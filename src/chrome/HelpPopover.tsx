import * as Popover from "@radix-ui/react-popover";
import {
  Activity,
  Download,
  GitFork,
  HelpCircle,
  LayoutGrid,
  Plus,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { type ReactNode } from "react";

/**
 * Quick-reference popover anchored to a `?` button in the top bar. Lists
 * every chrome action with its icon so the user can map button → behavior
 * without hover-discovering tooltips. Keyboard shortcuts are shown as a
 * tertiary detail — Forkly is button-first by design.
 */
export function HelpPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label="Help"
          title="What does each button do?"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-xl border border-border bg-bg-elevated p-3 shadow-2xl"
        >
          <div className="mb-2 font-mono text-xs text-fg">what each button does</div>
          <ul className="space-y-1.5">
            <Row icon={<Plus className="h-3 w-3" />} label="new session" detail="start a fresh conversation in this workspace" />
            <Row icon={<Download className="h-3 w-3" />} label="import" detail="bring in an existing Claude Code session from ~/.claude/projects" />
            <Row icon={<LayoutGrid className="h-3 w-3" />} label="reorganize" detail="auto-arrange all unlocked cells into a clean tree" shortcut="⌘⇧L" />
            <Row icon={<Activity className="h-3 w-3" />} label="network log" detail="every API call this app makes — local only, nothing leaves your machine" shortcut="⌘⇧N" />
            <Row icon={<SettingsIcon className="h-3 w-3" />} label="settings" detail="Claude Code auth, API keys, appearance" />
            <Row icon={<Sun className="h-3 w-3" />} label="theme" detail="toggle light / dark" />
          </ul>
          <div className="mt-3 border-t border-border pt-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
              on any message
            </div>
            <Row
              icon={<GitFork className="h-3 w-3" />}
              label="fork"
              detail="branch the conversation from this point — try a different prompt or model from the same context"
            />
            <div className="mt-1 space-y-1 font-mono text-[10px] text-fg-subtle">
              <div>
                hover a message + press <Kbd>2</Kbd>–<Kbd>9</Kbd> for a same-provider fan-out
              </div>
              <div>
                hover a message + press <Kbd>A</Kbd> to spawn one fork per configured provider — the cross-LLM demo
              </div>
            </div>
          </div>
          <div className="mt-3 border-t border-border pt-2">
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent("forkly:open-onboarding"))
              }
              className="w-full rounded px-2 py-1.5 text-left font-mono text-[11px] text-fg-muted hover:bg-bg hover:text-fg"
            >
              re-run setup
            </button>
          </div>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({
  icon,
  label,
  detail,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  shortcut?: string;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent-from">
        {icon}
      </span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] text-fg">{label}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </div>
        <div className="text-[10px] leading-snug text-fg-muted">{detail}</div>
      </div>
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 font-mono text-[9px] text-fg-muted">
      {children}
    </kbd>
  );
}
