import Markdown from './Markdown';
import {
  EmailList, EmailSkeleton, EmailDetail, EmailDetailSkeleton,
  type EmailItem, type EmailMessage,
} from './EmailList';

// The assistant is asked to emit ```gf-emails / ```gf-message blocks, but models
// drift (plain ``` or ```json, stray intro text). So we detect by SHAPE, not just
// the fence name: any code block whose JSON looks like email(s) becomes a card.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEmailItem(o: any): boolean {
  return !!o && typeof o === 'object' && typeof o.subject === 'string'
    && (typeof o.from === 'string' || typeof o.email === 'string');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEmailMessage(o: any): boolean {
  return !!o && typeof o === 'object' && typeof o.subject === 'string' && typeof o.body === 'string';
}

// Pull out the first fenced code block. Handles ```lang\n…\n``` and ```\n…\n```.
function firstFence(text: string) {
  const open = text.indexOf('```');
  if (open === -1) return null;
  const before = text.slice(0, open);
  const rest = text.slice(open + 3);
  const nl = rest.indexOf('\n');
  const firstLine = (nl === -1 ? rest : rest.slice(0, nl)).trim();
  let lang = '';
  let body = rest;
  if (/^[a-z0-9_-]+$/i.test(firstLine)) { // a real language tag, not JSON
    lang = firstLine.toLowerCase();
    body = nl === -1 ? '' : rest.slice(nl + 1);
  }
  const close = body.indexOf('```');
  return close === -1
    ? { before, lang, content: body, after: '', closed: false }
    : { before, lang, content: body.slice(0, close), after: body.slice(close + 3), closed: true };
}

export default function AssistantMessage(
  { text, streaming, onOpen }: { text: string; streaming: boolean; onOpen?: (it: EmailItem) => void },
) {
  const f = firstFence(text);
  // Only consider blocks that could be email JSON; leave real code blocks alone.
  const maybeEmail = !!f && ['gf-emails', 'gf-message', 'json', ''].includes(f.lang);
  if (!f || !maybeEmail) return <Markdown text={text} />;

  // Block still streaming in — guess list vs detail from the tag or first char.
  if (!f.closed) {
    if (!streaming) return <Markdown text={text} />;
    const head = f.content.trimStart()[0];
    const isList = f.lang === 'gf-emails' || head === '[';
    const isMsg = f.lang === 'gf-message' || head === '{';
    if (!isList && !isMsg) return <Markdown text={text} />;
    return (
      <>
        {f.before.trim() && <Markdown text={f.before} />}
        {isList ? <EmailSkeleton /> : <EmailDetailSkeleton />}
      </>
    );
  }

  let parsed: unknown = null;
  try { parsed = JSON.parse(f.content.trim()); } catch { parsed = null; }

  // Explicitly tagged blocks are trusted by their tag — a gf-message with just an
  // {"id"} is valid (the reader fetches sender/subject/body itself). Generic
  // json/'' blocks fall back to shape detection so real code blocks and unrelated
  // JSON aren't hijacked into email cards.
  const obj = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  const list = f.lang === 'gf-emails'
    ? (Array.isArray(parsed) && parsed.length > 0)
    : (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isEmailItem));
  const msg = f.lang === 'gf-message' ? obj : isEmailMessage(parsed);
  if (!list && !msg) {
    // A gf-tagged block we couldn't use — never dump raw JSON on the user; show
    // only any surrounding prose. Untagged blocks render normally (real code).
    if (f.lang === 'gf-emails' || f.lang === 'gf-message') {
      const around = `${f.before}\n${f.after}`.trim();
      return around ? <Markdown text={around} /> : <></>;
    }
    return <Markdown text={text} />;
  }

  return (
    <>
      {f.before.trim() && <Markdown text={f.before} />}
      {list ? <EmailList items={parsed as EmailItem[]} onOpen={onOpen} /> : <EmailDetail msg={parsed as EmailMessage} />}
      {f.after.trim() && <Markdown text={f.after} />}
    </>
  );
}
