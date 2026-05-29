/**
 * Global appearance mode for session cells:
 *  - "terminal": Claude-Code-in-a-pane look. Mono throughout, `›` prefix on
 *               user turns, blinking caret on streaming. The default.
 *  - "chat":    Claude.ai / ChatGPT look. Sans body, right-aligned user
 *               bubble, full-width assistant, soft typing indicator.
 *
 * Persisted in localStorage and applied as a `data-appearance` attribute on
 * <html> so CSS can fork on it. JSX structure differences (prefix vs bubble,
 * caret vs dots) live in the React layer.
 */

const STORAGE_KEY = "forkly:appearance";

export type Appearance = "terminal" | "chat";

export function getInitialAppearance(): Appearance {
  if (typeof window === "undefined") return "terminal";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Appearance | null;
  return stored === "chat" ? "chat" : "terminal";
}

export function applyAppearance(mode: Appearance) {
  if (typeof document !== "undefined") {
    // Two channels:
    //   • `data-appearance` on <html> is the legacy/global flag (still read
    //     by a few places).
    //   • `appearance-chat` / `appearance-terminal` class so CSS rules can
    //     scope to *any* ancestor — that's what lets a per-session override
    //     wrapper switch a single cell to a different mode without changing
    //     the rest of the canvas.
    const el = document.documentElement;
    el.dataset.appearance = mode;
    el.classList.remove("appearance-chat", "appearance-terminal");
    el.classList.add(`appearance-${mode}`);
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }
}
