# Commas AI Agent - Architecture

**Status: not yet written.**

This file is a placeholder created during repo scaffolding (2026-08-21). It should document the
real architecture once decided: agent/reasoning loop design, LLM client integration, MCP client
design (and any MCP servers it talks to), connector architecture, context assembly, chat
frontend/backend split.

Do not fill this in speculatively — see `active-context.md` Section 4 for open questions
(stack choice, MCP server relationships, etc.) that block writing this for real.

## Sections to fill in once decided

- System overview / diagram
- Agent loop (planning, tool calling, reasoning)
- LLM integration (provider, model, prompting approach)
- MCP client design (which servers, what tools they expose)
- Connectors (which external sources, how auth/access works)
- Context management (what gets assembled into the agent's context, and how)
- Chat interface (frontend/backend split, state management)
- Frontend/backend responsibilities
