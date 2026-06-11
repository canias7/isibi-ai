import { type RefObject } from 'react';
import Markdown from './Markdown';
import { IconX } from './icons';

// Presentational in-app reader for a legal doc (Privacy / Terms). The open and
// dismiss state plus the focus trap live in App, mirroring the other sheets.
export default function LegalSheet({ title, body, closing, onClose, panelRef }: {
  title: string;
  body: string;
  closing: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement>;
}) {
  return (
    <>
      <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={onClose} />
      <div className={`legal-sheet${closing ? ' closing' : ''}`} role="dialog" aria-label={title} ref={panelRef} tabIndex={-1}>
        <div className="legal-head">
          <span className="legal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="legal-body">
          <Markdown text={body} />
        </div>
      </div>
    </>
  );
}
