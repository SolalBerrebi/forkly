import * as Popover from "@radix-ui/react-popover";
import { Settings as SettingsIcon, Sparkles, Zap } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { getAvailableProviders, type AvailableProvider } from "../lib/availableProviders";
import { useDetectionStore } from "../state/detectionStore";

/**
 * Tiny popover that lists every provider the user has configured — Claude
 * Code, Codex, Gemini, Ollama, etc. — and lets them pick one with a single
 * click. Used by both the fork affordance (cross-LLM fork: "respond to the
 * same context with GPT instead of Claude") and the + new session button.
 *
 * Renders inline if exactly one provider is available; the popover is
 * pointless when there's no choice. Caller passes `forceMenu` to override
 * if they always want the menu (e.g. fan-out wanting an explicit choice).
 *
 * If `onPickAll` is provided AND 2+ providers are available, the popover
 * also shows a "Fan out to all N providers" option at the top — the
 * killer cross-LLM demo, one click.
 */
export function ProviderPicker({
  trigger,
  title,
  onPick,
  onPickAll,
  forceMenu = false,
}: {
  trigger: ReactNode;
  title: string;
  onPick: (provider: AvailableProvider) => void;
  onPickAll?: (providers: AvailableProvider[]) => void;
  forceMenu?: boolean;
}) {
  // Subscribe to each detection slot individually so React's snapshot cache
  // gets stable references — these slots only change on hydrate/refresh.
  // Computing `available` via a selector that returned a fresh array each
  // render triggered the "infinite render loop" warning that broke the UI.
  const claudeCode = useDetectionStore((s) => s.claudeCode);
  const codex = useDetectionStore((s) => s.codex);
  const ollama = useDetectionStore((s) => s.ollama);
  const apiKeys = useDetectionStore((s) => s.apiKeys);
  const available = useMemo(
    () => getAvailableProviders({ claudeCode, codex, ollama, apiKeys }),
    [claudeCode, codex, ollama, apiKeys],
  );

  // Single-provider fast path: clicking the trigger fires onPick directly.
  // (Disabled by `forceMenu`, used when the caller wants explicit confirmation.)
  if (available.length === 1 && !forceMenu) {
    return (
      <button
        onClick={() => onPick(available[0])}
        className="contents"
        aria-label={title}
      >
        {trigger}
      </button>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-2xl border border-(--glass-border) p-2 shadow-2xl backdrop-blur-xl backdrop-saturate-140"
          style={{ background: "var(--glass-bg-strong)" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-1.5 px-2 pt-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {title}
          </div>
          {available.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-0.5">
              {/* Cross-provider fan-out — only shown when the caller opted
                  in AND there are 2+ providers to fan across. The visual
                  treatment (accent gradient, dot row showing every provider
                  color) makes it read as the "special" power move. */}
              {onPickAll && available.length >= 2 && (
                <>
                  <li>
                    <Popover.Close asChild>
                      <button
                        onClick={() => onPickAll(available)}
                        className="flex w-full items-center gap-2.5 rounded-md border border-accent-from/40 bg-accent-from/10 px-2 py-2 text-left transition-colors hover:bg-accent-from/20"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-accent-from to-accent-to text-white">
                          <Zap className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 space-y-0.5">
                          <span className="block font-mono text-[12px] text-fg">
                            Fan out to all {available.length}
                          </span>
                          <span className="flex items-center gap-1 font-mono text-[10px] text-fg-subtle">
                            <span>spawns one fork per provider</span>
                            <span className="ml-auto flex items-center gap-0.5">
                              {available.map((p) => (
                                <span
                                  key={p.providerId}
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: p.color }}
                                  title={p.label}
                                />
                              ))}
                            </span>
                          </span>
                        </span>
                      </button>
                    </Popover.Close>
                  </li>
                  <li className="my-1 px-2">
                    <div className="h-px bg-(--glass-border)" />
                  </li>
                </>
              )}
              {available.map((p) => (
                <li key={p.providerId}>
                  <Popover.Close asChild>
                    <button
                      onClick={() => onPick(p)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-bg"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: p.tint, color: p.color }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex-1 space-y-0.5">
                        <span className="block font-mono text-[12px] text-fg">
                          {p.label}
                        </span>
                        <span className="block font-mono text-[10px] text-fg-subtle">
                          {p.modelId.replace(":latest", "")} · {p.hint}
                        </span>
                      </span>
                    </button>
                  </Popover.Close>
                </li>
              ))}
            </ul>
          )}
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function EmptyState() {
  return (
    <div className="space-y-2 px-2 py-3">
      <div className="font-mono text-[11px] text-fg">No providers configured yet</div>
      <div className="font-mono text-[10px] leading-relaxed text-fg-subtle">
        Set up at least one — Claude Code, Codex, Gemini, or Ollama — before
        creating sessions.
      </div>
      <button
        onClick={() =>
          window.dispatchEvent(new CustomEvent("forkly:open-onboarding"))
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-accent-from bg-accent-from/15 px-2.5 py-1 font-mono text-[11px] text-fg hover:bg-accent-from/25"
      >
        <SettingsIcon className="h-3 w-3" /> open setup
      </button>
    </div>
  );
}
