import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, Info, ShieldCheck, ShieldX } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { RightsApprovalPanel, type RightsDecisionView } from "@/components/rights/approval-panel";
import { AssetFacts, AssetUsagePanel } from "@/components/rights/asset-panels";
import { AwaitingApprovalBadge, RightsStatusBadge, UsableBadge } from "@/components/rights/badges";
import { CheckHistory, formatRightsTime } from "@/components/rights/check-history";
import { CheckedBy, ClassificationDetails } from "@/components/rights/classification-details";
import { ClassificationForm, type ClassificationValues } from "@/components/rights/classification-form";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { assetKindLabel, commercialUseValue, isAssetType } from "@/lib/rights/schema";
import { getAsset, type AssetDetail } from "@/lib/rights/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Asset rights" };

/** Prefill a new classification from the current one (status stays a deliberate choice). */
function initialValues(detail: AssetDetail): ClassificationValues {
  const l = detail.latest;
  const { asset, details } = detail;
  // where the asset comes from, as recorded on the asset itself (never guessed)
  const recordedSource =
    details.type === "source" ? (asset.publisher ?? "") : details.originalFilename ? `Upload: ${details.originalFilename}` : "Upload";
  return {
    status: "",
    ownership: l?.ownership ?? "unknown",
    owner: l?.owner ?? "",
    sourceDetail: l?.sourceDetail ?? recordedSource,
    license: l?.license ?? "",
    commercialUse: commercialUseValue(l?.commercialUse),
    authorization: l?.authorization ?? "",
    transformationRequired: l?.transformationRequired ?? false,
    risk: l?.risk ?? "",
    evidenceUrl: l?.evidenceUrl ?? "",
    notes: "",
  };
}

/** Why there is (or isn't) a usage approval for the current classification. */
function NoApprovalNeeded({ detail }: { detail: AssetDetail }) {
  const status = detail.asset.rightsStatus;
  if (status === "green") {
    return (
      <p className="flex items-start gap-2 text-xs" data-testid="approval-not-needed">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
        GREEN is usable as classified, under its recorded conditions. No usage approval is needed.
      </p>
    );
  }
  if (status === "red") {
    return (
      <p className="flex items-start gap-2 text-xs" data-testid="approval-not-possible">
        <ShieldX className="mt-px size-3.5 shrink-0 text-danger" aria-hidden />
        RED never enters production and can&apos;t be approved. If new documentation exists, record a new classification.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground" data-testid="approval-not-needed">
      Not classified yet. Only YELLOW classifications need a usage approval; record a classification first.
    </p>
  );
}

export default async function RightsAssetPage(props: PageProps<"/rights/[assetType]/[assetId]">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const { assetType, assetId } = await props.params;
  if (!isAssetType(assetType) || !z.uuid().safeParse(assetId).success) notFound();
  const sp = await props.searchParams;
  const reused = sp.existing === "1";

  const supabase = await createClient();
  const res = await getAsset(supabase, project.id, assetType, assetId);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") notFound();
    throw new Error("Could not load the asset");
  }
  const detail = res.data;
  const { asset, latest, checks } = detail;
  const tz = project.timezone;

  const latestDecision = latest?.approvals[0];
  const decision: RightsDecisionView | null =
    detail.approvable && latestDecision
      ? { decision: latestDecision.decision, notes: latestDecision.notes, decidedBy: latestDecision.decidedBy, when: formatRightsTime(latestDecision.createdAt, tz) }
      : null;

  const kind = assetKindLabel(asset.assetType, asset.kind);

  return (
    <div className="grid gap-4">
      <div>
        <Button asChild size="xs" variant="ghost" className="-ml-2 text-muted-foreground">
          <Link href="/rights">
            <ArrowLeft />
            Rights Center
          </Link>
        </Button>
      </div>
      <PageHeader
        title={asset.title}
        description={[kind, asset.publisher].filter(Boolean).join(" · ")}
        actions={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="asset-state">
            <RightsStatusBadge status={asset.rightsStatus} />
            {asset.awaitingApproval ? <AwaitingApprovalBadge /> : null}
            <UsableBadge usable={asset.usable} status={asset.rightsStatus} />
          </span>
        }
      />

      {reused ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info" data-testid="asset-reused">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          This link was already registered in the project: its existing record and classification history are shown below.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <SectionCard
            title="Current classification"
            description="The latest classification decides whether the asset may enter production."
            testId="current-classification"
          >
            {latest ? (
              <div className="grid gap-3">
                <CheckedBy check={latest} when={formatRightsTime(latest.checkedAt, tz)} />
                <ClassificationDetails check={latest} />
                {latest.checkedByAgent && !latest.checkedBy ? (
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Bot className="mt-px size-3 shrink-0" aria-hidden />
                    Suggested by an agent. Agents never classify GREEN and never approve: a person confirms it below.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState>Not classified yet. Unchecked assets never enter production: record the first classification below.</EmptyState>
            )}
          </SectionCard>

          <SectionCard
            title="Record a classification"
            description="Prefilled from the current classification. Pick GREEN, YELLOW or RED deliberately: the suggestion explains the rules, a person decides."
            testId="classify"
          >
            <ClassificationForm assetType={asset.assetType} assetId={asset.assetId} licenseStatus={asset.licenseStatus} initial={initialValues(detail)} />
          </SectionCard>

          <SectionCard title="Check history" description="Newest first, with the usage decisions recorded on each classification." count={checks.length} testId="history">
            {checks.length ? (
              <CheckHistory checks={checks} timeZone={tz} />
            ) : (
              <EmptyState>No classifications yet. Each one you record is kept here as the audit trail.</EmptyState>
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <SectionCard
            title="Usage approval"
            description="RIGHTS → APPROVAL, for YELLOW only. A person decides; agents never approve."
            testId="rights-approval"
          >
            {detail.approvable && latest ? (
              <div className="grid gap-3">
                <RightsApprovalPanel key={latest.id} checkId={latest.id} latest={decision} />
                <p className="text-[11px] text-muted-foreground">
                  Approved YELLOW is usable only in human-initiated production. Automated workflows (workers, agents) only ever use GREEN.
                </p>
              </div>
            ) : (
              <NoApprovalNeeded detail={detail} />
            )}
          </SectionCard>

          <SectionCard title="Asset" testId="asset">
            <AssetFacts detail={detail} timeZone={tz} />
          </SectionCard>

          <SectionCard title="Where it's used" description="Rights belong to the asset, never to a story: wherever it appears on screen, this classification applies." testId="usage">
            <AssetUsagePanel detail={detail} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
