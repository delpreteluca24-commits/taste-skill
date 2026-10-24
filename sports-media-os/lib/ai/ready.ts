import "server-only";

/**
 * Whether any AI provider can actually be called (server-only; values are never
 * read, only their presence). A user-level Anthropic key needs a workspace id.
 */
export function aiReady(): boolean {
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const anthropicOk = Boolean(anthropic) && (!anthropic!.startsWith("sk-ant-usr-") || Boolean(process.env.ANTHROPIC_WORKSPACE_ID?.trim()));
  return anthropicOk || Boolean(process.env.OPENAI_API_KEY?.trim());
}
