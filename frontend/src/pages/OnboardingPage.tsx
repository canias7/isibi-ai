import { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  Loader2,
  ChevronDown,
  Check,
  User,
  Settings,
  CreditCard,
  HelpCircle,
  LogOut,
  Menu,
  Plus,
  FolderOpen,
  Store,
  LayoutTemplate,
  BookOpen,
  Clock,
  X,
  AppWindow,
  BarChart3,
  MessageSquare,
  Monitor,
  Smartphone,
  Tablet,
  Code,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
} from "lucide-react";
import { post, get } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { MarketplacePage } from "./MarketplacePage";
import { MyAppsPage } from "./MyAppsPage";
import { DevMarketplacePage } from "./DevMarketplacePage";
import { SpecPreview } from "@/components/SpecPreview";

interface Props {
  onSpecCreated: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: string;
}

const MODELS = [
  { id: "anias-1.0", label: "Anias 1.0", description: "Software builder" },
  { id: "ambar-1.0", label: "Ambar 1.0", description: "Website builder" },
  { id: "mario-1.0", label: "Mario 1.0", description: "App builder" },
  { id: "claw-1.0", label: "Claw 1.0", description: "Agent builder" },
];

type View = "chat" | "marketplace" | "projects" | "myapps" | "templates" | "docs" | "history" | "mylistings";

interface SidebarItem {
  id: View;
  label: string;
  icon: typeof Plus;
  badge?: string;
}

const DEV_SIDEBAR: SidebarItem[] = [
  { id: "chat", label: "New Chat", icon: Plus },
  { id: "projects", label: "My Projects", icon: FolderOpen },
  { id: "mylistings", label: "My Listings", icon: BarChart3 },
  { id: "marketplace", label: "isibi marketplace", icon: Store, badge: "NEW" },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "docs", label: "Docs", icon: BookOpen },
  { id: "history", label: "History", icon: Clock },
];

const USER_SIDEBAR: SidebarItem[] = [
  { id: "myapps", label: "My Apps", icon: AppWindow },
  { id: "marketplace", label: "isibi marketplace", icon: Store, badge: "NEW" },
  { id: "docs", label: "Docs", icon: BookOpen },
  { id: "history", label: "History", icon: Clock },
];

export function OnboardingPage({ onSpecCreated }: Props) {
  const { user, clearAuth } = useAuthStore();
  const isDev = user?.account_type === "developer";
  const sidebarItems = isDev ? DEV_SIDEBAR : USER_SIDEBAR;
  const defaultView: View = isDev ? "chat" : "myapps";

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<View>(defaultView);

  // Chat history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Preview state
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewTab, setPreviewTab] = useState<"preview" | "code">("preview");
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [builtSpec, setBuiltSpec] = useState<any>(null);
  const [builtProjectId, setBuiltProjectId] = useState<string | null>(null);

  const hasStartedChat = messages.length > 0 && activeView === "chat";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [prompt]);

  const startNewChat = () => {
    if (messages.length > 0 && activeChatId) {
      setChatSessions((prev) =>
        prev.map((s) => (s.id === activeChatId ? { ...s, messages } : s))
      );
    }
    setMessages([]);
    setActiveChatId(null);
    setError(null);
    setActiveView("chat");
    setChatPanelOpen(true);
  };

  const loadChat = (session: ChatSession) => {
    if (messages.length > 0 && activeChatId) {
      setChatSessions((prev) =>
        prev.map((s) => (s.id === activeChatId ? { ...s, messages } : s))
      );
    }
    setMessages(session.messages);
    setActiveChatId(session.id);
    setActiveView("chat");
    setChatPanelOpen(true);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    const userMsg = prompt.trim();
    setPrompt("");
    setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    // Create a new chat session on first message
    let currentChatId = activeChatId;
    if (!currentChatId) {
      const newId = Math.random().toString(36).slice(2, 9);
      currentChatId = newId;
      const title = userMsg.slice(0, 40) + (userMsg.length > 40 ? "..." : "");
      const newSession: ChatSession = {
        id: newId,
        title,
        messages: newMessages,
        model: selectedModel.id,
        createdAt: new Date().toISOString(),
      };
      setChatSessions((prev) => [newSession, ...prev]);
      setActiveChatId(newId);
    } else {
      setChatSessions((prev) =>
        prev.map((s) => (s.id === currentChatId ? { ...s, messages: newMessages } : s))
      );
    }

    try {
      const res = await post<{
        reply: string;
        ready_to_build: boolean;
        project_id?: string;
        project_name?: string;
      }>("/chat", {
        model: selectedModel.id,
        messages: newMessages,
      });

      const updatedMessages: Message[] = [
        ...newMessages,
        { role: "assistant", content: res.reply },
      ];
      setMessages(updatedMessages);

      const cid = currentChatId;
      setChatSessions((prev) =>
        prev.map((s) => (s.id === cid ? { ...s, messages: updatedMessages } : s))
      );

      if (res.ready_to_build && res.project_id) {
        setBuiltProjectId(res.project_id);
        // Fetch the generated spec to show in preview
        try {
          const project = await get<{ spec: any }>(`/projects/${res.project_id}`);
          if (project?.spec) {
            setBuiltSpec(project.spec);
          }
        } catch {
          // Preview will show placeholder if fetch fails
        }
      }
    } catch (err: any) {
      const detail = err?.detail || "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: detail }]);
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const handleSidebarClick = (view: View) => {
    if (view === "chat") {
      startNewChat();
    } else {
      setActiveView(view);
    }
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const isEmpty = messages.length === 0;

  // ─── Chat panel (used both centered and as left panel) ───
  const chatInput = (
    <div className="bg-white px-3 pb-4 pt-2">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to build..."
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm text-black placeholder-gray-400 focus:outline-none"
          rows={1}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-end px-3 pb-2">
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const chatMessages = (
    <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {messages.map((msg, i) => (
        <div key={i} className="flex gap-3">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              msg.role === "user" ? "bg-gray-200 text-black" : "bg-black text-white"
            }`}
          >
            {msg.role === "user" ? "Y" : "A"}
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="text-xs font-medium text-black">
              {msg.role === "user" ? "You" : selectedModel.label}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {msg.content}
            </p>
          </div>
        </div>
      ))}
      {loading && (
        <div className="flex gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
            A
          </div>
          <div className="pt-0.5">
            <p className="text-xs font-medium text-black">{selectedModel.label}</p>
            <div className="mt-2 flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  // ─── Preview panel (right side when chat is active) ───
  const handleDownloadApp = () => {
    if (!builtSpec) return;
    const appName = builtSpec.app_name || builtSpec.name || "my-app";
    const safeName = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const entities = builtSpec.entities || [];
    const modules = builtSpec.modules || [];
    const primaryColor = builtSpec.design_system?.colors?.primary || "#000000";

    // Build a standalone Electron app with the spec baked in
    const indexHtml = generateAppHtml(appName, entities, modules, primaryColor, builtSpec);
    const mainJs = `const { app, BrowserWindow } = require("electron");
const path = require("path");
function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 800, title: ${JSON.stringify(appName)}, webPreferences: { nodeIntegration: false } });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });`;

    const packageJson = JSON.stringify({
      name: safeName,
      version: "1.0.0",
      main: "main.js",
      scripts: { start: "electron ." },
      dependencies: { electron: "^28.0.0" },
    }, null, 2);

    const startCommand = `#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi
echo "Launching ${appName}..."
npx electron .`;

    // Create zip using JSZip-like approach via Blob
    import("jszip").then(({ default: JSZip }) => {
      const zip = new JSZip();
      const folder = zip.folder(safeName)!;
      folder.file("index.html", indexHtml);
      folder.file("main.js", mainJs);
      folder.file("package.json", packageJson);
      folder.file("start.command", startCommand, { unixPermissions: "755" });
      folder.file("spec.json", JSON.stringify(builtSpec, null, 2));

      zip.generateAsync({ type: "blob", platform: "UNIX" }).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  };

  const previewPanel = (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
      {/* Preview toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPreviewTab("preview")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              previewTab === "preview" ? "bg-gray-100 text-black" : "text-gray-500 hover:text-black"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setPreviewTab("code")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              previewTab === "code" ? "bg-gray-100 text-black" : "text-gray-500 hover:text-black"
            }`}
          >
            <span className="flex items-center gap-1">
              <Code className="h-3 w-3" />
              Code
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPreviewDevice("desktop")}
            className={`rounded-lg p-1.5 transition ${
              previewDevice === "desktop" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black"
            }`}
          >
            <Monitor className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPreviewDevice("tablet")}
            className={`rounded-lg p-1.5 transition ${
              previewDevice === "tablet" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black"
            }`}
          >
            <Tablet className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPreviewDevice("mobile")}
            className={`rounded-lg p-1.5 transition ${
              previewDevice === "mobile" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black"
            }`}
          >
            <Smartphone className="h-4 w-4" />
          </button>
          <div className="mx-2 h-4 w-px bg-gray-200" />
          <button className="rounded-lg p-1.5 text-gray-400 transition hover:text-black">
            <ExternalLink className="h-4 w-4" />
          </button>
          {builtSpec && isDev && (
            <button
              onClick={handleDownloadApp}
              className="flex items-center gap-1.5 rounded-lg bg-black px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-gray-800"
              title="Download as desktop app"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}
        </div>
      </div>

      {/* Preview content */}
      <div className="flex flex-1 items-center justify-center p-4">
        {previewTab === "preview" ? (
          <div
            className={`flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm transition-all ${
              previewDevice === "desktop"
                ? "w-full"
                : previewDevice === "tablet"
                ? "w-[768px] max-w-full"
                : "w-[375px] max-w-full"
            }`}
          >
            {/* Simulated browser bar */}
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              </div>
              <div className="mx-2 flex-1 rounded-md bg-gray-50 px-3 py-1">
                <p className="text-center text-[10px] text-gray-400">
                  {builtSpec?.app_name?.toLowerCase().replace(/\s+/g, "-") || "your-app"}.isibi.ai
                </p>
              </div>
            </div>

            {/* Preview area */}
            <div className="flex-1 overflow-hidden">
              {builtSpec ? (
                <SpecPreview spec={builtSpec} device={previewDevice} />
              ) : (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50">
                      <Monitor className="h-8 w-8 text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-black">
                      {loading ? "Building your app..." : "Preview"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {loading
                        ? "Generating your application..."
                        : "Describe your requirements in the chat and the preview will appear here."}
                    </p>
                    {loading && (
                      <div className="mt-4 flex justify-center">
                        <div className="h-1 w-32 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-black" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full overflow-auto rounded-xl border border-gray-200 bg-gray-900 p-4">
            <pre className="text-xs text-green-400">
              <code>
                {builtSpec
                  ? JSON.stringify(builtSpec, null, 2)
                  : `// Generated spec will appear here\n// Keep chatting to refine your app\n\n// Model: ${selectedModel.label}\n// Session: ${activeChatId || "new"}`}
              </code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Render views ───
  const renderContent = () => {
    switch (activeView) {
      case "myapps":
        return <MyAppsPage />;
      case "marketplace":
        return <MarketplacePage />;
      case "mylistings":
        return <DevMarketplacePage />;
      case "projects":
        return (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <FolderOpen className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-black">No projects yet</p>
              <p className="mt-1 text-xs text-gray-400">Start a conversation to build your first project.</p>
              <button
                onClick={() => handleSidebarClick("chat")}
                className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                New Chat
              </button>
            </div>
          </div>
        );
      case "templates":
        return (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <LayoutTemplate className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-black">Templates</p>
              <p className="mt-1 text-xs text-gray-400">Coming soon.</p>
            </div>
          </div>
        );
      case "docs":
        return (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <BookOpen className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-black">Documentation</p>
              <p className="mt-1 text-xs text-gray-400">Coming soon.</p>
            </div>
          </div>
        );
      case "history":
        return (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <Clock className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-black">Chat History</p>
              <p className="mt-1 text-xs text-gray-400">Your past conversations will appear here.</p>
            </div>
          </div>
        );
      case "chat":
      default:
        // ─── SPLIT LAYOUT: chat has started ───
        if (hasStartedChat) {
          return (
            <div className="flex flex-1 overflow-hidden">
              {/* Left: Chat panel (collapsible) */}
              {chatPanelOpen && (
                <div className="flex w-[380px] shrink-0 flex-col border-r border-gray-200 bg-white">
                  {/* Chat panel header */}
                  <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-gray-400" />
                      <span className="text-xs font-medium text-black">Chat</span>
                    </div>
                    <button
                      onClick={() => setChatPanelOpen(false)}
                      className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-black"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </button>
                  </div>

                  {chatMessages}
                  {chatInput}
                </div>
              )}

              {/* Collapsed chat toggle */}
              {!chatPanelOpen && (
                <div className="flex w-10 flex-col items-center border-r border-gray-200 bg-white pt-3">
                  <button
                    onClick={() => setChatPanelOpen(true)}
                    className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-black"
                    title="Show chat"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Right: Preview panel */}
              {previewPanel}
            </div>
          );
        }

        // ─── CENTERED LAYOUT: empty state ───
        return (
          <>
            <div className="flex flex-1 flex-col items-center overflow-y-auto">
              <div className="w-full max-w-3xl flex-1 px-4">
                <div className="flex h-full flex-col items-center justify-center pb-32">
                  <h1 className="text-2xl font-semibold text-black">
                    What do you want to build?
                  </h1>
                </div>
              </div>
            </div>
            <div className="bg-white px-4 pb-6 pt-2">
              <div className="mx-auto w-full max-w-3xl">
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what you want to build..."
                    className="w-full resize-none bg-transparent px-4 pb-2 pt-4 text-sm text-black placeholder-gray-400 focus:outline-none"
                    rows={1}
                    disabled={loading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                  <div className="flex items-center justify-end px-3 pb-2">
                    <button
                      onClick={handleSubmit}
                      disabled={!prompt.trim() || loading}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-gray-400">
                  {selectedModel.label} can make mistakes. Review generated apps before use.
                </p>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 lg:static lg:z-auto ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden lg:border-0"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-black">isibi.ai</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-gray-200 lg:hidden"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* New Chat button */}
        {isDev && (
          <div className="px-3 pb-2">
            <button
              onClick={startNewChat}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-black transition hover:bg-gray-100"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </button>
          </div>
        )}

        {/* Chat sessions list */}
        {isDev && chatSessions.length > 0 && (
          <div className="border-b border-gray-200 px-2 pb-2">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Recent Chats
            </p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {chatSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => loadChat(session)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                    activeChatId === session.id
                      ? "bg-gray-200 font-medium text-black"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{session.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Account type indicator */}
        <div className="mx-3 mb-2 mt-2 rounded-lg bg-gray-100 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500">
            {isDev ? "Developer Account" : "User Account"}
          </p>
          <p className="text-xs font-medium text-black">
            {user ? `${user.first_name} ${user.last_name}` : ""}
          </p>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {sidebarItems
            .filter((item) => item.id !== "chat")
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSidebarClick(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-gray-200 font-medium text-black"
                      : "text-gray-600 hover:bg-gray-100 hover:text-black"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto rounded-full bg-black px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100"
            >
              <Menu className="h-4 w-4 text-gray-600" />
            </button>

            {isDev && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setModelOpen(!modelOpen)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-black transition hover:bg-gray-100"
                >
                  {selectedModel.label}
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                </button>
                {modelOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model);
                          setModelOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-gray-50"
                      >
                        <div>
                          <p className="text-sm font-medium text-black">{model.label}</p>
                          <p className="text-xs text-gray-400">{model.description}</p>
                        </div>
                        {selectedModel.id === model.id && (
                          <Check className="h-4 w-4 shrink-0 text-black" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Profile menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition hover:bg-gray-200"
            >
              <User className="h-4 w-4 text-gray-600" />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-[220px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                <div className="border-b border-gray-100 px-3 py-2">
                  <p className="text-sm font-medium text-black">
                    {user ? `${user.first_name} ${user.last_name}` : "My Account"}
                  </p>
                  <p className="text-xs text-gray-400">{user?.email || ""}</p>
                  {user?.account_type && (
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isDev ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {isDev ? "Developer" : "User"}
                    </span>
                  )}
                </div>
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                  <CreditCard className="h-4 w-4" />
                  Billing
                </button>
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                  <HelpCircle className="h-4 w-4" />
                  Help & FAQ
                </button>
                <div className="mt-1 border-t border-gray-100 pt-1">
                  <button
                    onClick={() => {
                      clearAuth();
                      window.location.href = "/";
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-500 transition hover:bg-gray-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* View content */}
        {renderContent()}
      </div>
    </div>
  );
}

// ── Generate standalone HTML app from spec ──
function generateAppHtml(appName: string, entities: any[], modules: any[], primaryColor: string, spec: any): string {
  const sidebarItems = modules.map((m: any) => `<button class="sidebar-item" onclick="showModule('${m.name}')">${m.name}</button>`).join("\n            ");

  const modulePages = modules.map((m: any) => {
    const entity = entities.find((e: any) => e.name === m.entity);
    if (m.name === "Dashboard" || m.layout === "dashboard") {
      const cards = entities.slice(0, 4).map((e: any) =>
        `<div class="stat-card"><div class="stat-label">${e.name}s</div><div class="stat-value">${Math.floor(Math.random() * 500 + 50)}</div></div>`
      ).join("");
      return `<div id="page-${m.name}" class="page"><h2>Dashboard</h2><div class="stats-grid">${cards}</div></div>`;
    }
    if (!entity) return `<div id="page-${m.name}" class="page"><h2>${m.name}</h2><p>Module content</p></div>`;

    const fields = entity.fields?.filter((f: any) => f.show_in_table !== false && !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)).slice(0, 6) || [];
    const headers = fields.map((f: any) => `<th>${f.name.replace(/_/g, " ")}</th>`).join("");
    const rows = Array.from({ length: 5 }, (_, ri) =>
      `<tr>${fields.map((f: any) => {
        if (f.enum_values?.length) return `<td><span class="badge">${f.enum_values[ri % f.enum_values.length]}</span></td>`;
        if (f.name.includes("name") || f.name.includes("title")) return `<td>Item ${ri + 1}</td>`;
        if (f.name.includes("email")) return `<td>user${ri+1}@example.com</td>`;
        if (f.name.includes("amount") || f.name.includes("value")) return `<td>$${(Math.random()*10000).toFixed(0)}</td>`;
        return `<td>${f.name} ${ri+1}</td>`;
      }).join("")}</tr>`
    ).join("");

    return `<div id="page-${m.name}" class="page" style="display:none"><div class="page-header"><h2>${entity.name}s</h2><button class="btn-primary" style="background:${primaryColor}">+ Add ${entity.name}</button></div><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${appName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;height:100vh;background:#fff;color:#111}
.sidebar{width:220px;background:#f8f9fa;border-right:1px solid #e5e7eb;padding:16px 12px;display:flex;flex-direction:column}
.sidebar h1{font-size:14px;font-weight:700;margin-bottom:20px;color:${primaryColor}}
.sidebar-item{display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:none;border-radius:8px;font-size:13px;color:#555;cursor:pointer;margin-bottom:2px}
.sidebar-item:hover,.sidebar-item.active{background:#e5e7eb;color:#000}
.main{flex:1;overflow:auto;padding:24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
h2{font-size:18px;font-weight:600}
.btn-primary{padding:8px 16px;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:500;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:500;color:#666;text-transform:capitalize}
td{padding:10px 12px;border-bottom:1px solid #f3f4f6}
tr:hover{background:#f9fafb}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;background:#e5e7eb;color:#333}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px}
.stat-label{font-size:12px;color:#888}
.stat-value{font-size:24px;font-weight:700;margin-top:4px}
</style>
</head>
<body>
<div class="sidebar">
  <h1>${appName}</h1>
  ${sidebarItems}
</div>
<div class="main">
  ${modulePages}
</div>
<script>
function showModule(name){
  document.querySelectorAll(".page").forEach(p=>p.style.display="none");
  const el=document.getElementById("page-"+name);
  if(el)el.style.display="block";
  document.querySelectorAll(".sidebar-item").forEach(b=>{b.classList.remove("active");if(b.textContent===name)b.classList.add("active")});
}
// Show first module
const first=document.querySelector(".page");
if(first){first.style.display="block";document.querySelector(".sidebar-item")?.classList.add("active")}
</script>
</body>
</html>`;
}
