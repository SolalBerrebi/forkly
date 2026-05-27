import { useReactFlow } from "@xyflow/react";
import { GitFork, Moon, Plus, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, getInitialTheme, type Theme } from "../lib/theme";
import { SettingsDialog } from "../settings/SettingsDialog";
import { useWorkspaceStore } from "../state/workspaceStore";

export function TopBar() {
  const addSession = useWorkspaceStore((s) => s.addSession);
  const flow = useReactFlow();
  const [theme, setTheme] = useState<Theme>("dark");

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
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/70 px-3 py-1.5 backdrop-blur">
        <GitFork className="h-3.5 w-3.5 text-accent-from" />
        <span className="font-mono text-sm tracking-tight">forkly</span>
        <span className="font-mono text-[10px] text-fg-subtle">v0.1.0-dev</span>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
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
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated/70 text-fg-muted backdrop-blur transition-colors hover:text-fg"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/70 px-3 py-1.5 font-mono text-xs text-fg backdrop-blur transition-colors hover:border-border-strong hover:bg-bg-elevated"
        >
          <Plus className="h-3.5 w-3.5" />
          new session
        </button>
      </div>
    </header>
  );
}
