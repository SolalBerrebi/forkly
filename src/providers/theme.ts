/**
 * Per-provider color identity. A consistent visual cue (Claude → warm amber,
 * OpenAI → green, Gemini → blue, Ollama → pink) so cells, picker chips, and
 * lineage edges all reinforce which model is at work on which node.
 *
 * Returned values are CSS color strings — usable directly in `style` props
 * (e.g. `style={{ color }}`) and `color-mix()` expressions.
 */

export interface ProviderTheme {
  /** Bright variant — used for accent text and icon fills. */
  fg: string;
  /** Soft tint — used for icon-pill backgrounds (8% mix typical). */
  tint: string;
  /** Short label shown next to the provider chip. */
  label: string;
}

const PROVIDER_THEMES: Record<string, ProviderTheme> = {
  // Anthropic / Claude — warm amber. Matches Claude's brand chip.
  anthropic: { fg: "#d97757", tint: "rgba(217, 119, 87, 0.14)", label: "claude" },
  // OpenAI — emerald green.
  openai: { fg: "#10a37f", tint: "rgba(16, 163, 127, 0.14)", label: "gpt" },
  // Gemini — Google blue.
  google: { fg: "#4285f4", tint: "rgba(66, 133, 244, 0.14)", label: "gemini" },
  // Mistral — vibrant orange.
  mistral: { fg: "#ff7000", tint: "rgba(255, 112, 0, 0.14)", label: "mistral" },
  // Ollama / local models — pink. Echoes the llama mascot color.
  ollama: { fg: "#ec4899", tint: "rgba(236, 72, 153, 0.14)", label: "ollama" },
};

const FALLBACK: ProviderTheme = {
  fg: "var(--color-accent-from)",
  tint: "color-mix(in srgb, var(--color-accent-from) 14%, transparent)",
  label: "model",
};

export function providerTheme(providerId: string): ProviderTheme {
  return PROVIDER_THEMES[providerId] ?? FALLBACK;
}
