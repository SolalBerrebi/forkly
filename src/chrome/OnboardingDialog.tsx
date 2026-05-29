import * as Dialog from "@radix-ui/react-dialog";
import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import {
  markOnboarded,
  setPreferredProvider,
  type PreferredProvider,
} from "../lib/preferredProvider";
import { providerTheme } from "../providers/theme";
import { useDetectionStore } from "../state/detectionStore";
import { TerminalButton } from "./TerminalButton";

/**
 * First-launch chooser. Lays out every transport the user could plausibly
 * use and steers them toward whichever is already ready on their machine.
 * The picked option becomes the default for the `+ new session` button so
 * the user doesn't have to re-pick on every cell creation.
 *
 * Closed by either picking a transport ("Use this") or dismissing — both
 * paths set `forkly:onboarded` so we don't nag.
 */
export function OnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const detection = useDetectionStore();
  const refresh = useDetectionStore((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);

  // Re-probe on every dialog open. The user may have run `claude login`,
  // `codex login`, or started Ollama since app start.
  useEffect(() => {
    if (!open) return;
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [open, refresh]);

  const closeAndOnboard = () => {
    markOnboarded();
    onOpenChange(false);
  };

  const pick = (pref: PreferredProvider) => {
    setPreferredProvider(pref);
    closeAndOnboard();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 w-160 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-(--glass-border) shadow-2xl backdrop-blur-xl backdrop-saturate-140 focus:outline-none"
          style={{ background: "var(--glass-bg-strong)" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="relative border-b border-border px-6 py-5">
            <Dialog.Title className="font-mono text-base text-fg">
              welcome to forkly
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">
              Pick how you want to talk to a model. You can change or mix
              providers per cell later — this just sets your default.
            </Dialog.Description>
            <Dialog.Close
              onClick={closeAndOnboard}
              aria-label="Skip onboarding"
              className="absolute right-3 top-3 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-6 py-5">
            {refreshing && !detection.hydrated && (
              <div className="flex items-center gap-2 text-xs text-fg-subtle">
                <Loader2 className="h-3 w-3 animate-spin" /> checking what's
                installed…
              </div>
            )}

            {/* Claude Code — primary if ready */}
            <Card
              providerId="anthropic"
              title="Claude Code"
              subtitle="Your claude.ai Pro / Max / Team subscription"
              status={
                detection.claudeCode?.installed
                  ? detection.claudeCode.loggedIn
                    ? "ready"
                    : "needs-login"
                  : "missing"
              }
              version={detection.claudeCode?.version ?? null}
              actionLabel="Use Claude (subscription)"
              missingScript="npm install -g @anthropic-ai/claude-code && claude login"
              missingScriptLabel="Install Claude Code + log in"
              missingHint="A new Terminal window will open with the install + login script. Review it and hit enter."
              loginScript="claude login"
              loginScriptLabel="Log in to Claude Code"
              loginHint="Opens Terminal and runs `claude login` — your browser handles the rest."
              onPick={() =>
                pick({
                  providerId: "anthropic",
                  modelId: "claude-sonnet-4-6",
                  transportId: "claude-code",
                })
              }
            />

            {/* Codex / ChatGPT */}
            <Card
              providerId="openai"
              title="ChatGPT (Codex CLI)"
              subtitle="Your ChatGPT Plus / Pro / Business plan"
              status={
                detection.codex?.installed
                  ? detection.codex.loggedIn
                    ? "ready"
                    : "needs-login"
                  : "missing"
              }
              version={detection.codex?.version ?? null}
              actionLabel="Use GPT (subscription)"
              missingScript="npm install -g @openai/codex && codex login"
              missingScriptLabel="Install Codex CLI + log in"
              missingHint="A new Terminal window will open with the install + login script. Review and hit enter."
              loginScript="codex login"
              loginScriptLabel="Log in to ChatGPT"
              loginHint="Opens Terminal and runs `codex login` — your browser handles the rest."
              onPick={() =>
                pick({
                  providerId: "openai",
                  modelId: "gpt-5.4",
                  transportId: "codex",
                })
              }
            />

            {/* Ollama */}
            <Card
              providerId="ollama"
              title="Ollama (local · free)"
              subtitle="Run open models on your machine. No keys, no internet."
              status={
                detection.ollama?.running
                  ? detection.ollama.models.length > 0
                    ? "ready"
                    : "needs-login"
                  : "missing"
              }
              version={null}
              actionLabel="Use local models (free)"
              disabledIfNoModels={
                !!detection.ollama?.running && detection.ollama.models.length === 0
              }
              missingHint="Install Ollama from ollama.com, then we'll detect it automatically."
              missingExternalUrl="https://ollama.com/download"
              missingExternalLabel="Open ollama.com/download"
              loginScript="ollama pull llama3.2"
              loginScriptLabel="Pull a starter model (llama3.2)"
              loginHint="A new Terminal window opens with the pull command — ~2GB download."
              onPick={() => {
                const firstModel = detection.ollama?.models[0]?.id ?? "llama3.2";
                pick({
                  providerId: "ollama",
                  modelId: firstModel,
                  transportId: "ollama",
                });
              }}
            />

            {/* Gemini free tier — always shown, recommended fallback */}
            <GeminiFreeCard onPick={pick} />
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-3 text-[11px] text-fg-subtle">
            <button
              onClick={() => {
                setRefreshing(true);
                refresh().finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
              className="font-mono text-fg-muted underline-offset-4 hover:underline disabled:opacity-50"
            >
              {refreshing ? "checking…" : "re-check what's installed"}
            </button>
            <button
              onClick={closeAndOnboard}
              className="font-mono text-fg-subtle hover:text-fg-muted"
            >
              I'll decide later
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type CardStatus = "ready" | "needs-login" | "missing";

function Card({
  providerId,
  title,
  subtitle,
  status,
  version,
  actionLabel,
  missingHint,
  missingScript,
  missingScriptLabel,
  missingExternalUrl,
  missingExternalLabel,
  loginHint,
  loginScript,
  loginScriptLabel,
  onPick,
  disabledIfNoModels,
}: {
  providerId: string;
  title: string;
  subtitle: string;
  status: CardStatus;
  version: string | null;
  actionLabel: string;
  missingHint: React.ReactNode;
  /** If provided, "not installed" state shows a TerminalButton that runs
   *  this script in a new terminal window. */
  missingScript?: string;
  missingScriptLabel?: string;
  /** Alternative to missingScript: open this URL in the browser instead
   *  (used for Ollama where the install needs the official site). */
  missingExternalUrl?: string;
  missingExternalLabel?: string;
  loginHint: React.ReactNode;
  /** If provided, "installed but not logged in" state shows a TerminalButton
   *  that runs this script. Typically a `<cli> login` command. */
  loginScript?: string;
  loginScriptLabel?: string;
  onPick: () => void;
  disabledIfNoModels?: boolean;
}) {
  const theme = providerTheme(providerId);
  const ready = status === "ready" && !disabledIfNoModels;
  // What setup affordance to surface — script or link, depending on state.
  const showMissingScript = !ready && (status === "missing" || disabledIfNoModels) && missingScript;
  const showMissingLink = !ready && (status === "missing" || disabledIfNoModels) && !missingScript && missingExternalUrl;
  const showLoginScript = !ready && status === "needs-login" && loginScript;
  return (
    <div
      className={[
        "flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
        ready
          ? "border-border-strong bg-bg/40"
          : "border-border bg-bg/20 opacity-90",
      ].join(" ")}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: theme.tint, color: theme.fg }}
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="font-mono text-sm text-fg">{title}</div>
          {ready && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{ background: theme.tint, color: theme.fg }}
            >
              <Check className="h-2.5 w-2.5" /> ready{version ? ` · ${version}` : ""}
            </span>
          )}
          {status === "needs-login" && !disabledIfNoModels && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-danger">
              setup needed
            </span>
          )}
          {(status === "missing" || disabledIfNoModels) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-fg-subtle/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              not detected
            </span>
          )}
        </div>
        <div className="text-xs text-fg-muted">{subtitle}</div>
        {showMissingScript && (
          <TerminalButton
            script={missingScript!}
            label={missingScriptLabel ?? "Run in terminal"}
            hint={typeof missingHint === "string" ? missingHint : undefined}
          />
        )}
        {showMissingLink && (
          <a
            href={missingExternalUrl!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-(--glass-border-strong) bg-bg-elevated px-3 py-1.5 font-mono text-[11px] text-fg-muted hover:text-fg"
          >
            <ExternalLink className="h-3 w-3" />
            {missingExternalLabel ?? "Open download page"}
          </a>
        )}
        {showLoginScript && (
          <TerminalButton
            script={loginScript!}
            label={loginScriptLabel ?? "Run in terminal"}
            hint={typeof loginHint === "string" ? loginHint : undefined}
          />
        )}
        {!ready && !showMissingScript && !showMissingLink && !showLoginScript && (
          <div className="text-[11px] leading-relaxed text-fg-subtle">
            {status === "missing" || disabledIfNoModels ? missingHint : loginHint}
          </div>
        )}
      </div>
      <button
        onClick={onPick}
        disabled={!ready}
        className={[
          "shrink-0 self-center rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors",
          ready
            ? "border-accent-from bg-accent-from/15 text-fg hover:bg-accent-from/25"
            : "cursor-not-allowed border-border bg-bg-elevated/40 text-fg-subtle",
        ].join(" ")}
      >
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * Gemini free-tier card — the universal fallback. Walks the user through
 * grabbing a free AI Studio key and saves it directly. The free tier covers
 * 1,000 requests/day on gemini-2.5-flash which is more than enough for the
 * "try it out" use case the README promises.
 */
function GeminiFreeCard({
  onPick,
}: {
  onPick: (pref: PreferredProvider) => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [step, setStep] = useState<"intro" | "paste">("intro");
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = providerTheme("google");

  useEffect(() => {
    ipc
      .hasApiKey("google")
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, []);

  const ready = hasKey === true;

  const save = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setError("Paste a key to continue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await ipc.setApiKey("google", trimmed);
      setHasKey(true);
      onPick({
        providerId: "google",
        modelId: "gemini-2.5-flash",
        transportId: "api",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-3.5 transition-colors"
      style={{
        borderColor: ready ? theme.fg : "color-mix(in srgb, var(--color-border) 80%, transparent)",
        background: ready ? theme.tint : "var(--color-bg)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ background: theme.tint, color: theme.fg }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm text-fg">Gemini (free tier)</div>
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{ background: theme.tint, color: theme.fg }}
            >
              recommended · no install
            </span>
          </div>
          <div className="text-xs text-fg-muted">
            Free Google AI Studio key — 60 req/min, 1,000 req/day on Flash. 30
            seconds to set up.
          </div>
        </div>
        {ready && step === "intro" && (
          <button
            onClick={() =>
              onPick({
                providerId: "google",
                modelId: "gemini-2.5-flash",
                transportId: "api",
              })
            }
            className="shrink-0 self-center rounded-lg border border-accent-from bg-accent-from/15 px-3 py-1.5 font-mono text-[11px] text-fg hover:bg-accent-from/25"
          >
            Use Gemini Free
          </button>
        )}
      </div>

      {step === "intro" && !ready && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-[11px] text-fg-muted hover:text-fg"
          >
            <ExternalLink className="h-3 w-3" />
            open AI Studio
          </a>
          <button
            onClick={() => setStep("paste")}
            className="rounded-lg border border-accent-from bg-accent-from/15 px-3 py-1.5 font-mono text-[11px] text-fg hover:bg-accent-from/25"
          >
            I have a key — paste it
          </button>
        </div>
      )}

      {step === "paste" && (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza…"
            className="w-full rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent-from"
            autoFocus
          />
          {error && (
            <div className="font-mono text-[10px] text-danger">⚠ {error}</div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg border border-accent-from bg-accent-from/15 px-3 py-1.5 font-mono text-[11px] text-fg hover:bg-accent-from/25 disabled:opacity-50"
            >
              {saving ? "saving…" : "save & use Gemini"}
            </button>
            <button
              onClick={() => {
                setStep("intro");
                setKeyInput("");
                setError(null);
              }}
              className="font-mono text-[11px] text-fg-subtle hover:text-fg-muted"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
