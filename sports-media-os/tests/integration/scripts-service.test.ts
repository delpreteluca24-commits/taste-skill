import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider } from "@/lib/ai/types";
import { parseGuardError } from "@/lib/db/errors";
import { parseWarning } from "@/lib/scripts/grounding";
import {
  addManualHook,
  createManualVersion,
  decideScript,
  getHookStudio,
  getScriptStudio,
  listHooks,
  listVersions,
  loadStoryMaterial,
  selectHook,
  setCurrentScript,
} from "@/lib/scripts/service";
import type { Database } from "@/types/database";
import { createJobContext, JobInputError, type JobContext } from "@/workers/context";
import { handler as hooksHandler } from "@/workers/handlers/hooks-generate";
import { handler as generateHandler } from "@/workers/handlers/script-generate";
import { handler as transformHandler } from "@/workers/handlers/script-transform";

import { pool } from "./db";

/**
 * Script Studio & Hook Studio end to end against the real database:
 * services as the signed-in user (RLS + project filter), worker handlers with
 * the SERVICE ROLE and a fake model. Versions are new rows, the current one is
 * approved by a person, hooks have one selection, and nothing crosses projects.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db };

async function signedInUser(): Promise<User> {
  const email = `scripts-${randomUUID()}@example.test`;
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

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(error?.message ?? "no data");
  return data as NonNullable<T>;
}

async function seed(user: User, name: string) {
  const project = await must(
    user.db.from("projects").insert({ owner_id: user.id, name, slug: `sc-${randomUUID().slice(0, 8)}` }).select("id").single(),
  );
  created.projects.push(project.id);
  const opp = await must(
    user.db.from("opportunities").insert({ project_id: project.id, title: `${name}: Bologna stun Inter`, angle: "The pressing trap" }).select("id").single(),
  );
  const story = await must(
    user.db
      .from("stories")
      .insert({ project_id: project.id, opportunity_id: opp.id, title: `${name}: Bologna stun Inter at San Siro`, production_formats: ["voiceover", "graphics"] })
      .select("id")
      .single(),
  );
  const content = await must(
    user.db.from("content_items").insert({ project_id: project.id, opportunity_id: opp.id, story_id: story.id, title: "Short", stage: "script" }).select("id").single(),
  );
  const source = await must(
    user.db.from("sources").insert({ project_id: project.id, name: "Agency", title: "Match report", url: `https://example.test/${randomUUID()}` }).select("id").single(),
  );
  const facts = await must(
    user.db
      .from("facts")
      .insert([
        { project_id: project.id, opportunity_id: opp.id, claim: "Bologna beat Inter 3-0 at San Siro", status: "confirmed" as const, is_critical: false },
        { project_id: project.id, story_id: story.id, claim: "Orsolini scored twice in the second half", status: "probable" as const, is_critical: false },
        { project_id: project.id, opportunity_id: opp.id, claim: "Inter won the match", status: "false" as const, is_critical: false },
      ])
      .select("id, claim"),
  );
  const byClaim = (prefix: string) => facts.find((f) => f.claim.startsWith(prefix))!.id;
  await must(user.db.from("fact_sources").insert({ project_id: project.id, fact_id: byClaim("Bologna"), source_id: source.id }).select("fact_id"));
  const quote = await must(
    user.db
      .from("research_items")
      .insert({
        project_id: project.id,
        opportunity_id: opp.id,
        item_type: "quote",
        content: "We pressed them like never before.",
        source_id: source.id,
        metadata: { speaker: "Italiano" },
      })
      .select("id")
      .single(),
  );
  return {
    projectId: project.id,
    storyId: story.id,
    contentId: content.id,
    sourceId: source.id,
    quoteId: quote.id,
    facts: { score: byClaim("Bologna"), brace: byClaim("Orsolini"), refuted: byClaim("Inter won") },
  };
}

let alice: User;
let bob: User;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  a = await seed(alice, "Scripts A");
  b = await seed(bob, "Scripts B");
});

afterAll(async () => {
  await pool.query("delete from public.jobs where project_id = any($1)", [created.projects]);
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

/** a job already claimed by a worker (status running) */
async function runningJob(projectId: string, type: string, payload: unknown, createdBy: string) {
  const { rows } = await pool.query(
    `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at, created_by)
     values ($1, $2, $3, 'running', 1, now(), 'test', now(), $4) returning *`,
    [projectId, type, JSON.stringify(payload), createdBy],
  );
  return rows[0];
}

/** fake provider behind the real router: answers in order, records what the model was sent */
function fakeAI(outputs: unknown[]) {
  const requests: { system: string; messages: { content: string }[] }[] = [];
  const provider: AIProvider = {
    id: "anthropic",
    isConfigured: () => true,
    complete: async (_model, request): Promise<AICallResult> => {
      requests.push(request as never);
      const out = outputs[Math.min(requests.length - 1, outputs.length - 1)];
      return {
        text: JSON.stringify(out),
        usage: { inputTokens: 3000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 },
        servedModel: "claude-sonnet-5-5",
        latencyMs: 4,
        stopReason: "end_turn",
      };
    },
  };
  const router = createAIRouter({
    providers: { anthropic: provider },
    resolveConfig: (task) => ({ task, primary: { provider: "anthropic", model: "claude-sonnet-5-5" }, fallbacks: [], effort: "medium", maxOutputTokens: 4000, source: "default" }),
  });
  return { router, requests };
}

function contextFor(job: Parameters<typeof createJobContext>[1], ai: ReturnType<typeof fakeAI>): JobContext {
  return { ...createJobContext(admin, job), ai: async () => ai.router };
}

const promptData = (content: string) => JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(content)![1]);

const scriptOut = (over: Record<string, unknown> = {}) => ({
  hook: "Bologna won 3-0 at San Siro.",
  context: "Inter lost at home.",
  escalation: "Orsolini scored twice in the second half, reports suggest.",
  reveal: "The press came from the wide players.",
  payoff: "A plan others will copy.",
  cta: "Follow for the breakdown.",
  facts_used: [a.facts.score, a.facts.brace],
  quote_ids: [],
  missing: [],
  ...over,
});

const isNotFound = (error: unknown) => parseGuardError(error as never)?.code === "NOT_FOUND";

describe("story material (what the model may use)", () => {
  it("holds the story's own claims (refuted ones excluded), sources, quotes and formats", async () => {
    const res = await loadStoryMaterial(alice.db, a.projectId, a.storyId);
    expect(res.error).toBeNull();
    const { context, allFacts, story } = res.data!;
    expect(context.facts.map((f) => f.id).sort()).toEqual([a.facts.score, a.facts.brace].sort());
    expect(context.facts.find((f) => f.id === a.facts.score)).toMatchObject({ status: "confirmed", sourceIds: [a.sourceId] });
    expect(allFacts.map((f) => f.id)).toContain(a.facts.refuted);
    expect(context.sources).toEqual([{ id: a.sourceId, title: "Match report", publisher: "Agency" }]);
    expect(context.quotes).toEqual([{ id: a.quoteId, speaker: "Italiano", text: "We pressed them like never before.", sourceId: a.sourceId }]);
    expect(story.productionFormats).toEqual(["voiceover", "graphics"]);
    expect(context.language).toBe("en");
  });

  it("refuses another project's story", async () => {
    expect(isNotFound((await loadStoryMaterial(bob.db, b.projectId, a.storyId)).error)).toBe(true);
    expect(isNotFound((await loadStoryMaterial(bob.db, a.projectId, a.storyId)).error)).toBe(true);
  });
});

describe("script.generate (Story agent)", () => {
  it("stores one grounded version per angle; only the first becomes current; nothing is approved", async () => {
    const ai = fakeAI([
      scriptOut({ facts_used: [a.facts.score, b.facts.score, "invented"], payoff: "60,000 fans fell silent." }),
      scriptOut({ hook: "How Bologna silenced San Siro." }),
    ]);
    const job = await runningJob(a.projectId, "script.generate", { storyId: a.storyId, angles: ["analysis", "storytelling"] }, alice.id);
    const result = (await generateHandler.run(contextFor(job, ai), { storyId: a.storyId, angles: ["analysis", "storytelling"] })) as {
      created: { angle: string; isCurrent: boolean; droppedFactIds: number; ungroundedNumbers: number }[];
      failed: unknown[];
    };
    expect(result.failed).toEqual([]);
    expect(result.created.map((c) => [c.angle, c.isCurrent])).toEqual([
      ["analysis", true],
      ["storytelling", false],
    ]);
    expect(result.created[0]).toMatchObject({ droppedFactIds: 2, ungroundedNumbers: 1 });

    // the model saw only this story's material (no other project, no refuted claim)
    const data = promptData(ai.requests[0].messages[0].content);
    expect(data.facts.map((f: { id: string }) => f.id).sort()).toEqual([a.facts.score, a.facts.brace].sort());
    expect(JSON.stringify(data)).not.toContain(b.facts.score);
    expect(JSON.stringify(data)).not.toContain("Inter won the match");
    expect(data.production.original_only).toBe(true);

    const { rows } = await pool.query(
      "select version, angle, operation, is_current, facts_used, warnings, provider, model, created_by, language, word_count from public.scripts where story_id = $1 order by version",
      [a.storyId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 1, angle: "analysis", operation: "generate", is_current: true, provider: "anthropic", model: "claude-sonnet-5-5", created_by: alice.id, language: "en" });
    // the other project's fact and the invented id were removed and reported
    expect(rows[0].facts_used).toEqual([a.facts.score]);
    expect(rows[0].warnings.map((w: string) => parseWarning(w).kind)).toEqual(["unknown_fact", "ungrounded_number"]);
    expect(rows[1]).toMatchObject({ version: 2, angle: "storytelling", is_current: false });
    expect(rows[1].facts_used.sort()).toEqual([a.facts.score, a.facts.brace].sort());
    expect(rows[1].warnings.map((w: string) => parseWarning(w).kind)).toEqual(["unconfirmed_fact"]);

    const approvals = await pool.query("select 1 from public.approvals where entity_type = 'script' and project_id = $1", [a.projectId]);
    expect(approvals.rowCount).toBe(0);
    const runs = await pool.query("select agent, status, model from public.agent_runs where project_id = $1 and agent = 'story'", [a.projectId]);
    expect(runs.rows).toEqual([{ agent: "story", status: "completed", model: "claude-sonnet-5-5" }]);

    // the studio shows the open job and the versions grouped by angle
    const studio = (await getScriptStudio(alice.db, a.projectId, a.storyId)).data!;
    expect(studio.generateJob?.id).toBe(job.id);
    expect(studio.current).toMatchObject({ version: 1, angle: "analysis", decision: null });
    expect(studio.groups.map((g) => g.angle)).toEqual(["storytelling", "analysis"]);
    expect(studio.factCounts).toMatchObject({ total: 3, confirmed: 1, probable: 1, false: 1 });
  });

  it("never replaces an existing current script", async () => {
    const before = await must(admin.from("scripts").select("id").eq("story_id", a.storyId).eq("is_current", true).single());
    const ai = fakeAI([scriptOut()]);
    const job = await runningJob(a.projectId, "script.generate", { storyId: a.storyId, angles: ["controversy"] }, alice.id);
    await generateHandler.run(contextFor(job, ai), { storyId: a.storyId, angles: ["controversy"] });
    const after = await must(admin.from("scripts").select("id").eq("story_id", a.storyId).eq("is_current", true).single());
    expect(after.id).toBe(before.id);
  });

  it("refuses a story of another project without calling the model", async () => {
    const ai = fakeAI([scriptOut()]);
    const job = await runningJob(a.projectId, "script.generate", { storyId: b.storyId, angles: ["analysis"] }, alice.id);
    await expect(generateHandler.run(contextFor(job, ai), { storyId: b.storyId, angles: ["analysis"] })).rejects.toBeInstanceOf(JobInputError);
    expect(ai.requests).toHaveLength(0);
  });
});

describe("versions, current and approval (signed-in user)", () => {
  it("a manual edit is a new current version built on the current one", async () => {
    const current = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions).find((v) => v.isCurrent)!;
    const res = await createManualVersion(alice.db, {
      projectId: a.projectId,
      userId: alice.id,
      input: { storyId: a.storyId, angle: null, tone: null, ...current.sections, payoff: "A plan others will copy, 2 years in the making." },
    });
    expect(res.error).toBeNull();
    const versions = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions);
    const manual = versions.find((v) => v.id === res.data!.id)!;
    expect(manual).toMatchObject({ operation: "manual", parentId: current.id, parentVersion: current.version, isCurrent: true, angle: current.angle });
    expect(manual.factsUsed.sort()).toEqual([...current.factsUsed].sort());
    expect(manual.warnings.map((w) => w.kind)).toContain("ungrounded_number");
    // the old version is untouched and no longer current
    const old = versions.find((v) => v.id === current.id)!;
    expect(old).toMatchObject({ isCurrent: false, sections: current.sections });

    const again = await createManualVersion(alice.db, {
      projectId: a.projectId,
      userId: alice.id,
      input: { storyId: a.storyId, angle: null, tone: null, ...manual.sections },
    });
    expect(again.error?.userMessage).toMatch(/Nothing changed/);
  });

  it("approves only the current version; production follows the current version's approval", async () => {
    const versions = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions);
    const current = versions.find((v) => v.isCurrent)!;
    const other = versions.find((v) => !v.isCurrent)!;

    const refused = await decideScript(alice.db, { projectId: a.projectId, scriptId: other.id, decision: "approved", notes: null });
    expect(refused.error?.userMessage).toMatch(/Only the current version/);

    const ok = await decideScript(alice.db, { projectId: a.projectId, scriptId: current.id, decision: "approved", notes: "numbers checked" });
    expect(ok.error).toBeNull();
    await must(alice.db.from("content_items").update({ stage: "production" }).eq("id", a.contentId).select("id"));
    await must(alice.db.from("content_items").update({ stage: "script" }).eq("id", a.contentId).select("id"));

    // switching the current version (pointer only) → production is blocked until that version is approved
    const switched = await setCurrentScript(alice.db, { projectId: a.projectId, scriptId: other.id });
    expect(switched.data).toMatchObject({ changed: true });
    const blocked = await alice.db.from("content_items").update({ stage: "production" }).eq("id", a.contentId).select("id");
    expect(parseGuardError(blocked.error)?.code).toBe("SCRIPT_NOT_APPROVED");
    const one = await pool.query("select count(*)::int as n from public.scripts where story_id = $1 and is_current", [a.storyId]);
    expect(one.rows[0].n).toBe(1);

    // the decision stays on the version it was made for
    const studio = (await getScriptStudio(alice.db, a.projectId, a.storyId)).data!;
    const approved = studio.groups.flatMap((g) => g.versions).find((v) => v.id === current.id)!;
    expect(approved.decision).toMatchObject({ decision: "approved", notes: "numbers checked" });
    expect(approved.decision?.decidedBy).toBeTruthy();
    expect(studio.current?.id).toBe(other.id);
    expect(studio.current?.decision).toBeNull();

    // back to the approved version for the next tests
    await setCurrentScript(alice.db, { projectId: a.projectId, scriptId: current.id });
  });
});

describe("script.transform (Story agent)", () => {
  it("rewrite_hook → a new version from its parent; other sections verbatim; the current (approved) version stays current", async () => {
    const parent = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions).find((v) => v.isCurrent)!;
    const ai = fakeAI([scriptOut({ hook: "Nobody saw Bologna's 3-0 coming.", context: "The model changed this too." })]);
    const job = await runningJob(a.projectId, "script.transform", { scriptId: parent.id, operation: "rewrite_hook" }, alice.id);
    const result = (await transformHandler.run(contextFor(job, ai), { scriptId: parent.id, operation: "rewrite_hook" })) as {
      scriptId: string;
      isCurrent: boolean;
    };
    expect(result.isCurrent).toBe(false);
    const child = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions).find((v) => v.id === result.scriptId)!;
    expect(child).toMatchObject({ operation: "rewrite_hook", parentId: parent.id, angle: parent.angle, isCurrent: false, tone: parent.tone });
    expect(child.sections).toEqual({ ...parent.sections, hook: "Nobody saw Bologna's 3-0 coming." });
    const current = await must(admin.from("scripts").select("id").eq("story_id", a.storyId).eq("is_current", true).single());
    expect(current.id).toBe(parent.id);
  });

  it("change_tone stores the tone; a foreign script is refused without calling the model", async () => {
    const parent = (await listVersions(alice.db, a.projectId, a.storyId)).data!.flatMap((g) => g.versions).find((v) => v.isCurrent)!;
    const ai = fakeAI([scriptOut()]);
    const job = await runningJob(a.projectId, "script.transform", { scriptId: parent.id, operation: "change_tone", tone: "calm" }, alice.id);
    const result = (await transformHandler.run(contextFor(job, ai), { scriptId: parent.id, operation: "change_tone", tone: "calm" })) as { scriptId: string };
    const row = await must(admin.from("scripts").select("tone, operation, parent_script_id").eq("id", result.scriptId).single());
    expect(row).toEqual({ tone: "calm", operation: "change_tone", parent_script_id: parent.id });

    const bScript = await must(
      admin.from("scripts").insert({ project_id: b.projectId, story_id: b.storyId, hook: "B hook", full_text: "B hook" } as never).select("id").single(),
    );
    const foreign = fakeAI([scriptOut()]);
    const bad = await runningJob(a.projectId, "script.transform", { scriptId: bScript.id, operation: "shorten" }, alice.id);
    await expect(transformHandler.run(contextFor(bad, foreign), { scriptId: bScript.id, operation: "shorten" })).rejects.toBeInstanceOf(JobInputError);
    expect(foreign.requests).toHaveLength(0);
  });
});

describe("hooks", () => {
  it("hooks.generate stores ≥5 scored hooks across types, never repeating existing ones; nothing is selected", async () => {
    const manual = await addManualHook(alice.db, { projectId: a.projectId, input: { storyId: a.storyId, hookType: "story", text: "One night at San Siro changed Bologna" } });
    expect(manual.error).toBeNull();
    const hook = (type: string, text: string, facts: string[] = [a.facts.score]) => ({ hook_type: type, text, angle: null, facts_used: facts, score: 75, rationale: "fits" });
    const ai = fakeAI([
      {
        hooks: [
          hook("curiosity", "Why Bologna's 3-0 at San Siro started with one trap"),
          hook("statistical", "3-0 at San Siro: Inter's night in one number"),
          hook("story", "One night at San Siro changed Bologna"), // already exists
          hook("story", "Orsolini scored twice in the second half, and San Siro went quiet", [a.facts.brace, b.facts.brace]),
          hook("mystery", "One change at half-time decided Bologna's night"),
          hook("shock", "Bologna beat Inter 3-0 at San Siro"),
          hook("controversial", "Was Inter's San Siro defeat about tactics or nerves?"),
        ],
        missing: [],
      },
    ]);
    const job = await runningJob(a.projectId, "hooks.generate", { storyId: a.storyId, count: 5 }, alice.id);
    const result = (await hooksHandler.run(contextFor(job, ai), { storyId: a.storyId, count: 5 })) as {
      inserted: number;
      distinctTypes: number;
      dropped: { duplicates: number; foreignFactIds: number };
    };
    expect(result).toMatchObject({ inserted: 5, distinctTypes: 5, dropped: { duplicates: 1, foreignFactIds: 1 } });
    expect(ai.requests[0].messages[0].content).toContain("One night at San Siro changed Bologna");

    const hooks = (await listHooks(alice.db, a.projectId, a.storyId)).data!;
    expect(hooks).toHaveLength(6);
    const ai5 = hooks.filter((h) => h.origin === "ai");
    expect(ai5.every((h) => h.explanation?.method === "blend" && h.model === "claude-sonnet-5-5" && !h.isSelected)).toBe(true);
    expect(hooks.find((h) => h.origin === "manual")?.explanation?.method).toBe("heuristic");
    // best first
    expect(hooks.map((h) => h.score ?? 0)).toEqual([...hooks.map((h) => h.score ?? 0)].sort((x, y) => y - x));
    const runs = await pool.query("select status from public.agent_runs where project_id = $1 and agent = 'hook'", [a.projectId]);
    expect(runs.rows).toEqual([{ status: "completed" }]);
  });

  it("one selected hook per story; selection can be cleared", async () => {
    const hooks = (await listHooks(alice.db, a.projectId, a.storyId)).data!;
    await selectHook(alice.db, { projectId: a.projectId, hookId: hooks[0].id, selected: true });
    await selectHook(alice.db, { projectId: a.projectId, hookId: hooks[1].id, selected: true });
    let after = (await getHookStudio(alice.db, a.projectId, a.storyId)).data!.hooks;
    expect(after.filter((h) => h.isSelected).map((h) => h.id)).toEqual([hooks[1].id]);
    await selectHook(alice.db, { projectId: a.projectId, hookId: hooks[1].id, selected: false });
    after = (await listHooks(alice.db, a.projectId, a.storyId)).data!;
    expect(after.some((h) => h.isSelected)).toBe(false);
  });
});

describe("project isolation (another project's member)", () => {
  it("cannot read, version, approve, switch or select anything of this story", async () => {
    const aScript = await must(admin.from("scripts").select("id").eq("story_id", a.storyId).eq("is_current", true).single());
    const aHook = (await listHooks(alice.db, a.projectId, a.storyId)).data![0];

    for (const projectId of [a.projectId, b.projectId]) {
      expect(isNotFound((await getScriptStudio(bob.db, projectId, a.storyId)).error)).toBe(true);
      expect(isNotFound((await getHookStudio(bob.db, projectId, a.storyId)).error)).toBe(true);
      expect(isNotFound((await decideScript(bob.db, { projectId, scriptId: aScript.id, decision: "approved", notes: null })).error)).toBe(true);
      expect(isNotFound((await setCurrentScript(bob.db, { projectId, scriptId: aScript.id })).error)).toBe(true);
      expect(isNotFound((await selectHook(bob.db, { projectId, hookId: aHook.id, selected: true })).error)).toBe(true);
      const manual = await createManualVersion(bob.db, {
        projectId,
        userId: bob.id,
        input: { storyId: a.storyId, angle: null, tone: null, hook: "h", context: "c", escalation: "e", reveal: "r", payoff: "p", cta: "x" },
      });
      expect(isNotFound(manual.error)).toBe(true);
      const hook = await addManualHook(bob.db, { projectId, input: { storyId: a.storyId, hookType: "story", text: "Intruder hook" } });
      expect(isNotFound(hook.error)).toBe(true);
    }
    // nothing changed on A's side
    const approvals = await pool.query("select decided_by from public.approvals where entity_type = 'script' and project_id = $1", [a.projectId]);
    expect(approvals.rows.every((r) => r.decided_by === alice.id)).toBe(true);
    const intruder = await pool.query("select 1 from public.hooks where text = 'Intruder hook'");
    expect(intruder.rowCount).toBe(0);
  });

  it("the worker refuses hooks for another project's story without calling the model", async () => {
    const ai = fakeAI([{ hooks: [], missing: [] }]);
    const job = await runningJob(a.projectId, "hooks.generate", { storyId: b.storyId, count: 5 }, alice.id);
    await expect(hooksHandler.run(contextFor(job, ai), { storyId: b.storyId, count: 5 })).rejects.toBeInstanceOf(JobInputError);
    expect(ai.requests).toHaveLength(0);
  });
});
