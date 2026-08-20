# Commas AI Agent

Prototype of the technical agent system behind the Commas AI Evidence Copilot concept: an LLM
agent loop, MCP client, connectors, and chat interface. This is a sibling repo to
[`commas-ai-copilot`](../commas-ai-copilot), which holds the earlier UI-only demo of the product
concept (no LLM, no MCP, scripted "AI investigation" over mock data). `commas-ai-copilot`
describes the UX/product concept; this repo is where the actual agent architecture gets built.

**Start here:** [`docs/active-context.md`](docs/active-context.md) — persistent session state,
read it before doing anything else in this repo.

## Status

Scaffolding only. No implementation yet. See `docs/active-context.md` for current state and open
questions, and `docs/product-spec.md` / `docs/architecture.md` / `docs/implementation-plan.md` for
what's still unwritten.

## Structure

```
commas-ai-agent/
├── docs/                  persistent context, spec, architecture, implementation plan
├── src/
│   ├── agent/             agent/reasoning loop
│   ├── llm/                LLM client integration
│   ├── mcp/                MCP client logic
│   ├── connectors/         external data source connectors
│   ├── context/            context assembly/management
│   ├── chat/                chat interface logic
│   └── ui/                 presentation layer
├── tests/
└── public/
```
