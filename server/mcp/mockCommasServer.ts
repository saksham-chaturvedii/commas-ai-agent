import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * In-process mock Commas MCP server — a real MCP server (real protocol, real tool
 * definitions), backed by mock data instead of a live Commas account. This is the "local
 * development option" for the Commas MCP connection: commasdocs.com confirms a real remote
 * MCP server exists (Streamable HTTP, x-api-key auth — see server/mcp/client.ts's "real mode"
 * for that path) but no credentials for it are available in this environment, so this mock
 * stands in, matching the documented tool names/purpose (docs/active-context.md §Integrations).
 *
 * Data mirrors src/lib/disputeData.ts (Sarah Johnson, Dispute #2481, txn_8b3f2a1c9d, $499,
 * "Product not received", purchased Aug 2 2026, evidence due Aug 13) — kept in sync by hand.
 *
 * Tool set is deliberately small per the task's scope: customers, transactions, and the one
 * dispute in this prototype's scenario. `commas_get_dispute` and `commas_mark_dispute_
 * response_ready` are namespaced `commas_` (not `fanbasis_`) because the real Commas platform
 * has no disputes API/evidence-submission API at all — confirmed gap, documented in
 * docs/active-context.md. `commas_mark_dispute_response_ready` is classified "write" in the
 * tool registry (server/agent/registry.ts) and therefore always pauses for seller approval
 * before running (server/agent/runtime.ts) — it never auto-executes, and it only ever flips a
 * mock in-memory flag; nothing is submitted anywhere real.
 */

interface MockCustomer {
  id: string;
  name: string;
  email: string;
}

interface MockTransaction {
  id: string;
  customerEmail: string;
  product: string;
  amountCents: number;
  status: string;
  purchasedAt: string;
}

interface MockDispute {
  id: string;
  status: string;
  reason: string;
  amountCents: number;
  customerEmail: string;
  openedAt: string;
  evidenceDueAt: string;
  responseStatus: "not_started" | "in_progress" | "ready";
}

const CUSTOMERS: MockCustomer[] = [
  { id: "cus_sarahjohnson", name: "Sarah Johnson", email: "sarah.johnson@email.com" },
];

const TRANSACTIONS: MockTransaction[] = [
  {
    id: "txn_8b3f2a1c9d",
    customerEmail: "sarah.johnson@email.com",
    product: "Pro Coaching Program",
    amountCents: 49900,
    status: "succeeded",
    purchasedAt: "2026-08-02T14:32:00Z",
  },
];

const DISPUTES: MockDispute[] = [
  {
    id: "2481",
    status: "needs_response",
    reason: "product_not_received",
    amountCents: 49900,
    customerEmail: "sarah.johnson@email.com",
    openedAt: "2026-08-09T00:00:00Z",
    evidenceDueAt: "2026-08-13T00:00:00Z",
    responseStatus: "not_started",
  },
];

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createMockCommasServer(): McpServer {
  const server = new McpServer({ name: "commas-mock", version: "0.1.0" });

  server.registerTool(
    "fanbasis_list_customers",
    {
      title: "List customers",
      description: "Search customers by name or email.",
      inputSchema: { search: z.string().optional() },
    },
    async ({ search }) => {
      const q = search?.trim().toLowerCase();
      const results = q
        ? CUSTOMERS.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
        : CUSTOMERS;
      return textResult({ customers: results });
    },
  );

  server.registerTool(
    "fanbasis_list_transactions",
    {
      title: "List transactions",
      description: "List transactions, optionally filtered by customer email.",
      inputSchema: { customer_email: z.string().optional() },
    },
    async ({ customer_email }) => {
      const results = customer_email
        ? TRANSACTIONS.filter((t) => t.customerEmail.toLowerCase() === customer_email.toLowerCase())
        : TRANSACTIONS;
      return textResult({ transactions: results });
    },
  );

  server.registerTool(
    "fanbasis_get_transaction",
    {
      title: "Get transaction",
      description: "Look up a single transaction by id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const txn = TRANSACTIONS.find((t) => t.id === id);
      if (!txn) return errorResult(`Transaction not found: ${id}`);
      return textResult({ transaction: txn });
    },
  );

  server.registerTool(
    "commas_get_dispute",
    {
      title: "Get dispute",
      description:
        "Look up a dispute by id. Prototype-only tool — the real Commas platform has no disputes API.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const dispute = DISPUTES.find((d) => d.id === id);
      if (!dispute) return errorResult(`Dispute not found: ${id}`);
      return textResult({ dispute });
    },
  );

  server.registerTool(
    "commas_mark_dispute_response_ready",
    {
      title: "Mark dispute response ready",
      description:
        "Mark a dispute's evidence response as ready to submit. Prototype-only, simulated — " +
        "the real Commas platform has no evidence-submission API; this only flips a mock flag " +
        "and is never actually sent anywhere. Always requires seller confirmation before running.",
      inputSchema: { dispute_id: z.string() },
    },
    async ({ dispute_id }) => {
      const dispute = DISPUTES.find((d) => d.id === dispute_id);
      if (!dispute) return errorResult(`Dispute not found: ${dispute_id}`);
      dispute.responseStatus = "ready";
      return textResult({ dispute, simulated: true });
    },
  );

  return server;
}
