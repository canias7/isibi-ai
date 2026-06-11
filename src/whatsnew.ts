// The in-app "What's new" sheet. OTA updates land silently, so releases worth
// announcing are curated here by hand: bump EDITION and rewrite ITEMS, and any
// device that last saw an older edition gets the sheet once on its next
// launch. Most merges ship without touching this — only bump it when there's
// something a user would actually care to read.

export const EDITION = 1;

export interface WhatsNewItem { title: string; sub: string }

export const ITEMS: WhatsNewItem[] = [
  { title: 'A little sound', sub: 'A soft blip when you send, a gentle tone when the reply lands. Switch it off in Settings.' },
  { title: 'Keep talking while it thinks', sub: 'Messages you send mid-reply queue up and go out the moment it finishes.' },
  { title: 'Drafts stick around', sub: 'A half-typed message is saved per chat — leave and come back anytime.' },
  { title: 'Photos open full screen', sub: 'Tap any image you sent to view it properly.' },
  { title: 'Replies show their time', sub: 'Every answer is stamped, so you know how fresh the info is.' },
];

const KEY = 'gf_wn_seen';

// `hasHistory` tells a fresh install apart from an existing user updating:
// nothing here is "new" to someone who just installed the app, so they're
// baselined silently instead of greeted with a changelog.
export function shouldShowWhatsNew(hasHistory: boolean): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null || Number.isNaN(Number(raw))) {
      if (hasHistory) return true;
      localStorage.setItem(KEY, String(EDITION));
      return false;
    }
    return Number(raw) < EDITION;
  } catch {
    return false;
  }
}

export function markWhatsNewSeen(): void {
  try { localStorage.setItem(KEY, String(EDITION)); } catch { /* private mode — fine */ }
}
