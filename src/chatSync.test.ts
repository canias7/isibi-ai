// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrafts, saveDrafts, loadChatModels, saveChatModels, loadQueuedMsg, saveQueuedMsg } from './chatSync';

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

describe('per-chat model choice', () => {
  it('round-trips explicit choices through localStorage', () => {
    saveChatModels(UID, { a: 'opus', b: 'haiku' });
    expect(loadChatModels(UID)).toEqual({ a: 'opus', b: 'haiku' });
  });

  it("drops 'auto' (the default needs no entry) and rejects junk", () => {
    saveChatModels(UID, { a: 'opus', b: 'auto', c: 'gpt-5' as never });
    expect(loadChatModels(UID)).toEqual({ a: 'opus' });
  });

  it('ignores junk values already in storage on load', () => {
    localStorage.setItem(`gf_models_${UID}`, JSON.stringify({ a: 'sonnet', b: 'nope', c: 'auto' }));
    expect(loadChatModels(UID)).toEqual({ a: 'sonnet' });
  });

  it('is per-user and survives garbage in storage', () => {
    saveChatModels(UID, { a: 'opus' });
    expect(loadChatModels('someone-else')).toEqual({});
    localStorage.setItem(`gf_models_${UID}`, 'not json');
    expect(loadChatModels(UID)).toEqual({});
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
