import * as Dialog from "@radix-ui/react-dialog";
import { Check, ExternalLink, KeyRound, Loader2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ipc } from "../lib/ipc";

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
          className="fixed left-1/2 top-1/2 z-40 w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="space-y-1">
              <Dialog.Title className="font-mono text-sm text-fg">api keys</Dialog.Title>
              <Dialog.Description className="text-xs text-fg-muted">
                Stored in your OS keychain. Sent only to the provider you choose.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="divide-y divide-border">
            {PROVIDERS.map((p) => (
              <ApiKeyRow key={p.id} provider={p} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

  const handleStartEdit = () => {
    setIsEditing(true);
    setValue("");
  };

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg text-fg-muted">
            <KeyRound className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="font-mono text-sm text-fg">{provider.name.toLowerCase()}</div>
            <div className="text-[10px] text-fg-subtle">
              {isSet === null ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> checking…
                </span>
              ) : isSet ? (
                <span className="flex items-center gap-1 text-success">
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
          className="flex items-center gap-1 text-[10px] text-fg-subtle transition-colors hover:text-fg-muted"
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
            className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent-from"
          />
          <button
            disabled={busy || !value.trim()}
            onClick={handleSave}
            className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "save"}
          </button>
        </div>
      )}

      {isSet === true && !isEditing && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg-muted tracking-widest">
            ••••••••••••••••
          </div>
          <button
            onClick={handleStartEdit}
            className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:text-fg"
          >
            update
          </button>
          <button
            onClick={handleClear}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg-subtle transition-colors hover:text-danger disabled:opacity-50"
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
