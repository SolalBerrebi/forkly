/**
 * "Xm ago" relative-time renderer for session info chips. Returns a stable
 * string that doesn't auto-tick — we rely on whatever next render to refresh
 * (which in practice happens on every stream:done event or user interaction).
 */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return "now"; // clock skew safety
  if (diff < 60_000) return "now";
  if (diff < 60 * 60_000) {
    const m = Math.floor(diff / 60_000);
    return `${m}m ago`;
  }
  if (diff < 24 * 60 * 60_000) {
    const h = Math.floor(diff / (60 * 60_000));
    return `${h}h ago`;
  }
  if (diff < 7 * 24 * 60 * 60_000) {
    const d = Math.floor(diff / (24 * 60 * 60_000));
    return `${d}d ago`;
  }
  const w = Math.floor(diff / (7 * 24 * 60 * 60_000));
  return `${w}w ago`;
}

/**
 * Compact thousands formatter for token chips: `312` → `312`, `1234` → `1.2k`,
 * `123456` → `123k`. Keeps the chip from blowing up at large message volumes.
 */
export function formatCompactCount(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
