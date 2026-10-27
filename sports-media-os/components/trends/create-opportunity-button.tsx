"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createOpportunityFromTrendAction } from "@/lib/opportunities/actions";

/**
 * "Create opportunity" from a radar trend. The Opportunity Engine scores it
 * (explained heuristics, no AI in the request) and returns the open one if it
 * already exists; either way the editor lands on the opportunity page, where a
 * person approves or rejects it.
 */
export function CreateOpportunityButton({
  trendId,
  title,
  opportunity,
  disabled,
  size = "xs",
}: {
  trendId: string;
  title: string;
  /** an open opportunity already created from this trend */
  opportunity?: { id: string } | null;
  /** viewers cannot create opportunities */
  disabled?: boolean;
  size?: "xs" | "sm";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (opportunity) {
    return (
      <Button asChild size={size} variant="secondary">
        <Link href={`/opportunities/${opportunity.id}`} aria-label={`Open the opportunity for ${title}`}>
          <ArrowRight aria-hidden />
          Open opportunity
        </Link>
      </Button>
    );
  }

  const create = () => {
    setError(null);
    startTransition(async () => {
      const result = await createOpportunityFromTrendAction(trendId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/opportunities/${result.data.opportunityId}`);
    });
  };

  return (
    <span className="inline-grid justify-items-start gap-1">
      <Button
        type="button"
        size={size}
        variant="brand"
        onClick={create}
        disabled={disabled || pending}
        aria-label={`Create an opportunity from ${title}`}
        title={disabled ? "Project editors can create opportunities" : "Score this story as a content opportunity (a person approves it)"}
        data-testid="create-opportunity"
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Target aria-hidden />}
        Create opportunity
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
