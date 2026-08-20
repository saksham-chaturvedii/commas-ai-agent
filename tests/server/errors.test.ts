// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AgentError, classifyError } from "../../server/agent/errors.js";

describe("classifyError", () => {
  it("passes an existing AgentError through unchanged", () => {
    const original = new AgentError("tool_error", "already classified");
    expect(classifyError(original)).toBe(original);
  });

  it("classifies 401/403-shaped errors as auth_failed", () => {
    expect(classifyError(new Error("Request failed with status 401")).code).toBe("auth_failed");
    expect(classifyError(new Error("403 Forbidden")).code).toBe("auth_failed");
    expect(classifyError(new Error("Authentication failed")).code).toBe("auth_failed");
  });

  it("classifies connection-shaped errors as server_unavailable", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:1")).code).toBe("server_unavailable");
    expect(classifyError(new Error("fetch failed")).code).toBe("server_unavailable");
  });

  it("classifies timeout-shaped errors as timeout", () => {
    expect(classifyError(new Error("Timed out after 10000ms")).code).toBe("timeout");
    expect(classifyError(new Error("The operation was aborted")).code).toBe("timeout");
  });

  it("classifies unparseable-response-shaped errors as malformed_result", () => {
    expect(classifyError(new Error("Unexpected token < in JSON at position 0")).code).toBe("malformed_result");
    expect(classifyError(new Error("Invalid tool response schema")).code).toBe("malformed_result");
  });

  it("falls back to tool_error for anything unrecognized", () => {
    expect(classifyError(new Error("something else entirely broke")).code).toBe("tool_error");
    expect(classifyError("a bare string, not even an Error").message).toBeTruthy();
  });
});
