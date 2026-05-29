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
      {/* Aurora-lit ambient layer. Three radial gradients of the accent
          palette so glass cards have actual color bleed-through. Doesn't
          pan with the canvas — it's screen-fixed so the lighting feels
          like environment rather than landscape. */}
      <div aria-hidden className="aurora" />
      <Background
        variant={BackgroundVariant.Dots}
        gap={28}
        size={1.4}
        color="var(--fork-grid-color)"
      />
      {/* Cursor halo. Subtle accent tint so it reads as ambient
          highlight, not a spotlight. */}
      <div
        ref={lightRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(360px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--color-accent-from) 5%, transparent), transparent 60%)",
        }}
      />
    </>
  );
}
