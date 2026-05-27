import * as Dialog from "@radix-ui/react-dialog";
import { useReactFlow } from "@xyflow/react";
import { ChevronRight, Folder, Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatRelativeTime } from "../lib/format";
import { ipc, type CcProject, type CcSessionSummary } from "../lib/ipc";
import { useWorkspaceStore } from "../state/workspaceStore";

interface CcImportDialogProps {
  trigger: ReactNode;
}

/**
 * Two-pane modal for live-linked Claude Code session import. Left pane
 * lists projects (most-recently-used first), right pane lists sessions
 * inside the selected project with a snippet of the first user message.
 *
 * "Live-linked" means the imported Forkly session reuses the CC session
 * UUID, so subsequent turns continue the same underlying ~/.claude/
 * projects/.../<uuid>.jsonl. Deletes in Forkly DO NOT delete the JSONL.
 */
export function CcImportDialog({ trigger }: CcImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<CcProject[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CcSessionSummary[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const flow = useReactFlow();
  const importCcSession = useWorkspaceStore((s) => s.importCcSession);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProjects(null);
    setSelectedProject(null);
    setSessions(null);

    ipc.listCcProjects()
      .then((rows) => {
        setProjects(rows);
        if (rows.length > 0) setSelectedProject(rows[0].encodedDir);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setProjects([]);
      });
  }, [open]);

  useEffect(() => {
    if (!selectedProject) {
      setSessions(null);
      return;
    }
    setSessionsLoading(true);
    setSessions(null);
    ipc.listCcSessions(selectedProject)
      .then((rows) => setSessions(rows))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSessionsLoading(false));
  }, [selectedProject]);

  const handleImport = async (s: CcSessionSummary) => {
    if (!selectedProject) return;
    setImporting(s.sessionId);
    setError(null);

    // Drop the imported session near the center of the current viewport.
    const viewport = flow.getViewport();
    const position = {
      x: (window.innerWidth / 2 - viewport.x) / viewport.zoom - 180,
      y: (window.innerHeight / 2 - viewport.y) / viewport.zoom - 200,
    };

    try {
      await importCcSession(selectedProject, s.sessionId, position);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 flex h-[600px] w-[820px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="space-y-1">
              <Dialog.Title className="font-mono text-sm text-fg">
                import from claude code
              </Dialog.Title>
              <Dialog.Description className="text-xs text-fg-muted">
                Live-linked: continuing the chat in Forkly appends to the same
                <code className="mx-1 rounded border border-border bg-bg px-1 py-px text-[10px]">
                  ~/.claude/projects/.../{`{uuid}`}.jsonl
                </code>
                .
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Projects pane */}
            <div className="w-72 shrink-0 overflow-y-auto border-r border-border">
              {projects === null ? (
                <LoadingRow label="loading projects" />
              ) : projects.length === 0 ? (
                <div className="px-4 py-6 font-mono text-xs text-fg-subtle">
                  no claude code projects found under <br />
                  <code className="text-fg-muted">~/.claude/projects/</code>
                </div>
              ) : (
                <ul className="py-1">
                  {projects.map((p) => (
                    <li key={p.encodedDir}>
                      <button
                        onClick={() => setSelectedProject(p.encodedDir)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg ${
                          selectedProject === p.encodedDir ? "bg-bg" : ""
                        }`}
                      >
                        <Folder className="h-3 w-3 shrink-0 text-fg-subtle" />
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate font-mono text-[12px] text-fg">
                            {p.displayName}
                          </div>
                          {p.cwd && (
                            <div className="truncate font-mono text-[9px] text-fg-subtle">
                              {p.cwd}
                            </div>
                          )}
                          <div className="font-mono text-[9px] text-fg-subtle">
                            {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}{" "}
                            · {formatRelativeTime(p.lastActivityMs)}
                          </div>
                        </div>
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 text-fg-subtle ${
                            selectedProject === p.encodedDir ? "text-accent-from" : ""
                          }`}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sessions pane */}
            <div className="flex-1 overflow-y-auto">
              {sessionsLoading ? (
                <LoadingRow label="loading sessions" />
              ) : !selectedProject ? (
                <Empty label="pick a project on the left" />
              ) : sessions === null || sessions.length === 0 ? (
                <Empty label="no sessions in this project" />
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.map((s) => (
                    <li key={s.sessionId}>
                      <button
                        onClick={() => handleImport(s)}
                        disabled={!!importing}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg disabled:opacity-50"
                      >
                        <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" />
                        <div className="flex-1 space-y-1 overflow-hidden">
                          <div className="line-clamp-2 font-mono text-[12px] text-fg">
                            {s.firstUserMessage ?? "(empty session)"}
                          </div>
                          <div className="flex items-center gap-3 font-mono text-[9px] text-fg-subtle">
                            <span>{s.messageCount} turns</span>
                            <span>{formatRelativeTime(s.lastActivityMs)}</span>
                            {s.modelId && (
                              <span className="truncate">{s.modelId}</span>
                            )}
                            <span className="truncate text-fg-subtle/60">
                              {s.sessionId.slice(0, 8)}…
                            </span>
                          </div>
                        </div>
                        {importing === s.sessionId && (
                          <Loader2 className="h-3 w-3 animate-spin text-accent-from" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {error && (
            <div className="border-t border-danger/40 bg-danger/10 px-5 py-2 font-mono text-[10px] text-danger">
              ⚠ {error}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 font-mono text-xs text-fg-subtle">
      <Loader2 className="h-3 w-3 animate-spin" />
      {label}…
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 font-mono text-xs text-fg-subtle">
      {label}
    </div>
  );
}
