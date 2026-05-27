import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProps {
  label: ReactNode;
  /** Side relative to the trigger. Defaults to "bottom" since most chrome lives at the top of the window. */
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

export function Tooltip({ label, side = "bottom", children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 select-none rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-[10px] text-fg-muted shadow-xl"
        >
          {label}
          <RadixTooltip.Arrow className="fill-border" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
