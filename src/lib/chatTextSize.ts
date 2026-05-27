/**
 * User-adjustable chat body size. Persisted to localStorage and applied as a
 * CSS variable on <html> so any element that uses `var(--chat-text-size)`
 * (message body, composer) picks it up immediately.
 *
 * The chip strip, headers, kbd hints, and other chrome stay fixed — only
 * the conversation text scales.
 */

const STORAGE_KEY = "forkly:chat-text-size";

export type ChatTextSize = "s" | "m" | "l" | "xl";

const PX_FOR_SIZE: Record<ChatTextSize, number> = {
  s: 12,
  m: 14,
  l: 16,
  xl: 18,
};

export const CHAT_TEXT_SIZE_OPTIONS: Array<{ id: ChatTextSize; label: string; px: number }> = [
  { id: "s", label: "S", px: PX_FOR_SIZE.s },
  { id: "m", label: "M", px: PX_FOR_SIZE.m },
  { id: "l", label: "L", px: PX_FOR_SIZE.l },
  { id: "xl", label: "XL", px: PX_FOR_SIZE.xl },
];

export function getInitialChatTextSize(): ChatTextSize {
  if (typeof window === "undefined") return "m";
  const stored = window.localStorage.getItem(STORAGE_KEY) as ChatTextSize | null;
  return stored && stored in PX_FOR_SIZE ? stored : "m";
}

export function applyChatTextSize(size: ChatTextSize) {
  const px = PX_FOR_SIZE[size];
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--chat-text-size", `${px}px`);
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, size);
  }
}
