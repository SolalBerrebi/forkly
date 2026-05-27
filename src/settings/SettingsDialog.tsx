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
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ipc, type ClaudeCodeStatus } from "../lib/ipc";

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
];

export function SettingsDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 w-[500px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="space-y-1">
              <Dialog.Title className="font-mono text-sm text-fg">auth</Dialog.Title>
              <Dialog.Description className="text-xs text-fg-muted">
                Pick how Forkly reaches Claude.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <ClaudeCodeSection />
          <ApiKeysSection />
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
      <CommandRow command="npm i -g @anthropic-ai/claude-code" hint="install" />
      <p className="text-[11px] text-fg-subtle">
        After installing, run <code className="font-mono text-fg-muted">claude login</code>{" "}
        and then click the refresh button above.
      </p>
    </div>
  );
}

function LoginCallout({ version }: { version: string | null }) {
  return (
    <div className="space-y-2">
      <StatusPill tone="warn">
        installed{version ? ` · ${version}` : ""} · not logged in
      </StatusPill>
      <CommandRow command="claude login" hint="run this in your terminal, then refresh" />
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

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      await ipc.setApiKey(provider.id, value.trim());
      setIsSet(true);
      setIsEditing(false);
      setValue("");
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
