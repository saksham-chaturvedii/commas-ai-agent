import type { AgentErrorCode } from "../types.js";

/**
 * Typed agent-level error. The runtime always catches raw errors from the LLM client and MCP
 * client and converts them to one of these before they can reach the HTTP layer — the UI must
 * only ever see `{ code, message }` (docs/PROTOTYPE_SPEC.md §4.7: "never a stack trace or raw
 * payload").
 */
export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/**
 * Classifies an arbitrary caught error (from the LLM client, the MCP client, or a timeout
 * race) into one of the six failure modes the task requires handling: authentication failure,
 * unavailable MCP server, malformed tool result, tool execution error, timeout, empty result.
 * `empty_result` is handled separately by the runtime (it's a valid, non-error tool outcome,
 * not something thrown) — this function only classifies genuine thrown errors.
 */
export function classifyError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (/\b401\b|\b403\b|unauthor|forbidden|auth(entication)? failed/i.test(lower)) {
    return new AgentError("auth_failed", "Authentication with Commas failed. Check the configured API key.", err);
  }
  if (/econnrefused|enotfound|etimedout|fetch failed|network|could not reach|unavailable/i.test(lower)) {
    return new AgentError("server_unavailable", "The Commas connection is unavailable right now.", err);
  }
  if (/timeout|timed out|aborted/i.test(lower)) {
    return new AgentError("timeout", "That took too long to check and was cancelled.", err);
  }
  if (/malformed|unexpected token|json|invalid.*(response|result|schema)/i.test(lower)) {
    return new AgentError("malformed_result", "Received an unreadable response while checking that.", err);
  }
  return new AgentError("tool_error", "Something went wrong while checking that.", err);
}
