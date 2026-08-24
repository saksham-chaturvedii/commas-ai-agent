/**
 * Agent-initiated application actions (docs/AI_ASSISTANT_ARCHITECTURE.md §7) — the propose →
 * approve → execute pipeline this folder has been reserved for since Phase 2. Distinct from
 * `server/adapters/`'s tools: those fetch data from a connected source; these propose a change to
 * the seller's OWN case record (add evidence, draft/update the response) and NEVER execute
 * themselves — the runtime only ever records the proposal and hands it back to the client, which
 * renders an explicit approve/decline control (`src/components/chat/ProposedActionCard.tsx`) and
 * only THEN calls the real mutation (`useChatStore`'s `addEvidenceItem`/`setResponseDraft` — the
 * SAME functions the Resolution Center's own manual "Add evidence"/response textarea already use,
 * so the Resolution Center stays the one source of truth for case state; nothing here duplicates
 * it). "Do not allow high-consequence actions to execute silently" is enforced by construction:
 * there is no code path from a tool call to a state mutation that doesn't pass through a rendered,
 * clicked approval control.
 *
 * These are LLM-visible tools (`LlmToolDef`-shaped, so they slot into `availableTools` exactly
 * like any adapter tool) but are NOT registered in `server/agent/registry.ts` and have no
 * `SourceAdapter` — they have no external source to call. `server/agent/runtime.ts`'s loop
 * recognizes their names (`PROPOSE_ACTION_TOOL_NAMES`) and intercepts them before the normal
 * adapter-dispatch path, exactly the same interception point Phase 4's `sharedAgentToolsFor`
 * pattern established for scoping which tools a runtime can see.
 */
import type { LlmToolDef } from "../../llm/types.js";
import type { ProposedAction, ProposedEvidenceCandidate } from "../../types.js";

export const PROPOSE_ADD_EVIDENCE_TOOL: LlmToolDef = {
  name: "propose_add_evidence",
  description:
    "Propose adding one or more evidence items to this dispute's evidence checklist, grounded in facts already " +
    "gathered from tool results this turn. Never adds anything itself — the seller reviews and approves each " +
    "item before it's added.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One short sentence describing what was found, e.g. \"I found 2 strong evidence items.\"" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "One of the dispute's evidence checklist category labels." },
            title: { type: "string" },
            record: { type: "string", description: "The specific fact/record this item cites." },
            sourceType: { type: "string", enum: ["transaction", "activity", "product", "terms", "communication", "manual"] },
            sourceLabel: { type: "string", description: "Where this came from, e.g. \"Gmail\", \"Commas\", \"Fathom\"." },
          },
          required: ["category", "title", "record", "sourceType", "sourceLabel"],
        },
      },
    },
    required: ["summary", "items"],
  },
};

export const PROPOSE_DRAFT_RESPONSE_TOOL: LlmToolDef = {
  name: "propose_draft_response",
  description:
    "Propose a draft (or an update to the existing draft) of the dispute response, grounded in facts already " +
    "gathered from tool results this turn. Never saves anything itself — the seller reviews and approves it " +
    "before it replaces their response draft.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One short sentence, e.g. \"I can draft a response based on the evidence.\"" },
      draftText: { type: "string" },
    },
    required: ["summary", "draftText"],
  },
};

export const PROPOSE_ACTION_TOOLS: LlmToolDef[] = [PROPOSE_ADD_EVIDENCE_TOOL, PROPOSE_DRAFT_RESPONSE_TOOL];
export const PROPOSE_ACTION_TOOL_NAMES = new Set(PROPOSE_ACTION_TOOLS.map((t) => t.name));

let counter = 0;
function newActionId(): string {
  counter += 1;
  return `action-${counter}-${Date.now().toString(36)}`;
}

/**
 * Validates and shapes a propose-tool's raw `input` into a `ProposedAction` the client can
 * render. Returns `undefined` on a malformed call (e.g. a real model omitting a required field)
 * — the runtime then falls back to a plain tool-error result rather than fabricating a proposal
 * from missing data (docs/AI_ASSISTANT_ARCHITECTURE.md's "never state a fact you can't support"
 * extends to actions: never propose something that wasn't actually specified).
 */
export function buildProposedAction(disputeId: string, toolName: string, input: Record<string, unknown>): ProposedAction | undefined {
  if (toolName === PROPOSE_ADD_EVIDENCE_TOOL.name) {
    const summary = typeof input.summary === "string" ? input.summary : undefined;
    const rawItems = Array.isArray(input.items) ? input.items : undefined;
    if (!summary || !rawItems || rawItems.length === 0) return undefined;
    const items: ProposedEvidenceCandidate[] = [];
    for (const raw of rawItems) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (
        typeof r.category !== "string" ||
        typeof r.title !== "string" ||
        typeof r.record !== "string" ||
        typeof r.sourceType !== "string" ||
        typeof r.sourceLabel !== "string"
      ) {
        continue;
      }
      items.push({
        category: r.category,
        title: r.title,
        record: r.record,
        sourceType: r.sourceType,
        sourceLabel: r.sourceLabel,
      });
    }
    if (items.length === 0) return undefined;
    return { id: newActionId(), type: "add_evidence", disputeId, summary, items, status: "pending" };
  }

  if (toolName === PROPOSE_DRAFT_RESPONSE_TOOL.name) {
    const summary = typeof input.summary === "string" ? input.summary : undefined;
    const draftText = typeof input.draftText === "string" ? input.draftText : undefined;
    if (!summary || !draftText) return undefined;
    return { id: newActionId(), type: "draft_response", disputeId, summary, draftText, status: "pending" };
  }

  return undefined;
}
