import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Terminal,
  Type,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Appearance } from "../lib/appearance";
import {
  applyChatTextSize,
  CHAT_TEXT_SIZE_OPTIONS,
  getInitialChatTextSize,
  type ChatTextSize,
} from "../lib/chatTextSize";
import { ipc, type ClaudeCodeStatus, type OllamaStatus } from "../lib/ipc";
import { useAppearance, useSetAppearance } from "../state/appearanceContext";
import { useDetectionStore } from "../state/detectionStore";
import { TerminalButton } from "../chrome/TerminalButton";

interface ProviderConfig {
  id: string;
  name: string;
  helpUrl: string;
  helpLabel: string;
  keyHint: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpLabel: "console.anthropic.com",
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    helpUrl: "https://platform.openai.com/api-keys",
    helpLabel: "platform.openai.com",
    keyHint: "sk-…",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    helpUrl: "https://aistudio.google.com/apikey",
    helpLabel: "aistudio.google.com — free tier available",
    keyHint: "AIza…",
  },
];

export function SettingsDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 flex max-h-[88vh] w-125 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-(--glass-border) shadow-2xl backdrop-blur-xl backdrop-saturate-140 focus:outline-none"
          style={{ background: "var(--glass-bg-strong)" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Sticky header — always anchored at the top while the body
              scrolls underneath. Without this, opening Settings on a short
              window made the API-keys / Appearance sections inaccessible. */}
          <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
            <div className="space-y-1">
              <Dialog.Title className="font-mono text-sm text-fg">settings</Dialog.Title>
              <Dialog.Description className="text-xs text-fg-muted">
                Auth providers, appearance, and API keys.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="chat-scroll flex-1 overflow-y-auto">
            <ClaudeCodeSection />
            <CodexSection />
            <OllamaSection />
            <AppearanceSection />
            <ApiKeysSection />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* -------------------------------------------------------------------- */
/* Claude Code (primary)                                                */
/* -------------------------------------------------------------------- */

function ClaudeCodeSection() {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const check = async () => {
    setRefreshing(true);
    try {
      const s = await ipc.detectClaudeCode();
      setStatus(s);
    } catch {
      setStatus({ installed: false, version: null, loggedIn: false });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    check();
  }, []);

  const ready = !!status?.installed && !!status?.loggedIn;

  return (
    <div className="space-y-3 border-b border-border bg-bg-elevated/60 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent-from">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm text-fg">claude code</div>
            <span className="rounded-full bg-accent-from/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-from">
              primary
            </span>
          </div>
          <div className="text-xs text-fg-muted">
            Use your claude.ai Pro / Max / Team subscription. No API charges.
          </div>
        </div>
        <button
          onClick={check}
          disabled={refreshing}
          aria-label="Recheck"
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {status === null ? (
        <StatusPill tone="muted">
          <Loader2 className="h-3 w-3 animate-spin" /> checking…
        </StatusPill>
      ) : ready ? (
        <StatusPill tone="success">
          <Check className="h-3 w-3" />
          ready · {status.version}
        </StatusPill>
      ) : !status.installed ? (
        <InstallCallout />
      ) : (
        <LoginCallout version={status.version} />
      )}
    </div>
  );
}

function InstallCallout() {
  return (
    <div className="space-y-2">
      <StatusPill tone="danger">not installed</StatusPill>
      <TerminalButton
        script="npm install -g @anthropic-ai/claude-code && claude login"
        label="Install Claude Code + log in"
        hint="Opens Terminal with the install + login script. Hit ↩ to run."
      />
    </div>
  );
}

function LoginCallout({ version }: { version: string | null }) {
  return (
    <div className="space-y-2">
      <StatusPill tone="warn">
        installed{version ? ` · ${version}` : ""} · not logged in
      </StatusPill>
      <TerminalButton
        script="claude login"
        label="Log in to Claude Code"
        hint="Opens Terminal and runs `claude login`. Your browser handles OAuth."
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Codex (OpenAI subscription)                                          */
/* -------------------------------------------------------------------- */

function CodexSection() {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const check = async () => {
    setRefreshing(true);
    try {
      const s = await ipc.detectCodex();
      setStatus(s);
    } catch {
      setStatus({ installed: false, version: null, loggedIn: false });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    check();
  }, []);

  const ready = !!status?.installed && !!status?.loggedIn;

  return (
    <div className="space-y-3 border-b border-border bg-bg-elevated/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border"
          style={{
            background: "color-mix(in srgb, #10a37f 14%, transparent)",
            color: "#10a37f",
          }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm text-fg">codex (chatgpt)</div>
            <span
              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{
                background: "color-mix(in srgb, #10a37f 16%, transparent)",
                color: "#10a37f",
              }}
            >
              subscription
            </span>
          </div>
          <div className="text-xs text-fg-muted">
            Use your ChatGPT Plus / Pro / Business plan via Codex CLI. No API charges.
          </div>
        </div>
        <button
          onClick={check}
          disabled={refreshing}
          aria-label="Recheck"
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {status === null ? (
        <StatusPill tone="muted">
          <Loader2 className="h-3 w-3 animate-spin" /> checking…
        </StatusPill>
      ) : ready ? (
        <StatusPill tone="success">
          <Check className="h-3 w-3" />
          ready · {status.version}
        </StatusPill>
      ) : !status.installed ? (
        <CodexInstallCallout />
      ) : (
        <CodexLoginCallout version={status.version} />
      )}
    </div>
  );
}

function CodexInstallCallout() {
  return (
    <div className="space-y-2">
      <StatusPill tone="danger">not installed</StatusPill>
      <TerminalButton
        script="npm install -g @openai/codex && codex login"
        label="Install Codex CLI + log in"
        hint="Opens Terminal with the install + login script. Hit ↩ to run."
      />
    </div>
  );
}

function CodexLoginCallout({ version }: { version: string | null }) {
  return (
    <div className="space-y-2">
      <StatusPill tone="warn">
        installed{version ? ` · ${version}` : ""} · not logged in
      </StatusPill>
      <TerminalButton
        script="codex login"
        label="Log in to ChatGPT"
        hint="Opens Terminal and runs `codex login`. Your browser handles OAuth."
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Ollama (local, free)                                                 */
/* -------------------------------------------------------------------- */

function OllamaSection() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const check = async () => {
    setRefreshing(true);
    try {
      const s = await ipc.detectOllama();
      setStatus(s);
    } catch {
      setStatus({ running: false, models: [] });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    check();
  }, []);

  const running = !!status?.running;
  const modelCount = status?.models.length ?? 0;

  return (
    <div className="space-y-3 border-b border-border bg-bg-elevated/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border"
          style={{
            background: "color-mix(in srgb, #ec4899 14%, transparent)",
            color: "#ec4899",
          }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm text-fg">ollama</div>
            <span
              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{
                background: "color-mix(in srgb, #ec4899 16%, transparent)",
                color: "#ec4899",
              }}
            >
              local · free
            </span>
          </div>
          <div className="text-xs text-fg-muted">
            Run open models on your machine. Zero cost, zero internet, no keys.
          </div>
        </div>
        <button
          onClick={check}
          disabled={refreshing}
          aria-label="Recheck"
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {status === null ? (
        <StatusPill tone="muted">
          <Loader2 className="h-3 w-3 animate-spin" /> checking…
        </StatusPill>
      ) : running ? (
        <div className="space-y-2">
          <StatusPill tone="success">
            <Check className="h-3 w-3" />
            running · {modelCount} {modelCount === 1 ? "model" : "models"}
          </StatusPill>
          {modelCount === 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] text-fg-subtle">
                No models installed yet. Pull one to start.
              </p>
              <CommandRow command="ollama pull llama3.2" hint="small, fast — good first model" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {status!.models.slice(0, 6).map((m) => (
                <span
                  key={m.id}
                  className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-fg-muted"
                >
                  {m.id.replace(":latest", "")}
                </span>
              ))}
              {modelCount > 6 && (
                <span className="font-mono text-[10px] text-fg-subtle">
                  +{modelCount - 6} more
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <StatusPill tone="warn">not running</StatusPill>
          <p className="text-[11px] text-fg-subtle">
            Install from{" "}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="text-accent-from underline"
            >
              ollama.com/download
            </a>{" "}
            then run <code className="font-mono text-fg-muted">ollama serve</code> and refresh.
          </p>
        </div>
      )}
    </div>
  );
}

function CommandRow({ command, hint }: { command: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore; user can select manually
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <code className="flex-1 truncate font-mono text-[11.5px] text-fg">
          {command}
        </code>
        <button
          onClick={copy}
          aria-label="Copy"
          className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <p className="px-1 text-[10px] text-fg-subtle">{hint}</p>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warn" | "danger" | "muted";
  children: ReactNode;
}) {
  const colors = {
    success: "border-success/40 bg-success/10 text-success",
    warn: "border-danger/40 bg-danger/10 text-danger",
    danger: "border-danger/40 bg-danger/10 text-danger",
    muted: "border-border bg-bg text-fg-muted",
  }[tone];

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${colors}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Appearance                                                           */
/* -------------------------------------------------------------------- */

function AppearanceSection() {
  const [size, setSize] = useState<ChatTextSize>(() => getInitialChatTextSize());
  const appearance = useAppearance();
  const setAppearance = useSetAppearance();

  const handlePickSize = (next: ChatTextSize) => {
    setSize(next);
    applyChatTextSize(next);
  };

  const APPEARANCES: Array<{ id: Appearance; label: string; hint: string }> = [
    { id: "terminal", label: "terminal", hint: "claude code feel" },
    { id: "chat", label: "chat", hint: "claude.ai feel" },
  ];

  return (
    <div className="space-y-4 border-b border-border px-5 py-4">
      {/* Appearance: terminal vs chat ----------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-fg-muted">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 space-y-0.5">
            <div className="font-mono text-sm text-fg">cell appearance</div>
            <div className="text-[10px] text-fg-muted">
              How conversations render inside each session.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pl-10">
          {APPEARANCES.map((opt) => {
            const active = opt.id === appearance;
            return (
              <button
                key={opt.id}
                onClick={() => setAppearance(opt.id)}
                aria-pressed={active}
                className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-accent-from/50 bg-accent-from/10"
                    : "border-border bg-bg hover:border-border-strong"
                }`}
              >
                <span
                  className={`font-mono text-[11px] ${
                    active ? "text-accent-from" : "text-fg"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="text-[9px] text-fg-subtle">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat text size ------------------------------------------------- */}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-fg-muted">
            <Type className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-0.5">
            <div className="font-mono text-sm text-fg">chat text size</div>
            <div className="text-[10px] text-fg-muted">
              Scales message body + composer. Headers and chips stay fixed.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border bg-bg p-0.5">
          {CHAT_TEXT_SIZE_OPTIONS.map((opt) => {
            const active = opt.id === size;
            return (
              <button
                key={opt.id}
                onClick={() => handlePickSize(opt.id)}
                aria-pressed={active}
                title={`${opt.px}px`}
                className={`flex h-6 w-7 items-center justify-center rounded font-mono text-[10px] transition-colors ${
                  active
                    ? "bg-accent-from/15 text-accent-from"
                    : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* API keys (advanced)                                                  */
/* -------------------------------------------------------------------- */

function ApiKeysSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-1 font-mono text-[11px] text-fg-subtle transition-colors hover:text-fg-muted"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        api keys
        <span className="rounded-full bg-bg px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-subtle">
          advanced
        </span>
        <span className="ml-auto text-[10px] text-fg-subtle">
          pay-per-token · org workflows
        </span>
      </button>

      {expanded && (
        <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-bg-elevated/40">
          {PROVIDERS.map((p) => (
            <ApiKeyRow key={p.id} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApiKeyRow({ provider }: { provider: ProviderConfig }) {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .hasApiKey(provider.id)
      .then((has) => {
        if (!cancelled) setIsSet(has);
      })
      .catch(() => {
        if (!cancelled) setIsSet(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider.id]);

  const refreshDetection = useDetectionStore((s) => s.refresh);

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      await ipc.setApiKey(provider.id, value.trim());
      setIsSet(true);
      setIsEditing(false);
      setValue("");
      // Refresh the cache so the cross-LLM fork picker picks up the new
      // provider without waiting for an app restart.
      refreshDetection().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    setBusy(true);
    try {
      await ipc.deleteApiKey(provider.id);
      setIsSet(false);
      setIsEditing(false);
      setValue("");
      refreshDetection().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg text-fg-subtle">
            <KeyRound className="h-3 w-3" />
          </div>
          <div>
            <div className="font-mono text-xs text-fg">{provider.name.toLowerCase()}</div>
            <div className="text-[10px] text-fg-subtle">
              {isSet === null ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> checking…
                </span>
              ) : isSet ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="h-2.5 w-2.5" /> connected
                </span>
              ) : (
                <span>not set</span>
              )}
            </div>
          </div>
        </div>

        <a
          href={provider.helpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          {provider.helpLabel}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>

      {(isSet === false || isEditing) && (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) handleSave();
              if (e.key === "Escape") {
                setIsEditing(false);
                setValue("");
              }
            }}
            placeholder={provider.keyHint}
            className="flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent-from"
          />
          <button
            disabled={busy || !value.trim()}
            onClick={handleSave}
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "save"}
          </button>
        </div>
      )}

      {isSet === true && !isEditing && (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg-muted tracking-widest">
            ••••••••••••••••
          </div>
          <button
            onClick={() => {
              setIsEditing(true);
              setValue("");
            }}
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg-muted transition-colors hover:text-fg"
          >
            update
          </button>
          <button
            onClick={handleClear}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg-subtle transition-colors hover:text-danger disabled:opacity-50"
          >
            clear
          </button>
        </div>
      )}

      {error && (
        <div className="font-mono text-[10px] text-danger">{error}</div>
      )}
    </div>
  );
}
