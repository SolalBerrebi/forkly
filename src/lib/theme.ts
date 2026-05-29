const STORAGE_KEY = "forkly:theme";

export type Theme = "dark" | "light";

/**
 * Read the user's theme preference. If they've explicitly chosen one, we
 * honour it; otherwise we follow the system color scheme. This matches
 * how macOS / iOS apps behave — "automatic" is the default, and the
 * toggle is for users who want to override.
 */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // No explicit preference — follow the OS.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Watch the OS for color-scheme changes. Only takes effect for users who
 * haven't explicitly chosen a theme via the toggle — explicit preferences
 * always win. Returns an unsubscribe function.
 */
export function subscribeToSystemTheme(onChange: (theme: Theme) => void) {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const handler = (e: MediaQueryListEvent) => {
    // Skip if the user has explicitly chosen — their pick beats the system.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return;
    onChange(e.matches ? "light" : "dark");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
