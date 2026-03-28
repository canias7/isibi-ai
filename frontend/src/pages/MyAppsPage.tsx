import { useState, useRef, useEffect } from "react";
import {
  Pencil,
  Trash2,
  Search,
  LayoutGrid,
  Plus,
  Store,
  ExternalLink,
  MoreHorizontal,
  Copy,
  Download,
  AlertTriangle,
  X,
} from "lucide-react";
import { useAppStore, type UserApp } from "@/stores/appStore";

/* ─── Constants ─── */

const TYPE_LABEL: Record<string, string> = {
  software: "Software",
  website: "Website",
  app: "App",
  agent: "Agent",
};

const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  software: { bg: "bg-violet-100", text: "text-violet-700" },
  website: { bg: "bg-sky-100", text: "text-sky-700" },
  app: { bg: "bg-amber-100", text: "text-amber-700" },
  agent: { bg: "bg-emerald-100", text: "text-emerald-700" },
};

type FilterType = "all" | "online" | "offline" | "created" | "marketplace";
type SortType = "recent" | "name-az" | "name-za";

interface MyAppsPageProps {
  onNewChat?: () => void;
  onMarketplace?: () => void;
  onOpenProject?: (projectId: string) => void;
}

/* ─── Utility: relative date ─── */

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── CSS keyframes injected once ─── */

const STYLE_ID = "my-apps-page-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes myapps-fadein {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes myapps-pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: .4; }
    }
    @keyframes myapps-modal-in {
      from { opacity: 0; transform: scale(.95); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes myapps-pill-press {
      0%   { transform: scale(1); }
      50%  { transform: scale(.95); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════════════════
   MyAppsPage
   ═══════════════════════════════════════════════════════════════════════ */

export function MyAppsPage({
  onNewChat,
  onMarketplace,
  onOpenProject,
}: MyAppsPageProps) {
  const { apps, toggleStatus, removeApp } = useAppStore();
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(ensureKeyframes, []);

  /* ── Filtering & sorting ── */

  const filtered = apps
    .filter((app) => {
      if (filter === "online") return app.status === "online";
      if (filter === "offline") return app.status === "offline";
      if (filter === "created") return app.source === "created";
      if (filter === "marketplace") return app.source === "marketplace";
      return true;
    })
    .filter((app) =>
      searchQuery
        ? app.name.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    )
    .sort((a, b) => {
      switch (sort) {
        case "name-az":
          return a.name.localeCompare(b.name);
        case "name-za":
          return b.name.localeCompare(a.name);
        default:
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
      }
    });

  const filterPills: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Online", value: "online" },
    { label: "Offline", value: "offline" },
    { label: "Built by You", value: "created" },
    { label: "From Marketplace", value: "marketplace" },
  ];

  const appToDelete = deleteConfirm
    ? apps.find((a) => a.id === deleteConfirm)
    : null;

  /* ── Empty state ── */

  if (apps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        {/* subtle dot grid background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #ec4899 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 text-center max-w-md px-6">
          {/* icon */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-pink-50">
            <LayoutGrid className="h-10 w-10 text-pink-500" strokeWidth={1.5} />
          </div>

          <h2 className="mt-6 text-xl font-bold text-gray-900">No apps yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            Build your first app or discover one on the marketplace
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={onNewChat}
              className="flex items-center gap-2 rounded-xl bg-pink-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-pink-500/25 transition hover:bg-pink-600 active:scale-[.97]"
            >
              <Plus className="h-4 w-4" />
              Start Building
            </button>
            <button
              onClick={onMarketplace}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 active:scale-[.97]"
            >
              <Store className="h-4 w-4" />
              Browse Marketplace
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main view ── */

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {/* ── Header ── */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">My Apps</h1>
              <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-pink-100 px-2 text-xs font-bold text-pink-600">
                {apps.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Your software collection
            </p>
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* pills */}
          <div className="flex flex-wrap items-center gap-2">
            {filterPills.map((pill) => {
              const active = filter === pill.value;
              return (
                <button
                  key={pill.value}
                  onClick={() => setFilter(pill.value)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 ${
                    active
                      ? "bg-pink-500 text-white shadow-sm shadow-pink-500/25"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                  style={{
                    animation: active
                      ? "myapps-pill-press 200ms ease"
                      : undefined,
                  }}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {/* search + sort */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-56 rounded-xl bg-gray-100 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 outline-none transition focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:shadow-sm"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="h-9 rounded-xl bg-gray-100 px-3 text-sm text-gray-600 outline-none transition focus:bg-white focus:ring-2 focus:ring-pink-500/20"
            >
              <option value="recent">Recent</option>
              <option value="name-az">Name A-Z</option>
              <option value="name-za">Name Z-A</option>
            </select>
          </div>
        </div>

        {/* ── No results ── */}
        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <Search className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-4 text-sm font-semibold text-gray-500">
              No apps match your filters
            </p>
            <button
              onClick={() => {
                setFilter("all");
                setSearchQuery("");
              }}
              className="mt-2 text-sm font-semibold text-pink-500 hover:text-pink-600 transition"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* ── Card grid ── */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app, i) => (
            <AppCard
              key={app.id}
              app={app}
              index={i}
              onToggle={() => toggleStatus(app.id)}
              onOpen={() => {
                if (app.htmlContent) {
                  const blob = new Blob([app.htmlContent], {
                    type: "text/html",
                  });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
              }}
              onEdit={() => {
                if (app.projectId && onOpenProject) {
                  onOpenProject(app.projectId);
                }
              }}
              onDelete={() => setDeleteConfirm(app.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Delete modal ── */}
      {deleteConfirm && appToDelete && (
        <DeleteModal
          appName={appToDelete.name}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => {
            removeApp(deleteConfirm);
            setDeleteConfirm(null);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   AppCard
   ═══════════════════════════════════════════════════════════════════════ */

function AppCard({
  app,
  index,
  onToggle,
  onOpen,
  onEdit,
  onDelete,
}: {
  app: UserApp;
  index: number;
  onToggle: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isOnline = app.status === "online";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const typeColors = TYPE_COLOR[app.type] ?? TYPE_COLOR.software;

  return (
    <div
      className="group relative flex flex-col rounded-2xl border bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-500/[.06]"
      style={{
        borderColor: isOnline ? "#bbf7d0" : "#f3f4f6",
        borderLeftWidth: 3,
        borderLeftColor: isOnline ? "#22c55e" : "#d1d5db",
        opacity: isOnline ? 1 : 0.85,
        animation: `myapps-fadein 400ms ease both`,
        animationDelay: `${index * 50}ms`,
      }}
    >
      {/* ── Gradient header strip ── */}
      <div
        className="relative flex items-center gap-4 rounded-t-2xl px-5 py-4"
        style={{
          background: `linear-gradient(135deg, ${app.color}18, ${app.color}08)`,
        }}
      >
        {/* App initial */}
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-lg font-bold text-white shadow-md"
          style={{
            backgroundColor: app.color,
            boxShadow: `0 4px 12px ${app.color}40`,
          }}
        >
          {app.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-gray-900">
            {app.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* type badge */}
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${typeColors.bg} ${typeColors.text}`}
            >
              {TYPE_LABEL[app.type] || "Software"}
            </span>
            {/* source badge */}
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                app.source === "created"
                  ? "bg-pink-100 text-pink-600"
                  : "bg-blue-100 text-blue-600"
              }`}
            >
              {app.source === "created" ? "Built by you" : "From Marketplace"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col px-5 pb-4 pt-3">
        {/* Status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* pulsing dot */}
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: isOnline ? "#22c55e" : "#9ca3b8",
                animation: isOnline
                  ? "myapps-pulse-dot 2s ease-in-out infinite"
                  : undefined,
              }}
            />
            <span
              className={`text-xs font-semibold ${
                isOnline ? "text-green-600" : "text-gray-400"
              }`}
            >
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>

          {/* Toggle switch */}
          <button
            onClick={onToggle}
            aria-label={isOnline ? "Turn offline" : "Turn online"}
            className="relative h-6 w-11 rounded-full transition-colors duration-200"
            style={{ backgroundColor: isOnline ? "#22c55e" : "#d1d5db" }}
          >
            <span
              className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
              style={{
                transform: isOnline ? "translateX(20px)" : "translateX(0)",
              }}
            />
          </button>
        </div>

        {/* date */}
        <p className="mt-3 text-[11px] text-gray-400">
          Added {formatDate(app.createdAt)}
        </p>

        {/* divider */}
        <div className="my-3 h-px bg-gray-100" />

        {/* ── Action bar ── */}
        <div className="flex items-center gap-2">
          {/* Open button */}
          <button
            onClick={onOpen}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-pink-500 py-2 text-xs font-semibold text-white shadow-sm shadow-pink-500/25 transition hover:bg-pink-600 active:scale-[.97]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </button>

          {/* Edit */}
          <button
            onClick={onEdit}
            title="Edit in builder"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

          {/* More menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="More actions"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 bottom-full mb-1 z-20 w-40 rounded-xl border border-gray-100 bg-white py-1 shadow-xl shadow-black/[.08]">
                <MenuButton
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label="Rename"
                  onClick={() => setMenuOpen(false)}
                />
                <MenuButton
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label="Duplicate"
                  onClick={() => setMenuOpen(false)}
                />
                <MenuButton
                  icon={<Download className="h-3.5 w-3.5" />}
                  label="Export"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="my-1 h-px bg-gray-100" />
                <MenuButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Delete"
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Menu button ─── */

function MenuButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium transition ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Delete Modal
   ═══════════════════════════════════════════════════════════════════════ */

function DeleteModal({
  appName,
  onCancel,
  onConfirm,
}: {
  appName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        style={{ animation: "myapps-modal-in 200ms ease" }}
      >
        {/* close */}
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition"
        >
          <X className="h-4 w-4" />
        </button>

        {/* icon */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>

        <h3 className="mt-4 text-center text-lg font-bold text-gray-900">
          Delete {appName}?
        </h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-gray-500">
          This action cannot be undone. The app will be permanently removed from
          your collection.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 active:scale-[.97]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-500/25 transition hover:bg-red-600 active:scale-[.97]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
