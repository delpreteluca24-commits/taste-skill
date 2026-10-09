import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { suggestEditorialAlternatives } from "@/lib/rights/alternatives";
import type { ClassificationFields } from "@/lib/rights/schema";
import {
  classify,
  decideRights,
  getAsset,
  listAssets,
  loadStoryAlternatives,
  registerAsset,
  rightsSummary,
  setProductionFormats,
} from "@/lib/rights/service";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Rights Center services against the running Supabase stack, called the way
 * the app calls them: with a SIGNED-IN user's client (RLS applies,
 * record_approval sees auth.uid()) and, for automated callers, the service role.
 */

type Db = SupabaseClient<Database>;
type User = { id: string; db: Db };

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };

async function signedInUser(): Promise<User> {
  const email = `rights-${randomUUID()}@example.test`;
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
    .insert({ owner_id: user.id, name, slug: `rights-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.projects.push(data.id);
  return data.id;
}

function unwrap<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new Error(`unexpected error: ${JSON.stringify(res.error)}`);
  return res.data as NonNullable<T>;
}

async function newVideo(user: User, projectId: string, title = "Match footage") {
  return unwrap(
    await user.db
      .from("videos")
      .insert({ project_id: projectId, title, storage_path: `${projectId}/${randomUUID()}.mp4`, original_filename: "match.mp4", container: "mp4" })
      .select("id")
      .single(),
  ).id;
}

async function newSource(user: User, projectId: string, over: Partial<Database["public"]["Tables"]["sources"]["Insert"]> = {}) {
  return unwrap(
    await user.db
      .from("sources")
      .insert({ project_id: projectId, name: "Club TV", title: "Training clip", url: `https://example.test/${randomUUID()}`, source_type: "video", ...over })
      .select("id")
      .single(),
  ).id;
}

const fields = (over: Partial<ClassificationFields> = {}): ClassificationFields => ({
  status: "yellow",
  ownership: "unknown",
  owner: null,
  sourceDetail: null,
  license: null,
  commercialUse: null,
  authorization: null,
  transformationRequired: false,
  risk: null,
  evidenceUrl: null,
  notes: null,
  ...over,
});

const GREEN_LICENSED = fields({
  status: "green",
  ownership: "licensed",
  owner: "Club FC",
  sourceDetail: "Club media office",
  license: "Editorial + social, 12 months",
  commercialUse: true,
  authorization: "Email from press office, 2026-10-01",
  transformationRequired: true,
  risk: "Low",
  evidenceUrl: "https://example.test/license.pdf",
  notes: "Commentary only",
});

let alice: User;
let bob: User;
let projectA = "";
let projectB = "";

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  projectA = await newProject(alice, "Rights A");
  projectB = await newProject(bob, "Rights B");
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe("classify", () => {
  it("records all ten fields and the asset's derived status follows the latest check", async () => {
    const video = await newVideo(alice, projectA);
    const green = unwrap(await classify(alice.db, { projectId: projectA, assetType: "video", assetId: video, fields: GREEN_LICENSED }));
    expect(green).toMatchObject({ status: "green", rightsStatus: "green", usable: true });

    const check = unwrap(await alice.db.from("rights_checks").select("*").eq("id", green.checkId).single());
    expect(check).toMatchObject({
      project_id: projectA,
      video_id: video,
      source_id: null,
      status: "green",
      ownership: "licensed",
      owner: "Club FC",
      source_detail: "Club media office",
      license: "Editorial + social, 12 months",
      commercial_use: true,
      authorization_details: "Email from press office, 2026-10-01",
      transformation_required: true,
      risk: "Low",
      evidence_url: "https://example.test/license.pdf",
      notes: "Commentary only",
      checked_by: alice.id, // stamped by the DB, never by the client
      checked_by_agent: null,
    });

    const red = unwrap(
      await classify(alice.db, {
        projectId: projectA,
        assetType: "video",
        assetId: video,
        fields: fields({ status: "red", ownership: "third_party", commercialUse: false, risk: "Takedown notice received" }),
      }),
    );
    expect(red).toMatchObject({ status: "red", rightsStatus: "red", usable: false });

    const detail = unwrap(await getAsset(alice.db, projectA, "video", video));
    expect(detail.checks.map((c) => [c.status, c.isLatest])).toEqual([
      ["red", true],
      ["green", false],
    ]);
    expect(detail.latest?.id).toBe(red.checkId);
    expect(detail.asset).toMatchObject({ rightsStatus: "red", usable: false, awaitingApproval: false, risk: "Takedown notice received" });
    expect(detail.approvable).toBe(false);
    expect(detail.checks[0].checkedBy).toBeTruthy();
  });

  it("refuses a GREEN without a documented basis (DB rule) with a friendly message", async () => {
    const video = await newVideo(alice, projectA);
    const res = await classify(alice.db, {
      projectId: projectA,
      assetType: "video",
      assetId: video,
      fields: fields({ status: "green", ownership: "licensed", commercialUse: true }), // no evidence link
    });
    expect(res.error?.code).toBe("23514");
    expect(res.error?.userMessage).toMatch(/GREEN needs confirmed commercial use/);
    expect(unwrap(await alice.db.from("videos").select("rights_status").eq("id", video).single()).rights_status).toBe("unchecked");
  });

  it("only classifies assets of the given project", async () => {
    const bobVideo = await newVideo(bob, projectB);
    // alice's project + bob's asset: not in the project
    const a = await classify(alice.db, { projectId: projectA, assetType: "video", assetId: bobVideo, fields: fields() });
    expect(a.error?.message).toMatch(/^NOT_FOUND/);
    // bob's project from alice's session: RLS hides it
    const b = await classify(alice.db, { projectId: projectB, assetType: "video", assetId: bobVideo, fields: fields() });
    expect(b.error).not.toBeNull();
    expect(unwrap(await admin.from("rights_checks").select("id").eq("video_id", bobVideo))).toHaveLength(0);
  });

  it("automated callers (service role) may suggest YELLOW or RED, never GREEN", async () => {
    const source = await newSource(alice, projectA);
    const green = await classify(admin, {
      projectId: projectA,
      assetType: "source",
      assetId: source,
      fields: fields({ status: "green", ownership: "owned", commercialUse: true }),
      agent: "rights",
    });
    expect(green.error?.code).toBe("AGENT_GREEN");

    const yellow = unwrap(await classify(admin, { projectId: projectA, assetType: "source", assetId: source, fields: fields(), agent: "rights" }));
    expect(yellow).toMatchObject({ status: "yellow", usable: false });
    const row = unwrap(await admin.from("rights_checks").select("checked_by, checked_by_agent").eq("id", yellow.checkId).single());
    expect(row).toEqual({ checked_by: null, checked_by_agent: "rights" });
  });
});

describe("YELLOW usage approval", () => {
  it("approve makes it usable (humans only); a later rejection revokes it", async () => {
    const source = await newSource(alice, projectA, { title: "Fan video of the goal" });
    const check = unwrap(
      await classify(alice.db, { projectId: projectA, assetType: "source", assetId: source, fields: fields({ ownership: "creator_provided", commercialUse: true }) }),
    );
    expect(check.usable).toBe(false);
    let detail = unwrap(await getAsset(alice.db, projectA, "source", source));
    expect(detail).toMatchObject({ approvable: true, asset: { awaitingApproval: true, usable: false } });

    const approved = unwrap(
      await decideRights(alice.db, { projectId: projectA, checkId: check.checkId, decision: "approved", notes: "Creator confirmed by DM, screenshot in Drive" }),
    );
    expect(approved).toMatchObject({ assetType: "source", assetId: source, usable: true });
    detail = unwrap(await getAsset(alice.db, projectA, "source", source));
    expect(detail.asset).toMatchObject({ rightsStatus: "yellow", usable: true, awaitingApproval: false });
    expect(detail.latest?.approvals).toHaveLength(1);
    expect(detail.latest?.approvals[0]).toMatchObject({ decision: "approved", notes: "Creator confirmed by DM, screenshot in Drive" });
    expect(detail.latest?.approvals[0].decidedBy).toBeTruthy();

    const rejected = unwrap(await decideRights(alice.db, { projectId: projectA, checkId: check.checkId, decision: "rejected", notes: "Creator withdrew permission" }));
    expect(rejected.usable).toBe(false);
    detail = unwrap(await getAsset(alice.db, projectA, "source", source));
    expect(detail.asset).toMatchObject({ usable: false, awaitingApproval: true });
    // newest decision first (approvals.seq)
    expect(detail.latest?.approvals.map((a) => a.decision)).toEqual(["rejected", "approved"]);

    // an approved YELLOW never counts for automated production
    const listed = unwrap(await listAssets(alice.db, projectA, { awaitingApproval: true }));
    expect(listed.items.map((i) => i.assetId)).toContain(source);
  });

  it("RED can never be approved (service and DB), GREEN needs no approval", async () => {
    const video = await newVideo(alice, projectA);
    const red = unwrap(
      await classify(alice.db, { projectId: projectA, assetType: "video", assetId: video, fields: fields({ status: "red", ownership: "third_party", commercialUse: false }) }),
    );
    const res = await decideRights(alice.db, { projectId: projectA, checkId: red.checkId, decision: "approved", notes: "Trying to approve RED anyway" });
    expect(res.error?.code).toBe("RIGHTS_APPROVAL_INVALID");
    expect(res.error?.userMessage).toMatch(/RED assets never enter production/);

    // the DB refuses it as well, whoever calls it
    const rpc = await alice.db.rpc("record_approval", { p_checkpoint: "rights", p_entity_id: red.checkId, p_decision: "approved" });
    expect(rpc.error?.message).toMatch(/^RIGHTS_APPROVAL_INVALID/);
    expect(unwrap(await alice.db.from("videos").select("usable_in_production").eq("id", video).single()).usable_in_production).toBe(false);

    const green = unwrap(await classify(alice.db, { projectId: projectA, assetType: "video", assetId: video, fields: GREEN_LICENSED }));
    const g = await decideRights(alice.db, { projectId: projectA, checkId: green.checkId, decision: "approved", notes: "Not needed but trying" });
    expect(g.error?.userMessage).toMatch(/only YELLOW needs a usage approval/);
  });

  it("decides only on the latest classification", async () => {
    const source = await newSource(alice, projectA);
    const first = unwrap(await classify(alice.db, { projectId: projectA, assetType: "source", assetId: source, fields: fields() }));
    await new Promise((r) => setTimeout(r, 5)); // checked_at orders checks
    unwrap(await classify(alice.db, { projectId: projectA, assetType: "source", assetId: source, fields: fields({ notes: "re-checked" }) }));
    const res = await decideRights(alice.db, { projectId: projectA, checkId: first.checkId, decision: "approved", notes: "Approving the stale check" });
    expect(res.error?.userMessage).toMatch(/newer classification/);
  });

  it("can't decide on another project's classification", async () => {
    const bobSource = await newSource(bob, projectB);
    const check = unwrap(await classify(bob.db, { projectId: projectB, assetType: "source", assetId: bobSource, fields: fields() }));
    const res = await decideRights(alice.db, { projectId: projectA, checkId: check.checkId, decision: "approved", notes: "Not my project at all" });
    expect(res.error?.message).toMatch(/^NOT_FOUND/);
    expect(unwrap(await admin.from("sources").select("usable_in_production").eq("id", bobSource).single()).usable_in_production).toBe(false);
  });
});

describe("register asset", () => {
  it("is idempotent by canonical url and maps the kind to a source type", async () => {
    const path = `/media/${randomUUID()}`;
    const first = unwrap(
      await registerAsset(alice.db, {
        projectId: projectA,
        input: { url: `https://WWW.Club.test${path}/?utm_source=x#t=10`, title: "Goal from the stands", publisher: null, kind: "image" },
      }),
    );
    expect(first.existing).toBe(false);
    const row = unwrap(await alice.db.from("sources").select("url, name, title, source_type, metadata, rights_status").eq("id", first.sourceId).single());
    expect(row).toMatchObject({
      url: `https://www.club.test${path}`,
      name: "club.test",
      title: "Goal from the stands",
      source_type: "other",
      metadata: { added_from: "rights_center", asset_kind: "image" },
      rights_status: "unchecked",
    });

    const again = unwrap(
      await registerAsset(alice.db, { projectId: projectA, input: { url: `https://www.club.test${path}`, title: "Other title", publisher: "Club", kind: "video" } }),
    );
    expect(again).toEqual({ sourceId: first.sourceId, existing: true });
    expect(unwrap(await alice.db.from("sources").select("id").eq("project_id", projectA).eq("url", row.url))).toHaveLength(1);

    // the same link in another project is that project's own asset
    const other = unwrap(await registerAsset(bob.db, { projectId: projectB, input: { url: `https://www.club.test${path}`, title: null, publisher: null, kind: "social" } }));
    expect(other.existing).toBe(false);
    expect(other.sourceId).not.toBe(first.sourceId);
  });

  it("reuses a legacy, non-canonical copy of the link", async () => {
    const legacy = `https://example.test/legacy/${randomUUID()}/?utm_campaign=y`;
    const id = await newSource(alice, projectA, { url: legacy });
    expect(unwrap(await registerAsset(alice.db, { projectId: projectA, input: { url: legacy, title: null, publisher: null, kind: "video" } }))).toEqual({
      sourceId: id,
      existing: true,
    });
  });
});

describe("listAssets and summary", () => {
  let p: string;
  let ids: Record<"green" | "yellow" | "red" | "unchecked" | "upload", string>;

  beforeAll(async () => {
    p = await newProject(alice, "Rights list");
    ids = {
      green: await newSource(alice, p, { title: "Owned graphics pack", source_type: "official" }),
      yellow: await newSource(alice, p, { title: "Derby fan clip", source_type: "social" }),
      red: await newSource(alice, p, { title: "Broadcast highlights 50% off", source_type: "video" }),
      unchecked: await newSource(alice, p, { title: "Match report", source_type: "news" }),
      upload: await newVideo(alice, p, "Press conference upload"),
    };
    unwrap(await classify(alice.db, { projectId: p, assetType: "source", assetId: ids.green, fields: fields({ status: "green", ownership: "owned", commercialUse: true }) }));
    unwrap(await classify(alice.db, { projectId: p, assetType: "source", assetId: ids.yellow, fields: fields() }));
    unwrap(await classify(alice.db, { projectId: p, assetType: "source", assetId: ids.red, fields: fields({ status: "red", ownership: "third_party" }) }));
    await newVideo(bob, projectB, "Bob's footage");
  });

  it("lists every asset of the project with its latest classification, awaiting approval first", async () => {
    const all = unwrap(await listAssets(alice.db, p));
    expect(all.total).toBe(5);
    expect(all.items[0]).toMatchObject({ assetId: ids.yellow, rightsStatus: "yellow", awaitingApproval: true });
    const green = all.items.find((i) => i.assetId === ids.green)!;
    expect(green).toMatchObject({ assetType: "source", rightsStatus: "green", usable: true, ownership: "owned", commercialUse: true, checkId: expect.any(String) });
    expect(all.items.find((i) => i.assetId === ids.upload)).toMatchObject({ assetType: "video", rightsStatus: "unchecked", checkId: null, kind: "mp4" });
  });

  it("filters by status, type, awaiting approval and search", async () => {
    const ofStatus = async (status: "green" | "red" | "unchecked") => unwrap(await listAssets(alice.db, p, { status })).items.map((i) => i.assetId);
    expect(await ofStatus("green")).toEqual([ids.green]);
    expect(await ofStatus("red")).toEqual([ids.red]);
    expect((await ofStatus("unchecked")).sort()).toEqual([ids.unchecked, ids.upload].sort());

    expect(unwrap(await listAssets(alice.db, p, { type: "upload" })).items.map((i) => i.assetId)).toEqual([ids.upload]);
    expect(unwrap(await listAssets(alice.db, p, { type: "official" })).items.map((i) => i.assetId)).toEqual([ids.green]);
    expect(unwrap(await listAssets(alice.db, p, { type: "article" })).items.map((i) => i.assetId)).toEqual([ids.unchecked]);
    expect(unwrap(await listAssets(alice.db, p, { awaitingApproval: true })).items.map((i) => i.assetId)).toEqual([ids.yellow]);
    // case-insensitive, and LIKE wildcards are literal
    expect(unwrap(await listAssets(alice.db, p, { search: "DERBY" })).items.map((i) => i.assetId)).toEqual([ids.yellow]);
    expect(unwrap(await listAssets(alice.db, p, { search: "50%" })).items.map((i) => i.assetId)).toEqual([ids.red]);
    expect(unwrap(await listAssets(alice.db, p, { search: "%" })).items).toHaveLength(1);
  });

  it("is isolated between projects", async () => {
    const mine = unwrap(await listAssets(alice.db, p));
    expect(mine.items.some((i) => i.title === "Bob's footage")).toBe(false);
    // another project's id from alice's session: RLS returns nothing
    expect(unwrap(await listAssets(alice.db, projectB)).items).toEqual([]);
    expect(unwrap(await rightsSummary(alice.db, projectB)).total).toBe(0);
    // the service role still only sees the requested project
    const asWorker = unwrap(await listAssets(admin, p));
    expect(asWorker.total).toBe(5);
    expect((await getAsset(alice.db, projectA, "source", ids.green)).error?.message).toMatch(/^NOT_FOUND/);
  });

  it("summarises counts per status and awaiting approval", async () => {
    expect(unwrap(await rightsSummary(alice.db, p))).toEqual({
      total: 5,
      green: 1,
      yellow: 1,
      red: 1,
      unchecked: 2,
      awaitingApproval: 1,
      usable: 1,
      uncheckedMedia: 1, // the upload; the news article is a reference
    });
  });
});

describe("STORY ≠ FOOTAGE", () => {
  async function storyFixture(user: User, projectId: string) {
    const opp = unwrap(await user.db.from("opportunities").insert({ project_id: projectId, title: "Bologna stun Inter" }).select("id").single()).id;
    const story = unwrap(await user.db.from("stories").insert({ project_id: projectId, title: "How Bologna won at San Siro", opportunity_id: opp }).select("id").single()).id;
    return { opp, story };
  }

  it("gathers the story's assets with their rights and the research material", async () => {
    const { opp, story } = await storyFixture(alice, projectA);
    // footage: a RED broadcast clip from research media, a GREEN upload cut into a clip, a news article as reference
    const broadcast = await newSource(alice, projectA, { title: "Broadcast highlights", source_type: "video" });
    unwrap(await classify(alice.db, { projectId: projectA, assetType: "source", assetId: broadcast, fields: fields({ status: "red", ownership: "third_party" }) }));
    const article = await newSource(alice, projectA, { title: "Match report", source_type: "news" });
    const upload = await newVideo(alice, projectA, "Our studio recording");
    unwrap(await classify(alice.db, { projectId: projectA, assetType: "video", assetId: upload, fields: fields({ status: "green", ownership: "owned", commercialUse: true }) }));
    const item = unwrap(await alice.db.from("content_items").insert({ project_id: projectA, story_id: story, title: "Short" }).select("id").single()).id;
    unwrap(await alice.db.from("clips").insert({ project_id: projectA, video_id: upload, content_item_id: item, start_sec: 0, end_sec: 20 }).select("id").single());

    unwrap(
      await alice.db
        .from("research_items")
        .insert([
          { project_id: projectA, opportunity_id: opp, item_type: "media", title: "Broadcast highlights", source_id: broadcast },
          { project_id: projectA, opportunity_id: opp, item_type: "article", title: "Match report", source_id: article },
          { project_id: projectA, opportunity_id: opp, item_type: "timeline", title: "Kick-off at San Siro" },
          { project_id: projectA, opportunity_id: opp, item_type: "timeline", title: "First goal" },
          { project_id: projectA, opportunity_id: opp, item_type: "quote", title: "Coach", content: "We believed.", url: "https://example.test/presser" },
        ])
        .select("id"),
    );
    unwrap(
      await alice.db
        .from("facts")
        .insert([
          { project_id: projectA, opportunity_id: opp, claim: "Bologna won 3-0", status: "confirmed", is_critical: false },
          { project_id: projectA, story_id: story, claim: "Played in October", status: "confirmed", is_critical: false },
          { project_id: projectA, content_item_id: item, claim: "Second win in a row", status: "confirmed", is_critical: false },
          { project_id: projectA, opportunity_id: opp, claim: "Attendance 75,000", status: "uncertain", is_critical: false },
        ])
        .select("id"),
    );

    const data = unwrap(await loadStoryAlternatives(alice.db, projectA, story));
    expect(data.story).toMatchObject({ id: story, status: "draft", productionFormats: [] });
    expect(data.opportunity).toEqual({ id: opp, title: "Bologna stun Inter" });
    expect(data.assets.map((a) => [a.assetId, a.status, a.usable, a.via]).sort()).toEqual(
      [
        [broadcast, "red", false, "research"],
        [upload, "green", true, "clip"],
      ].sort(),
    );
    expect(data.referenceArticles).toBe(1);
    expect(data.material).toMatchObject({ confirmedFacts: 3, timelineItems: 2, quotes: 1, hasStatistics: true, hasLocations: true });
    expect(suggestEditorialAlternatives(data.material).footageStatus).toBe("partial");
  });

  it("a story without usable footage still gets original formats", async () => {
    const { story } = await storyFixture(alice, projectA);
    const data = unwrap(await loadStoryAlternatives(alice.db, projectA, story));
    expect(data.assets).toEqual([]);
    const result = suggestEditorialAlternatives(data.material);
    expect(result.footageStatus).toBe("none");
    expect(result.suggestions[0].format).toBe("original_commentary");
  });

  it("saves production formats only for a story of the project", async () => {
    const { story } = await storyFixture(alice, projectA);
    expect(unwrap(await setProductionFormats(alice.db, { projectId: projectA, storyId: story, formats: ["original_commentary", "statistics"] }))).toEqual({
      formats: ["original_commentary", "statistics"],
    });
    expect(unwrap(await loadStoryAlternatives(alice.db, projectA, story)).story.productionFormats).toEqual(["original_commentary", "statistics"]);

    const bobStory = await storyFixture(bob, projectB);
    // wrong project for the story, and another project's id from alice's session: both refused
    expect((await setProductionFormats(alice.db, { projectId: projectA, storyId: bobStory.story, formats: ["voiceover"] })).error?.message).toMatch(/^NOT_FOUND/);
    expect((await setProductionFormats(alice.db, { projectId: projectB, storyId: bobStory.story, formats: ["voiceover"] })).error?.message).toMatch(/^NOT_FOUND/);
    // even the service role is scoped by the project id it is given
    expect((await setProductionFormats(admin, { projectId: projectA, storyId: bobStory.story, formats: ["voiceover"] })).error?.message).toMatch(/^NOT_FOUND/);
    expect(unwrap(await admin.from("stories").select("production_formats").eq("id", bobStory.story).single()).production_formats).toEqual([]);
    expect((await loadStoryAlternatives(alice.db, projectA, bobStory.story)).error?.message).toMatch(/^NOT_FOUND/);
  });
});

describe("asset usage", () => {
  it("links a source back to the research of the opportunities using it", async () => {
    const opp = unwrap(await alice.db.from("opportunities").insert({ project_id: projectA, title: "Usage opportunity" }).select("id").single()).id;
    const source = await newSource(alice, projectA, { title: "Club statement video" });
    unwrap(
      await alice.db
        .from("research_items")
        .insert([
          { project_id: projectA, opportunity_id: opp, item_type: "video", title: "Statement", source_id: source },
          { project_id: projectA, opportunity_id: opp, item_type: "media", title: "Statement (media)", source_id: source },
        ])
        .select("id"),
    );
    const upload = unwrap(
      await alice.db.from("videos").insert({ project_id: projectA, title: "Downloaded with permission", storage_path: `${projectA}/${randomUUID()}.mp4`, source_id: source }).select("id").single(),
    ).id;

    const detail = unwrap(await getAsset(alice.db, projectA, "source", source));
    expect(detail.usage.opportunities).toEqual([{ id: opp, title: "Usage opportunity", status: "new", itemTypes: expect.arrayContaining(["video", "media"]) }]);
    expect(detail.usage.videos).toEqual([{ id: upload, title: "Downloaded with permission" }]);
    expect(detail.details).toMatchObject({ type: "source", sourceType: "video", fromConnector: false });

    const video = unwrap(await getAsset(alice.db, projectA, "video", upload));
    expect(video.details).toMatchObject({ type: "video", source: { id: source, title: "Club statement video" } });
  });
});
