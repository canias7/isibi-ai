import type { KeyboardEvent } from 'react';

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
