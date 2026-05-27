import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type NetLogEntry } from "../lib/ipc";
import { formatRelativeTime } from "../lib/format";

const MAX_ENTRIES = 500;

interface NetworkLogDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-out panel from the right edge listing every outbound LLM call this
 * session — POST /v1/messages for the API transport, `claude --print …` for
 * the CC transport. Backs the README's local-first claim with literal
 * receipts; click any row to expand the detail line.
 */
export function NetworkLogDrawer({ open, onClose }: NetworkLogDrawerProps) {
  const [entries, setEntries] = useState<NetLogEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Initial hydrate when the drawer opens — keeps memory cost zero when closed.
  useEffect(() => {
    if (!open) return;
    ipc.listNetLog(MAX_ENTRIES)
      .then((rows) => setEntries(rows))
      .catch((err) => console.error("list net log failed", err));
  }, [open]);

  // Live updates via the backend's net-log:entry event. Subscribe once at
  // mount so entries logged before the drawer opens are still captured.
  const unlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let cancelled = false;
    listen<NetLogEntry>("net-log:entry", (e) => {
      setEntries((prev) => {
        // Replace if same id; otherwise append. Cap at MAX_ENTRIES (newest
        // wins).
        const idx = prev.findIndex((p) => p.id === e.payload.id);
        const next = idx === -1 ? [...prev, e.payload] : [...prev];
        if (idx !== -1) next[idx] = e.payload;
        if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
        return next;
      });
    })
      .then((u) => {
        if (cancelled) u();
        else unlistenRef.current = u;
      })
      .catch((err) => console.error("net-log subscription failed", err));

    return () => {
      cancelled = true;
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await ipc.clearNetLog();
      setEntries([]);
    } catch (err) {
      console.error("clear net log failed", err);
    }
  }, []);

  // Newest first.
  const ordered = [...entries].reverse();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-border bg-bg-elevated shadow-2xl"
            role="dialog"
            aria-label="Network log"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="font-mono text-sm text-fg">network log</div>
                <div className="text-[10px] text-fg-muted">
                  every outbound call from this app, locally only
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleClear}
                  aria-label="Clear log"
                  title="Clear log"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {ordered.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <div className="font-mono text-xs text-fg-subtle">
                    no calls yet. send a message in any session to see it land here.
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {ordered.map((entry) => (
                    <LogRow
                      key={entry.id}
                      entry={entry}
                      expanded={expanded === entry.id}
                      onToggle={() =>
                        setExpanded((prev) => (prev === entry.id ? null : entry.id))
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border px-4 py-2 font-mono text-[9px] text-fg-subtle">
              local-only · capped at {MAX_ENTRIES} entries · ⌘⇧N to toggle
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: NetLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isError = entry.status.startsWith("error");
  const isInFlight = entry.status === "streaming";
  const tone = isError ? "text-danger" : isInFlight ? "text-accent-from" : "text-success";

  return (
    <li>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-4 py-2 text-left transition-colors hover:bg-bg"
      >
        <ChevronRight
          className={`mt-0.5 h-3 w-3 shrink-0 text-fg-subtle transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <div className="flex-1 space-y-0.5 overflow-hidden">
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className={tone}>{entry.status}</span>
            <span className="truncate text-fg">{entry.method}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[9px] text-fg-subtle">
            <span>{formatRelativeTime(entry.timestampMs)}</span>
            {entry.durationMs !== null && <span>{entry.durationMs}ms</span>}
            {entry.inputTokens !== null && entry.outputTokens !== null && (
              <span>
                {entry.inputTokens} › {entry.outputTokens} tok
              </span>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border bg-bg/50 px-4 py-2 font-mono text-[10px] text-fg-muted">
          {entry.sessionId && (
            <div>
              <span className="text-fg-subtle">session </span>
              <span>{entry.sessionId.slice(0, 8)}…</span>
            </div>
          )}
          {entry.detail && (
            <div className="whitespace-pre-wrap break-all text-fg-muted">{entry.detail}</div>
          )}
        </div>
      )}
    </li>
  );
}
