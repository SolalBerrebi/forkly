import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "confirm",
  cancelLabel = "cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    try {
      await onConfirm();
    } finally {
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-40 w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="flex items-start gap-3">
              {destructive && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-danger/40 bg-danger/10 text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
              )}
              <div className="space-y-1">
                <Dialog.Title className="font-mono text-sm text-fg">{title}</Dialog.Title>
                {description && (
                  <Dialog.Description className="text-xs leading-relaxed text-fg-muted">
                    {description}
                  </Dialog.Description>
                )}
              </div>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <Dialog.Close className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:text-fg">
              {cancelLabel}
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              className={
                destructive
                  ? "rounded-md border border-danger/40 bg-danger/15 px-3 py-1.5 font-mono text-xs text-danger transition-colors hover:bg-danger/25"
                  : "rounded-md border border-accent-from/40 bg-accent-from/15 px-3 py-1.5 font-mono text-xs text-accent-from transition-colors hover:bg-accent-from/25"
              }
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
