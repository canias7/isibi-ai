import { useState } from "react";
import {
  Pencil,
  Trash2,
  Search,
  AppWindow,
  Plus,
  Store,
} from "lucide-react";
import { useAppStore, type UserApp } from "@/stores/appStore";

const TYPE_LABEL: Record<string, string> = {
  software: "Software",
  website: "Website",
  app: "App",
  agent: "Agent",
};

type FilterType = "all" | "online" | "offline" | "created" | "marketplace";
type SortType = "recent" | "name-az" | "name-za";

interface MyAppsPageProps {
  onNewChat?: () => void;
  onMarketplace?: () => void;
  onOpenProject?: (projectId: string) => void;
}

export function MyAppsPage({ onNewChat, onMarketplace, onOpenProject }: MyAppsPageProps) {
  const { apps, toggleStatus, removeApp } = useAppStore();
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filter apps
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
        case "recent":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

  const filterPills: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Online", value: "online" },
    { label: "Offline", value: "offline" },
    { label: "Created", value: "created" },
    { label: "Marketplace", value: "marketplace" },
  ];

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Empty state
  if (apps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center max-w-sm">
          <AppWindow className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-lg font-semibold text-black">No apps yet</p>
          <p className="mt-2 text-sm text-gray-500">
            Build your first app or browse the marketplace.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={onNewChat}
              className="flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              Start Building
            </button>
            <button
              onClick={onMarketplace}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-black transition hover:bg-gray-50"
            >
              <Store className="h-4 w-4" />
              Browse Marketplace
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-black">My Apps</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your apps. Toggle them on or off, edit, or remove.
          </p>
        </div>

        {/* Filter bar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            {filterPills.map((pill) => (
              <button
                key={pill.value}
                onClick={() => setFilter(pill.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === pill.value
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-48 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-black placeholder-gray-400 focus:border-pink-300 focus:outline-none focus:ring-1 focus:ring-pink-200"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-600 focus:border-pink-300 focus:outline-none focus:ring-1 focus:ring-pink-200"
            >
              <option value="recent">Recent</option>
              <option value="name-az">Name A-Z</option>
              <option value="name-za">Name Z-A</option>
            </select>
          </div>
        </div>

        {/* No results */}
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <Search className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-500">No apps match your filters</p>
            <button
              onClick={() => { setFilter("all"); setSearchQuery(""); }}
              className="mt-2 text-xs font-medium text-pink-500 hover:text-pink-600"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* App cards grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onToggle={() => toggleStatus(app.id)}
              onEdit={() => {
                if (app.projectId && onOpenProject) {
                  onOpenProject(app.projectId);
                }
              }}
              onDelete={() => setDeleteConfirm(app.id)}
              formatDate={formatDate}
            />
          ))}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-black">Delete App</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to remove this app? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removeApp(deleteConfirm);
                  setDeleteConfirm(null);
                }}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── App Card Component ─── */

function AppCard({
  app,
  onToggle,
  onEdit,
  onDelete,
  formatDate,
}: {
  app: UserApp;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  formatDate: (d: string) => string;
}) {
  const isOnline = app.status === "online";

  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-5 transition-shadow duration-200 hover:shadow-md">
      {/* Top row: icon + info */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {/* App icon */}
          <div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white text-lg font-bold"
            style={{ backgroundColor: app.color }}
          >
            {app.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-black">{app.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {/* Type badge */}
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                {TYPE_LABEL[app.type] || "Software"}
              </span>
              {/* Source badge */}
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                  app.source === "marketplace"
                    ? "bg-pink-50 text-pink-600"
                    : "bg-blue-50 text-blue-600"
                }`}
              >
                {app.source === "marketplace" ? "From Marketplace" : "Built by you"}
              </span>
            </div>
          </div>
        </div>

        {/* Status dot */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className={`h-2 w-2 rounded-full ${
              isOnline ? "bg-green-500" : "bg-gray-300"
            }`}
          />
          <span
            className={`text-[11px] font-medium ${
              isOnline ? "text-green-600" : "text-gray-400"
            }`}
          >
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      {/* Date */}
      <p className="mt-3 text-[11px] text-gray-400">
        Added {formatDate(app.createdAt)}
      </p>

      {/* Action row */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="flex items-center gap-1">
          {/* Edit button */}
          <button
            onClick={onEdit}
            title="Edit app"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-black"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {/* Delete button */}
          <button
            onClick={onDelete}
            title="Delete app"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Toggle switch */}
        <button
          onClick={onToggle}
          title={isOnline ? "Turn off" : "Turn on"}
          className="relative h-6 w-11 rounded-full transition-colors duration-200"
          style={{ backgroundColor: isOnline ? "#ec4899" : "#d1d5db" }}
        >
          <span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{
              transform: isOnline ? "translateX(20px)" : "translateX(0)",
            }}
          />
        </button>
      </div>
    </div>
  );
}
