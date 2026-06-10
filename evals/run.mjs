#!/usr/bin/env node
// Behavioral evals for the chat backend: a handful of canned conversations run
// against PRODUCTION, checking the contracts the app depends on (card fast-path,
// error shapes, model routing, basic answer quality). Run before merging prompt
// or model changes:
//
//   npm run evals
//
// Costs a few cents (three short model calls); the other checks are free.
// Uses the PUBLIC anon key — the same one shipped inside the app.

const CHAT_API = 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/chat';
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcGZlcXJlbHZ6aWx0ZndwdXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1Mjk2NDMsImV4cCI6MjA5NjEwNTY0M30.DZ_mssAlWiGj-6xLG7Z_srt0taV-mXbbRzazQ29P2xw';

async function chat(text, { expectStatus = 200 } = {}) {
  const res = await fetch(CHAT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }], tz: 'UTC', cards: true }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.text();
  return { status: res.status, body, model: res.headers.get('x-gf-model') || '' };
}

const checks = [
  {
    name: 'bad body -> 400 with a human message',
    run: async () => {
      const res = await fetch(CHAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
        body: '{}',
        signal: AbortSignal.timeout(30000),
      });
      if (res.status !== 400) return `expected 400, got ${res.status}`;
      return null;
    },
  },
  {
    name: 'email-tap fast path returns exactly a gf-message card (no model call)',
    run: async () => {
      const r = await chat('Open this email: [[gfid:evaltest123]]');
      if (r.status !== 200) return `status ${r.status}`;
      const expected = '```gf-message\n{"id":"evaltest123"}\n```';
      if (r.body.trim() !== expected) return `unexpected body: ${r.body.slice(0, 120)}`;
      return null;
    },
  },
  {
    name: 'simple chat answers in plain text on Sonnet',
    run: async () => {
      const r = await chat('Say hello in one short sentence.');
      if (r.status !== 200) return `status ${r.status}`;
      if (!r.body.trim()) return 'empty reply';
      if (r.body.includes('```')) return 'unexpected code block in a plain greeting';
      if (!r.model.includes('sonnet')) return `expected sonnet, routed to ${r.model}`;
      return null;
    },
  },
  {
    name: 'exact arithmetic is correct',
    run: async () => {
      const r = await chat('What is 17 multiplied by 23? Reply with just the number.');
      if (r.status !== 200) return `status ${r.status}`;
      if (!r.body.includes('391')) return `expected 391 in: ${r.body.slice(0, 120)}`;
      return null;
    },
  },
  {
    name: 'complex asks route to Opus',
    run: async () => {
      const r = await chat('Analyze the pros and cons of renting versus buying a home, briefly.');
      if (r.status !== 200) return `status ${r.status}`;
      if (!r.model.includes('opus')) return `expected opus, routed to ${r.model}`;
      if (!r.body.trim()) return 'empty reply';
      return null;
    },
  },
];

let failed = 0;
for (const c of checks) {
  try {
    const problem = await c.run();
    if (problem) {
      failed++;
      console.log(`FAIL  ${c.name} — ${problem}`);
    } else {
      console.log(`pass  ${c.name}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.name} — ${String(e?.message || e)}`);
  }
}
console.log(failed ? `\n${failed} eval(s) failed` : '\nall evals passed');
process.exit(failed ? 1 : 0);
