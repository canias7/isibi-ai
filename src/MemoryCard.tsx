import { useEffect, useState } from 'react';
import { memoryAttachment } from './memory';
import { IconDoc } from './icons';

// Renders a saved memory's attachment inline in a chat reply (the assistant emits
// a ```gf-memory {"id":…} block). Images show inline; files show as an Open card.
export function MemoryAttachmentCard({ id }: { id: string }) {
  const [att, setAtt] = useState<{ type: string; name: string; url: string } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setAtt(null);
    setErr(false);
    memoryAttachment(id)
      .then((a) => { if (alive) (a ? setAtt(a) : setErr(true)); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  if (err) return <div className="mc-err">Couldn’t load that attachment.</div>;
  if (!att) return <div className="mc-load">Loading…</div>;

  if (att.type === 'image') {
    return (
      <a className="mc-img" href={att.url} target="_blank" rel="noreferrer">
        <img src={att.url} alt={att.name} />
      </a>
    );
  }
  return (
    <a className="mc-file" href={att.url} target="_blank" rel="noreferrer">
      <span className="mc-file-ico"><IconDoc size={18} /></span>
      <span className="mc-file-name">{att.name}</span>
      <span className="mc-file-open">Open</span>
    </a>
  );
}
