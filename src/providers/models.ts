/**
 * Static catalog of models available per provider. Drives the per-session
 * model picker in the SessionNode header. Adding a new model is a one-line
 * edit here — no other code needs to change.
 *
 * For Claude Code transport, model ids match what `claude --model` accepts
 * (full versioned ids or short aliases). For the API transport, ids match
 * Anthropic's documented model strings at /v1/messages.
 */

export interface ModelOption {
  /** Canonical model id sent to the provider. */
  id: string;
  /** Short human label for the dropdown ("sonnet 4.6", not the full id). */
  label: string;
  /** Optional one-line description shown below the label. */
  description?: string;
}

export const MODEL_CATALOG: Record<string, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-4-7", label: "opus 4.7", description: "most capable" },
    { id: "claude-sonnet-4-6", label: "sonnet 4.6", description: "balanced" },
    { id: "claude-haiku-4-5-20251001", label: "haiku 4.5", description: "fastest" },
  ],
};

/**
 * Find the short label for a stored model id. Falls back to the id itself
 * if it doesn't match the catalog (e.g. a session imported from CC with a
 * model not yet listed).
 */
export function labelForModel(providerId: string, modelId: string): string {
  const opts = MODEL_CATALOG[providerId];
  if (!opts) return modelId;
  return opts.find((m) => m.id === modelId)?.label ?? modelId;
}
