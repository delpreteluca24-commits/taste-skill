import "server-only";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import { dashboardSchema, type DashboardData } from "./types";

/** All control-room sections in one RPC round trip (RLS applies). */
export async function getDashboard(projectId: string): Promise<DashboardData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dashboard", { p_project_id: projectId });
  if (error) {
    logger.error("dashboard.rpc_failed", { projectId, code: error.code, message: error.message });
    throw new Error("Could not load the dashboard");
  }
  const parsed = dashboardSchema.safeParse(data);
  if (!parsed.success) {
    logger.error("dashboard.payload_invalid", { projectId, issues: parsed.error.issues.slice(0, 5) });
    throw new Error("Dashboard payload has an unexpected shape");
  }
  return parsed.data;
}
