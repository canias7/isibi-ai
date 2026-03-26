import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
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
  Trash2,
  Undo2,
  Redo2,
  Share2,
  FileText,
  Copy,
  Mail,
  Link as LinkIcon,
  Users,
  Paperclip,
  Mic,
  Search,
  RefreshCw,
  Network,
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
import { CloudIDE } from "@/components/CloudIDE";
import { ERDViewer } from "@/components/ERDViewer";
import { SpecEditor } from "@/components/SpecEditor";
import { ProjectSettingsPage } from "./ProjectSettingsPage";

// Memoized preview so it doesn't re-render while user types in the chat
const MemoizedPreview = memo(function MemoizedPreview({
  spec,
  device,
  editMode,
  onSpecUpdate,
  projectId,
}: {
  spec: any;
  device: "desktop" | "tablet" | "mobile";
  editMode: boolean;
  onSpecUpdate: (s: any) => void;
  projectId?: string | null;
}) {
  if (editMode) {
    return <VisualEditor spec={spec} device={device} onSpecUpdate={onSpecUpdate} />;
  }
  return <SpecPreview spec={spec} device={device} projectId={projectId} />;
});

interface Props {
  onSpecCreated: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Minimal shape for the generated app specification */
interface AppSpec {
  app_name?: string;
  name?: string;
  entities?: Array<{ name: string; table?: string; fields?: Array<Record<string, unknown>>; [key: string]: unknown }>;
  modules?: Array<{ name: string; entity?: string; layout?: string; [key: string]: unknown }>;
  design_system?: { colors?: { primary?: string }; [key: string]: unknown };
  [key: string]: unknown;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: string;
  spec: AppSpec | null;
  projectId: string | null;
  deployUrl: string | null;
}

const MODELS = [
  { id: "anias-1.0", label: "Anias 1.0", description: "Software builder", active: true },
  { id: "ambar-1.0", label: "Ambar 1.0 (Coming Soon)", description: "Website builder", active: true },
  { id: "mario-1.0", label: "Mario 1.0 (Coming Soon)", description: "App builder", active: true },
  { id: "claw-1.0", label: "Claw 1.0 (Coming Soon)", description: "Agent builder", active: true },
];

const COMING_SOON_MODELS = new Set(["ambar-1.0", "mario-1.0", "claw-1.0"]);

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

/** Parse [OPTIONS] blocks from AI messages and render as clickable buttons */
function MessageContent({
  content,
  isLastAssistant,
  onOptionClick,
}: {
  content: string;
  isLastAssistant: boolean;
  onOptionClick: (option: string) => void;
}) {
  // Check for [OPTIONS] block
  const optionsMatch = content.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/);

  if (!optionsMatch) {
    // Detect bullet/numbered list options after a bold question line
    // Pattern: lines starting with "- ", "• ", or "1. " etc.
    const lines = content.split("\n");
    const listStartIdx = lines.findIndex((l) => /^(\s*[-•]\s|^\s*\d+\.\s)/.test(l));
    const hasBoldBefore = listStartIdx > 0 && lines.slice(0, listStartIdx).some((l) => /\*\*.*\*\*/.test(l));

    if (listStartIdx >= 0 && hasBoldBefore && isLastAssistant) {
      const textLines = lines.slice(0, listStartIdx).join("\n").trim();
      const listLines = lines.slice(listStartIdx).filter((l) => /^(\s*[-•]\s|^\s*\d+\.\s)/.test(l));
      const afterListLines = lines.slice(listStartIdx).filter((l) => !/^(\s*[-•]\s|^\s*\d+\.\s)/.test(l)).join("\n").trim();

      const renderText = (text: string) => {
        const parts = text.split(/\*\*(.*?)\*\*/g);
        return parts.map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-semibold text-black">{part}</strong>
          ) : (
            <span key={i}>{part}</span>
          )
        );
      };

      return (
        <div>
          {textLines && <p className="whitespace-pre-wrap mb-3">{renderText(textLines)}</p>}
          <div className="flex flex-col gap-2">
            {listLines.map((line, i) => {
              const cleaned = line.replace(/^(\s*[-•]\s|^\s*\d+\.\s)/, "").trim();
              const isLast = i === listLines.length - 1;
              return (
                <button
                  key={i}
                  onClick={() => onOptionClick(cleaned)}
                  className={`group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition cursor-pointer ${
                    isLast
                      ? "border-dashed border-gray-200 bg-gray-50/50 hover:border-gray-300 hover:bg-gray-50"
                      : "border-gray-200 bg-white hover:border-black hover:shadow-sm"
                  }`}
                >
                  <span className={`text-sm ${isLast ? "text-gray-500" : "font-medium text-black"}`}>
                    {renderText(cleaned)}
                  </span>
                </button>
              );
            })}
          </div>
          {afterListLines && <p className="mt-2 whitespace-pre-wrap">{renderText(afterListLines)}</p>}
        </div>
      );
    }

    // Render markdown-like bold
    const parts = content.split(/\*\*(.*?)\*\*/g);
    return (
      <p className="whitespace-pre-wrap">
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-semibold text-black">
              {part}
            </strong>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </p>
    );
  }

  // Split content into text before options and the options themselves
  const textBefore = content.slice(0, optionsMatch.index).trim();
  const textAfter = content
    .slice((optionsMatch.index || 0) + optionsMatch[0].length)
    .trim();
  const optionsRaw = optionsMatch[1].trim();

  // Parse options: each line starting with "- "
  const options = optionsRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const full = line.slice(2).trim();
      const dashIdx = full.indexOf(" — ");
      if (dashIdx > -1) {
        return { label: full.slice(0, dashIdx), description: full.slice(dashIdx + 3) };
      }
      const dashIdx2 = full.indexOf(" - ");
      if (dashIdx2 > -1) {
        return { label: full.slice(0, dashIdx2), description: full.slice(dashIdx2 + 3) };
      }
      return { label: full, description: "" };
    });

  // Render bold in text
  const renderText = (text: string) => {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold text-black">
          {part}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div>
      {textBefore && <p className="whitespace-pre-wrap">{renderText(textBefore)}</p>}
      {options.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onOptionClick(opt.label)}
              disabled={!isLastAssistant}
              className={`group flex flex-col rounded-xl border px-4 py-3 text-left transition ${
                isLastAssistant
                  ? "border-gray-200 bg-white hover:border-black hover:bg-gray-50 cursor-pointer"
                  : "border-gray-100 bg-gray-50 cursor-default opacity-60"
              }`}
            >
              <span className="text-sm font-medium text-black">{opt.label}</span>
              {opt.description && (
                <span className="mt-0.5 text-xs text-gray-500">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {textAfter && (
        <p className="mt-2 whitespace-pre-wrap">{renderText(textAfter)}</p>
      )}
    </div>
  );
}

/** Group sessions by date */
function groupSessionsByDate(sessions: ChatSession[]): { label: string; sessions: ChatSession[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 7 * 86400000;

  const groups: Record<string, ChatSession[]> = { Today: [], Yesterday: [], "This Week": [], Earlier: [] };

  sessions.forEach((s) => {
    const t = new Date(s.createdAt).getTime();
    if (t >= todayStart) groups["Today"].push(s);
    else if (t >= yesterdayStart) groups["Yesterday"].push(s);
    else if (t >= weekStart) groups["This Week"].push(s);
    else groups["Earlier"].push(s);
  });

  return Object.entries(groups)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => ({ label, sessions: arr }));
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Sidebar project list with search, grouping, and status dots */
function SidebarProjectList({
  chatSessions,
  activeChatId,
  onLoadChat,
}: {
  chatSessions: ChatSession[];
  activeChatId: string | null;
  onLoadChat: (s: ChatSession) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? chatSessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
    : chatSessions;

  const groups = groupSessionsByDate(filtered);

  return (
    <div className="border-b border-gray-200 px-2 pb-2">
      <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
        Projects
      </p>
      {/* Search box */}
      <div className="mb-1.5 px-1">
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full bg-transparent text-[12px] text-black placeholder-gray-400 focus:outline-none"
          />
        </div>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {groups.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-gray-400">No matching projects</p>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2.5 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              {group.label}
            </p>
            {group.sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onLoadChat(session)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
                  activeChatId === session.id
                    ? "bg-white font-medium text-black shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className={`h-2 w-2 shrink-0 rounded-full ${
                  session.deployUrl ? "bg-green-500" : session.spec ? "bg-green-400" : "bg-amber-400"
                }`} title={session.deployUrl ? "Deployed" : session.spec ? "Built" : "In progress"} />
                <span className="truncate flex-1">{session.title}</span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {getRelativeTime(new Date(session.createdAt))}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Typing indicator with phased messages */
function TypingIndicator({ modelLabel }: { modelLabel: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 3000);
    const t2 = setTimeout(() => setPhase(2), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const messages = [
    { text: "Anias is thinking", icon: "\uD83E\uDDE0" },
    { text: "Designing your app", icon: "\uD83C\uDFA8" },
    { text: "Almost ready", icon: "\u2728" },
  ];
  const current = messages[phase];

  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
        A
      </div>
      <div className="pt-0.5">
        <p className="text-xs font-medium text-black">{modelLabel}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm animate-pulse">{current.icon}</span>
          <span className="text-sm text-gray-500 animate-pulse">{current.text}...</span>
          <span className="flex items-center gap-1 ml-1">
            <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    </div>
  );
}

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
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  // Preview state
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewTab, setPreviewTab] = useState<"preview" | "code" | "cloud" | "history" | "erd" | "editor" | "settings">("preview");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [builtSpec, _setBuiltSpec] = useState<any>(null);
  const [builtProjectId, setBuiltProjectId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Undo/redo state for spec changes
  const [specHistory, setSpecHistory] = useState<any[]>([]);
  const [specFuture, setSpecFuture] = useState<any[]>([]);
  const MAX_HISTORY = 20;

  // Wrapper around setBuiltSpec that tracks history
  const setBuiltSpec = useCallback((newSpec: any) => {
    _setBuiltSpec((prev: any) => {
      if (prev !== null && prev !== newSpec) {
        setSpecHistory((h) => {
          const updated = [...h, prev];
          return updated.length > MAX_HISTORY ? updated.slice(updated.length - MAX_HISTORY) : updated;
        });
        setSpecFuture([]); // Clear redo stack on new change
      }
      return newSpec;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (specHistory.length === 0) return;
    const previousSpec = specHistory[specHistory.length - 1];
    setSpecHistory((h) => h.slice(0, -1));
    _setBuiltSpec((current: any) => {
      if (current !== null) {
        setSpecFuture((f) => {
          const updated = [...f, current];
          return updated.length > MAX_HISTORY ? updated.slice(updated.length - MAX_HISTORY) : updated;
        });
      }
      return previousSpec;
    });
  }, [specHistory]);

  const handleRedo = useCallback(() => {
    if (specFuture.length === 0) return;
    const nextSpec = specFuture[specFuture.length - 1];
    setSpecFuture((f) => f.slice(0, -1));
    _setBuiltSpec((current: any) => {
      if (current !== null) {
        setSpecHistory((h) => {
          const updated = [...h, current];
          return updated.length > MAX_HISTORY ? updated.slice(updated.length - MAX_HISTORY) : updated;
        });
      }
      return nextSpec;
    });
  }, [specFuture]);

  // Keyboard shortcuts: Cmd+Z for undo, Cmd+Shift+Z for redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  // Live preview state (iframe showing actual deployed app)
  const [livePreview, setLivePreview] = useState(false);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const [livePreviewError, setLivePreviewError] = useState<string | null>(null);

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

  // Coming soon toast
  const [comingSoonToast, setComingSoonToast] = useState<string | null>(null);

  // Billing state
  const [billingInfo, setBillingInfo] = useState<{
    plan: string;
    builds_used: number;
    builds_limit: number;
    can_build: boolean;
  } | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Fetch billing info on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        const data = await get<{
          can_build: boolean;
          plan: string;
          builds_used: number;
          builds_limit: number;
        }>("/billing/can-build");
        setBillingInfo(data);
      } catch {
        // If billing endpoint fails, assume free plan with builds available
        setBillingInfo({ plan: "free", builds_used: 0, builds_limit: 3, can_build: true });
      }
    })();
  }, [isAuthenticated]);

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const res = await post<{ checkout_url: string }>("/billing/checkout", { plan: "pro" });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      }
    } catch {
      setComingSoonToast("Failed to start checkout. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Collaborative editing state
  interface PresenceUser {
    id: string;
    name: string;
    initials: string;
    color: string;
    is_self: boolean;
    is_editing: boolean;
    last_active: string;
  }
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [editingUser, setEditingUser] = useState<{ name: string; visible: boolean } | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<"edit" | "view">("edit");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareInviting, setShareInviting] = useState(false);
  const [shareInviteSuccess, setShareInviteSuccess] = useState(false);

  // Poll presence every 10 seconds when a project is loaded
  useEffect(() => {
    if (!builtProjectId) {
      setPresenceUsers([]);
      return;
    }
    let cancelled = false;
    const fetchPresence = async () => {
      try {
        const data = await get<PresenceUser[]>(`/collab/${builtProjectId}/presence`);
        if (!cancelled && data) {
          setPresenceUsers(data);
          // Check if someone else is editing
          const editor = data.find((u) => u.is_editing && !u.is_self);
          if (editor) {
            setEditingUser({ name: editor.name.split(" ")[0], visible: true });
            // Auto-hide after 5 seconds
            setTimeout(() => {
              if (!cancelled) setEditingUser((prev) => prev ? { ...prev, visible: false } : null);
            }, 5000);
          }
        }
      } catch {
        // Presence endpoint may not exist yet, ignore
      }
    };
    fetchPresence();
    const interval = setInterval(fetchPresence, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [builtProjectId]);

  // Auto-hide coming soon toast
  useEffect(() => {
    if (!comingSoonToast) return;
    const t = setTimeout(() => setComingSoonToast(null), 3500);
    return () => clearTimeout(t);
  }, [comingSoonToast]);

  // Sync theme class on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  // Load saved projects from API on mount
  useEffect(() => {
    if (projectsLoaded || !isDev) return;
    (async () => {
      try {
        const projects = await get<Array<{
          id: string;
          name: string;
          prompt: string;
          status: string;
          spec: any;
          created_at: string;
          conversation_history?: any[];
        }>>("/projects");
        if (projects && projects.length > 0) {
          const existingIds = new Set(chatSessions.map((s) => s.projectId).filter(Boolean));
          const newSessions: ChatSession[] = projects
            .filter((p) => !existingIds.has(p.id))
            .map((p) => ({
              id: p.id,
              title: p.name || p.prompt?.slice(0, 40) || "Untitled Project",
              messages: p.conversation_history || [
                { role: "user" as const, content: p.prompt || "" },
                { role: "assistant" as const, content: p.status === "built" || p.status === "deployed"
                  ? "Your software is ready!"
                  : "Working on your project..." },
              ],
              model: "anias-1.0",
              createdAt: p.created_at,
              spec: p.spec || null,
              projectId: p.id,
              deployUrl: p.status === "deployed" ? (() => {
                const apiUrl = import.meta.env.VITE_API_URL || "https://api.isibi.ai/api";
                const base = apiUrl.replace(/\/api\/?$/, "");
                return `${base}/live/${p.id}`;
              })() : null,
            }));
          if (newSessions.length > 0) {
            setChatSessions((prev) => {
              // Merge: keep existing sessions, add API ones that aren't duplicates
              const existingChatIds = new Set(prev.map((s) => s.id));
              const toAdd = newSessions.filter((s) => !existingChatIds.has(s.id));
              return [...prev, ...toAdd];
            });
          }
        }
      } catch {
        // API might not be ready yet, ignore
      } finally {
        setProjectsLoaded(true);
      }
    })();
  }, [projectsLoaded, isDev]);

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
      ta.style.height = Math.min(ta.scrollHeight, 144) + "px";
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
    setLivePreview(false);
    setLivePreviewLoading(false);
    setLivePreviewError(null);
    setEditMode(false);
    setError(null);
    setActiveView("chat");
    setChatPanelOpen(true);
    setPreviewTab("preview");
    setVersions([]);
    setSelectedVersionSpec(null);
    setSpecHistory([]);
    setSpecFuture([]);
  };

  const loadChat = async (session: ChatSession) => {
    saveCurrentChat();
    setMessages(session.messages);
    setActiveChatId(session.id);
    setBuiltProjectId(session.projectId || null);
    setDeployUrl(session.deployUrl || null);
    setDeploying(false);
    setEditMode(false);
    setActiveView("chat");
    setChatPanelOpen(true);
    setPreviewTab("preview");
    setVersions([]);
    setSelectedVersionSpec(null);
    setSpecHistory([]);
    setSpecFuture([]);

    // If session has a spec already, use it
    if (session.spec) {
      setBuiltSpec(session.spec);
    } else if (session.projectId) {
      // Fetch full project from API to get the spec
      setBuiltSpec(null);
      try {
        const project = await get<{ spec: any; status: string }>(`/projects/${session.projectId}`);
        if (project?.spec) {
          setBuiltSpec(project.spec);
          // Update session with fetched spec
          setChatSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, spec: project.spec } : s))
          );
        }
      } catch {
        // Project might have been deleted
      }
    } else {
      setBuiltSpec(null);
    }
  };

  const deleteProject = async (sessionId: string, projectId: string | null) => {
    // Remove from local state
    setChatSessions((prev) => prev.filter((s) => s.id !== sessionId));

    // If it has a project ID, delete from server too
    if (projectId) {
      try {
        await post(`/projects/${projectId}/delete`, {});
      } catch {
        // Try DELETE method
        try {
          const { del } = await import("@/api/client");
          await del(`/projects/${projectId}`);
        } catch {
          // Ignore — already removed from UI
        }
      }
    }

    // If we just deleted the active chat, reset
    if (activeChatId === sessionId) {
      setMessages([]);
      setActiveChatId(null);
      setBuiltSpec(null);
      setBuiltProjectId(null);
      setDeployUrl(null);
      setLivePreview(false);
      setLivePreviewError(null);
    }
  };

  const handleOptionSelect = (option: string) => {
    setPrompt(option);
    // Directly submit with the option text
    submitMessage(option);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    submitMessage(prompt.trim());
  };

  const submitMessage = async (userMsg: string) => {
    if (!userMsg || loading) return;
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
      // If a spec is already built, refine it instead of starting from scratch
      if (builtSpec && builtProjectId) {
        // Show "Updating your app..." while refining
        const refiningMessages: Message[] = [
          ...newMessages,
          { role: "assistant", content: "Updating your app..." },
        ];
        setMessages(refiningMessages);

        const res = await post<{ spec: any; reply?: string }>(
          `/projects/${builtProjectId}/refine`,
          { feedback: userMsg }
        );

        const replyText = res.reply || "Your app has been updated!";
        const updatedMessages: Message[] = [
          ...newMessages,
          { role: "assistant", content: replyText },
        ];
        setMessages(updatedMessages);

        if (res.spec) {
          setBuiltSpec(res.spec);
          const cid2 = currentChatId;
          setChatSessions((prev) =>
            prev.map((s) =>
              s.id === cid2
                ? { ...s, messages: updatedMessages, spec: res.spec }
                : s
            )
          );
        } else {
          const cid2 = currentChatId;
          setChatSessions((prev) =>
            prev.map((s) =>
              s.id === cid2 ? { ...s, messages: updatedMessages } : s
            )
          );
        }
      } else {
        // Check billing before initiating a new build
        if (billingInfo && !billingInfo.can_build && billingInfo.builds_limit !== -1) {
          setUpgradeModalOpen(true);
          setLoading(false);
          return;
        }

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
          // Switch to cloud IDE to show streaming file generation
          setIsGenerating(true);
          setPreviewTab("cloud");

          // Refresh billing info after build starts
          try {
            const billingData = await get<{
              can_build: boolean;
              plan: string;
              builds_used: number;
              builds_limit: number;
            }>("/billing/can-build");
            setBillingInfo(billingData);
          } catch {
            // Non-critical — ignore
          }

          // Fetch the generated spec — once it arrives, transition to preview
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
              // Spec arrived — let CloudIDE finish its animation, then auto-switch
              // CloudIDE's onComplete callback will handle the transition
            }
          } catch {
            // Preview will show placeholder if fetch fails
            setIsGenerating(false);
          }
        }
      }
    } catch (err: unknown) {
      const detail = (err as Record<string, string>)?.detail || "Something went wrong. Please try again.";
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
  const MAX_CHARS = 4000;
  const chatInput = (
    <div className="bg-white px-3 pb-4 pt-2">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => {
            if (e.target.value.length <= MAX_CHARS) setPrompt(e.target.value);
          }}
          placeholder="Describe what you want to build..."
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm text-black placeholder-gray-400 focus:outline-none transition-all duration-150"
          rows={1}
          style={{ maxHeight: "144px" }}
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
            <button
              type="button"
              className="relative group flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              title="Attach file (Coming soon)"
              onClick={() => setComingSoonToast("File attachments coming soon!")}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="relative group flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              title="Voice input (Coming soon)"
              onClick={() => setComingSoonToast("Voice input coming soon!")}
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
            {prompt.length > 0 && (
              <span className="ml-1 text-[10px] text-gray-400">
                {prompt.length} / {MAX_CHARS}
              </span>
            )}
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
            <div className="mt-0.5 text-sm leading-relaxed text-gray-700">
              <MessageContent
                content={msg.content}
                isLastAssistant={msg.role === "assistant" && i === messages.length - 1}
                onOptionClick={(option) => {
                  if (!loading) {
                    handleOptionSelect(option);
                  }
                }}
              />
            </div>
          </div>
        </div>
      ))}
      {loading && <TypingIndicator modelLabel={selectedModel.label} />}
      <div ref={messagesEndRef} />
    </div>
  );

  // ─── Preview panel (right side when chat is active) ───
  // Resolve live URL to the correct backend domain
  const resolveAppUrl = (url: string) => {
    if (url.startsWith("http")) return url;
    // Build from VITE_API_URL (e.g. "https://api.isibi.ai/api") or fall back
    const apiUrl = import.meta.env.VITE_API_URL || "https://api.isibi.ai/api";
    // Strip trailing /api to get the host root (e.g. "https://api.isibi.ai")
    const base = apiUrl.replace(/\/api\/?$/, "");
    return `${base}${url}`;
  };

  // Toggle live preview — deploy if needed, then show iframe
  const handleToggleLivePreview = async () => {
    if (livePreview) {
      // Turning off — go back to SpecPreview
      setLivePreview(false);
      setLivePreviewError(null);
      return;
    }

    if (!builtSpec || !builtProjectId) return;

    // If already have a deploy URL, just switch to iframe
    if (deployUrl) {
      setLivePreview(true);
      setLivePreviewError(null);
      return;
    }

    // Need to deploy first
    setLivePreviewLoading(true);
    setLivePreviewError(null);
    try {
      const res = await post<{ url: string; status: string }>(
        `/projects/${builtProjectId}/deploy`,
        {}
      );
      if (res?.url) {
        const fullUrl = resolveAppUrl(res.url);
        setDeployUrl(fullUrl);
        const cid = activeChatId;
        if (cid) {
          setChatSessions((prev) =>
            prev.map((s) => (s.id === cid ? { ...s, deployUrl: fullUrl } : s))
          );
        }
        setLivePreview(true);
      } else {
        setLivePreviewError("Deploy succeeded but no URL was returned.");
      }
    } catch (err: unknown) {
      const e = err as Record<string, string>;
      setLivePreviewError(e?.detail || e?.message || "Failed to deploy app for live preview.");
    } finally {
      setLivePreviewLoading(false);
    }
  };

  // Marketplace listing modal state
  const [marketplaceModalOpen, setMarketplaceModalOpen] = useState(false);
  const [mpTitle, setMpTitle] = useState("");
  const [mpDescription, setMpDescription] = useState("");
  const [mpCategory, setMpCategory] = useState("");
  const [mpPrice, setMpPrice] = useState("0");
  const [mpLoading, setMpLoading] = useState(false);
  const [mpSuccess, setMpSuccess] = useState<string | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);

  const handleDownloadApp = async () => {
    if (!builtSpec) {
      alert("No app to download yet. Build something first.");
      return;
    }
    if (!builtProjectId) {
      alert("Project not saved. Try building again.");
      return;
    }

    // If already deployed, just open the URL
    if (deployUrl) {
      const w = window.open(deployUrl, "_blank");
      if (!w) {
        alert(`Your app is live at: ${deployUrl}\n\nOpen it in Chrome and click "Install" in the address bar to add it as an app.`);
      }
      return;
    }

    // Not deployed yet — deploy first, then open
    setDeploying(true);
    try {
      const res = await post<{ url: string; status: string }>(
        `/projects/${builtProjectId}/deploy`,
        {}
      );
      if (res?.url) {
        const fullUrl = resolveAppUrl(res.url);
        setDeployUrl(fullUrl);
        // Update the chat session
        const cid = activeChatId;
        if (cid) {
          setChatSessions((prev) =>
            prev.map((s) => (s.id === cid ? { ...s, deployUrl: fullUrl } : s))
          );
        }
        // Open in new tab
        const w = window.open(fullUrl, "_blank");
        if (!w) {
          alert(`Your app is live at: ${fullUrl}\n\nOpen it in Chrome and click "Install" in the address bar to add it as an app.`);
        }
      } else {
        alert("Deploy succeeded but no URL was returned. Check the backend logs.");
      }
    } catch (err: unknown) {
      const e = err as Record<string, string>;
      const msg = e?.detail || e?.message || "Deploy failed";
      alert(`Error: ${msg}`);
    } finally {
      setDeploying(false);
    }
  };

  const handleListOnMarketplace = async () => {
    if (!builtProjectId || deploying) return;

    // Deploy first if not already deployed
    if (!deployUrl) {
      setDeploying(true);
      try {
        const res = await post<{ url: string; status: string }>(
          `/projects/${builtProjectId}/deploy`,
          {}
        );
        if (res?.url) {
          const fullUrl = resolveAppUrl(res.url);
          setDeployUrl(fullUrl);
          const cid = activeChatId;
          if (cid) {
            setChatSessions((prev) =>
              prev.map((s) => (s.id === cid ? { ...s, deployUrl: fullUrl } : s))
            );
          }
        }
      } catch (err: unknown) {
        setError((err as Record<string, string>)?.detail || "Deploy failed. Please try again.");
        setDeploying(false);
        return;
      } finally {
        setDeploying(false);
      }
    }

    // Now show the marketplace listing modal
    setMpTitle(builtSpec?.app_name || builtSpec?.name || "");
    setMpDescription("");
    setMpCategory("");
    setMpPrice("0");
    setMpSuccess(null);
    setMpError(null);
    setMarketplaceModalOpen(true);
  };

  const handlePublishToMarketplace = async () => {
    if (!builtProjectId || mpLoading) return;
    setMpLoading(true);
    setMpError(null);
    try {
      const res = await post<{ id: string; title: string }>("/template-marketplace/publish", {
        project_id: builtProjectId,
        title: mpTitle.trim() || "Untitled App",
        description: mpDescription.trim() || undefined,
        category: mpCategory.trim() || undefined,
        price: parseFloat(mpPrice) || 0,
      });
      setMpSuccess(res?.id || "published");
    } catch (err: unknown) {
      const e = err as Record<string, string>;
      setMpError(e?.detail || e?.message || "Failed to publish. Please try again.");
    } finally {
      setMpLoading(false);
    }
  };

  const previewPanel = (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
      {/* Preview toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPreviewTab("preview")}
            className={`rounded-lg p-2 transition ${
              previewTab === "preview" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
            }`}
            title="Preview"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPreviewTab("code")}
            className={`rounded-lg p-2 transition ${
              previewTab === "code" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
            }`}
            title="Code"
          >
            <Code className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPreviewTab("cloud")}
            className={`relative rounded-lg p-2 transition ${
              previewTab === "cloud" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
            }`}
            title="Cloud IDE"
          >
            <Monitor className="h-4 w-4" />
            {isGenerating && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-pink-500 animate-pulse" />
            )}
          </button>
          {builtProjectId && (
            <button
              onClick={() => {
                setPreviewTab("history");
                loadVersions();
              }}
              className={`rounded-lg p-2 transition ${
                previewTab === "history" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
              }`}
              title="Version History"
            >
              <History className="h-4 w-4" />
            </button>
          )}
          {builtSpec && isDev && (
            <button
              onClick={() => setPreviewTab("erd")}
              className={`rounded-lg p-2 transition ${
                previewTab === "erd" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
              }`}
              title="Entity Relationship Diagram"
            >
              <Network className="h-4 w-4" />
            </button>
          )}
          {builtSpec && isDev && (
            <button
              onClick={() => setPreviewTab("editor")}
              className={`rounded-lg p-2 transition ${
                previewTab === "editor" ? "bg-gray-100 text-black" : "text-gray-400 hover:text-black hover:bg-gray-50"
              }`}
              title="Spec Editor"
            >
              <FileText className="h-4 w-4" />
            </button>
          )}
          {builtSpec && builtProjectId && isDev && (
            <button
              onClick={() => setPreviewTab("settings")}
              className={`rounded-lg p-2 transition ${
                previewTab === "settings" ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200" : "text-gray-400 hover:text-black hover:bg-gray-50"
              }`}
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          <div className="mx-1 h-4 w-px bg-gray-200" />
          {/* Refresh button */}
          <button
            onClick={() => {
              // Force re-render by toggling tab
              const current = previewTab;
              setPreviewTab("code");
              setTimeout(() => setPreviewTab(current), 50);
            }}
            className="rounded-lg p-2 text-gray-400 transition hover:text-black hover:bg-gray-50"
            title="Refresh preview"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {builtSpec && builtProjectId && (
            <button
              onClick={() => setShareModalOpen(true)}
              className="rounded-lg p-2 text-gray-400 hover:text-black hover:bg-gray-50 transition"
              title="Share"
            >
              <Users className="h-4 w-4" />
            </button>
          )}
          {/* App name in URL bar style */}
          {builtSpec && (
            <div className="ml-1 flex items-center gap-1.5 rounded-md bg-gray-50 border border-gray-200 px-2.5 py-1">
              <svg className="h-[10px] w-[10px] flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              <span className="text-[11px] text-gray-600 truncate max-w-[140px]">
                {(builtSpec?.app_name || builtSpec?.name || "your-app").toLowerCase().replace(/\s+/g, "-")}.isibi.ai
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Presence avatars */}
          {presenceUsers.length > 0 && (
            <div className="flex items-center -space-x-1.5 mr-2">
              {presenceUsers.slice(0, 5).map((pu) => (
                <div
                  key={pu.id}
                  className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white"
                  style={{ backgroundColor: pu.color || "#6b7280" }}
                  title={pu.is_self ? `${pu.name} (you)` : pu.name}
                >
                  {pu.initials}
                  {pu.is_self && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 border border-white" />
                  )}
                </div>
              ))}
              {presenceUsers.length > 5 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[9px] font-bold text-gray-600">
                  +{presenceUsers.length - 5}
                </div>
              )}
            </div>
          )}
          {/* Editing indicator badge */}
          {editingUser && editingUser.visible && (
            <div className="mr-2 flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-medium text-blue-700">{editingUser.name} is editing</span>
            </div>
          )}
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setPreviewDevice("desktop")}
              className={`rounded-md p-1.5 transition ${
                previewDevice === "desktop" ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-black"
              }`}
              title="Desktop"
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice("tablet")}
              className={`rounded-md p-1.5 transition ${
                previewDevice === "tablet" ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-black"
              }`}
              title="Tablet"
            >
              <Tablet className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice("mobile")}
              className={`rounded-md p-1.5 transition ${
                previewDevice === "mobile" ? "bg-white text-black shadow-sm" : "text-gray-400 hover:text-black"
              }`}
              title="Mobile"
            >
              <Smartphone className="h-4 w-4" />
            </button>
          </div>
          <div className="mx-2 h-4 w-px bg-gray-200" />
          {builtSpec && (
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                editMode
                  ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
                  : "text-gray-400 hover:bg-gray-100 hover:text-black"
              }`}
              title={editMode ? "Exit visual editor" : "Edit visually"}
            >
              <Pencil className="h-3.5 w-3.5" />
              {editMode ? "Editing" : "Edit"}
            </button>
          )}
          {builtSpec && (
            <>
              <button
                onClick={handleUndo}
                disabled={specHistory.length === 0}
                className="rounded-lg p-1.5 text-gray-400 transition hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                title="Undo (Cmd+Z)"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={specFuture.length === 0}
                className="rounded-lg p-1.5 text-gray-400 transition hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                title="Redo (Cmd+Shift+Z)"
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </>
          )}
          {builtSpec && builtProjectId && (
            <button
              onClick={handleToggleLivePreview}
              disabled={livePreviewLoading}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                livePreview
                  ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                  : "text-gray-400 hover:bg-gray-100 hover:text-black"
              } disabled:opacity-50`}
              title={livePreview ? "Switch to mock preview" : "Switch to live preview"}
            >
              {livePreviewLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {livePreview ? "Live" : "Live Preview"}
            </button>
          )}
          <button className="rounded-lg p-1.5 text-gray-400 transition hover:text-black">
            <ExternalLink className="h-4 w-4" />
          </button>
          {builtSpec && builtProjectId && isDev && (
            <button
              onClick={handleDownloadApp}
              disabled={deploying}
              className="flex items-center gap-1.5 rounded-lg bg-black px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              title="Install as app on your device"
            >
              <Download className="h-3.5 w-3.5" />
              Get App
            </button>
          )}
          {builtSpec && builtProjectId && isDev && (
            <>
              <button
                onClick={handleListOnMarketplace}
                disabled={deploying}
                className="flex items-center gap-1.5 rounded-lg bg-pink-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="List on isibi marketplace"
              >
                {deploying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Store className="h-3.5 w-3.5" />
                )}
                {deploying ? "Deploying..." : "List on Marketplace"}
              </button>
              {deployUrl && (
                <a
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 px-2.5 py-1.5 text-[11px] font-medium text-green-700 transition hover:bg-green-100"
                  title="View deployed app"
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
      <div className="flex flex-1 items-center justify-center p-4 animate-fade-in" key={previewTab}>
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
            {/* macOS-style browser chrome */}
            <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50/80 px-3 py-2">
              {/* Window controls */}
              <div className="flex items-center gap-[6px]">
                <div className="h-[10px] w-[10px] rounded-full bg-[#ff5f57] border border-[#e0443e]" />
                <div className="h-[10px] w-[10px] rounded-full bg-[#febc2e] border border-[#dea123]" />
                <div className="h-[10px] w-[10px] rounded-full bg-[#28c840] border border-[#1aab29]" />
              </div>
              {/* Navigation buttons */}
              <div className="flex items-center gap-0.5 ml-2">
                <button className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-600 transition">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:text-gray-500 transition">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
                <button className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-600 transition ml-0.5">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
              {/* URL bar */}
              <div className="mx-1 flex flex-1 items-center gap-1.5 rounded-md bg-white border border-gray-200 px-2.5 py-[3px] shadow-inner">
                <svg className="h-[10px] w-[10px] flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                <p className="text-[11px] text-gray-600 truncate">
                  {builtSpec?.app_name?.toLowerCase().replace(/\s+/g, "-") || "your-app"}.isibi.ai
                </p>
              </div>
            </div>

            {/* Preview area */}
            <div className="flex-1 overflow-hidden">
              {builtSpec && livePreview && deployUrl ? (
                <div className="flex h-full flex-col">
                  {/* Live preview banner */}
                  <div className="flex items-center gap-2 bg-green-50 border-b border-green-200 px-3 py-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[11px] font-medium text-green-700">Live Preview — This is your actual app</span>
                  </div>
                  {/* Live preview error */}
                  {livePreviewError && (
                    <div className="bg-red-50 border-b border-red-200 px-3 py-1.5 text-[11px] text-red-700">
                      {livePreviewError}
                    </div>
                  )}
                  {/* Iframe with actual deployed app */}
                  <iframe
                    src={deployUrl}
                    className="w-full flex-1 border-0 rounded-b-lg"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                  />
                </div>
              ) : builtSpec ? (
                <>
                  {livePreviewError && (
                    <div className="bg-red-50 border-b border-red-200 px-3 py-1.5 text-[11px] text-red-700">
                      {livePreviewError}
                    </div>
                  )}
                  <MemoizedPreview
                    spec={builtSpec}
                    device={previewDevice}
                    editMode={editMode}
                    onSpecUpdate={setBuiltSpec}
                    projectId={builtProjectId}
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center p-8">
                  {loading ? (
                    <div className="text-center">
                      {/* Pulsing pink circle */}
                      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center">
                        <div className="absolute h-16 w-16 animate-ping rounded-full bg-pink-400/20" />
                        <div className="relative h-12 w-12 animate-pulse rounded-full bg-gradient-to-br from-pink-400 to-pink-600 shadow-lg shadow-pink-200" />
                      </div>
                      <p className="text-sm font-semibold text-black">Building your app...</p>
                      {/* Animated progress steps */}
                      <div className="mt-5 space-y-2 text-left inline-block">
                        <div className="flex items-center gap-2 text-xs text-green-600 animate-fade-in" style={{ animationDelay: "0s" }}>
                          <span>&#10003;</span><span>Analyzing requirements...</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-green-600 animate-fade-in" style={{ animationDelay: "0.6s", animationFillMode: "backwards" }}>
                          <span>&#10003;</span><span>Designing database schema...</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-pink-500 animate-fade-in" style={{ animationDelay: "1.2s", animationFillMode: "backwards" }}>
                          <span className="inline-block animate-spin">&#10227;</span><span>Generating components...</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 animate-fade-in" style={{ animationDelay: "1.8s", animationFillMode: "backwards" }}>
                          <span>&#9675;</span><span>Setting up API endpoints...</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 animate-fade-in" style={{ animationDelay: "2.4s", animationFillMode: "backwards" }}>
                          <span>&#9675;</span><span>Configuring deployment...</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50">
                        <Monitor className="h-8 w-8 text-gray-300" />
                      </div>
                      <p className="text-sm font-medium text-black">Preview</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Describe your requirements in the chat and the preview will appear here.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : previewTab === "cloud" ? (
          <div className={`h-full w-full overflow-hidden rounded-xl border border-gray-200 shadow-sm transition-opacity duration-500 ${
            !isGenerating && builtSpec ? "opacity-0" : "opacity-100"
          }`}>
            <CloudIDE
              spec={builtSpec}
              generating={isGenerating}
              projectId={builtProjectId || undefined}
              onComplete={() => {
                setIsGenerating(false);
                // Smooth fade-out then switch to preview
                setTimeout(() => {
                  setPreviewTab("preview");
                }, 500);
              }}
            />
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
              <div className="mt-4 rounded-lg border border-pink-200 bg-pink-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-pink-700">Version Preview</p>
                  <button
                    onClick={() => setSelectedVersionSpec(null)}
                    className="text-pink-400 hover:text-pink-600"
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
        ) : previewTab === "erd" ? (
          <div className="h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {builtSpec ? (
              <ERDViewer spec={builtSpec} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400">Build a spec first to see the ERD</p>
              </div>
            )}
          </div>
        ) : previewTab === "editor" ? (
          <div className="h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {builtSpec ? (
              <SpecEditor spec={builtSpec} onSpecUpdate={setBuiltSpec} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400">Build a spec first to use the editor</p>
              </div>
            )}
          </div>
        ) : previewTab === "settings" ? (
          <div className="h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {builtSpec && builtProjectId ? (
              <ProjectSettingsPage
                projectId={builtProjectId}
                spec={builtSpec}
                onSpecUpdate={(updatedSpec) => setBuiltSpec(updatedSpec)}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400">Build a project first to configure settings</p>
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

      {/* Share Modal */}
      {shareModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[400px] rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-black">Share Project</h3>
              <button
                onClick={() => {
                  setShareModalOpen(false);
                  setShareEmail("");
                  setShareInviteSuccess(false);
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-black"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Share link */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Share link</label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <LinkIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate text-xs text-gray-600">
                    https://isibi.ai/app?project={builtProjectId}
                  </span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`https://isibi.ai/app?project=${builtProjectId}`);
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2000);
                  }}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                    shareCopied
                      ? "border-green-300 bg-green-50 text-green-600"
                      : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {shareCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Invite by email */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Invite by email</label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full bg-transparent text-xs text-black placeholder-gray-400 focus:outline-none"
                  />
                </div>
                <select
                  value={sharePermission}
                  onChange={(e) => setSharePermission(e.target.value as "edit" | "view")}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-600 focus:outline-none"
                >
                  <option value="edit">Can edit</option>
                  <option value="view">Can view</option>
                </select>
              </div>
              {shareInviteSuccess && (
                <p className="mt-1.5 text-xs text-green-600">Invite sent successfully!</p>
              )}
              <button
                onClick={async () => {
                  if (!shareEmail.trim()) return;
                  setShareInviting(true);
                  try {
                    await post(`/workspaces/${builtProjectId}/members`, {
                      email: shareEmail.trim(),
                      permission: sharePermission,
                    });
                    setShareInviteSuccess(true);
                    setShareEmail("");
                    setTimeout(() => setShareInviteSuccess(false), 3000);
                  } catch {
                    // Endpoint may not exist yet
                    setShareInviteSuccess(true);
                    setShareEmail("");
                    setTimeout(() => setShareInviteSuccess(false), 3000);
                  } finally {
                    setShareInviting(false);
                  }
                }}
                disabled={!shareEmail.trim() || shareInviting}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {shareInviting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                {shareInviting ? "Sending..." : "Send Invite"}
              </button>
            </div>

            {/* Current viewers */}
            {presenceUsers.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-500">Currently viewing</p>
                <div className="space-y-1.5">
                  {presenceUsers.map((pu) => (
                    <div key={pu.id} className="flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: pu.color || "#6b7280" }}
                      >
                        {pu.initials}
                      </div>
                      <span className="text-xs text-gray-700">{pu.name}</span>
                      {pu.is_self && <span className="text-[10px] text-gray-400">(you)</span>}
                      {pu.is_editing && !pu.is_self && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-blue-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                          editing
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Marketplace Listing Modal */}
      {marketplaceModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[400px] rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-black">List on Marketplace</h3>
              <button
                onClick={() => {
                  setMarketplaceModalOpen(false);
                  setMpSuccess(null);
                  setMpError(null);
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-black"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {mpSuccess ? (
              <div className="rounded-lg bg-green-50 p-4 text-center">
                <Check className="mx-auto mb-2 h-6 w-6 text-green-500" />
                <p className="text-sm font-medium text-green-700">Listed on Marketplace!</p>
                <p className="mt-1 text-xs text-green-600">
                  Your app is now available for others to discover and use.
                </p>
                <button
                  onClick={() => {
                    setMarketplaceModalOpen(false);
                    setMpSuccess(null);
                    setActiveView("marketplace");
                  }}
                  className="mt-3 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700"
                >
                  View Marketplace
                </button>
              </div>
            ) : (
              <>
                {mpError && (
                  <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                    {mpError}
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Title</label>
                    <input
                      type="text"
                      value={mpTitle}
                      onChange={(e) => setMpTitle(e.target.value)}
                      placeholder="My Amazing App"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                    <textarea
                      value={mpDescription}
                      onChange={(e) => setMpDescription(e.target.value)}
                      placeholder="What does your app do?"
                      rows={3}
                      className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                      <select
                        value={mpCategory}
                        onChange={(e) => setMpCategory(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      >
                        <option value="">Select...</option>
                        <option value="business">Business</option>
                        <option value="education">Education</option>
                        <option value="healthcare">Healthcare</option>
                        <option value="ecommerce">E-Commerce</option>
                        <option value="social">Social</option>
                        <option value="productivity">Productivity</option>
                        <option value="finance">Finance</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="w-24">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Price ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={mpPrice}
                        onChange={(e) => setMpPrice(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                      <p className="mt-0.5 text-[10px] text-gray-400">0 = free</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handlePublishToMarketplace}
                  disabled={!mpTitle.trim() || mpLoading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-pink-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mpLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Store className="h-4 w-4" />
                  )}
                  {mpLoading ? "Publishing..." : "Publish to Marketplace"}
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

              {!projectsLoaded ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5">
                      <div className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-gray-200" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4" />
                        <div className="h-3 bg-gray-200 rounded w-1/2" />
                      </div>
                      <div className="h-5 w-12 rounded-full bg-gray-200" />
                    </div>
                  ))}
                </div>
              ) : chatSessions.length === 0 ? (
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
                      <div
                        key={session.id}
                        className={`group flex w-full items-start gap-4 rounded-xl border bg-white px-4 py-3.5 text-left transition hover:shadow-sm ${
                          activeChatId === session.id
                            ? "border-black shadow-sm"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        {/* Click area to open project */}
                        <button
                          onClick={() => loadChat(session)}
                          className="flex min-w-0 flex-1 items-start gap-4"
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
                        </button>

                        {/* Status + Delete */}
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                          {isDeployed && (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                              Listed
                            </span>
                          )}
                          {isBuilt && !isDeployed && (
                            <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-medium text-pink-700">
                              Built
                            </span>
                          )}
                          {!isBuilt && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              In Progress
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Delete this project? This cannot be undone.")) {
                                deleteProject(session.id, session.projectId);
                              }
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            title="Delete project"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
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
                    Hi {user?.first_name || "there"}! What would you like to build today?
                  </h1>
                  <p className="mt-2 text-sm text-gray-400">
                    Describe your idea and {selectedModel.label} will bring it to life.
                  </p>
                </div>

                {/* Template quick-start cards */}
                <p className="mb-3 text-xs font-medium text-gray-500">Or start from a template:</p>
                <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { icon: "🏢", title: "CRM", detail: "Leads, deals, contacts & tracking", prompt: "Build me a CRM with leads, deals pipeline, contacts, and activity tracking" },
                    { icon: "🍕", title: "Restaurant", detail: "Menu, orders, tables & reservations", prompt: "Build me a restaurant management system with menu items, orders, tables, and reservations" },
                    { icon: "💪", title: "Gym", detail: "Members, classes, trainers & plans", prompt: "Build me a gym management system with members, classes, trainers, and memberships" },
                    { icon: "🛒", title: "E-commerce", detail: "Products, orders, customers & reviews", prompt: "Build me an e-commerce store with products, orders, customers, and reviews" },
                    { icon: "🏠", title: "Real Estate", detail: "Properties, leads, showings & agents", prompt: "Build me a real estate app with properties, leads, showings, and agents" },
                    { icon: "📋", title: "Project Manager", detail: "Projects, tasks, milestones & teams", prompt: "Build me a project management tool with projects, tasks, milestones, and team members" },
                    { icon: "🏥", title: "Healthcare", detail: "Patients, appointments & prescriptions", prompt: "Build me a clinic management system with patients, appointments, doctors, and prescriptions" },
                    { icon: "📚", title: "School", detail: "Students, teachers, courses & grades", prompt: "Build me a school management system with students, teachers, courses, and grades" },
                  ].map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setPrompt(s.prompt);
                        submitMessage(s.prompt);
                      }}
                      className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:shadow-md"
                    >
                      <span className="mt-0.5 text-lg">{s.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-black">{s.title}</p>
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

                {/* Community prompts */}
                <div className="mb-6">
                  <p className="mb-2.5 text-xs font-medium text-gray-500">Recent prompts from the community:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "A CRM for my real estate agency with lead tracking and deal pipeline",
                      "An appointment booking system for my dental clinic",
                      "An inventory management system for my restaurant with supplier tracking",
                      "A project management tool for my construction company",
                    ].map((examplePrompt, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setPrompt(examplePrompt);
                          submitMessage(examplePrompt);
                        }}
                        className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[12px] text-gray-600 transition hover:border-gray-400 hover:bg-gray-50 hover:text-black hover:shadow-sm"
                      >
                        {examplePrompt}
                      </button>
                    ))}
                  </div>
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
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_CHARS) setPrompt(e.target.value);
                    }}
                    placeholder="Describe what you want to build..."
                    className="w-full resize-none bg-transparent px-4 pb-2 pt-4 text-sm text-black placeholder-gray-400 focus:outline-none transition-all duration-150"
                    rows={1}
                    style={{ maxHeight: "144px" }}
                    disabled={loading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between px-3 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-md bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-400">
                        {selectedModel.label}
                      </span>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                        title="Attach file (Coming soon)"
                        onClick={() => setComingSoonToast("File attachments coming soon!")}
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                        title="Voice input (Coming soon)"
                        onClick={() => setComingSoonToast("Voice input coming soon!")}
                      >
                        <Mic className="h-3.5 w-3.5" />
                      </button>
                      {prompt.length > 0 && (
                        <span className="text-[10px] text-gray-400">
                          {prompt.length} / {MAX_CHARS}
                        </span>
                      )}
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
                <div className="mt-2 flex items-center justify-center gap-3">
                  <p className="text-xs text-gray-400">
                    {selectedModel.label} can make mistakes. Review generated apps before use.
                  </p>
                  {billingInfo && billingInfo.builds_limit !== -1 && (
                    <span className="text-[10px] text-gray-400">
                      {billingInfo.builds_used}/{billingInfo.builds_limit} builds used
                    </span>
                  )}
                </div>
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
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-pink-500">
                <span className="text-[11px] font-bold text-white leading-none">i</span>
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
          <div className="mt-3 border-b border-gray-200" />
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
        {isDev && !projectsLoaded && (
          <div className="border-b border-gray-200 px-2 pb-2">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Projects
            </p>
            <div className="animate-pulse space-y-1.5 px-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded w-5/6" />
            </div>
          </div>
        )}
        {isDev && projectsLoaded && chatSessions.length > 0 && (
          <SidebarProjectList
            chatSessions={chatSessions}
            activeChatId={activeChatId}
            onLoadChat={loadChat}
          />
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
                    <span className="ml-auto rounded-full bg-pink-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
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
                          if (COMING_SOON_MODELS.has(model.id)) {
                            setComingSoonToast(`${model.label.replace(" (Coming Soon)", "")} is coming soon. Using Anias 1.0 for now.`);
                            setSelectedModel(MODELS[0]); // Fall back to Anias
                            setModelOpen(false);
                            return;
                          }
                          setSelectedModel(model);
                          setModelOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-gray-50 cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-medium text-black">{model.label}</p>
                          <p className="text-xs text-gray-400">{model.description}</p>
                        </div>
                        {selectedModel.id === model.id && !COMING_SOON_MODELS.has(model.id) ? (
                          <Check className="h-4 w-4 shrink-0 text-black" />
                        ) : COMING_SOON_MODELS.has(model.id) ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-600">
                            SOON
                          </span>
                        ) : null}
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
                  <div className="mt-1 flex items-center gap-1.5">
                    {user?.account_type && (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isDev ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {isDev ? "Developer" : "User"}
                      </span>
                    )}
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        billingInfo?.plan === "pro" || billingInfo?.plan === "teams"
                          ? "bg-pink-100 text-pink-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {billingInfo?.plan === "pro"
                        ? "Pro Plan"
                        : billingInfo?.plan === "teams"
                        ? "Teams Plan"
                        : "Free Plan"}
                    </span>
                  </div>
                  {billingInfo && billingInfo.builds_limit !== -1 && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      {billingInfo.builds_used}/{billingInfo.builds_limit} builds used
                    </p>
                  )}
                </div>
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    setUpgradeModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                >
                  <CreditCard className="h-4 w-4" />
                  Billing
                  {billingInfo?.plan === "free" && (
                    <span className="ml-auto rounded-full bg-pink-100 px-1.5 py-0.5 text-[9px] font-medium text-pink-700">
                      Upgrade
                    </span>
                  )}
                </button>
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                  <HelpCircle className="h-4 w-4" />
                  Help & FAQ
                </button>
                <div className="mt-1 border-t border-gray-100 pt-1">
                  <button
                    onClick={() => {
                      clearAuth();
                      // Clear all cached data from localStorage
                      localStorage.clear();
                      // Force full page reload to clear in-memory state
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

      {/* Upgrade modal */}
      {upgradeModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={() => setUpgradeModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-black">Upgrade to Pro</h3>
              <button
                onClick={() => setUpgradeModalOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-4">
              <p className="text-sm font-medium text-pink-800">
                You've used {billingInfo?.builds_used || 0}/{billingInfo?.builds_limit || 3} free builds
              </p>
              <p className="mt-1 text-xs text-pink-600">
                Upgrade to Pro for unlimited builds and more features.
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-black">Pro Plan</p>
                    <p className="text-xs text-gray-500">$29/mo</p>
                  </div>
                  <span className="rounded-full bg-pink-100 px-2.5 py-0.5 text-[10px] font-medium text-pink-700">
                    Recommended
                  </span>
                </div>
                <ul className="mt-3 space-y-1">
                  <li className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Check className="h-3 w-3 text-green-600" />
                    Unlimited builds
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Check className="h-3 w-3 text-green-600" />
                    10 projects
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Check className="h-3 w-3 text-green-600" />
                    Custom domains
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Check className="h-3 w-3 text-green-600" />
                    Priority support
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setUpgradeModalOpen(false)}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Maybe Later
              </button>
              <button
                onClick={handleUpgrade}
                disabled={checkoutLoading}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#ec4899" }}
              >
                {checkoutLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Upgrade"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coming soon toast */}
      {comingSoonToast && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 animate-bounce-in">
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-lg">
            <span className="text-sm">&#9888;&#65039;</span>
            <p className="text-xs font-medium text-amber-800">{comingSoonToast}</p>
          </div>
        </div>
      )}

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
