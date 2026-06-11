import privacyRaw from '../legal/PRIVACY.md?raw';
import termsRaw from '../legal/TERMS.md?raw';

// The legal docs are authored in /legal and bundled here so they're reachable
// in-app without external hosting (App Store review expects a reachable policy).
// The leading internal authoring note (a "> DRAFT — review with counsel…"
// blockquote) is stripped at load: it's a note to us, not policy for the user.
function clean(md: string): string {
  return md
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const PRIVACY_MD = clean(privacyRaw);
export const TERMS_MD = clean(termsRaw);
