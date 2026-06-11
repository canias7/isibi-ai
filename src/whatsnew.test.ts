// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { EDITION, shouldShowWhatsNew, markWhatsNewSeen } from './whatsnew';

beforeEach(() => localStorage.clear());

describe('whatsnew (once-per-edition announcement)', () => {
  it('shows to an existing user who has never seen an edition', () => {
    expect(shouldShowWhatsNew(true)).toBe(true);
  });

  it('baselines a fresh install silently instead of greeting it with a changelog', () => {
    expect(shouldShowWhatsNew(false)).toBe(false);
    expect(localStorage.getItem('gf_wn_seen')).toBe(String(EDITION));
    // …and they stay baselined even once they have history.
    expect(shouldShowWhatsNew(true)).toBe(false);
  });

  it('never shows the same edition twice', () => {
    expect(shouldShowWhatsNew(true)).toBe(true);
    markWhatsNewSeen();
    expect(shouldShowWhatsNew(true)).toBe(false);
  });

  it('shows again when the stored edition is older than the current one', () => {
    localStorage.setItem('gf_wn_seen', String(EDITION - 1));
    expect(shouldShowWhatsNew(true)).toBe(true);
  });

  it('treats garbage in storage like a first run', () => {
    localStorage.setItem('gf_wn_seen', 'not a number');
    expect(shouldShowWhatsNew(true)).toBe(true);
    expect(shouldShowWhatsNew(false)).toBe(false);
  });
});
