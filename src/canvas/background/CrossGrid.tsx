import { Background, BackgroundVariant } from "@xyflow/react";
import { useEffect, useRef } from "react";

/**
 * Cross-dot grid that pans with the canvas + a screen-space radial
 * highlight that follows the cursor. The highlight sits above the
 * background but below nodes via z-index, and is pointer-transparent.
 */
export function CrossGrid() {
  const lightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const el = lightRef.current;
      if (!el) return;
      el.style.setProperty("--mx", `${e.clientX}px`);
      el.style.setProperty("--my", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", handle);
    return () => window.removeEventListener("mousemove", handle);
  }, []);

  return (
    <>
      <Background
        variant={BackgroundVariant.Cross}
        gap={32}
        size={6}
        color="var(--fork-grid-color)"
      />
      <div
        ref={lightRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 transition-opacity"
        style={{
          background:
            "radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--color-accent-from) 7%, transparent), transparent 55%)",
        }}
      />
    </>
  );
}
