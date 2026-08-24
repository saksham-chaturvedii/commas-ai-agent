/**
 * Server-owned record of write-tool calls actually paused for approval (audit P0-1: previously
 * `POST /api/agent/approve` executed any tool name/input the client asserted, with no server-side
 * record that a pending approval ever existed — a forged request could execute an arbitrary
 * write tool). One instance per `createApp()` call, like `SessionStore`, so tests never leak
 * pending approvals into each other.
 */

export interface PendingApprovalRecord {
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a seller to read and click, short enough that a leaked/forged id goes stale.

export class PendingApprovalStore {
  private records = new Map<string, PendingApprovalRecord>();

  /** Called only from the runtime's own tool-calling loop, right when it decides to pause for
   * approval — never from anything client-supplied. */
  register(toolCallId: string, toolName: string, input: Record<string, unknown>): void {
    this.records.set(toolCallId, { toolName, input, createdAt: Date.now() });
  }

  /**
   * One-time consume: removes the record regardless of outcome, so a given `toolCallId` can
   * never be replayed twice, then returns it only if it existed, matches `toolName`, and hasn't
   * expired. The caller must use the RETURNED `toolName`/`input` to execute — never the
   * client-supplied ones — since those are the only values this server ever actually proposed.
   */
  consume(toolCallId: string, toolName: string): PendingApprovalRecord | undefined {
    const record = this.records.get(toolCallId);
    this.records.delete(toolCallId);
    if (!record) return undefined;
    if (record.toolName !== toolName) return undefined;
    if (Date.now() - record.createdAt > TTL_MS) return undefined;
    return record;
  }

  size(): number {
    return this.records.size;
  }
}
