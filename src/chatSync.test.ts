// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrafts, saveDrafts } from './chatSync';

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
