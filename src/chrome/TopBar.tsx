import { useReactFlow } from "@xyflow/react";
import { Activity, GitFork, LayoutGrid, Moon, Plus, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, getInitialTheme, type Theme } from "../lib/theme";
import { SettingsDialog } from "../settings/SettingsDialog";
import { useWorkspaceStore } from "../state/workspaceStore";
import { NetworkLogDrawer } from "./NetworkLogDrawer";
import { Tooltip } from "./Tooltip";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function TopBar() {
  const addSession = useWorkspaceStore((s) => s.addSession);
  const reorganizeCurrentWorkspace = useWorkspaceStore(
    (s) => s.reorganizeCurrentWorkspace,
  );
  const flow = useReactFlow();
  const [theme, setTheme] = useState<Theme>("dark");
  const [netLogOpen, setNetLogOpen] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  // Global chrome shortcuts:
  //   ⌘⇧L → reorganize the current workspace (unlock all)
  //   ⌘⇧N → toggle the network log drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta || !e.shiftKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "l") {
        e.preventDefault();
        reorganizeCurrentWorkspace(true);
      } else if (key === "n") {
        e.preventDefault();
        setNetLogOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reorganizeCurrentWorkspace]);

  const handleAdd = () => {
    const viewport = flow.getViewport();
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom - 140;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 60;
    const jitterX = (Math.random() - 0.5) * 120;
    const jitterY = (Math.random() - 0.5) * 80;
    addSession({ position: { x: cx + jitterX, y: cy + jitterY } }).catch((err) => {
      console.error("create session failed", err);
    });
  };

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3">
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/70 px-3 py-1.5 backdrop-blur">
          <GitFork className="h-3.5 w-3.5 text-accent-from" />
          <span className="font-mono text-sm tracking-tight">forkly</span>
          <span className="font-mono text-[10px] text-fg-subtle">v0.1.0-dev</span>
        </div>
        <WorkspaceSwitcher />
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <Tooltip label="network log · ⌘⇧N">
          <button
            onClick={() => setNetLogOpen(true)}
            aria-label="Network log"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="reorganize canvas · ⌘⇧L">
          <button
            onClick={() => reorganizeCurrentWorkspace(true)}
            aria-label="Reorganize canvas"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="auth & api keys">
          <SettingsDialog
            trigger={
              <button
                aria-label="Settings"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
              </button>
            }
          />
        </Tooltip>
        <Tooltip label={theme === "dark" ? "switch to light" : "switch to dark"}>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
        <Tooltip label="new session in this workspace">
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/70 px-3 py-1.5 font-mono text-xs text-fg backdrop-blur transition-colors hover:border-border-strong hover:bg-bg-elevated"
          >
            <Plus className="h-3.5 w-3.5" />
            new session
          </button>
        </Tooltip>
      </div>
      <NetworkLogDrawer open={netLogOpen} onClose={() => setNetLogOpen(false)} />
    </header>
  );
}
