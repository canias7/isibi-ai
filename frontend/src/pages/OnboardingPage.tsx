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
} from "lucide-react";
import { post } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { MarketplacePage } from "./MarketplacePage";
import { MyAppsPage } from "./MyAppsPage";
import { DevMarketplacePage } from "./DevMarketplacePage";

interface Props {
  onSpecCreated: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
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

// Developer sidebar: build tools + marketplace management, no My Apps
const DEV_SIDEBAR: SidebarItem[] = [
  { id: "chat", label: "New Chat", icon: Plus },
  { id: "projects", label: "My Projects", icon: FolderOpen },
  { id: "mylistings", label: "My Listings", icon: BarChart3 },
  { id: "marketplace", label: "isibi marketplace", icon: Store, badge: "NEW" },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "docs", label: "Docs", icon: BookOpen },
  { id: "history", label: "History", icon: Clock },
];

// User sidebar: My Apps + marketplace browsing, no build tools
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

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    const userMsg = prompt.trim();
    setPrompt("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      await post("/projects", { prompt: userMsg });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Your app is ready. Loading it now..." },
      ]);
      setTimeout(() => onSpecCreated(), 1000);
    } catch (err: any) {
      const detail = err?.detail || "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: detail }]);
      setError(detail);
      setLoading(false);
    }
  };

  const handleSidebarClick = (view: View) => {
    if (view === "chat") {
      setActiveView("chat");
      setMessages([]);
      setError(null);
    } else {
      setActiveView(view);
    }
    setSidebarOpen(false);
  };

  const isEmpty = messages.length === 0;

  // Render the active view content
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
              <p className="mt-1 text-xs text-gray-400">
                Start a conversation to build your first project.
              </p>
              <button
                onClick={() => setActiveView("chat")}
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
              <p className="mt-1 text-xs text-gray-400">
                Your past conversations will appear here.
              </p>
            </div>
          </div>
        );
      case "chat":
      default:
        return (
          <>
            <div className="flex flex-1 flex-col items-center overflow-y-auto">
              <div className="w-full max-w-3xl flex-1 px-4">
                {isEmpty ? (
                  <div className="flex h-full flex-col items-center justify-center pb-32">
                    <h1 className="text-2xl font-semibold text-black">
                      What do you want to build?
                    </h1>
                  </div>
                ) : (
                  <div className="space-y-6 py-6">
                    {messages.map((msg, i) => (
                      <div key={i} className="flex gap-4">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                            msg.role === "user"
                              ? "bg-gray-200 text-black"
                              : "bg-black text-white"
                          }`}
                        >
                          {msg.role === "user" ? "Y" : "A"}
                        </div>
                        <div className="min-w-0 pt-1">
                          <p className="text-sm font-medium text-black">
                            {msg.role === "user" ? "You" : selectedModel.label}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                            {msg.content}
                          </p>
                        </div>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
                          A
                        </div>
                        <div className="pt-1">
                          <p className="text-sm font-medium text-black">
                            {selectedModel.label}
                          </p>
                          <div className="mt-2 flex items-center gap-1">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Input area */}
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

        {/* Account type indicator */}
        <div className="mx-3 mb-2 rounded-lg bg-gray-100 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500">
            {isDev ? "Developer Account" : "User Account"}
          </p>
          <p className="text-xs font-medium text-black">
            {user ? `${user.first_name} ${user.last_name}` : ""}
          </p>
        </div>

        {/* Sidebar items */}
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {sidebarItems.map((item) => {
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
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100"
            >
              <Menu className="h-4 w-4 text-gray-600" />
            </button>

            {/* Model selector — only for developers */}
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
                          <p className="text-sm font-medium text-black">
                            {model.label}
                          </p>
                          <p className="text-xs text-gray-400">
                            {model.description}
                          </p>
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
                        isDev
                          ? "bg-purple-100 text-purple-700"
                          : "bg-gray-100 text-gray-600"
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
