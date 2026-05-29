import { Check, Copy, Loader2, Terminal as TerminalIcon } from "lucide-react";
import { useState } from "react";
import { ipc } from "../lib/ipc";

/**
 * One-click "run this script in your terminal" button. Backed by
 * `ipc.runInTerminal`, which opens macOS Terminal (via AppleScript),
 * Linux gnome-terminal/konsole/xterm, or Windows cmd.exe with the script
 * pre-typed. The user reviews the command and hits enter — we do not
 * auto-execute it, to keep trust intact.
 *
 * The command itself stays visible above the button so the user always
 * knows what they're about to run. A small copy button is included for
 * people who'd rather paste into their own shell.
 */
export function TerminalButton({
  script,
  label,
  hint,
}: {
  script: string;
  label: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      await ipc.runInTerminal(script);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // fall through — the textarea is selectable
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-(--glass-border) bg-bg px-3 py-2">
        <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <code className="flex-1 truncate font-mono text-[11px] text-fg">
          {script}
        </code>
        <button
          onClick={copy}
          aria-label="Copy"
          title="Copy to clipboard"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent-from bg-accent-from/15 px-3 py-1.5 font-mono text-[11px] text-fg transition-all hover:bg-accent-from/25 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <TerminalIcon className="h-3 w-3" />
        )}
        {busy ? "opening terminal…" : label}
      </button>
      {hint && (
        <p className="px-1 font-mono text-[10px] leading-relaxed text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p className="px-1 font-mono text-[10px] text-danger">⚠ {error}</p>
      )}
    </div>
  );
}
