import type { HandlerMap } from "../runner";

import { handler as connector_fetch } from "./connector-fetch";
import { handler as trends_detect } from "./trends-detect";
import { handler as opportunity_ai_score } from "./opportunity-ai-score";
import { handler as research_suggest } from "./research-suggest";
import { handler as factcheck_assist } from "./factcheck-assist";
import { handler as script_generate } from "./script-generate";
import { handler as hooks_generate } from "./hooks-generate";
import { handler as script_transform } from "./script-transform";
import { handler as studio_package } from "./studio-package";

/** Every job type the worker can run. */
export const handlers: HandlerMap = {
  "connector.fetch": connector_fetch,
  "trends.detect": trends_detect,
  "opportunity.ai_score": opportunity_ai_score,
  "research.suggest": research_suggest,
  "factcheck.assist": factcheck_assist,
  "script.generate": script_generate,
  "hooks.generate": hooks_generate,
  "script.transform": script_transform,
  "studio.package": studio_package,
};
