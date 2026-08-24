/**
 * Human-approved action layer for the shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md
 * §7 — the propose → review → approve → execute pipeline). Deliberately unimplemented in this
 * foundational phase: the shared agent has no `propose_*` tools yet (see
 * server/agent/tools/index.ts), so there is nothing here to gate an approval around.
 *
 * This file marks where `ActionProposal` records, a `ProposalStore`, and the
 * propose/decision HTTP routes land once dispute-mode investigation tools exist — see the
 * architecture doc for the full five-stage model (agent intent → proposed action → human
 * decision → executed action → UI state update) this module will implement.
 */
export {};
