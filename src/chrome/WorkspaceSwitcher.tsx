import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Layers, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceStore, type WorkspaceId } from "../state/workspaceStore";
import { ConfirmDialog } from "./ConfirmDialog";

export function WorkspaceSwitcher() {
  const workspacesById = useWorkspaceStore((s) => s.workspacesById);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<WorkspaceId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedWorkspaces = useMemo(
    () =>
      Object.values(workspacesById).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
      ),
    [workspacesById],
  );

  const current = workspacesById[currentWorkspaceId];

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createWorkspace(name);
      setCreating(false);
      setNewName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteWorkspace(confirmDelete);
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setNewName("");
            setError(null);
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Switch workspace"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated/70 px-2.5 py-1.5 font-mono text-xs text-fg backdrop-blur transition-colors hover:border-border-strong hover:bg-bg-elevated"
          >
            <Layers className="h-3.5 w-3.5 text-fg-muted" />
            <span className="max-w-[140px] truncate">{current?.name ?? "main"}</span>
            <ChevronDown className="h-3 w-3 text-fg-subtle" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 w-64 overflow-hidden rounded-lg border border-border bg-bg-elevated p-1 shadow-2xl"
          >
            <div className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              workspaces
            </div>

            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {sortedWorkspaces.map((w) => {
                const isCurrent = w.id === currentWorkspaceId;
                return (
                  <div
                    key={w.id}
                    className="group/row flex items-center gap-1 rounded px-1 py-0.5"
                  >
                    <button
                      onClick={() => switchWorkspace(w.id)}
                      className={`flex flex-1 items-center gap-2 rounded px-1.5 py-1 font-mono text-[12px] transition-colors ${
                        isCurrent
                          ? "bg-accent-from/10 text-fg"
                          : "text-fg-muted hover:bg-bg hover:text-fg"
                      }`}
                    >
                      <Check
                        className={`h-3 w-3 shrink-0 ${
                          isCurrent ? "text-accent-from" : "opacity-0"
                        }`}
                      />
                      <span className="flex-1 truncate text-left">{w.name}</span>
                    </button>
                    {sortedWorkspaces.length > 1 && (
                      <button
                        onClick={() => setConfirmDelete(w.id)}
                        aria-label={`Delete workspace ${w.name}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover/row:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            {creating ? (
              <div className="space-y-1 px-1 py-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setCreating(false);
                      setNewName("");
                    }
                    e.stopPropagation();
                  }}
                  placeholder="workspace name"
                  className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent-from"
                />
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                    }}
                    className="rounded border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg"
                  >
                    cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="rounded border border-accent-from/40 bg-accent-from/15 px-2 py-0.5 font-mono text-[10px] text-accent-from disabled:opacity-40"
                  >
                    create
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 font-mono text-[11px] text-fg-muted transition-colors hover:bg-bg hover:text-fg"
              >
                <Plus className="h-3 w-3" />
                new workspace
              </button>
            )}

            {error && (
              <div className="px-2 py-1 font-mono text-[10px] text-danger">{error}</div>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`delete workspace "${
          confirmDelete ? workspacesById[confirmDelete]?.name : ""
        }"?`}
        description={
          <>
            This permanently removes the workspace and every session inside it,
            including all their messages. This cannot be undone.
          </>
        }
        confirmLabel="delete workspace"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
