"use server";

import { fail, type ActionResult } from "@/lib/actions";

/**
 * CONTRACT (owned by the Opportunities module):
 * Create a scored opportunity from a trend (heuristic components + explanation).
 */
export async function createOpportunityFromTrendAction(trendId: string): Promise<ActionResult<{ opportunityId: string }>> {
  void trendId;
  return fail("Not implemented yet");
}

/**
 * CONTRACT (owned by the Opportunities module):
 * For an APPROVED opportunity: create story + content item (stage "research"), then redirect to /content/[id].
 */
export async function startProductionAction(opportunityId: string): Promise<ActionResult<{ contentItemId: string }>> {
  void opportunityId;
  return fail("Not implemented yet");
}
