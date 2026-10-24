import { beforeEach, describe, expect, it, vi } from "vitest";

import { taskFieldName } from "@/components/settings/ai-format";
import { fieldErrorsByPath, friendlyAiFieldErrors, readAiSettingsForm } from "@/components/settings/ai-routing";
import { aiSettingsSchema } from "@/lib/settings/schema";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test", displayName: null, role: "owner" as string };

vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => user) }));
vi.mock("@/lib/settings/service", () => ({ saveWorkspaceSection: vi.fn(async () => ({ error: null })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { saveWorkspaceSection } = await import("@/lib/settings/service");
const { saveSettingsSection } = await import("@/app/(app)/settings/actions");

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("readAiSettingsForm (readSection('ai'))", () => {
  it("omits empty fields and tasks with nothing set (= inherit env/default)", () => {
    const raw = readAiSettingsForm(
      form({
        [taskFieldName("discovery", "model")]: "",
        [taskFieldName("discovery", "fallback")]: "   ",
        [taskFieldName("discovery", "effort")]: "",
        [taskFieldName("scoring", "model")]: "anthropic:claude-haiku-5-5",
        [taskFieldName("scoring", "effort")]: "",
        [taskFieldName("script", "effort")]: "high",
        batchCostLimitUsd: "2.50",
      }),
    );
    expect(raw).toEqual({
      tasks: { scoring: { model: "anthropic:claude-haiku-5-5" }, script: { effort: "high" } },
      batchCostLimitUsd: "2.50",
    });
    expect(aiSettingsSchema.parse(raw)).toEqual({
      tasks: { scoring: { model: "anthropic:claude-haiku-5-5" }, script: { effort: "high" } },
      batchCostLimitUsd: 2.5,
    });
  });

  it("returns no tasks when every field is empty, and omits an empty batch limit (schema default $1, never 0)", () => {
    const raw = readAiSettingsForm(form({ batchCostLimitUsd: " " }));
    expect(raw).toEqual({ tasks: {} });
    expect(aiSettingsSchema.parse(raw)).toEqual({ tasks: {}, batchCostLimitUsd: 1 });
  });

  it("normalises valid model refs to provider:model and trims", () => {
    const raw = readAiSettingsForm(
      form({
        [taskFieldName("research", "model")]: "  claude-sonnet-5-5 ",
        [taskFieldName("research", "fallback")]: "OpenAI:gpt-test",
      }),
    );
    expect(raw.tasks).toEqual({ research: { model: "anthropic:claude-sonnet-5-5", fallback: "openai:gpt-test" } });
  });

  it("passes invalid model refs through so the schema rejects them", () => {
    const raw = readAiSettingsForm(form({ [taskFieldName("scoring", "model")]: "mistral:big; drop table" }));
    expect(raw.tasks).toEqual({ scoring: { model: "mistral:big; drop table" } });
    const parsed = aiSettingsSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(Object.keys(fieldErrorsByPath(parsed.error))).toEqual(["tasks.scoring.model"]);
  });

  it("ignores unknown task names and non-string values", () => {
    const fd = form({ "tasks.publishing.model": "anthropic:claude-haiku-5-5" });
    fd.set(taskFieldName("scoring", "model"), new Blob(["x"]));
    expect(readAiSettingsForm(fd)).toEqual({ tasks: {} });
  });

  it("keys nested errors by path and rewrites batch/effort messages in plain language", () => {
    const parsed = aiSettingsSchema.safeParse({ tasks: { research: { effort: "turbo" } }, batchCostLimitUsd: "5000" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = friendlyAiFieldErrors(fieldErrorsByPath(parsed.error));
    expect(Object.keys(errors).sort()).toEqual(["batchCostLimitUsd", "tasks.research.effort"]);
    expect(errors.batchCostLimitUsd[0]).toMatch(/between 0 and 1000/);
    expect(errors["tasks.research.effort"][0]).toMatch(/low, medium, high, xhigh, max/);
  });
});

describe("saveSettingsSection — AI section", () => {
  beforeEach(() => {
    vi.mocked(saveWorkspaceSection).mockClear();
    user.role = "owner";
  });

  it("stores only the overrides that were filled in", async () => {
    const res = await saveSettingsSection(
      null,
      form({
        section: "ai",
        [taskFieldName("scoring", "model")]: "claude-sonnet-5-5",
        [taskFieldName("scoring", "fallback")]: "",
        [taskFieldName("fact_check", "effort")]: "xhigh",
        [taskFieldName("discovery", "model")]: "",
        batchCostLimitUsd: "3",
      }),
    );
    expect(res).toMatchObject({ ok: true });
    expect(saveWorkspaceSection).toHaveBeenCalledWith(
      "ai",
      { tasks: { scoring: { model: "anthropic:claude-sonnet-5-5" }, fact_check: { effort: "xhigh" } }, batchCostLimitUsd: 3 },
      user.id,
    );
  });

  it("rejects an invalid model with a per-field error and saves nothing", async () => {
    const res = await saveSettingsSection(
      null,
      form({ section: "ai", [taskFieldName("script", "fallback")]: "not a model!", batchCostLimitUsd: "1" }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Check the highlighted fields.");
    expect(res.fieldErrors?.["tasks.script.fallback"]?.[0]).toMatch(/provider:model/);
    expect(saveWorkspaceSection).not.toHaveBeenCalled();
  });

  it("rejects a negative batch limit", async () => {
    const res = await saveSettingsSection(null, form({ section: "ai", batchCostLimitUsd: "-1" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.batchCostLimitUsd?.[0]).toMatch(/between 0 and 1000/);
    expect(saveWorkspaceSection).not.toHaveBeenCalled();
  });

  it("is admin-only", async () => {
    user.role = "member";
    const res = await saveSettingsSection(null, form({ section: "ai", batchCostLimitUsd: "1" }));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/admins/) });
    expect(saveWorkspaceSection).not.toHaveBeenCalled();
  });

  it("keeps flat field errors for the other sections", async () => {
    const res = await saveSettingsSection(null, form({ section: "production", captionPreset: "bold", aspectRatio: "9:16", clipDurationSec: "5" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.fieldErrors ?? {})).toEqual(["clipDurationSec"]);
  });
});
