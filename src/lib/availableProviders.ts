/**
 * Translates raw detection state into "what can the user actually use right
 * now?". A provider is *available* when at least one of its transports has
 * working auth:
 *   - anthropic: claude-code logged in OR anthropic api key set
 *   - openai:    codex logged in OR openai api key set
 *   - google:    google api key set (no CLI path post-Antigravity)
 *   - ollama:    daemon running AND at least one model pulled
 *
 * The picker uses this to gate the cross-LLM fork chooser — we never offer a
 * provider that's going to fail at stream-time.
 */

import { providerTheme } from "../providers/theme";
import type { ClaudeCodeStatus, OllamaStatus, TransportId } from "./ipc";

export interface AvailableProvider {
  providerId: string;
  /** Human label (Claude / GPT / Gemini / Ollama). */
  label: string;
  /** Default model id for one-click selection. For Ollama this is the first
   *  installed model, since the catalog is dynamic. */
  modelId: string;
  /** Cheapest available transport — subscription if logged in, API otherwise. */
  transportId: TransportId;
  /** Short hint shown under the provider name in the picker. */
  hint: string;
  /** Foreground color for the chip. */
  color: string;
  /** Background tint for the chip. */
  tint: string;
}

/** Minimal input — only what the helper actually reads. Keeps the React-side
 *  memoisation honest: callers can pass primitives selected one-by-one from
 *  the detection store without dragging the whole state in. */
export interface DetectionLike {
  claudeCode: ClaudeCodeStatus | null;
  codex: ClaudeCodeStatus | null;
  ollama: OllamaStatus | null;
  apiKeys: Record<string, boolean>;
}

export function getAvailableProviders(detection: DetectionLike): AvailableProvider[] {
  const out: AvailableProvider[] = [];

  // Anthropic — prefer CLI when logged in, fall back to API key.
  const claudeReady = !!detection.claudeCode?.loggedIn;
  const claudeKey = !!detection.apiKeys.anthropic;
  if (claudeReady || claudeKey) {
    const t = providerTheme("anthropic");
    out.push({
      providerId: "anthropic",
      label: "Claude",
      modelId: "claude-sonnet-4-6",
      transportId: claudeReady ? "claude-code" : "api",
      hint: claudeReady ? "subscription" : "api key",
      color: t.fg,
      tint: t.tint,
    });
  }

  // OpenAI — prefer Codex CLI subscription, fall back to API key.
  const codexReady = !!detection.codex?.loggedIn;
  const openaiKey = !!detection.apiKeys.openai;
  if (codexReady || openaiKey) {
    const t = providerTheme("openai");
    out.push({
      providerId: "openai",
      label: "GPT",
      modelId: "gpt-5.4",
      transportId: codexReady ? "codex" : "api",
      hint: codexReady ? "ChatGPT subscription" : "api key",
      color: t.fg,
      tint: t.tint,
    });
  }

  // Google — API key only. No CLI path on a v0.1 timeline.
  if (detection.apiKeys.google) {
    const t = providerTheme("google");
    out.push({
      providerId: "google",
      label: "Gemini",
      modelId: "gemini-2.5-flash",
      transportId: "api",
      hint: "api key (free tier)",
      color: t.fg,
      tint: t.tint,
    });
  }

  // Ollama — only show when running AND at least one model is available.
  if (
    detection.ollama?.running &&
    detection.ollama.models.length > 0
  ) {
    const t = providerTheme("ollama");
    const first = detection.ollama.models[0];
    out.push({
      providerId: "ollama",
      label: "Ollama",
      modelId: first.id,
      transportId: "ollama",
      hint: `local · ${first.id.replace(":latest", "")}`,
      color: t.fg,
      tint: t.tint,
    });
  }

  return out;
}
