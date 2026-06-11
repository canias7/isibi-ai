import { describe, it, expect } from 'vitest';
import type { ChatMessage } from './api';
import {
  slimMessages,
  isNetworkError,
  serverIsMoreComplete,
  withoutPlaceholders,
  titleFrom,
  cleanForDisplay,
  modelShort,
  plainText,
  decideRetry,
  mergeQueued,
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

describe('withoutPlaceholders (failed/empty bubbles are UI state, not content)', () => {
  it('drops failed and empty assistant messages, keeps everything else', () => {
    const msgs = [user('q1'), asst('a1'), user('q2'), asst('', { failed: true }), user('q3'), asst('')];
    expect(withoutPlaceholders(msgs)).toEqual([user('q1'), asst('a1'), user('q2'), user('q3')]);
  });
  it('keeps a partially-streamed reply (non-empty, not failed)', () => {
    const msgs = [user('q'), asst('partial answer that streamed before the drop')];
    expect(withoutPlaceholders(msgs)).toEqual(msgs);
  });
  it('never drops user messages, even empty ones', () => {
    const msgs = [user(''), asst('hi')];
    expect(withoutPlaceholders(msgs)).toEqual(msgs);
  });
});

describe('serverIsMoreComplete with stacked pending turns (the weather/Hi incident)', () => {
  // The server stores clean history (no placeholders) — a local copy carrying
  // failed bubbles must not look "longer" than a server copy with MORE real content.
  it('adopts when the server answered a later turn than our placeholders cover', () => {
    const local = [user('whats in miami'), asst('miami stuff'), user('what about the weather'), asst('', { failed: true, sent: false }), user('hi'), asst('', { failed: true, sent: true })];
    const remote = [user('whats in miami'), asst('miami stuff'), user('what about the weather'), user('hi'), asst('here is the weather…')];
    expect(serverIsMoreComplete(local, remote)).toBe(true);
  });
  it('still refuses a server copy with no real reply for our pending turn', () => {
    const local = [user('whats in miami'), asst('miami stuff'), user('what about the weather'), asst('', { failed: true })];
    const remote = [user('whats in miami'), asst('miami stuff')];
    expect(serverIsMoreComplete(local, remote)).toBe(false);
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

describe('decideRetry (recover a pending turn without re-running it)', () => {
  const d = (sent: boolean, hasRemote: boolean, serverMoreComplete: boolean, force: boolean) =>
    decideRetry({ sent, hasRemote, serverMoreComplete, force });

  it('always ADOPTS when the server already has the reply (never re-runs)', () => {
    // serverMoreComplete short-circuits regardless of every other flag.
    for (const sent of [true, false]) for (const hasRemote of [true, false]) for (const force of [true, false]) {
      expect(d(sent, hasRemote, true, force)).toBe('adopt');
    }
  });

  it('WAITS when it could not reach the server and the user did not force it', () => {
    expect(d(false, false, false, false)).toBe('wait');
    expect(d(true, false, false, false)).toBe('wait');
  });

  it('WAITS on a turn that reached the server (it will finish it) unless forced', () => {
    expect(d(true, true, false, false)).toBe('wait');
  });

  it('RESENDS an unsent turn once the server is reachable', () => {
    expect(d(false, true, false, false)).toBe('resend');
  });

  it('RESENDS when the user forces it, even with no server check', () => {
    expect(d(true, false, false, true)).toBe('resend');
    expect(d(true, true, false, true)).toBe('resend');
  });

  it('SAFETY: a sent turn is never resent without force or an explicit adopt', () => {
    // The duplicate-action guarantee: for every input where the turn was already
    // sent, we never auto-"resend" unless the user forced it.
    for (const hasRemote of [true, false]) for (const serverMoreComplete of [true, false]) {
      expect(d(true, hasRemote, serverMoreComplete, false)).not.toBe('resend');
    }
  });
});

describe('mergeQueued (stacking messages typed during a reply)', () => {
  it('creates a fresh queue when nothing is queued', () => {
    expect(mergeQueued<string>(null, 'hello', ['a'])).toEqual({ text: 'hello', atts: ['a'] });
  });

  it('stacks text on a newline and concatenates attachments', () => {
    expect(mergeQueued({ text: 'first', atts: ['a'] }, 'second', ['b'])).toEqual({
      text: 'first\nsecond',
      atts: ['a', 'b'],
    });
  });

  it('caps the combined attachments at the limit (keeping the most recent)', () => {
    const existing = { text: 't', atts: [1, 2, 3, 4, 5] };
    expect(mergeQueued(existing, 'more', [6, 7, 8]).atts).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('trims the merged text', () => {
    expect(mergeQueued({ text: 'a', atts: [] }, '  b  ', []).text).toBe('a\n  b');
  });
});
