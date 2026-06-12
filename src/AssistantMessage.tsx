import { memo } from 'react';
import Markdown from './Markdown';
import {
  EmailList, EmailSkeleton, EmailDetail, EmailDetailSkeleton, ContactsList, ReceiptCard, FileCard, GenImage,
  type EmailItem, type EmailMessage, type ContactItem, type ReceiptData, type FileData, type ImageData,
} from './EmailList';
import { MemoryAttachmentCard } from './MemoryCard';

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

// Memoised: this does real work per render (regex scans, JSON parse, markdown).
// With a stable `onOpen` (App wraps it in useCallback) and unchanged `text`,
// memo lets every non-streaming message skip re-rendering when the parent
// re-renders (e.g. on every composer keystroke) — that's the anti-jank win.
function AssistantMessage(
  { text, streaming, onOpen }: { text: string; streaming: boolean; onOpen?: (it: EmailItem) => void },
) {
  // Transient tool-activity markers the server streams while it works
  // ([[gfstatus:…]]). Pull out the latest as the live label, strip the rest
  // (incl. a trailing partial one still arriving) so they never show as text.
  const sm = [...text.matchAll(/\[\[gfstatus:([^\]]*)\]\]/g)];
  const liveStatus = sm.length ? sm[sm.length - 1][1] : '';
  // Strip status pills, the reminder-sync signal, and any trailing partial
  // marker — including one split mid-prefix ("[[gf") or mid-terminator ("…]")
  // across stream chunks, which the old pattern let flash as raw text.
  const clean = text.replace(/\[\[gf(?:status|sync):[^\]]*\]\]/g, '').replace(/\[\[gf\w*(?::[^\]]*)?\]?$/, '');

  // Nothing to render yet while streaming → show a "thinking" indicator (the
  // bouncing dots), or a tool-activity label when a tool is running.
  if (streaming && !clean.trim()) {
    if (liveStatus) {
      return (
        <div className="gf-status" role="status" aria-live="polite">
          <span className="gf-status-spin" aria-hidden />
          <span>{liveStatus}</span>
        </div>
      );
    }
    return <div className="gf-thinking" role="status" aria-label="Thinking">Thinking…</div>;
  }

  const f = firstFence(clean);
  // Accept ANY gf-* tag the model uses — gf-message / gf-emails AND variants it
  // sometimes invents (gf-email-open, gf-email-detail, …). Also json/'' blocks,
  // which we then confirm by shape so real code blocks are left alone.
  const gf = !!f && f.lang.startsWith('gf-');
  const maybeEmail = !!f && (gf || f.lang === 'json' || f.lang === '');
  if (!f || !maybeEmail) return <Markdown text={clean} />;

  // Block still streaming in — guess list vs detail from the tag or first char.
  if (!f.closed) {
    if (!streaming) return <Markdown text={clean} />;
    const head = f.content.trimStart()[0];
    const isList = head === '[';
    const isMsg = head === '{';
    if (!isList && !isMsg) return <Markdown text={clean} />;
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
  // For ANY gf-* tag, trust it by shape: a JSON array → inbox list; a JSON object
  // → one email (id-only is fine, the reader fetches the rest). Generic json/''
  // blocks must actually look like email(s) so real code/JSON isn't hijacked.
  // Contacts card (gf-contacts): a JSON array of {name,email,phone}. Detected by
  // its own tag so it renders as people rows, not email rows.
  const isContacts = f.lang === 'gf-contacts' && Array.isArray(parsed) && parsed.length > 0;
  // Receipt card (gf-receipt): a {kind,title} object confirming a completed action.
  const isReceipt = f.lang === 'gf-receipt' && obj && typeof (parsed as { title?: unknown }).title === 'string';
  // Memory attachment (gf-memory): a {id} object — surface a saved photo/file.
  const isMemoryCard = f.lang === 'gf-memory' && obj && typeof (parsed as { id?: unknown }).id === 'string';
  // Generated file (gf-file): a {name,url,…} object — a downloadable the sandbox made.
  const isFile = f.lang === 'gf-file' && obj && typeof (parsed as { url?: unknown }).url === 'string';
  // Generated image (gf-image): a {url} object — an image the assistant created.
  const isImage = f.lang === 'gf-image' && obj && typeof (parsed as { url?: unknown }).url === 'string';
  // A block whose tag claims one of these specific cards either matches that
  // card's shape or renders as NOTHING — it must never fall through to the
  // email card below (a gf-file missing its url once ghost-rendered as an
  // "Unknown" email). The email fallback is only for email-ish gf-* tags.
  const claimsCard = ['gf-contacts', 'gf-receipt', 'gf-memory', 'gf-file', 'gf-image'].includes(f.lang);
  const cardMatched = isContacts || isReceipt || isMemoryCard || isFile || isImage;
  const list = gf
    ? (Array.isArray(parsed) && parsed.length > 0)
    : (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isEmailItem));
  const msg = gf ? obj : isEmailMessage(parsed);
  if ((claimsCard && !cardMatched) || (!list && !msg)) {
    // A gf-* block we couldn't parse — never dump raw JSON on the user; show any
    // surrounding prose, and recurse into what follows so a *second* card still
    // renders. Untagged blocks render normally (real code).
    if (gf) {
      return (
        <>
          {f.before.trim() && <Markdown text={f.before} />}
          {f.after.trim() && <AssistantMessage text={f.after} streaming={streaming} onOpen={onOpen} />}
        </>
      );
    }
    return <Markdown text={clean} />;
  }

  return (
    <>
      {f.before.trim() && <Markdown text={f.before} />}
      {isImage
        ? <GenImage data={parsed as ImageData} />
        : isFile
        ? <FileCard data={parsed as FileData} />
        : isMemoryCard
        ? <MemoryAttachmentCard id={(parsed as { id: string }).id} />
        : isReceipt
          ? <ReceiptCard data={parsed as ReceiptData} />
          : isContacts
            ? <ContactsList items={parsed as ContactItem[]} />
            : list
              ? <EmailList items={parsed as EmailItem[]} onOpen={onOpen} />
              : <EmailDetail msg={parsed as EmailMessage} />}
      {f.after.trim() && <AssistantMessage text={f.after} streaming={streaming} onOpen={onOpen} />}
    </>
  );
}

export default memo(AssistantMessage);
