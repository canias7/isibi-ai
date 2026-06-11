// Map raw GoTrue/network error text to something a human can act on — raw
// "For security purposes, you can only request this after 47 seconds" or
// "Failed to fetch" helps nobody on a login screen. The raw message stays the
// fallback: never swallow an error we don't recognize.
export function friendlyAuthError(raw: string, online: boolean): string {
  if (!online) return 'You’re offline — check your connection and try again.';
  const m = raw.toLowerCase();
  const wait = m.match(/after (\d+) second/);
  if (wait) return `Too many attempts — wait ${wait[1]} seconds, then try again.`;
  if (/rate limit|too many request/.test(m)) return 'Too many attempts — give it a minute, then try again.';
  if (/(token|otp|code)[^.]*(expired|invalid)|(expired|invalid)[^.]*(token|otp|code)/.test(m)) {
    return 'That code is wrong or has expired — tap “Resend code” for a fresh one.';
  }
  if (/network|failed to fetch|load failed|connection|timed? ?out/.test(m)) {
    return 'Couldn’t reach the server — check your connection and try again.';
  }
  return raw;
}
