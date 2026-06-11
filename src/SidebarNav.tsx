import type { MutableRefObject } from 'react';
import type { Session } from '@supabase/supabase-js';
import { keyActivate } from './a11y';
import { tap } from './haptics';
import { IconSearch, IconX, IconCompose, IconChat, IconSettings, IconLogout } from './icons';
import type { Conversation } from './chatSync';

// Relative label for sidebar chat rows ("3:24 PM" / "Yesterday" / "May 19").
function dayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function chatWhen(ts: number): string {
  if (!ts) return '';
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
  if (diff <= 0) return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// The chats drawer — presentational; state and handlers stay in App. On wide
// screens (see the min-width media block in sidebar.css) it becomes a
// permanently visible column instead of a drawer.
export default function SidebarNav({
  open, onClose, session, isGuest, view, currentId,
  chatSearch, setChatSearch, q, chatSections,
  editingId, editingTitle, setEditingTitle, setEditingId, commitRename,
  selectChat, newChat, go, signOut,
  rowPressStart, rowPressCancel, pressFired, onMenuChat,
}: {
  open: boolean;
  onClose: () => void;
  session: Session;
  isGuest: boolean;
  view: string;
  currentId: string;
  chatSearch: string;
  setChatSearch: (s: string) => void;
  q: string;
  chatSections: { label: string; items: Conversation[] }[];
  editingId: string | null;
  editingTitle: string;
  setEditingTitle: (s: string) => void;
  setEditingId: (id: string | null) => void;
  commitRename: () => void;
  selectChat: (id: string) => void;
  newChat: () => void;
  go: (v: 'chat' | 'connectors' | 'settings') => void;
  signOut: () => void;
  rowPressStart: (c: Conversation) => void;
  rowPressCancel: () => void;
  pressFired: MutableRefObject<boolean>;
  onMenuChat: (c: Conversation) => void;
}) {
  return (
    <>
      <div className={`backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Chats and navigation">
        <div className="side-search">
          <IconSearch size={15} />
          <input
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search chats"
          />
          {chatSearch && (
            <button className="side-search-x" onClick={() => setChatSearch('')} aria-label="Clear search">
              <IconX size={13} />
            </button>
          )}
        </div>
        <button className="side-item primary" onClick={() => { void tap(); newChat(); }}>
          <span className="ico"><IconCompose size={18} /></span> New chat
        </button>
        <nav className="side-nav">
          <button className={`side-item ${view === 'chat' ? 'active' : ''}`} onClick={() => go('chat')}>
            <span className="ico"><IconChat size={18} /></span> Chat
          </button>
          <button className={`side-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            <span className="ico"><IconSettings size={18} /></span> Settings
          </button>
        </nav>

        <div className="side-chats">
          {q && chatSections.length === 0 && <div className="side-empty">No chats match that.</div>}
          {chatSections.map((sec) => (
            <div key={sec.label} className="side-group">
              <div className="side-label">{sec.label}</div>
              {sec.items.map((c) => {
                const isEditing = editingId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`side-item chat-item ${view === 'chat' && c.id === currentId ? 'active' : ''}`}
                    onClick={() => {
                      if (pressFired.current) { pressFired.current = false; return; }
                      if (!isEditing) selectChat(c.id);
                    }}
                    onTouchStart={() => rowPressStart(c)}
                    onTouchEnd={rowPressCancel}
                    onTouchMove={rowPressCancel}
                    onContextMenu={(e) => { e.preventDefault(); onMenuChat(c); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={isEditing ? undefined : keyActivate(() => selectChat(c.id))}
                  >
                    {isEditing ? (
                      <input
                        className="chat-rename"
                        value={editingTitle}
                        aria-label="Chat name"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditingId(null); }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <>
                        <span className="chat-title">{c.title || 'New chat'}</span>
                        <span className="chat-time">{chatWhen(c.updatedAt || 0)}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="side-foot">
          <div className="side-profile" role="button" tabIndex={0} onClick={() => { void tap(); go('settings'); }} onKeyDown={keyActivate(() => { void tap(); go('settings'); })}>
            <span className="side-avatar">{(session.user.email ?? 'G').charAt(0).toUpperCase()}</span>
            <span className="side-who">
              <span className="side-name">{isGuest || !session.user.email ? 'Guest' : session.user.email.split('@')[0].replace(/^./, (ch) => ch.toUpperCase())}</span>
              {session.user.email && <span className="side-mail">{session.user.email}</span>}
            </span>
            {!isGuest && (
              <button className="side-out" onClick={(e) => { e.stopPropagation(); signOut(); }} aria-label="Sign out">
                <IconLogout size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
