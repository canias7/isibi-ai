import { describe, it, expect } from 'vitest';
import { PRIVACY_MD, TERMS_MD } from './legalDocs';

describe('bundled legal docs (in-app reader source)', () => {
  it('carry real policy text', () => {
    expect(PRIVACY_MD.length).toBeGreaterThan(200);
    expect(TERMS_MD.length).toBeGreaterThan(200);
  });

  it('keep their document titles', () => {
    expect(PRIVACY_MD).toMatch(/Privacy Policy/i);
    expect(TERMS_MD).toMatch(/Terms of Service/i);
  });

  it('strip the internal DRAFT authoring note so users never see it', () => {
    for (const md of [PRIVACY_MD, TERMS_MD]) {
      expect(md).not.toMatch(/DRAFT/);
      expect(md).not.toMatch(/review with counsel/i);
      expect(md).not.toMatch(/^\s*>/m); // no leftover blockquote lines
    }
  });
});
