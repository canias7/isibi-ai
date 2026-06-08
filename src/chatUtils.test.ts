import { describe, it, expect } from 'vitest';
import type { ChatMessage } from './api';
import {
  slimMessages,
  isNetworkError,
  serverIsMoreComplete,
  titleFrom,
  cleanForDisplay,
  modelShort,
  plainText,
} from './chatUtils';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const asst = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ role: 'assistant', content, ...extra });

describe('serverIsMoreComplete (guards against overwriting local history)', () => {
  it('never adopts an empty server copy', () => {
    expect(serverIsMoreComplete([user('hi'), asst('hello')], [])).toBe(false);
  });

  it('adopts when the server has more messages (a newer turn)', () => {
    const local = [user('hi'), asst('hello')];
    const remote = [user('hi'), asst('hello'), user('again'), asst('hey')];
    expect(serverIsMoreComplete(local, remote)).toBe(true);
  });

  it('never adopts a shorter server copy', () => {
    const local = [user('hi'), asst('hello'), user('again'), asst('hey')];
    const remote = [user('hi'), asst('hello')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
  });

  it('does not adopt when the server has no real reply yet (empty trailing assistant)', () => {
    const local = [user('hi'), asst('partial answer')];
    const remote = [user('hi'), asst('   ')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
  });

  it('does not adopt when the server turn ends on a user message (no reply)', () => {
    const local = [user('hi'), asst('answer')];
    const remote = [user('hi'), user('answer')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
  });

  it('adopts the server reply when ours failed', () => {
    const local = [user('hi'), asst('', { failed: true })];
    const remote = [user('hi'), asst('finished in the background')];
    expect(serverIsMoreComplete(local, remote)).toBe(true);
  });

  it('adopts when the server reply is more complete than our partial stream', () => {
    const local = [user('hi'), asst('par')];
    const remote = [user('hi'), asst('partial then the full answer')];
    expect(serverIsMoreComplete(local, remote)).toBe(true);
  });

  it('does NOT overwrite when both replies are equally complete', () => {
    const local = [user('hi'), asst('same answer')];
    const remote = [user('hi'), asst('same answer')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
  });

  it('does not adopt a shorter server reply at the same turn count', () => {
    const local = [user('hi'), asst('the complete answer')];
    const remote = [user('hi'), asst('the')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
  });
});

describe('slimMessages (strips heavy base64 before persisting)', () => {
  it('clears attachment data but keeps the metadata', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'see this', attachments: [{ kind: 'image', mediaType: 'image/png', data: 'BIGBASE64', name: 'a.png' }] },
    ];
    const slim = slimMessages(msgs);
    expect(slim[0].attachments![0].data).toBe('');
    expect(slim[0].attachments![0].name).toBe('a.png');
    expect(slim[0].attachments![0].mediaType).toBe('image/png');
  });

  it('leaves messages without attachments untouched', () => {
    const msgs = [user('plain')];
    expect(slimMessages(msgs)).toEqual(msgs);
  });

  it('does not mutate the input', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'x', attachments: [{ kind: 'image', mediaType: 'image/png', data: 'KEEPME', name: 'a.png' }] },
    ];
    slimMessages(msgs);
    expect(msgs[0].attachments![0].data).toBe('KEEPME');
  });
});

describe('isNetworkError (decides retry vs hard error)', () => {
  it('treats a TypeError (fetch failure) as a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('matches common offline phrasings', () => {
    expect(isNetworkError(new Error('Load failed'))).toBe(true);
    expect(isNetworkError(new Error('network connection lost'))).toBe(true);
  });
  it('does not treat a real API/HTTP error as a network error', () => {
    expect(isNetworkError(new Error('Chat API error: 500'))).toBe(false);
  });
});

describe('titleFrom', () => {
  it('uses the first user message, whitespace-collapsed', () => {
    expect(titleFrom([asst('ignored'), user('  hello   there  ')])).toBe('hello there');
  });
  it('truncates long titles with an ellipsis', () => {
    const long = 'a'.repeat(60);
    const t = titleFrom([user(long)]);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBe(43); // 42 chars + ellipsis
  });
  it('falls back to "New chat" with no user message', () => {
    expect(titleFrom([asst('hi')])).toBe('New chat');
    expect(titleFrom([])).toBe('New chat');
  });
});

describe('cleanForDisplay / plainText (strip internal markers & cards)', () => {
  it('removes the gfid open-email marker from display', () => {
    expect(cleanForDisplay('open this [[gfid:abc123]]')).toBe('open this');
  });
  it('strips gf card blocks and markers for copy', () => {
    const raw = 'Here you go [[gfid:x]]\n```gf-receipt\n{"a":1}\n```\nDone';
    const out = plainText(raw);
    expect(out).not.toContain('gf-receipt');
    expect(out).not.toContain('gfid');
    expect(out).toContain('Here you go');
    expect(out).toContain('Done');
  });
});

describe('modelShort', () => {
  it('maps full model ids to short labels', () => {
    expect(modelShort('claude-haiku-4-5')).toBe('haiku');
    expect(modelShort('claude-sonnet-4-6')).toBe('sonnet');
    expect(modelShort('claude-opus-4-8')).toBe('opus');
  });
  it('falls back to stripping the claude- prefix', () => {
    expect(modelShort('claude-future-9')).toBe('future-9');
  });
});
