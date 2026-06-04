import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { streamChat, type ChatMessage } from './api';
import Connectors from './Connectors';

type View = 'chat' | 'connectors' | 'settings';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    setMessages([]);
    go('chat');
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
