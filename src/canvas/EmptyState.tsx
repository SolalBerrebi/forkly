import { Panel } from "@xyflow/react";
import { motion } from "framer-motion";
import { GitFork } from "lucide-react";

/**
 * Shown when the active workspace has no sessions. A small welcome card with
 * a discoverable summary of the keyboard moves — meant to teach the unique
 * mechanics (fan-out, merge) without a tutorial pop-up.
 */
export function EmptyState() {
  return (
    <Panel position="top-center" className="top-1/2! -translate-y-1/2!">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="select-none rounded-2xl border border-border bg-bg-elevated/70 px-8 py-7 text-center shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)] backdrop-blur-md"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-bg text-accent-from shadow-[0_0_36px_-8px_color-mix(in_srgb,var(--color-accent-from)_60%,transparent)]">
          <GitFork className="h-5 w-5" />
        </div>

        <div className="font-mono text-sm text-fg">your canvas awaits</div>
        <div className="mt-1 text-[11px] text-fg-muted">
          press <Kbd>+ new session</Kbd> in the top right to start a conversation
        </div>

        <div className="mx-auto mt-5 h-px w-32 bg-border" />

        <div className="mt-5 space-y-1.5 font-mono text-[10px] text-fg-subtle">
          <div>
            hover any message · <Kbd>2</Kbd>–<Kbd>9</Kbd> to fan out parallel replies
          </div>
          <div>
            select 2+ nodes · <Kbd>M</Kbd> to synthesize a merge
          </div>
          <div>
            <Kbd>⌫</Kbd> on a selected node to delete it
          </div>
        </div>
      </motion.div>
    </Panel>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-border-strong bg-bg px-1.5 py-px text-[10px] text-fg-muted">
      {children}
    </kbd>
  );
}
