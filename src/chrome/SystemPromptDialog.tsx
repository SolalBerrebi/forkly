import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

interface SystemPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current saved system prompt (empty string when unset). */
  initialValue: string;
  onSave: (value: string) => void;
}

// One-click starting points. The "general assistant" preset is the answer to
// "I want this cell to talk, not code" — it neutralizes a CLI agent's default
// coding persona across every transport.
const PRESETS: { label: string; text: string }[] = [
  {
    label: "general assistant",
    text: "You are a helpful, conversational assistant. Answer naturally and concisely. You are not limited to coding or software tasks.",
  },
  {
    label: "concise",
    text: "Be concise and direct. Skip preamble and filler; lead with the answer.",
  },
  {
    label: "brainstorm",
    text: "Act as a thoughtful brainstorming partner. Offer several distinct angles, ask clarifying questions when useful, and think out loud.",
  },
];

export function SystemPromptDialog({
  open,
  onOpenChange,
  initialValue,
  onSave,
}: SystemPromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  // Re-seed each time it opens so the textarea reflects the current saved value
  // (and discards an un-saved edit from a previous open).
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const save = () => {
    onSave(value.trim());
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 w-[540px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent-from/40 bg-accent-from/10 text-accent-from">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="space-y-1">
                <Dialog.Title className="font-mono text-sm text-fg">
                  system prompt
                </Dialog.Title>
                <Dialog.Description className="text-xs leading-relaxed text-fg-muted">
                  Steers how this cell behaves, on every transport. Leave it empty
                  for the model's default — or set it to make a Claude Code / Codex
                  cell hold a normal conversation instead of acting as a coding agent.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-5 py-4">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              // Keep canvas / global key handlers from firing while typing.
              onKeyDown={(e) => e.stopPropagation()}
              rows={5}
              autoFocus
              placeholder="e.g. You are a helpful conversational assistant. Answer naturally; you are not limited to coding."
              className="chat-scroll w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent-from"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle/70">
                presets
              </span>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setValue(p.text)}
                  className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-fg-muted transition-colors hover:border-accent-from hover:text-accent-from"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
            <button
              onClick={() => setValue("")}
              className="rounded-md px-2 py-1.5 font-mono text-xs text-fg-subtle transition-colors hover:text-fg-muted"
            >
              clear
            </button>
            <div className="flex items-center gap-2">
              <Dialog.Close className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:text-fg">
                cancel
              </Dialog.Close>
              <button
                onClick={save}
                className="rounded-md border border-accent-from/40 bg-accent-from/15 px-3 py-1.5 font-mono text-xs text-accent-from transition-colors hover:bg-accent-from/25"
              >
                save
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
