import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { streamChat, type ChatMessage } from './api';
import Connectors from './Connectors';

type View = 'chat' | 'connectors' | 'settings';

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const CHATS_KEY = 'gf_chats';
const MAX_CHATS = 50;

function loadChats(): Conversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHATS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveChats(chats: Conversation[]) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* storage full / unavailable — keep running in memory */
  }
}

function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const t = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  return t ? (t.length > 42 ? t.slice(0, 42) + '…' : t) : 'New chat';
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default function App() {
  const [chats, setChats] = useState<Conversation[]>(loadChats);
  const [currentId, setCurrentId] = useState<string>(() => loadChats()[0]?.id ?? uid());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChats()[0]?.messages ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // Persist the active conversation once a turn finishes (not on every token).
  useEffect(() => {
    if (busy || messages.length === 0) return;
    setChats((prev) => {
      const convo: Conversation = { id: currentId, title: titleFrom(messages), messages, updatedAt: Date.now() };
      const next = [convo, ...prev.filter((c) => c.id !== currentId)];
      saveChats(next);
      return next;
    });
  }, [messages, busy, currentId]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const history = [...messages, { role: 'user', content: text } as ChatMessage];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    try {
      await streamChat(history, (tok) => {
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { role: 'assistant', content: last.content + tok };
          return copy;
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function go(v: View) {
    setView(v);
    setSidebarOpen(false);
  }

  function newChat() {
    // The current thread is already saved by the persist effect; just start fresh.
    setCurrentId(uid());
    setMessages([]);
    go('chat');
  }

  function selectChat(id: string) {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    setCurrentId(id);
    setMessages(c.messages);
    go('chat');
  }

  function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveChats(next);
      return next;
    });
    if (id === currentId) {
      setCurrentId(uid());
      setMessages([]);
    }
  }

  const title = view === 'connectors' ? 'Connectors' : view === 'settings' ? 'Settings' : 'Go Farther';

  return (
    <div className="app">
      {/* Sidebar + backdrop */}
      <div className={`backdrop ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-head">Go Farther</div>
        <button className="side-item primary" onClick={newChat}>
          <span className="ico">✎</span> New chat
        </button>
        <nav className="side-nav">
          <button className={`side-item ${view === 'chat' ? 'active' : ''}`} onClick={() => go('chat')}>
            <span className="ico">💬</span> Chat
          </button>
          <button className={`side-item ${view === 'connectors' ? 'active' : ''}`} onClick={() => go('connectors')}>
            <span className="ico">🔌</span> Connectors
          </button>
          <button className={`side-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            <span className="ico">⚙️</span> Settings
          </button>
        </nav>

        {chats.length > 0 && (
          <div className="side-chats">
            <div className="side-label">Recent chats</div>
            {chats.map((c) => (
              <button
                key={c.id}
                className={`side-item chat-item ${view === 'chat' && c.id === currentId ? 'active' : ''}`}
                onClick={() => selectChat(c.id)}
              >
                <span className="chat-title">{c.title || 'New chat'}</span>
                <span
                  className="chat-del"
                  role="button"
                  aria-label="Delete chat"
                  onClick={(e) => deleteChat(c.id, e)}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
        <span className="title">{title}</span>
        <button className="icon-btn" onClick={newChat} aria-label="New chat">✎</button>
      </header>

      {view === 'connectors' ? (
        <Connectors />
      ) : view === 'settings' ? (
        <div className="page">
          <div className="page-inner">
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">More options coming soon.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="empty">
                <h1>What can I help with?</h1>
              </div>
            ) : (
              <div className="thread">
                {messages.map((m, i) => {
                  const streamingHere = busy && i === messages.length - 1 && m.role === 'assistant';
                  return (
                    <div key={i} className={`msg ${m.role}`}>
                      <div className="bubble">
                        {m.content}
                        {streamingHere && <span className="cursor" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Message Go Farther…"
                rows={1}
              />
              <button className="send" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Send">
                ↑
              </button>
            </div>
            <p className="hint">Go Farther can make mistakes — double-check important info.</p>
          </div>
        </>
      )}
    </div>
  );
}
