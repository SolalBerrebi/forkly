/**
 * True when a Radix menu / dialog / popover is currently mounted (open).
 *
 * Global canvas key handlers (Delete/Backspace to remove, `M` to merge, `2`–`9`
 * / `A` to fan out) bail when one is open — otherwise a Backspace meant to
 * dismiss the model picker destroys the selected node, and a number key meant
 * for an open menu fans out behind it. Tooltips (`role="tooltip"`) are
 * deliberately excluded since they're open on mere hover and must not block
 * shortcuts.
 */
export function isOverlayOpen(): boolean {
  return !!document.querySelector(
    '[role="menu"], [role="dialog"], [role="alertdialog"]',
  );
}
