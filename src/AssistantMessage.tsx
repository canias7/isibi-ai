import Markdown from './Markdown';
import {
  EmailList, EmailSkeleton, EmailDetail, EmailDetailSkeleton,
  type EmailItem, type EmailMessage,
} from './EmailList';

// Fenced blocks the assistant emits (see chat system prompt):
//   ```gf-emails   → an inbox list  (JSON array)
//   ```gf-message  → one opened email (JSON object)
const LIST_FENCE = '```gf-emails';
const MSG_FENCE = '```gf-message';

// Renders an assistant reply. If it contains an email block, that part becomes a
// rich component and everything else renders as Markdown. Tolerant of the block
// still streaming in (shows a skeleton until it's closed and parseable).
export default function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  const li = text.indexOf(LIST_FENCE);
  const mi = text.indexOf(MSG_FENCE);
  let fence: string | null = null;
  let start = -1;
  if (li !== -1 && (mi === -1 || li < mi)) { fence = LIST_FENCE; start = li; }
  else if (mi !== -1) { fence = MSG_FENCE; start = mi; }

  if (fence === null) return <Markdown text={text} />;

  const isList = fence === LIST_FENCE;
  const before = text.slice(0, start);
  const afterFence = text.slice(start + fence.length);
  const end = afterFence.indexOf('```');

  // Block not closed yet.
  if (end === -1) {
    if (streaming) {
      return (
        <>
          {before.trim() && <Markdown text={before} />}
          {isList ? <EmailSkeleton /> : <EmailDetailSkeleton />}
        </>
      );
    }
    return <Markdown text={text} />; // stream ended unclosed — show raw
  }

  const json = afterFence.slice(0, end).trim();
  const after = afterFence.slice(end + 3);
  let parsed: unknown = null;
  try { parsed = JSON.parse(json); } catch { parsed = null; }

  const ok = isList ? Array.isArray(parsed) : !!parsed && typeof parsed === 'object';

  return (
    <>
      {before.trim() && <Markdown text={before} />}
      {ok
        ? (isList
            ? <EmailList items={parsed as EmailItem[]} />
            : <EmailDetail msg={parsed as EmailMessage} />)
        : <Markdown text={'```\n' + json + '\n```'} />}
      {after.trim() && <Markdown text={after} />}
    </>
  );
}
