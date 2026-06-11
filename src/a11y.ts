import { useEffect, type KeyboardEvent, type RefObject } from 'react';

// Keyboard activation for styled div/span "buttons" (role="button" rows like
// settings toggles and sidebar chats). A real <button> gets Enter/Space for
// free; these don't — so external keyboards, switch control, and full-keyboard
// access on iOS couldn't activate them at all. Spread alongside onClick:
//   <div role="button" tabIndex={0} onClick={fn} onKeyDown={keyActivate(fn)}>
export function keyActivate(fn: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must toggle, not scroll the page
      fn();
    }
  };
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

// Focus trap for sheets / dialogs / full-screen overlays. While `active`:
//   • focus moves INTO the container (first focusable, else the container),
//   • Tab / Shift+Tab wrap inside it — focus can never land on the dimmed
//     page behind (which is where keyboard and VoiceOver users get lost),
//   • Escape calls onClose (when given),
//   • on close, focus returns to whatever opened it.
// The container needs tabIndex={-1} so it can take focus when it has no
// focusable children yet.
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>, onClose?: () => void) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus();

    function onKey(e: globalThis.KeyboardEvent) {
      if (!root) return;
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null); // skip hidden controls
      if (!items.length) { e.preventDefault(); return; }
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const i = current ? items.indexOf(current) : -1;
      // Outside the trap, or about to walk off either end → wrap around.
      const next = e.shiftKey
        ? (i <= 0 ? items[items.length - 1] : items[i - 1])
        : (i === -1 || i === items.length - 1 ? items[0] : items[i + 1]);
      e.preventDefault();
      next.focus();
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
