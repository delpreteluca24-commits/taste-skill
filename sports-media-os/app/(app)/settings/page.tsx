import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleSlash } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { modelSuggestions, presentAllTaskRouting } from "@/components/settings/ai-routing";
import { fetchAiUsageSummary, USAGE_WINDOW_DAYS } from "@/components/settings/ai-usage";
import { AiUsagePanel } from "@/components/settings/ai-usage-panel";
import { CostControlExplainer } from "@/components/settings/cost-control-explainer";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { platformLabel } from "@/lib/dashboard/format";
import { configuredAIProviders } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { SUGGESTED_MODELS } from "@/lib/settings/schema";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";
import { Constants } from "@/types/database";

import {
  AiSettingsForm,
  ProductionSettingsForm,
  PublishingSettingsForm,
  ThresholdSettingsForm,
  TranscriptionSettingsForm,
} from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

const PLATFORMS = Constants.public.Enums.platform;

export default async function SettingsPage() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const supabase = await createClient();
  const [settings, accounts, usage] = await Promise.all([
    getWorkspaceSettings(),
    supabase.from("platform_accounts").select("platform, status, account_name").eq("project_id", project.id),
    fetchAiUsageSummary(supabase, project.id, USAGE_WINDOW_DAYS),
  ]);
  if (usage.error) logger.error("settings.ai_usage_read_failed", { code: usage.error.code, message: usage.error.message });
  const keys = configuredAIProviders();
  const readOnly = user.role === "member";
  // Effective routing is resolved here: the env (model ids, keys) never reaches the client;
  // the form only receives model ids, sources, prices and estimates.
  const routing = presentAllTaskRouting(settings.ai.tasks, process.env, keys);

  return (
    <div className="grid max-w-4xl gap-4">
      <PageHeader title="Settings" description="Workspace defaults used by agents, workers and the production pipeline." />
      {readOnly ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Read-only: only workspace admins can change these settings.
        </p>
      ) : null}

      <SectionCard
        title="AI model routing"
        description="One model per task, cheapest that fits. Provider-agnostic: agents call the AI router, never a vendor SDK directly. Workspace-wide."
        testId="ai-routing"
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <KeyStatus label="ANTHROPIC_API_KEY" configured={keys.anthropic} />
          <KeyStatus label="OPENAI_API_KEY" configured={keys.openai} />
        </div>
        <AiSettingsForm
          value={settings.ai}
          routing={routing}
          suggestions={modelSuggestions(SUGGESTED_MODELS)}
          disabled={readOnly}
        />
      </SectionCard>

      <SectionCard
        title={`AI usage · ${project.name}`}
        description={`Last ${USAGE_WINDOW_DAYS} days, per task and model, from the ai_usage ledger.`}
        testId="ai-usage-panel"
      >
        <AiUsagePanel summary={usage.data} />
      </SectionCard>

      <SectionCard title="How AI cost is controlled" testId="ai-cost-control">
        <CostControlExplainer />
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Transcription" description="Runs in the video worker (never in a request).">
          <TranscriptionSettingsForm value={settings.transcription} disabled={readOnly} />
        </SectionCard>
        <SectionCard title="Publishing" description="Human approval checkpoint.">
          <PublishingSettingsForm value={settings.publishing} disabled={readOnly} />
        </SectionCard>
      </div>

      <SectionCard title="Production defaults">
        <ProductionSettingsForm value={settings.production} disabled={readOnly} />
      </SectionCard>

      <SectionCard title="Score thresholds" description="Below these scores, items are not proposed for production.">
        <ThresholdSettingsForm value={settings.thresholds} disabled={readOnly} />
      </SectionCard>

      <SectionCard title={`Platform connections · ${project.name}`} description="Official APIs only. Without a connection, manual export is always available.">
        <ul className="divide-y" data-testid="platform-connections">
          {PLATFORMS.map((platform) => {
            const account = accounts.data?.find((a) => a.platform === platform);
            const connected = account?.status === "connected";
            return (
              <li key={platform} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div>
                  <p className="text-[13px]">{platformLabel(platform)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {connected ? account?.account_name : "Manual export available · API adapter in Milestone 5"}
                  </p>
                </div>
                <Badge variant={connected ? "success" : "outline"}>
                  {connected ? <CheckCircle2 /> : <CircleSlash />}
                  {connected ? "Connected" : "NOT CONNECTED"}
                </Badge>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard title="Storage" description="Private Supabase Storage buckets; media is served through signed URLs.">
        <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <li><span className="text-foreground">videos</span> — source uploads (MP4, MOV, MKV, WEBM)</li>
          <li><span className="text-foreground">renders</span> — rendered clips and audio</li>
          <li><span className="text-foreground">thumbnails</span> — thumbnail images</li>
          <li><span className="text-foreground">captions</span> — SRT / ASS files</li>
          <li><span className="text-foreground">exports</span> — manual publishing packages</li>
        </ul>
      </SectionCard>
    </div>
  );
}

function KeyStatus({ label, configured }: { label: string; configured: boolean }) {
  return (
    <Badge variant={configured ? "success" : "outline"}>
      {configured ? <CheckCircle2 /> : <CircleSlash />}
      {label} {configured ? "configured" : "missing"}
    </Badge>
  );
}
