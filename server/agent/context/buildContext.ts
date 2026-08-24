/**
 * Context builder for the shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §5). Turns a
 * session's `SessionConfig` into the system prompt the LLM actually sees — this is the one place
 * "global vs dispute" changes what the model is told, so mode never needs its own code path
 * anywhere else in the runtime.
 *
 * Deliberately minimal in this foundational phase: no tool inventory, no dispute facts, no
 * evidence inventory — the shared agent doesn't call tools yet ("do not implement all real tools
 * yet" — see server/agent/tools/index.ts). Once dispute-mode tools exist, this is where the
 * dispute-specific system-prompt section and the envelope-derived context block
 * (docs/AI_ASSISTANT_ARCHITECTURE.md §5's "context block") get built, following the same
 * first-turn/delta pattern already validated in the `commas-ai-copilot` POC.
 */
import type { SessionRecord } from "../sessions/store.js";

const BASE_PERSONA =
  "You are the Commas AI Agent, a helpful assistant for a seller using the Commas platform. " +
  "Be concise and direct. Never state a fact you can't support, and say plainly when you don't " +
  "know something rather than guessing.";

export function buildContextPrompt(session: SessionRecord): string {
  if (session.config.mode === "dispute") {
    const label = `Dispute #${session.config.disputeId}`;
    return (
      `${BASE_PERSONA} The seller currently has ${label} open in the Resolution Center, so ` +
      "assume questions about \"this dispute\" refer to it. You do not have dispute-investigation " +
      "tools available in this conversation yet — if asked to look something up about the " +
      "dispute (evidence, transaction, customer activity), say plainly that deeper investigation " +
      "isn't wired up in this mode yet rather than guessing at details."
    );
  }
  return `${BASE_PERSONA} This is a general workspace conversation, not scoped to any specific dispute.`;
}
