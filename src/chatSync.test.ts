// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrafts, saveDrafts, loadQueuedMsg, saveQueuedMsg } from './chatSync';

const UID = 'user-1';

beforeEach(() => localStorage.clear());

describe('draft persistence (per-chat composer text)', () => {
  it('round-trips drafts through localStorage', () => {
    saveDrafts(UID, { a: 'hello there', b: 'second draft' });
    expect(loadDrafts(UID)).toEqual({ a: 'hello there', b: 'second draft' });
  });

  it('drops empty/whitespace drafts on save', () => {
    saveDrafts(UID, { a: 'keep me', b: '   ', c: '' });
    expect(loadDrafts(UID)).toEqual({ a: 'keep me' });
  });

  it('caps the stored map so it cannot grow unbounded', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 30; i++) big[`chat${i}`] = `draft ${i}`;
    saveDrafts(UID, big);
    expect(Object.keys(loadDrafts(UID)).length).toBe(20);
  });

  it('is per-user and survives garbage in storage', () => {
    saveDrafts(UID, { a: 'mine' });
    expect(loadDrafts('someone-else')).toEqual({});
    localStorage.setItem(`gf_drafts_${UID}`, 'not json');
    expect(loadDrafts(UID)).toEqual({});
  });
});

describe('queued-message persistence (survives a crash mid-reply)', () => {
  it('round-trips {convId, text}', () => {
    saveQueuedMsg(UID, { convId: 'c1', text: 'follow up' });
    expect(loadQueuedMsg(UID)).toEqual({ convId: 'c1', text: 'follow up' });
  });

  it('clears on null and ignores empty/whitespace text', () => {
    saveQueuedMsg(UID, { convId: 'c1', text: 'x' });
    saveQueuedMsg(UID, null);
    expect(loadQueuedMsg(UID)).toBeNull();
    saveQueuedMsg(UID, { convId: 'c1', text: '   ' });
    expect(loadQueuedMsg(UID)).toBeNull();
  });

  it('is per-user and survives garbage', () => {
    saveQueuedMsg(UID, { convId: 'c1', text: 'mine' });
    expect(loadQueuedMsg('someone-else')).toBeNull();
    localStorage.setItem(`gf_queued_${UID}`, 'not json');
    expect(loadQueuedMsg(UID)).toBeNull();
  });
});
