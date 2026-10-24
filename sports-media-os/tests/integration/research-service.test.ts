import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseGuardError, toUserMessage } from "@/lib/db/errors";
import {
  addSource,
  answerQuestion,
  createClaim,
  createItem,
  linkClaimSource,
  listResearchOverview,
  loadClaimEvidence,
  loadWorkspace,
  setClaimStatus,
  setLinkRelation,
  unlinkClaimSource,
  updateClaim,
  updateItem,
} from "@/lib/research/service";
import { researchItemSchema, sourceFormSchema } from "@/lib/research/schema";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Research Workspace services against the running Supabase stack, called the
 * way the app calls them: with a SIGNED-IN user's client (RLS applies, the DB
 * stamps checked_by from auth.uid()), always filtered by the active project.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db };

async function signedInUser(): Promise<User> {
  const email = `research-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
  return { id: data.user.id, db };
}

async function newProject(user: User, name: string) {
  const { data, error } = await user.db
    .from("projects")
    .insert({ owner_id: user.id, name, slug: `research-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.projects.push(data.id);
  return data.id;
}

async function newSource(user: User, projectId: string, name: string, extra: Partial<Database["public"]["Tables"]["sources"]["Insert"]> = {}) {
  const { data, error } = await user.db
    .from("sources")
    .insert({ project_id: projectId, name, title: `${name}: Bologna win at San Siro`, url: `https://example.test/${randomUUID()}`, ...extra })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** opportunity with a trend (2 sources) — like one created from the radar */
async function seedOpportunity(user: User, projectId: string, title: string) {
  const { data: trend, error: trendError } = await user.db.from("trends").insert({ project_id: projectId, title }).select("id").single();
  if (trendError) throw new Error(trendError.message);
  const trendSources = [await newSource(user, projectId, "Agency"), await newSource(user, projectId, "Daily")];
  const { error: linkError } = await user.db
    .from("trend_sources")
    .insert(trendSources.map((source_id) => ({ project_id: projectId, trend_id: trend.id, source_id })));
  if (linkError) throw new Error(linkError.message);
  const { data: opp, error } = await user.db
    .from("opportunities")
    .insert({ project_id: projectId, title, trend_id: trend.id, why_now: "Finished two hours ago" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { opportunityId: opp.id, trendSources };
}

let alice: User;
let bob: User;
let projectA = "";
let projectA2 = ""; // Alice's second project
let projectB = ""; // Bob's project
let oppA = "";
let oppA2 = "";
let oppB = "";
let trendSourcesA: string[] = [];
let sourceA2 = "";
let sourceB = "";

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  projectA = await newProject(alice, "Research A");
  projectA2 = await newProject(alice, "Research A2");
  projectB = await newProject(bob, "Research B");
  const a = await seedOpportunity(alice, projectA, "Bologna stun Inter 3-0 at San Siro");
  oppA = a.opportunityId;
  trendSourcesA = a.trendSources;
  oppA2 = (await seedOpportunity(alice, projectA2, "Other project story")).opportunityId;
  oppB = (await seedOpportunity(bob, projectB, "Foreign story")).opportunityId;
  sourceA2 = await newSource(alice, projectA2, "A2 Source");
  sourceB = await newSource(bob, projectB, "Foreign");
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

const guard = (error: unknown) => parseGuardError(error as never)?.code;

describe("workspace loader", () => {
  it("returns the opportunity with its trend sources, rights state and empty groups", async () => {
    // a YELLOW classification on one trend source (rights live on the asset)
    const { error } = await alice.db
      .from("rights_checks")
      .insert({ project_id: projectA, source_id: trendSourcesA[0], status: "yellow", owner: "Agency", risk: "medium" });
    expect(error).toBeNull();

    const res = await loadWorkspace(alice.db, projectA, oppA);
    expect(res.error).toBeNull();
    const ws = res.data!;
    expect(ws.opportunity).toMatchObject({ id: oppA, title: "Bologna stun Inter 3-0 at San Siro", why_now: "Finished two hours ago" });
    expect(ws.sources.map((s) => s.id).sort()).toEqual([...trendSourcesA].sort());
    expect(ws.sources.every((s) => s.origins.includes("trend"))).toBe(true);
    const yellow = ws.sources.find((s) => s.id === trendSourcesA[0])!;
    expect(yellow).toMatchObject({ rightsStatus: "yellow", usableInProduction: false, awaitingApproval: true });
    expect(ws.sources.find((s) => s.id === trendSourcesA[1])).toMatchObject({ rightsStatus: "unchecked", usableInProduction: false });
    expect(Object.keys(ws.items).sort()).toEqual(
      ["article", "competitor", "context", "media", "note", "question", "quote", "timeline", "video"].sort(),
    );
    expect(ws.progress).toMatchObject({ sources: 2, claims: 0, openQuestions: 0, unconfirmedCritical: 0 });
    expect(ws.researchJob).toBeNull();
  });

  it("is isolated per project: another member's project, a foreign user and a mismatched project all get NOT_FOUND", async () => {
    // Bob cannot see Alice's opportunity (RLS) even when asking with her project id
    expect(guard((await loadWorkspace(bob.db, projectA, oppA)).error)).toBe("NOT_FOUND");
    // Alice sees both her projects, but the workspace is always filtered by the active project
    expect(guard((await loadWorkspace(alice.db, projectA2, oppA)).error)).toBe("NOT_FOUND");
    expect(guard((await loadWorkspace(alice.db, projectA, oppA2)).error)).toBe("NOT_FOUND");
    expect((await loadWorkspace(alice.db, projectA2, oppA2)).data?.opportunity.id).toBe(oppA2);
    expect(guard((await loadWorkspace(alice.db, projectA, oppB)).error)).toBe("NOT_FOUND");
    // the overview lists only the active project's opportunities
    const overview = await listResearchOverview(alice.db, projectA);
    expect(overview.data!.map((r) => r.id)).toEqual([oppA]);
    expect((await listResearchOverview(bob.db, projectA)).data).toEqual([]);
  });
});

describe("sources", () => {
  it("adds a source with a canonical link, then reuses it for the same link (tracking params ignored)", async () => {
    const url = `https://www.example.test/news/${randomUUID()}`;
    const first = await addSource(alice.db, {
      projectId: projectA,
      opportunityId: oppA,
      userId: alice.id,
      input: sourceFormSchema.parse({ url: `${url}/?utm_source=x#top`, title: "Orsolini double sinks Inter", publisher: "Gazzetta" }),
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ existingSource: false, alreadyLinked: false });
    const { data: stored } = await alice.db.from("sources").select("url, name, rights_status").eq("id", first.data!.sourceId).single();
    expect(stored).toEqual({ url, name: "Gazzetta", rights_status: "unchecked" });

    const again = await addSource(alice.db, { projectId: projectA, opportunityId: oppA, userId: alice.id, input: sourceFormSchema.parse({ url }) });
    expect(again.data).toMatchObject({ sourceId: first.data!.sourceId, existingSource: true, alreadyLinked: true });

    // an existing project source (from the trend) is reused, not duplicated
    const { data: trendSource } = await alice.db.from("sources").select("url").eq("id", trendSourcesA[1]).single();
    const reuse = await addSource(alice.db, {
      projectId: projectA,
      opportunityId: oppA,
      userId: alice.id,
      input: sourceFormSchema.parse({ url: trendSource!.url }),
    });
    expect(reuse.data).toMatchObject({ sourceId: trendSourcesA[1], existingSource: true, alreadyLinked: false });

    const ws = (await loadWorkspace(alice.db, projectA, oppA)).data!;
    expect(ws.items.article.map((i) => i.sourceId)).toEqual(expect.arrayContaining([first.data!.sourceId, trendSourcesA[1]]));
    expect(ws.sources.find((s) => s.id === trendSourcesA[1])!.origins).toEqual(["research", "trend"]);
  });

  it("refuses to add a source to another project's opportunity", async () => {
    const res = await addSource(bob.db, {
      projectId: projectB,
      opportunityId: oppA,
      userId: bob.id,
      input: sourceFormSchema.parse({ url: "https://example.test/sneaky" }),
    });
    expect(guard(res.error)).toBe("NOT_FOUND");
  });
});

describe("research items", () => {
  it("creates typed items: a quote linked by URL becomes an attributed source, a timeline sorts by date", async () => {
    const quote = await createItem(alice.db, {
      projectId: projectA,
      opportunityId: oppA,
      userId: alice.id,
      input: researchItemSchema.parse({ type: "quote", speaker: "Coach", content: "We believed from minute one.", url: `https://club.test/${randomUUID()}` }),
    });
    expect(quote.error).toBeNull();
    for (const [title, occurredAt] of [
      ["Bologna win 3-0", "2026-10-04"],
      ["Inter top of the table", "2026-09-28"],
    ]) {
      const t = await createItem(alice.db, {
        projectId: projectA,
        opportunityId: oppA,
        userId: alice.id,
        input: researchItemSchema.parse({ type: "timeline", title, occurredAt, sourceId: trendSourcesA[0] }),
      });
      expect(t.error).toBeNull();
    }

    const ws = (await loadWorkspace(alice.db, projectA, oppA)).data!;
    const q = ws.items.quote[0];
    expect(q.meta.speaker).toBe("Coach");
    expect(q.source).not.toBeNull(); // the link was turned into a source record (rights live there)
    expect(ws.items.timeline.map((t) => t.title)).toEqual(["Inter top of the table", "Bologna win 3-0"]);

    // edit keeps the type; changing it is refused
    const edited = await updateItem(alice.db, {
      projectId: projectA,
      itemId: q.id,
      input: researchItemSchema.parse({ type: "quote", speaker: "Head coach", content: q.content, sourceId: q.sourceId }),
    });
    expect(edited.error).toBeNull();
    const wrongType = await updateItem(alice.db, {
      projectId: projectA,
      itemId: q.id,
      input: researchItemSchema.parse({ type: "note", content: "x" }),
    });
    expect(wrongType.error?.userMessage).toMatch(/type cannot be changed/);
  });

  it("answers and reopens a question (only questions, only in the active project)", async () => {
    const created = await createItem(alice.db, {
      projectId: projectA,
      opportunityId: oppA,
      userId: alice.id,
      input: researchItemSchema.parse({ type: "question", content: "Who refereed the match?" }),
    });
    const itemId = created.data!.id;
    expect((await loadWorkspace(alice.db, projectA, oppA)).data!.progress.openQuestions).toBe(1);

    expect((await answerQuestion(alice.db, { projectId: projectA, itemId, answered: true, answer: null, userId: alice.id })).error?.userMessage).toMatch(
      /Write the answer/,
    );
    expect(guard((await answerQuestion(alice.db, { projectId: projectA2, itemId, answered: true, answer: "x", userId: alice.id })).error)).toBe(
      "NOT_FOUND",
    );
    expect(guard((await answerQuestion(bob.db, { projectId: projectA, itemId, answered: true, answer: "x", userId: bob.id })).error)).toBe(
      "NOT_FOUND",
    );

    const answered = await answerQuestion(alice.db, { projectId: projectA, itemId, answered: true, answer: "Daniele Orsato", userId: alice.id });
    expect(answered.error).toBeNull();
    let ws = (await loadWorkspace(alice.db, projectA, oppA)).data!;
    const q = ws.items.question.find((i) => i.id === itemId)!;
    expect(q.meta).toMatchObject({ answered: true, answer: "Daniele Orsato" });
    expect(q.meta.answeredAt).toBeTruthy();
    expect(ws.progress).toMatchObject({ openQuestions: 0, answeredQuestions: 1 });

    await answerQuestion(alice.db, { projectId: projectA, itemId, answered: false, answer: null, userId: alice.id });
    ws = (await loadWorkspace(alice.db, projectA, oppA)).data!;
    expect(ws.items.question.find((i) => i.id === itemId)!.meta).toMatchObject({ answered: false, answeredAt: null });

    const note = await createItem(alice.db, { projectId: projectA, opportunityId: oppA, userId: alice.id, input: researchItemSchema.parse({ type: "note", content: "n" }) });
    expect((await answerQuestion(alice.db, { projectId: projectA, itemId: note.data!.id, answered: true, answer: "x", userId: alice.id })).error?.userMessage).toMatch(
      /Only questions/,
    );
  });
});

describe("claims ↔ sources", () => {
  it("creates claims critical + uncertain by default and refuses the same claim twice", async () => {
    const c = await createClaim(alice.db, { projectId: projectA, opportunityId: oppA, claim: "Inter had won all 6 home games before this one" });
    expect(c.error).toBeNull();
    const { data } = await alice.db.from("facts").select("status, is_critical, checked_by_agent").eq("id", c.data!.id).single();
    expect(data).toEqual({ status: "uncertain", is_critical: true, checked_by_agent: null });
    const dup = await createClaim(alice.db, { projectId: projectA, opportunityId: oppA, claim: "inter had won ALL 6 home games before this one." });
    expect(dup.error?.userMessage).toMatch(/already listed/);
    expect(guard((await createClaim(bob.db, { projectId: projectB, opportunityId: oppA, claim: "x" })).error)).toBe("NOT_FOUND");
  });

  it("links and unlinks sources; a source of another project is rejected even for a member of both", async () => {
    const fact = (await createClaim(alice.db, { projectId: projectA, opportunityId: oppA, claim: "Orsolini scored twice" })).data!.id;

    const crossProject = await linkClaimSource(alice.db, {
      projectId: projectA,
      factId: fact,
      sourceId: sourceA2,
      relation: "supports",
      excerpt: null,
      locator: null,
      userId: alice.id,
    });
    expect(crossProject.error?.code).toBe("23503");
    expect(toUserMessage(crossProject.error)).toMatch(/another project/);

    const foreign = await linkClaimSource(bob.db, {
      projectId: projectB,
      factId: fact,
      sourceId: sourceB,
      relation: "supports",
      excerpt: null,
      locator: null,
      userId: bob.id,
    });
    expect(guard(foreign.error)).toBe("NOT_FOUND");

    const linked = await linkClaimSource(alice.db, {
      projectId: projectA,
      factId: fact,
      sourceId: trendSourcesA[0],
      relation: "mentions",
      excerpt: "Orsolini (2) and Ndoye scored",
      locator: "para 2",
      userId: alice.id,
    });
    expect(linked.data).toMatchObject({ opportunityId: oppA, updated: false });
    // same source again = update the link
    const relinked = await linkClaimSource(alice.db, {
      projectId: projectA,
      factId: fact,
      sourceId: trendSourcesA[0],
      relation: "supports",
      excerpt: "Orsolini scored twice",
      locator: "para 2",
      userId: alice.id,
    });
    expect(relinked.data).toMatchObject({ updated: true });

    const claim = (await loadWorkspace(alice.db, projectA, oppA)).data!.claims.find((c) => c.id === fact)!;
    expect(claim.links).toHaveLength(1);
    expect(claim.links[0]).toMatchObject({ sourceId: trendSourcesA[0], relation: "supports", excerpt: "Orsolini scored twice", locator: "para 2" });
    expect(claim.links[0].source).toMatchObject({ rightsStatus: "yellow" });
    expect(claim.evidence).toMatchObject({ verdict: "supported", supports: 1, canConfirm: true });

    const evidence = (await loadClaimEvidence(alice.db, projectA, fact)).data!;
    expect(evidence.sources.map((s) => s.id)).toEqual([trendSourcesA[0]]);

    expect(guard((await unlinkClaimSource(bob.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[0] })).error)).toBe("NOT_FOUND");
    const unlinked = await unlinkClaimSource(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[0] });
    expect(unlinked.data).toMatchObject({ downgraded: false });
    expect(guard((await unlinkClaimSource(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[0] })).error)).toBe("NOT_FOUND");
  });

  it("confirm flow: an unsourced critical claim is refused, then accepted after linking a 'supports' source; the DB stamps the checker", async () => {
    const fact = (await createClaim(alice.db, { projectId: projectA, opportunityId: oppA, claim: "It was Inter's first home defeat of the season" })).data!.id;

    const refused = await setClaimStatus(alice.db, { projectId: projectA, factId: fact, status: "confirmed", confidence: 0.9, notes: null });
    expect(guard(refused.error)).toBe("CLAIM_UNSOURCED");
    expect(toUserMessage(refused.error)).toMatch(/supporting source/);

    // 'mentions' is not evidence
    await linkClaimSource(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[1], relation: "mentions", excerpt: null, locator: null, userId: alice.id });
    expect(guard((await setClaimStatus(alice.db, { projectId: projectA, factId: fact, status: "confirmed", confidence: 0.9, notes: null })).error)).toBe(
      "CLAIM_UNSOURCED",
    );

    await setLinkRelation(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[1], relation: "supports" });
    const ok = await setClaimStatus(alice.db, {
      projectId: projectA,
      factId: fact,
      status: "confirmed",
      confidence: 0.9,
      notes: "Checked against the Daily report",
    });
    expect(ok.error).toBeNull();
    const { data: row } = await alice.db.from("facts").select("status, confidence, checked_by, checked_at, notes").eq("id", fact).single();
    expect(row).toMatchObject({ status: "confirmed", confidence: 0.9, checked_by: alice.id, notes: "Checked against the Daily report" });
    expect(row!.checked_at).toBeTruthy();

    // other projects / users cannot change it
    expect(guard((await setClaimStatus(alice.db, { projectId: projectA2, factId: fact, status: "false", confidence: null, notes: null })).error)).toBe(
      "NOT_FOUND",
    );
    expect(guard((await setClaimStatus(bob.db, { projectId: projectB, factId: fact, status: "false", confidence: null, notes: null })).error)).toBe(
      "NOT_FOUND",
    );

    // demoting the only supporting link sends the claim back to uncertain (DB rule)
    await setLinkRelation(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[1], relation: "mentions" });
    expect((await alice.db.from("facts").select("status").eq("id", fact).single()).data!.status).toBe("uncertain");

    // confirm again, then unlinking the last supporting source downgrades it
    await setLinkRelation(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[1], relation: "supports" });
    await setClaimStatus(alice.db, { projectId: projectA, factId: fact, status: "confirmed", confidence: 0.9, notes: null });
    const unlinked = await unlinkClaimSource(alice.db, { projectId: projectA, factId: fact, sourceId: trendSourcesA[1] });
    expect(unlinked.data).toMatchObject({ downgraded: true });
    expect((await alice.db.from("facts").select("status").eq("id", fact).single()).data!.status).toBe("uncertain");
  });

  it("editing the wording resets a verified claim; non-critical claims may be confirmed without a source", async () => {
    const fact = (await createClaim(alice.db, { projectId: projectA, opportunityId: oppA, claim: "The match was played in rain", isCritical: false })).data!.id;
    expect((await setClaimStatus(alice.db, { projectId: projectA, factId: fact, status: "confirmed", confidence: 0.7, notes: null })).error).toBeNull();

    const sameWords = await updateClaim(alice.db, { projectId: projectA, factId: fact, claim: "The match was played in rain.", isCritical: false });
    expect(sameWords.data).toMatchObject({ statusReset: false });
    // making a confirmed claim critical without a supporting source is refused by the DB
    expect(guard((await updateClaim(alice.db, { projectId: projectA, factId: fact, claim: "The match was played in rain", isCritical: true })).error)).toBe(
      "CLAIM_UNSOURCED",
    );
    const reworded = await updateClaim(alice.db, { projectId: projectA, factId: fact, claim: "The match was played in heavy rain", isCritical: true });
    expect(reworded.data).toMatchObject({ statusReset: true });
    expect((await alice.db.from("facts").select("status, confidence, is_critical").eq("id", fact).single()).data).toEqual({
      status: "uncertain",
      confidence: null,
      is_critical: true,
    });
  });

  it("counts unconfirmed critical claims and open questions in the overview", async () => {
    const ws = (await loadWorkspace(alice.db, projectA, oppA)).data!;
    const row = (await listResearchOverview(alice.db, projectA)).data!.find((r) => r.id === oppA)!;
    expect(row.progress.unconfirmedCritical).toBe(ws.progress.unconfirmedCritical);
    expect(row.progress.openQuestions).toBe(ws.progress.openQuestions);
    expect(row.progress.sources).toBe(ws.progress.sources);
    expect(ws.progress.unconfirmedCritical).toBeGreaterThan(0);
    expect(row.blockers).toBe(1);
    expect(ws.gaps[0]).toMatchObject({ key: "unconfirmed_critical", severity: "blocker" });
  });
});
