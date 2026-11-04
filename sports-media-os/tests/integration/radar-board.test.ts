import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EventInput } from "@/lib/radar/schema";
import { createEvent, deleteEvent, getEvent, getMemberRole, getRadarBoard, updateEvent } from "@/lib/radar/service";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Sports Radar board and manual events against the running Supabase stack,
 * with signed-in users' clients (RLS applies) — the way pages and actions call
 * the service. Covers project isolation and every board filter.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };

async function signedInUser(): Promise<{ id: string; db: Db }> {
  const email = `radar-${randomUUID()}@example.test`;
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

async function newProject(user: { id: string; db: Db }, name: string) {
  const { data, error } = await user.db
    .from("projects")
    .insert({ owner_id: user.id, name, slug: `radar-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.projects.push(data.id);
  return data.id;
}

const NOW = new Date();
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const event = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Inter vs Bologna",
  sport_id: null,
  competition: "Serie A",
  venue: "San Siro",
  description: null,
  starts_at: at(10),
  ends_at: null,
  status: "scheduled",
  importance: 70,
  ...over,
});

let alice: { id: string; db: Db };
let bob: { id: string; db: Db };
let viewer: { id: string; db: Db };
let projectA = "";
let projectB = "";
let football = "";
let tennis = "";
const ev: Record<string, string> = {};
const tr: Record<string, string> = {};

type TrendInsert = Database["public"]["Tables"]["trends"]["Insert"];

async function seedTrend(projectId: string, over: Partial<TrendInsert>) {
  const row: TrendInsert = { title: "Trend", last_seen_at: at(-1), ...over, project_id: projectId };
  const { data, error } = await admin
    .from("trends")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  viewer = await signedInUser();
  projectA = await newProject(alice, "Radar A");
  projectB = await newProject(bob, "Radar B");
  await admin.from("project_members").insert({ project_id: projectA, user_id: viewer.id, role: "viewer" });
  const { data: sports } = await admin.from("sports").select("id, slug").in("slug", ["football", "tennis"]);
  football = sports!.find((s) => s.slug === "football")!.id;
  tennis = sports!.find((s) => s.slug === "tennis")!.id;

  tr.sweet = await seedTrend(projectA, {
    title: "Bologna stun Inter",
    sport_id: football,
    status: "rising",
    trend_score: 72,
    curiosity_score: 80,
    competition_level: "medium",
    radar_score: 75,
    is_sweet_spot: true,
    signals: ["upset", "rising_trend"],
  });
  tr.emerging = await seedTrend(projectA, {
    title: "Sinner fitness doubt",
    sport_id: tennis,
    status: "emerging",
    trend_score: 30,
    curiosity_score: 40,
    competition_level: "low",
    radar_score: 46,
    signals: ["injury"],
  });
  tr.breakingPeak = await seedTrend(projectA, {
    title: "Coach sacked",
    sport_id: football,
    status: "peaking",
    trend_score: 60,
    curiosity_score: 45,
    competition_level: "high",
    radar_score: 50,
    signals: ["breaking"],
  });
  tr.quietPeak = await seedTrend(projectA, { title: "Steady story", status: "peaking", radar_score: 40, competition_level: "medium" });
  tr.expired = await seedTrend(projectA, { title: "Old sweet spot", status: "expired", radar_score: 90, is_sweet_spot: true, last_seen_at: at(-100) });
  tr.foreign = await seedTrend(projectB, { title: "Foreign sweet spot", status: "rising", radar_score: 99, is_sweet_spot: true });
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe("manual events: create, update, isolation", () => {
  it("an editor creates events in their project (marked as manual entry)", async () => {
    const soon = await createEvent(alice.db, projectA, event({ sport_id: football }));
    expect(soon.error).toBeNull();
    ev.soon = soon.data!.id;
    ev.later = (await createEvent(alice.db, projectA, event({ title: "Derby d'Italia", starts_at: at(24 * 5) }))).data!.id;
    ev.live = (await createEvent(alice.db, projectA, event({ title: "Sinner vs Alcaraz", sport_id: tennis, status: "live", starts_at: at(-1) }))).data!.id;
    ev.done = (await createEvent(alice.db, projectA, event({ title: "Roma vs Lazio", status: "finished", starts_at: at(-5), ends_at: at(-3), sport_id: football }))).data!.id;
    ev.doneNoEnd = (await createEvent(alice.db, projectA, event({ title: "Napoli vs Genoa", status: "finished", starts_at: at(-6), ends_at: null }))).data!.id;
    ev.doneOld = (await createEvent(alice.db, projectA, event({ title: "Juve vs Torino", status: "finished", starts_at: at(-50), ends_at: at(-48) }))).data!.id;
    ev.foreign = (await createEvent(bob.db, projectB, event({ title: "Foreign fixture" }))).data!.id;

    const row = await getEvent(alice.db, projectA, ev.soon);
    expect(row).toMatchObject({ title: "Inter vs Bologna", competition: "Serie A", venue: "San Siro", status: "scheduled", importance: 70 });
    expect(row!.sport?.name).toBe("Football (Soccer)");
    const { data } = await admin.from("events").select("metadata, project_id").eq("id", ev.soon).single();
    expect(data).toEqual({ metadata: { entered_by: "manual" }, project_id: projectA });
  });

  it("updates within the project; the database refuses an end before the start", async () => {
    const res = await updateEvent(alice.db, projectA, ev.soon, event({ sport_id: football, venue: "Stadio Meazza", importance: 85 }));
    expect(res.error).toBeNull();
    expect((await getEvent(alice.db, projectA, ev.soon))!.venue).toBe("Stadio Meazza");
    const bad = await updateEvent(alice.db, projectA, ev.soon, event({ starts_at: at(10), ends_at: at(8) }));
    expect(bad.error?.code).toBe("23514");
  });

  it("other projects' members and viewers cannot read, create, change or delete", async () => {
    expect(await getEvent(bob.db, projectA, ev.soon)).toBeNull();
    expect((await createEvent(bob.db, projectA, event())).error?.code).toBe("42501");
    expect((await updateEvent(bob.db, projectA, ev.soon, event({ title: "hijacked" }))).error?.message).toMatch(/NOT_FOUND/);
    // Alice with Bob's project id: the project filter refuses her own event, and Bob's event is invisible to her
    expect((await updateEvent(alice.db, projectB, ev.soon, event())).error?.message).toMatch(/NOT_FOUND/);
    expect((await updateEvent(alice.db, projectA, ev.foreign, event())).error?.message).toMatch(/NOT_FOUND/);
    expect((await deleteEvent(bob.db, projectA, ev.soon)).error).not.toBeNull();

    expect(await getMemberRole(viewer.db, projectA, viewer.id)).toBe("viewer");
    expect(await getMemberRole(bob.db, projectA, bob.id)).toBeNull();
    expect(await getEvent(viewer.db, projectA, ev.soon)).not.toBeNull(); // viewers read
    expect((await createEvent(viewer.db, projectA, event())).error?.code).toBe("42501");
    expect((await updateEvent(viewer.db, projectA, ev.soon, event({ title: "viewer edit" }))).error?.message).toMatch(/NOT_FOUND/);
    expect((await getEvent(alice.db, projectA, ev.soon))!.title).toBe("Inter vs Bologna");
  });

  it("the owner (admin) deletes; trends keep existing", async () => {
    const tmp = (await createEvent(alice.db, projectA, event({ title: "Temporary" }))).data!.id;
    expect((await deleteEvent(alice.db, projectA, tmp)).error).toBeNull();
    expect(await getEvent(alice.db, projectA, tmp)).toBeNull();
  });
});

describe("radar board", () => {
  const board = (db: Db, projectId: string, filters = {}) => getRadarBoard(db, projectId, filters, { tz: "UTC", now: NOW });

  it("sweet spot, breaking & emerging, upcoming (72h, live first), just finished (24h)", async () => {
    const b = await board(alice.db, projectA);
    expect(b.sweetSpot.map((t) => t.id)).toEqual([tr.sweet]); // expired and foreign never shown
    expect(b.breaking.map((t) => t.id)).toEqual([tr.breakingPeak, tr.emerging]); // by radar score; quiet peaking story excluded
    expect(b.upcoming.map((e) => e.id)).toEqual([ev.live, ev.soon]); // 5-day event out of the 72h window
    expect(b.finished.map((e) => e.id)).toEqual([ev.done, ev.doneNoEnd]);
    expect(b.activeTrends).toBe(4);
    expect(b.sweetSpot[0]).toMatchObject({ opportunity: null, sport: { name: "Football (Soccer)" } });
    expect(b.windows.upcoming.custom).toBe(false);
  });

  it("filters: sport, min score, competition, trend status, event status, date range", async () => {
    expect((await board(alice.db, projectA, { sportId: tennis })).breaking.map((t) => t.id)).toEqual([tr.emerging]);
    expect((await board(alice.db, projectA, { sportId: tennis })).upcoming.map((e) => e.id)).toEqual([ev.live]);
    expect((await board(alice.db, projectA, { minScore: 48 })).breaking.map((t) => t.id)).toEqual([tr.breakingPeak]);
    expect((await board(alice.db, projectA, { competition: "low" })).breaking.map((t) => t.id)).toEqual([tr.emerging]);
    expect((await board(alice.db, projectA, { competition: "high" })).sweetSpot).toEqual([]);
    expect((await board(alice.db, projectA, { trendStatus: "expired" })).sweetSpot.map((t) => t.id)).toEqual([tr.expired]);
    expect((await board(alice.db, projectA, { eventStatus: "live" })).upcoming.map((e) => e.id)).toEqual([ev.live]);
    expect((await board(alice.db, projectA, { eventStatus: "live" })).finished).toEqual([]);

    // a custom date range replaces the default windows (days in the project timezone)
    const day = (h: number) => at(h).slice(0, 10);
    const ranged = await board(alice.db, projectA, { from: day(-72), to: day(24 * 6) });
    expect(ranged.windows.upcoming.custom).toBe(true);
    expect(ranged.upcoming.map((e) => e.id)).toEqual(expect.arrayContaining([ev.live, ev.soon, ev.later]));
    expect(ranged.finished.map((e) => e.id)).toEqual(expect.arrayContaining([ev.done, ev.doneNoEnd, ev.doneOld]));
  });

  it("an open opportunity of a trend is attached to its card", async () => {
    const { data: opp } = await alice.db.from("opportunities").insert({ project_id: projectA, trend_id: tr.sweet, title: "Bologna angle" }).select("id").single();
    const b = await board(alice.db, projectA);
    expect(b.sweetSpot[0].opportunity).toEqual({ id: opp!.id, status: "new" });
  });

  it("another project's member sees an empty board", async () => {
    const b = await board(bob.db, projectA);
    expect([b.sweetSpot, b.breaking, b.upcoming, b.finished].every((l) => l.length === 0)).toBe(true);
    expect(b.activeTrends).toBe(0);
    const own = await board(bob.db, projectB);
    expect(own.sweetSpot.map((t) => t.id)).toEqual([tr.foreign]);
    expect(own.upcoming.map((e) => e.id)).toEqual([ev.foreign]);
  });
});
