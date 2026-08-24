/**
 * Gemini's function-calling `parameters` field rejects standard JSON Schema keywords its schema
 * validator doesn't recognize — confirmed live (not guessed): a real request with the tool
 * registry's own schemas (each carrying the top-level `$schema` key zod-to-json-schema adds,
 * e.g. `server/agent/registry.ts`'s tool definitions) failed with `400 INVALID_ARGUMENT`,
 * `Unknown name "$schema"` for every tool. Anthropic's API tolerates the same schemas as-is;
 * Gemini's doesn't. Strips `$schema` (and `$id`, in case a future schema source adds one) at
 * every depth, leaving everything else — types, properties, required, descriptions — untouched.
 */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (schema && typeof schema === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$schema" || key === "$id") continue;
      result[key] = sanitizeSchemaForGemini(value);
    }
    return result;
  }
  return schema;
}
