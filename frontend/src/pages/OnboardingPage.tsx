import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  History,
  Upload,
  RotateCcw,
  Eye,
  Rocket,
  Pencil,
  Sun,
  Moon,
  Keyboard,
} from "lucide-react";
import { post, get } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { MarketplacePage } from "./MarketplacePage";
import { MyAppsPage } from "./MyAppsPage";
import { DevMarketplacePage } from "./DevMarketplacePage";
import { SpecPreview } from "@/components/SpecPreview";
import { VisualEditor } from "@/components/VisualEditor";

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
  spec: any | null;
  projectId: string | null;
  deployUrl: string | null;
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
  const [previewTab, setPreviewTab] = useState<"preview" | "code" | "history">("preview");
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [builtSpec, setBuiltSpec] = useState<any>(null);
  const [builtProjectId, setBuiltProjectId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  // Version history state
  const [versions, setVersions] = useState<Array<{
    id: string;
    version_number: number;
    change_description: string | null;
    created_at: string;
  }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersionSpec, setSelectedVersionSpec] = useState<any>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  // GitHub export modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportRepoName, setExportRepoName] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Theme
  const { theme, toggleTheme } = useThemeStore();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Sync theme class on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  const hasStartedChat = messages.length > 0 && activeView === "chat";

  // ─── Keyboard shortcuts ───
  const focusChatInput = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const shortcuts = useMemo(
    () => [
      {
        key: "Enter",
        meta: true,
        action: () => handleSubmit(),
        description: "Submit chat message",
      },
      {
        key: "k",
        meta: true,
        action: focusChatInput,
        description: "Focus chat input",
      },
      {
        key: "n",
        meta: true,
        action: () => startNewChat(),
        description: "New chat",
      },
      {
        key: "d",
        meta: true,
        action: toggleTheme,
        description: "Toggle dark mode",
      },
      {
        key: ".",
        meta: true,
        action: () => setSidebarOpen((prev) => !prev),
        description: "Toggle sidebar",
      },
      {
        key: "/",
        meta: true,
        action: () => setShortcutsOpen((prev) => !prev),
        description: "Show keyboard shortcuts",
      },
      {
        key: "?",
        action: () => setShortcutsOpen((prev) => !prev),
        description: "Show keyboard shortcuts",
      },
      {
        key: "Escape",
        action: () => setShortcutsOpen(false),
        description: "Close modal",
      },
    ],
    [focusChatInput, toggleTheme]
  );

  useKeyboardShortcuts(shortcuts);

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

  const saveCurrentChat = () => {
    if (messages.length > 0 && activeChatId) {
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === activeChatId
            ? { ...s, messages, spec: builtSpec, projectId: builtProjectId, deployUrl }
            : s
        )
      );
    }
  };

  const startNewChat = () => {
    saveCurrentChat();
    setMessages([]);
    setActiveChatId(null);
    setBuiltSpec(null);
    setBuiltProjectId(null);
    setDeployUrl(null);
    setDeploying(false);
    setEditMode(false);
    setError(null);
    setActiveView("chat");
    setChatPanelOpen(true);
    setPreviewTab("preview");
    setVersions([]);
    setSelectedVersionSpec(null);
  };

  const loadChat = (session: ChatSession) => {
    saveCurrentChat();
    setMessages(session.messages);
    setActiveChatId(session.id);
    setBuiltSpec(session.spec || null);
    setBuiltProjectId(session.projectId || null);
    setDeployUrl(session.deployUrl || null);
    setDeploying(false);
    setEditMode(false);
    setActiveView("chat");
    setChatPanelOpen(true);
    setPreviewTab("preview");
    setVersions([]);
    setSelectedVersionSpec(null);
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
        spec: null,
        projectId: null,
        deployUrl: null,
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
            // Save spec + projectId to the chat session
            const pid = res.project_id;
            const sp = project.spec;
            setChatSessions((prev) =>
              prev.map((s) =>
                s.id === cid ? { ...s, spec: sp, projectId: pid } : s
              )
            );
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

  // ─── Version history handlers ───
  const loadVersions = async () => {
    if (!builtProjectId) return;
    setVersionsLoading(true);
    try {
      const data = await get<Array<{
        id: string;
        version_number: number;
        change_description: string | null;
        created_at: string;
      }>>(`/projects/${builtProjectId}/versions`);
      setVersions(data || []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const previewVersion = async (versionId: string) => {
    if (!builtProjectId) return;
    try {
      const data = await get<{ spec_snapshot: any }>(
        `/projects/${builtProjectId}/versions/${versionId}`
      );
      if (data?.spec_snapshot) {
        setSelectedVersionSpec(data.spec_snapshot);
      }
    } catch {
      // ignore
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!builtProjectId) return;
    setRestoringVersionId(versionId);
    try {
      await post(`/projects/${builtProjectId}/versions/${versionId}/restore`, {});
      const project = await get<{ spec: any }>(`/projects/${builtProjectId}`);
      if (project?.spec) {
        setBuiltSpec(project.spec);
        setSelectedVersionSpec(null);
      }
      await loadVersions();
    } catch {
      // ignore
    } finally {
      setRestoringVersionId(null);
    }
  };

  // ─── GitHub export handler ───
  const handleExport = async () => {
    if (!builtProjectId || !exportRepoName.trim()) return;
    setExportLoading(true);
    setExportSuccess(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "/api"}/projects/${builtProjectId}/export/github`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({ repo_name: exportRepoName.trim() }),
        }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportRepoName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportSuccess(exportRepoName.trim());
      setTimeout(() => {
        setExportModalOpen(false);
        setExportSuccess(null);
        setExportRepoName("");
      }, 2000);
    } catch {
      setExportSuccess(null);
    } finally {
      setExportLoading(false);
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

  const handleDeploy = async () => {
    if (!builtProjectId || deploying) return;
    setDeploying(true);
    setDeployUrl(null);
    try {
      const res = await post<{ url: string; status: string }>(
        `/projects/${builtProjectId}/deploy`,
        {}
      );
      if (res?.url) {
        const fullUrl = res.url.startsWith("http")
          ? res.url
          : `${window.location.origin}${res.url}`;
        setDeployUrl(fullUrl);
      }
    } catch (err: any) {
      setError(err?.detail || "Deploy failed. Please try again.");
    } finally {
      setDeploying(false);
    }
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
          {builtProjectId && (
            <button
              onClick={() => {
                setPreviewTab("history");
                loadVersions();
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                previewTab === "history" ? "bg-gray-100 text-black" : "text-gray-500 hover:text-black"
              }`}
            >
              <span className="flex items-center gap-1">
                <History className="h-3 w-3" />
                History
              </span>
            </button>
          )}
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
          {builtSpec && (
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                editMode
                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                  : "text-gray-400 hover:bg-gray-100 hover:text-black"
              }`}
              title={editMode ? "Exit visual editor" : "Edit visually"}
            >
              <Pencil className="h-3.5 w-3.5" />
              {editMode ? "Editing" : "Edit"}
            </button>
          )}
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
          {builtSpec && builtProjectId && isDev && (
            <>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Deploy to live URL"
              >
                {deploying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Rocket className="h-3.5 w-3.5" />
                )}
                {deploying ? "Deploying..." : "Deploy"}
              </button>
              {deployUrl && (
                <a
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 px-2.5 py-1.5 text-[11px] font-medium text-green-700 transition hover:bg-green-100"
                  title="Open deployed app"
                >
                  <ExternalLink className="h-3 w-3" />
                  Live
                </a>
              )}
            </>
          )}
          {builtSpec && builtProjectId && isDev && (
            <button
              onClick={() => {
                setExportRepoName(builtSpec?.app_name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "my-app");
                setExportModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-black transition hover:bg-gray-50"
              title="Export as GitHub project"
            >
              <Upload className="h-3.5 w-3.5" />
              Export
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
              {builtSpec && editMode ? (
                <VisualEditor
                  spec={builtSpec}
                  device={previewDevice}
                  onSpecUpdate={(updatedSpec) => setBuiltSpec(updatedSpec)}
                />
              ) : builtSpec ? (
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
        ) : previewTab === "code" ? (
          <div className="h-full w-full overflow-auto rounded-xl border border-gray-200 bg-gray-900 p-4">
            <pre className="text-xs text-green-400">
              <code>
                {builtSpec
                  ? JSON.stringify(builtSpec, null, 2)
                  : `// Generated spec will appear here\n// Keep chatting to refine your app\n\n// Model: ${selectedModel.label}\n// Session: ${activeChatId || "new"}`}
              </code>
            </pre>
          </div>
        ) : previewTab === "history" ? (
          <div className="h-full w-full overflow-auto rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold text-black">Version History</h3>
            {versionsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <History className="mb-3 h-8 w-8 text-gray-300" />
                <p className="text-sm text-gray-500">No versions yet</p>
                <p className="mt-1 text-xs text-gray-400">
                  Versions are created each time your spec is generated or refined.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                          v{v.version_number}
                        </span>
                        <span className="truncate text-xs font-medium text-black">
                          {v.change_description || `Version ${v.version_number}`}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {new Date(v.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="ml-2 flex items-center gap-1">
                      <button
                        onClick={() => previewVersion(v.id)}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200 hover:text-black"
                        title="Preview this version"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => restoreVersion(v.id)}
                        disabled={restoringVersionId === v.id}
                        className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200 hover:text-black disabled:opacity-50"
                        title="Restore this version"
                      >
                        {restoringVersionId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedVersionSpec && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-blue-700">Version Preview</p>
                  <button
                    onClick={() => setSelectedVersionSpec(null)}
                    className="text-blue-400 hover:text-blue-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <pre className="max-h-60 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">
                  {JSON.stringify(selectedVersionSpec, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Export Modal */}
      {exportModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[360px] rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-black">Export Project</h3>
              <button
                onClick={() => {
                  setExportModalOpen(false);
                  setExportSuccess(null);
                  setExportRepoName("");
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-black"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {exportSuccess ? (
              <div className="rounded-lg bg-green-50 p-3 text-center">
                <Check className="mx-auto mb-2 h-6 w-6 text-green-500" />
                <p className="text-sm font-medium text-green-700">Downloaded!</p>
                <p className="mt-1 text-xs text-green-600">{exportSuccess}.zip</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">
                    Project name
                  </label>
                  <input
                    type="text"
                    value={exportRepoName}
                    onChange={(e) => setExportRepoName(e.target.value)}
                    placeholder="my-app"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleExport();
                    }}
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Downloads the full generated codebase as a zip file.
                  </p>
                </div>
                <button
                  onClick={handleExport}
                  disabled={!exportRepoName.trim() || exportLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {exportLoading ? "Exporting..." : "Export & Download"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
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
          <div className="flex flex-1 flex-col overflow-y-auto p-6">
            <div className="mx-auto w-full max-w-3xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-black">My Projects</h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    All your chats and builds in one place.
                  </p>
                </div>
                <button
                  onClick={() => handleSidebarClick("chat")}
                  className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
                >
                  <Plus className="h-4 w-4" />
                  New Project
                </button>
              </div>

              {chatSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <FolderOpen className="mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm font-medium text-black">No projects yet</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Start a conversation to build your first project.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {chatSessions.map((session) => {
                    const isBuilt = !!session.spec;
                    const isDeployed = !!session.deployUrl;
                    const modelInfo = MODELS.find((m) => m.id === session.model);
                    const date = new Date(session.createdAt);
                    const timeAgo = getTimeAgo(date);

                    return (
                      <button
                        key={session.id}
                        onClick={() => loadChat(session)}
                        className={`flex w-full items-start gap-4 rounded-xl border bg-white px-4 py-3.5 text-left transition hover:shadow-sm ${
                          activeChatId === session.id
                            ? "border-black shadow-sm"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        {/* Icon */}
                        <div
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isBuilt ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                          }`}
                        >
                          {isBuilt ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <MessageSquare className="h-4 w-4" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-black">
                            {session.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[11px] text-gray-400">
                              {modelInfo?.label || session.model}
                            </span>
                            <span className="text-[11px] text-gray-300">·</span>
                            <span className="text-[11px] text-gray-400">{timeAgo}</span>
                            <span className="text-[11px] text-gray-300">·</span>
                            <span className="text-[11px] text-gray-400">
                              {session.messages.length} messages
                            </span>
                          </div>
                        </div>

                        {/* Status badges */}
                        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                          {isDeployed && (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                              Live
                            </span>
                          )}
                          {isBuilt && !isDeployed && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                              Built
                            </span>
                          )}
                          {!isBuilt && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              In Progress
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
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
              <div className="w-full max-w-2xl flex-1 px-4 pt-12">
                {/* Hero */}
                <div className="mb-10 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-black">
                    <span className="text-lg font-bold text-white">i</span>
                  </div>
                  <h1 className="text-2xl font-semibold text-black">
                    What do you want to build?
                  </h1>
                  <p className="mt-2 text-sm text-gray-400">
                    Describe your idea and {selectedModel.label} will bring it to life.
                  </p>
                </div>

                {/* Starter prompts */}
                <div className="mb-8 grid grid-cols-2 gap-2">
                  {[
                    { icon: "🏢", text: "A CRM to manage leads and deals", detail: "Sales pipeline, contacts, analytics" },
                    { icon: "📋", text: "A project management tool", detail: "Tasks, boards, timelines, team view" },
                    { icon: "🛒", text: "An e-commerce dashboard", detail: "Products, orders, customers, inventory" },
                    { icon: "📊", text: "A finance tracker for my business", detail: "Invoices, expenses, reports, clients" },
                  ].map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setPrompt(s.text);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:shadow-sm"
                    >
                      <span className="mt-0.5 text-lg">{s.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-black group-hover:text-black">{s.text}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">{s.detail}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Feature highlights */}
                <div className="mb-6 grid grid-cols-3 gap-3">
                  {[
                    { icon: "⚡", title: "Instant Preview", desc: "See your app come to life in real time" },
                    { icon: "🎨", title: "Visual Editor", desc: "Click any element to customize it" },
                    { icon: "🚀", title: "One-Click Deploy", desc: "Go live with a single click" },
                  ].map((f, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3 text-center"
                    >
                      <span className="text-lg">{f.icon}</span>
                      <p className="mt-1.5 text-xs font-medium text-black">{f.title}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">{f.desc}</p>
                    </div>
                  ))}
                </div>

                {/* Recent projects quick access */}
                {chatSessions.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-2 text-xs font-medium text-gray-400">Continue where you left off</p>
                    <div className="flex flex-wrap gap-2">
                      {chatSessions.slice(0, 3).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => loadChat(s)}
                          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 transition hover:border-gray-300 hover:text-black"
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span className="max-w-[150px] truncate">{s.title}</span>
                          {s.spec && <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[9px] font-medium text-green-600">Built</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input area */}
            <div className="bg-white px-4 pb-6 pt-2">
              <div className="mx-auto w-full max-w-2xl">
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition focus-within:border-gray-300 focus-within:shadow-md">
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
                  <div className="flex items-center justify-between px-3 pb-2">
                    <div className="flex items-center gap-1">
                      <span className="rounded-md bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-400">
                        {selectedModel.label}
                      </span>
                    </div>
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
    <div className="flex h-screen bg-white dark:bg-gray-950 dark:text-gray-100">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 transition-transform duration-200 lg:static lg:z-auto ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden lg:border-0"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
              <span className="text-xs font-bold text-white">i</span>
            </div>
            <span className="text-sm font-semibold text-black">isibi.ai</span>
          </div>
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-3 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              New Project
            </button>
          </div>
        )}

        {/* Chat sessions list */}
        {isDev && chatSessions.length > 0 && (
          <div className="border-b border-gray-200 px-2 pb-2">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Projects
            </p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {chatSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => loadChat(session)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                    activeChatId === session.id
                      ? "bg-white font-medium text-black shadow-sm"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <div className={`h-2 w-2 shrink-0 rounded-full ${
                    session.deployUrl ? "bg-green-500" : session.spec ? "bg-blue-500" : "bg-amber-400"
                  }`} />
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
      <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-950">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Menu className="h-4 w-4 text-gray-600 dark:text-gray-400" />
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

          {/* Top bar right actions */}
          <div className="flex items-center gap-1">
            {/* Keyboard shortcuts button */}
            <button
              onClick={() => setShortcutsOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100 dark:hover:bg-gray-800"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-yellow-400" />
              ) : (
                <Moon className="h-4 w-4 text-gray-500" />
              )}
            </button>

          {/* Profile menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 transition hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <User className="h-4 w-4 text-gray-600 dark:text-gray-400" />
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
        </div>

        {/* View content */}
        {renderContent()}
      </div>

      {/* Keyboard shortcuts modal */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="w-[400px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-black dark:text-white">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShortcutsOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {[
                { keys: ["\u2318", "Enter"], desc: "Submit chat message" },
                { keys: ["\u2318", "K"], desc: "Focus chat input" },
                { keys: ["\u2318", "N"], desc: "New chat" },
                { keys: ["\u2318", "D"], desc: "Toggle dark mode" },
                { keys: ["\u2318", "."], desc: "Toggle sidebar" },
                { keys: ["\u2318", "/"], desc: "Show this help" },
                { keys: ["?"], desc: "Show this help" },
                { keys: ["Esc"], desc: "Close modal" },
              ].map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-300">{s.desc}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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

function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
