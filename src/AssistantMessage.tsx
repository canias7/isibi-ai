import Markdown from './Markdown';
import { EmailList, EmailSkeleton, type EmailItem } from './EmailList';

// Fenced block the assistant emits for an inbox listing (see chat system prompt):
//   ```gf-emails
//   [ { ...email... }, ... ]
//   ```
const FENCE = '```gf-emails';

// Renders an assistant reply. If it contains a gf-emails block, that part becomes
// inbox cards and everything else renders as Markdown. Tolerant of the block
// still streaming in (shows a skeleton until it's closed and parseable).
export default function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  const start = text.indexOf(FENCE);
  if (start === -1) return <Markdown text={text} />;

  const before = text.slice(0, start);
  const afterFence = text.slice(start + FENCE.length);
  const end = afterFence.indexOf('```');

  // Block not closed yet.
  if (end === -1) {
    if (streaming) {
      return (
        <>
          {before.trim() && <Markdown text={before} />}
          <EmailSkeleton />
        </>
      );
    }
    // Stream ended without a closing fence — show whatever we got, raw.
    return <Markdown text={text} />;
  }

  const json = afterFence.slice(0, end).trim();
  const after = afterFence.slice(end + 3);
  let items: EmailItem[] | null = null;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) items = parsed as EmailItem[];
  } catch {
    items = null;
  }

  return (
    <>
      {before.trim() && <Markdown text={before} />}
      {items ? <EmailList items={items} /> : <Markdown text={'```\n' + json + '\n```'} />}
      {after.trim() && <Markdown text={after} />}
    </>
  );
}
