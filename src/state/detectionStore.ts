import { create } from "zustand";
import { ipc, type ClaudeCodeStatus, type OllamaStatus } from "../lib/ipc";

/**
 * App-wide cache of "is this CLI / local service installed and ready?"
 * answers. Populated at startup so the UI can switch defaults (e.g. picking
 * codex over api when the user has run `codex login`, or showing Ollama
 * models in the picker when the daemon is running) without waiting on
 * detection per render.
 */
interface DetectionState {
  claudeCode: ClaudeCodeStatus | null;
  codex: ClaudeCodeStatus | null;
  ollama: OllamaStatus | null;
  /** Provider id → "has a key stored in the keychain". Cached so the picker
   *  doesn't have to await an IPC roundtrip every render. */
  apiKeys: Record<string, boolean>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
}

const emptyCli: ClaudeCodeStatus = { installed: false, version: null, loggedIn: false };
const emptyOllama: OllamaStatus = { running: false, models: [] };

// Providers we check API-key presence for. Add new ones here when a new
// HTTP-backed provider lands.
const API_KEY_PROVIDERS = ["anthropic", "openai", "google"] as const;

async function probe() {
  const [claudeCode, codex, ollama, ...keyPresences] = await Promise.all([
    ipc.detectClaudeCode().catch(() => emptyCli),
    ipc.detectCodex().catch(() => emptyCli),
    ipc.detectOllama().catch(() => emptyOllama),
    ...API_KEY_PROVIDERS.map((p) =>
      ipc.hasApiKey(p).catch(() => false),
    ),
  ]);
  const apiKeys: Record<string, boolean> = {};
  API_KEY_PROVIDERS.forEach((p, i) => {
    apiKeys[p] = !!keyPresences[i];
  });
  return { claudeCode, codex, ollama, apiKeys };
}

export const useDetectionStore = create<DetectionState>((set) => ({
  claudeCode: null,
  codex: null,
  ollama: null,
  apiKeys: {},
  hydrated: false,
  hydrate: async () => {
    const probed = await probe();
    set({ ...probed, hydrated: true });
  },
  refresh: async () => {
    const probed = await probe();
    set(probed);
  },
}));
