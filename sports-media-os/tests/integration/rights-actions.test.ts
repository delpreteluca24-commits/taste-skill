import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Rights Center server actions end to end: FormData → zod → service (signed-in
 * client, RLS) → user-safe result. Only the Next.js request APIs are mocked
 * (session, active-project cookie, revalidation, redirect); the database is real.
 */

type Db = SupabaseClient<Database>;
const session = vi.hoisted(() => ({ userId: "", projectId: "", db: null as unknown }));

class Redirect extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async () => ({ id: session.userId, email: "user@example.test", displayName: null, role: "member" }),
}));
vi.mock("@/lib/projects/service", () => ({
  getActiveProject: async () => (session.projectId ? { id: session.projectId, name: "P", slug: "p", timezone: "UTC", status: "active", color: null } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.db }));

const actions = await import("@/lib/rights/actions");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db; projectId: string; storyId: string; videoId: string };

async function setupUser(): Promise<User> {
  const email = `rights-actions-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  const { data: p } = await db.from("projects").insert({ owner_id: data.user.id, name: "Rights actions", slug: `rr-${randomUUID().slice(0, 8)}` }).select("id").single();
  created.projects.push(p!.id);
  const { data: s } = await db.from("stories").insert({ project_id: p!.id, title: "Derby story" }).select("id").single();
  const { data: v } = await db.from("videos").insert({ project_id: p!.id, title: "Studio recording", storage_path: `${p!.id}/${randomUUID()}.mp4` }).select("id").single();
  return { id: data.user.id, db, projectId: p!.id, storyId: s!.id, videoId: v!.id };
}

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const signIn = (u: User) => Object.assign(session, { userId: u.id, projectId: u.projectId, db: u.db });

let alice: User;
let bob: User;

beforeAll(async () => {
  alice = await setupUser();
  bob = await setupUser();
});
beforeEach(() => signIn(alice));

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

const classifyForm = (u: User, values: Record<string, string>) =>
  form({ assetType: "video", assetId: u.videoId, ownership: "unknown", commercialUse: "unknown", ...values });

describe("classifyAsset", () => {
  it("returns friendly GREEN field errors without writing anything", async () => {
    const res = await actions.classifyAsset(null, classifyForm(alice, { status: "green", ownership: "licensed", commercialUse: "yes" }));
    expect(res).toMatchObject({
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: { evidenceUrl: [expect.stringMatching(/^For GREEN, an evidence link/)], status: [expect.stringMatching(/documented basis/)] },
    });
    const { data } = await alice.db.from("rights_checks").select("id").eq("video_id", alice.videoId);
    expect(data).toEqual([]);
  });

  it("records a classification and reports the outcome", async () => {
    const res = await actions.classifyAsset(null, classifyForm(alice, { status: "yellow", ownership: "creator_provided", commercialUse: "yes", notes: "Waiting for the DM" }));
    expect(res).toMatchObject({ ok: true, data: { status: "yellow" }, message: expect.stringMatching(/not usable until a person approves/) });
  });

  it("can't classify another project's asset", async () => {
    const res = await actions.classifyAsset(null, classifyForm(bob, { status: "red" }));
    expect(res).toMatchObject({ ok: false, error: "Not found or you don't have access." });
  });

  it("needs an active project", async () => {
    session.projectId = "";
    expect(await actions.classifyAsset(null, classifyForm(alice, { status: "red" }))).toMatchObject({ ok: false, error: /select a project/ });
  });
});

describe("decideRightsAction", () => {
  it("approves the latest YELLOW with notes; RED is refused", async () => {
    const yellow = await actions.classifyAsset(null, classifyForm(alice, { status: "yellow" }));
    if (!yellow.ok) throw new Error(yellow.error);

    expect(await actions.decideRightsAction(yellow.data.checkId, "approved", "")).toMatchObject({ ok: false, fieldErrors: { notes: [expect.any(String)] } });
    expect(await actions.decideRightsAction(yellow.data.checkId, "approved", "Club press office confirmed, email archived")).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Automated workflows still can't use YELLOW/),
    });
    const { data: v } = await alice.db.from("videos").select("usable_in_production").eq("id", alice.videoId).single();
    expect(v!.usable_in_production).toBe(true);

    const red = await actions.classifyAsset(null, classifyForm(alice, { status: "red", ownership: "third_party", commercialUse: "no" }));
    if (!red.ok) throw new Error(red.error);
    expect(await actions.decideRightsAction(red.data.checkId, "approved", "Trying to approve a RED asset")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/RED assets never enter production/),
    });
    expect(await actions.decideRightsAction("not-a-uuid", "approved", "x")).toMatchObject({ ok: false });
  });
});

describe("registerAssetAction", () => {
  it("opens the registered asset, and the existing one for the same link", async () => {
    const url = `https://club.test/posts/${randomUUID()}`;
    let first = "";
    await expect(actions.registerAssetAction(null, form({ url, kind: "social", title: "Celebration post" }))).rejects.toSatisfy((e) => {
      first = (e as Redirect).url;
      return /^\/rights\/source\/[0-9a-f-]{36}$/.test(first);
    });
    await expect(actions.registerAssetAction(null, form({ url: `${url}?utm_source=share`, kind: "social" }))).rejects.toSatisfy(
      (e) => (e as Redirect).url === `${first}?existing=1`,
    );
  });

  it("validates the link", async () => {
    expect(await actions.registerAssetAction(null, form({ url: "javascript:alert(1)", kind: "video" }))).toMatchObject({
      ok: false,
      fieldErrors: { url: ["Paste a full http(s) link"] },
    });
  });
});

describe("saveProductionFormats", () => {
  it("saves the plan of a story of the active project", async () => {
    expect(await actions.saveProductionFormats(alice.storyId, ["statistics", "original_commentary", "statistics"])).toMatchObject({
      ok: true,
      data: { formats: ["original_commentary", "statistics"] },
    });
    const { data } = await alice.db.from("stories").select("production_formats").eq("id", alice.storyId).single();
    expect(data!.production_formats).toEqual(["original_commentary", "statistics"]);
    expect(await actions.saveProductionFormats(alice.storyId, [])).toMatchObject({ ok: true, data: { formats: [] }, message: "Production plan cleared." });
  });

  it("refuses another project's story and unknown formats", async () => {
    expect(await actions.saveProductionFormats(bob.storyId, ["voiceover"])).toMatchObject({ ok: false, error: "Not found or you don't have access." });
    const { data } = await admin.from("stories").select("production_formats").eq("id", bob.storyId).single();
    expect(data!.production_formats).toEqual([]);
    expect(await actions.saveProductionFormats(alice.storyId, ["broadcast_highlights"])).toMatchObject({ ok: false, error: "Unknown production format" });
  });
});
