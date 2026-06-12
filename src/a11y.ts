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

// Arrow-key roving for a role="radiogroup" / "menu" of role="radio" /
// "menuitemradio" buttons. A radio group is supposed to move selection with the
// arrow keys (ARIA APG) — plain <button> children don't do that. Attach to the
// group container's onKeyDown; Arrow keys focus the prev/next option and select
// it (radios select on focus). Enter/Space still work via the button itself.
// True while an option's click is being dispatched BY arrow navigation — option
// handlers that normally select-and-dismiss (the model sheets) check this so an
// arrow press selects WITHOUT closing; only a real tap/Enter dismisses.
// (click() dispatches synchronously, so a plain flag is race-free.)
let arrowSelecting = false;
export function isArrowSelecting(): boolean {
  return arrowSelecting;
}

export function radioArrowNav(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"], [role="menuitemradio"]')];
  if (radios.length < 2) return;
  const i = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return; // focus isn't on one of the options — let the key through
  e.preventDefault();
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const next = radios[(i + (fwd ? 1 : -1) + radios.length) % radios.length];
  next.focus();
  arrowSelecting = true;
  try { next.click(); } finally { arrowSelecting = false; } // arrow selects, per the radio-group pattern
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
      // The biometric lock inerts the overlay this trap serves — while inert,
      // the trap must go dormant, or it wrestles focus away from the Unlock
      // button and Escape "closes" a sheet the user can't even see.
      if (root.closest('[inert]')) return;
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
