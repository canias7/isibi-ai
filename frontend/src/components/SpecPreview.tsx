/**
 * SpecPreview — renders a generated spec as a live interactive UI preview.
 * Sidebar navigation, CRUD table with add/edit/delete, detail view, dashboard,
 * Kanban board view, Calendar view, and mobile-responsive layout.
 */
import { useState, useMemo } from "react";
import {
  LayoutDashboard, Users, ShoppingCart, Building2, Briefcase,
  CalendarDays, FileText, Package, Truck, Heart, Star, Box,
  ChevronRight, Search, Plus, MoreHorizontal, Bell, X,
  ChevronLeft, Pencil, Trash2, Eye, Check, ArrowUpDown,
  Table2, Columns3, Calendar, TrendingUp, Zap, Activity,
  Home, Settings, Menu,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, ShoppingCart, Building2, Briefcase,
  CalendarDays, FileText, Package, Truck, Heart, Star, Box,
};

function resolveIcon(name?: string) {
  if (!name) return Box;
  return ICON_MAP[name] || Box;
}

interface SpecPreviewProps {
  spec: any;
  device: "desktop" | "tablet" | "mobile";
}

type ViewMode = "list" | "detail" | "create" | "edit";
type ListStyle = "table" | "board" | "calendar";

/* ── CSS keyframes injected once ─── */
const STYLE_TAG_ID = "spec-preview-animations";
function ensureAnimations() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    @keyframes spFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    @keyframes spSlideIn { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
    @keyframes spPulse { 0%,100% { opacity:1; } 50% { opacity:.6; } }
    .sp-fade-in { animation: spFadeIn .25s ease-out both; }
    .sp-slide-in { animation: spSlideIn .2s ease-out both; }
    .sp-stagger-1 { animation-delay: .04s; }
    .sp-stagger-2 { animation-delay: .08s; }
    .sp-stagger-3 { animation-delay: .12s; }
    .sp-stagger-4 { animation-delay: .16s; }
  `;
  document.head.appendChild(style);
}

/* ── Color helpers ─── */
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}
function withAlpha(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const STATUS_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#f97316"];

function statusColor(index: number) {
  return STATUS_COLORS[index % STATUS_COLORS.length];
}

/* ═══════════════════════════════════════════════════════════════════ */

export function SpecPreview({ spec, device }: SpecPreviewProps) {
  ensureAnimations();

  const [activeModule, setActiveModule] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [listStyle, setListStyle] = useState<ListStyle>("table");
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [menuOpenRow, setMenuOpenRow] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [notification, setNotification] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);

  // Track mock data so we can add/edit/delete
  const [mockDataMap, setMockDataMap] = useState<Record<string, any[]>>({});

  if (!spec || !spec.modules) return null;

  const modules = spec.modules || [];
  const entities = spec.entities || [];
  const currentModule = modules[activeModule];
  const currentEntity = currentModule?.entity
    ? entities.find((e: any) => e.name === currentModule.entity)
    : null;

  const isMobile = device === "mobile";

  // Start with empty data — user adds rows via the Add button
  const entityKey = currentEntity?.name || "";
  if (currentEntity && !mockDataMap[entityKey]) {
    mockDataMap[entityKey] = [];
  }
  const allRows = mockDataMap[entityKey] || [];

  const tableColumns = currentEntity
    ? (currentEntity.ui_config?.list_view?.columns || currentEntity.fields
        .filter((f: any) => f.show_in_table !== false)
        .slice(0, 6)
        .map((f: any) => f.name))
    : [];

  const design = spec.design_system || {};
  const primaryColor = design.colors?.primary || "#000000";

  // Detect features
  const statusField = currentEntity?.fields?.find((f: any) => f.name === "status" && f.enum_values?.length > 0);
  const dateField = currentEntity?.fields?.find((f: any) =>
    f.name.includes("date") || f.db_type?.includes("DATE") || f.db_type?.includes("TIMESTAMP")
  );
  const hasBoard = !!statusField;
  const hasCalendar = !!dateField;

  // Filter rows by search
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    if (activeFilter > 0 && currentEntity) {
      const sf = currentEntity.fields.find((f: any) => f.name === "status" || f.enum_values?.length > 0);
      if (sf?.enum_values) {
        const filterValue = sf.enum_values[activeFilter - 1];
        rows = rows.filter((row) => row[sf.name] === filterValue);
      }
    }
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const va = String(a[sortCol] || "");
        const vb = String(b[sortCol] || "");
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return rows;
  }, [allRows, searchQuery, activeFilter, sortCol, sortDir, currentEntity]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2000);
  };

  const handleModuleClick = (i: number) => {
    setActiveModule(i);
    setViewMode("list");
    setListStyle("table");
    setSelectedRow(null);
    setSearchQuery("");
    setActiveFilter(0);
    setMenuOpenRow(null);
    setCalendarSelectedDate(null);
  };

  const handleRowClick = (row: any) => {
    setSelectedRow(row);
    setViewMode("detail");
    setMenuOpenRow(null);
  };

  const handleAddClick = () => {
    setFormData({});
    setViewMode("create");
  };

  const handleEditClick = (row: any) => {
    setFormData({ ...row });
    setSelectedRow(row);
    setViewMode("edit");
    setMenuOpenRow(null);
  };

  const handleDeleteClick = (rowIndex: number) => {
    const updated = [...allRows];
    updated.splice(rowIndex, 1);
    setMockDataMap({ ...mockDataMap, [entityKey]: updated });
    setMenuOpenRow(null);
    showNotification("Deleted successfully");
  };

  const handleFormSubmit = () => {
    if (viewMode === "create") {
      const newRow: any = {};
      for (const f of currentEntity?.fields || []) {
        if (["id", "org_id", "deleted_at", "version"].includes(f.name)) continue;
        if (f.name === "created_at") { newRow[f.name] = new Date().toLocaleDateString(); continue; }
        if (f.name === "updated_at") { newRow[f.name] = new Date().toLocaleDateString(); continue; }
        newRow[f.name] = formData[f.name] || "";
      }
      setMockDataMap({ ...mockDataMap, [entityKey]: [...allRows, newRow] });
      showNotification(`${currentEntity?.name} created`);
    } else if (viewMode === "edit" && selectedRow) {
      const updated = allRows.map((r) => (r === selectedRow ? { ...r, ...formData } : r));
      setMockDataMap({ ...mockDataMap, [entityKey]: updated });
      showNotification(`${currentEntity?.name} updated`);
    }
    setViewMode("list");
    setFormData({});
  };

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const handleDashboardCardClick = (entityName: string) => {
    const idx = modules.findIndex((m: any) => m.entity === entityName);
    if (idx >= 0) handleModuleClick(idx);
  };

  const formFields = currentEntity?.fields?.filter((f: any) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  const isDashboard = currentModule?.name === "Dashboard" || currentModule?.layout === "dashboard";

  /* ── Render ─── */
  return (
    <div className="flex h-full overflow-hidden rounded-xl bg-white text-xs" style={{ fontFamily: "'Inter', system-ui, sans-serif" }} onClick={() => setMenuOpenRow(null)}>
      {/* Notification toast */}
      {notification && (
        <div className="absolute top-3 right-3 z-50 sp-fade-in flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium text-white shadow-lg"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.85)})` }}
        >
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20">
            <Check className="h-2.5 w-2.5" />
          </div>
          {notification}
        </div>
      )}

      {/* ── Sidebar (desktop/tablet) ─── */}
      {!isMobile && (
        <div className="flex w-52 shrink-0 flex-col border-r border-gray-100/80 bg-gradient-to-b from-gray-50/80 to-white">
          <div className="border-b border-gray-100/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg text-white text-[10px] font-bold shadow-sm"
                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})` }}
              >
                {(spec.app_name || spec.name || "A")[0].toUpperCase()}
              </div>
              <p className="text-[12px] font-semibold tracking-tight text-gray-900">
                {spec.app_name || spec.name || "My App"}
              </p>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2 py-3">
            {modules.map((mod: any, i: number) => {
              const Icon = resolveIcon(mod.sidebar_icon);
              const isActive = i === activeModule;
              return (
                <button
                  key={i}
                  onClick={() => handleModuleClick(i)}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] transition-all duration-150 ${
                    isActive
                      ? "font-medium text-white shadow-sm"
                      : "text-gray-500 hover:bg-gray-100/80 hover:text-gray-800"
                  }`}
                  style={isActive ? { background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` } : {}}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${isActive ? "" : "group-hover:scale-110"}`} />
                  {mod.name}
                </button>
              );
            })}
          </nav>
          {/* Sidebar footer */}
          <div className="border-t border-gray-100/80 p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-[9px] font-bold text-gray-600">
                U
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-gray-700 truncate">User</p>
                <p className="text-[9px] text-gray-400 truncate">user@example.com</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ─── */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-100/80 px-4 py-2.5 bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {viewMode !== "list" && (
              <button
                onClick={() => { setViewMode("list"); setSelectedRow(null); }}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-gray-400 hover:text-gray-800 hover:bg-gray-50 transition-all duration-150"
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </button>
            )}
            <h1 className="text-[13px] font-semibold tracking-tight text-gray-900">
              {viewMode === "create" ? `New ${currentEntity?.name || ""}` :
               viewMode === "edit" ? `Edit ${currentEntity?.name || ""}` :
               viewMode === "detail" ? (selectedRow?.[formFields[0]?.name] || currentEntity?.name) :
               currentModule?.name || "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {viewMode === "list" && !isDashboard && (
              <div className="flex h-7 items-center rounded-lg border border-gray-200/80 bg-white px-2.5 shadow-sm transition-all duration-150 focus-within:border-gray-300 focus-within:shadow">
                <Search className="mr-1.5 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-24 bg-transparent text-[11px] text-gray-800 placeholder-gray-400 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="ml-1 rounded-full p-0.5 hover:bg-gray-100 transition">
                    <X className="h-2.5 w-2.5 text-gray-400" />
                  </button>
                )}
              </div>
            )}
            <button className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 transition-all duration-150 cursor-pointer shadow-sm">
              <Bell className="h-3.5 w-3.5 text-gray-500" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white" style={{ backgroundColor: primaryColor }} />
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className={`flex-1 overflow-auto ${isMobile ? "p-3 pb-16" : "p-4"}`}>
          <div className="sp-fade-in" key={`${activeModule}-${viewMode}-${listStyle}`}>
            {viewMode === "create" || viewMode === "edit" ? (
              <FormPreview
                entity={currentEntity}
                formData={formData}
                setFormData={setFormData}
                onSubmit={handleFormSubmit}
                onCancel={() => { setViewMode("list"); setFormData({}); }}
                primaryColor={primaryColor}
                mode={viewMode}
                isMobile={isMobile}
              />
            ) : viewMode === "detail" && selectedRow ? (
              <DetailPreview
                entity={currentEntity}
                row={selectedRow}
                primaryColor={primaryColor}
                onEdit={() => handleEditClick(selectedRow)}
                onBack={() => setViewMode("list")}
                isMobile={isMobile}
              />
            ) : isDashboard ? (
              <DashboardPreview
                spec={spec}
                primaryColor={primaryColor}
                onCardClick={handleDashboardCardClick}
                mockDataMap={mockDataMap}
                isMobile={isMobile}
              />
            ) : currentEntity ? (
              <>
                {/* View toggle */}
                {(hasBoard || hasCalendar) && (
                  <div className="mb-3 flex items-center gap-1">
                    <ViewToggleButton icon={Table2} label="Table" active={listStyle === "table"} onClick={() => setListStyle("table")} primaryColor={primaryColor} />
                    {hasBoard && <ViewToggleButton icon={Columns3} label="Board" active={listStyle === "board"} onClick={() => setListStyle("board")} primaryColor={primaryColor} />}
                    {hasCalendar && <ViewToggleButton icon={Calendar} label="Calendar" active={listStyle === "calendar"} onClick={() => setListStyle("calendar")} primaryColor={primaryColor} />}
                  </div>
                )}

                {listStyle === "board" && hasBoard ? (
                  <BoardPreview
                    entity={currentEntity}
                    rows={filteredRows}
                    statusField={statusField}
                    primaryColor={primaryColor}
                    onRowClick={handleRowClick}
                    onAddClick={handleAddClick}
                  />
                ) : listStyle === "calendar" && hasCalendar ? (
                  <CalendarPreview
                    entity={currentEntity}
                    rows={allRows}
                    dateField={dateField}
                    primaryColor={primaryColor}
                    onRowClick={handleRowClick}
                    onAddClick={handleAddClick}
                    calendarMonth={calendarMonth}
                    setCalendarMonth={setCalendarMonth}
                    calendarSelectedDate={calendarSelectedDate}
                    setCalendarSelectedDate={setCalendarSelectedDate}
                  />
                ) : (
                  <TablePreview
                    entity={currentEntity}
                    columns={tableColumns}
                    rows={filteredRows}
                    primaryColor={primaryColor}
                    onRowClick={handleRowClick}
                    onAddClick={handleAddClick}
                    onEditClick={handleEditClick}
                    onDeleteClick={handleDeleteClick}
                    menuOpenRow={menuOpenRow}
                    setMenuOpenRow={setMenuOpenRow}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    onSort={handleSort}
                    sortCol={sortCol}
                    sortDir={sortDir}
                    isMobile={isMobile}
                  />
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-[11px] text-gray-400">{currentModule?.name}</p>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom tab bar */}
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-around border-t border-gray-100 bg-white/95 backdrop-blur-sm px-1 py-1.5 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
            {modules.slice(0, 5).map((mod: any, i: number) => {
              const Icon = resolveIcon(mod.sidebar_icon);
              const isActive = i === activeModule;
              return (
                <button
                  key={i}
                  onClick={() => handleModuleClick(i)}
                  className="flex flex-col items-center gap-0.5 px-2 py-1 transition-all duration-150"
                >
                  <Icon className="h-4 w-4" style={{ color: isActive ? primaryColor : "#9ca3af" }} />
                  <span className={`text-[8px] font-medium ${isActive ? "" : "text-gray-400"}`}
                    style={isActive ? { color: primaryColor } : {}}
                  >
                    {mod.name.length > 8 ? mod.name.slice(0, 7) + "..." : mod.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── View Toggle Button ─── */
function ViewToggleButton({ icon: Icon, label, active, onClick, primaryColor }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  primaryColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all duration-150 ${
        active ? "text-white shadow-sm" : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      }`}
      style={active ? { background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` } : {}}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Dashboard Preview
   ═══════════════════════════════════════════════════════════════════ */
function DashboardPreview({ spec, primaryColor, onCardClick, mockDataMap, isMobile }: {
  spec: any;
  primaryColor: string;
  onCardClick: (entity: string) => void;
  mockDataMap: Record<string, any[]>;
  isMobile: boolean;
}) {
  const stats = spec.dashboard?.stat_cards || [];
  const entities = spec.entities || [];
  const cards = stats.length > 0 ? stats : entities.slice(0, 4).map((e: any) => ({ label: `Total ${e.name}s`, entity: e.name }));

  const gradients = [
    `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})`,
    `linear-gradient(135deg, #10b981, #34d399)`,
    `linear-gradient(135deg, #f59e0b, #fbbf24)`,
    `linear-gradient(135deg, #8b5cf6, #a78bfa)`,
  ];

  // First entity data for "recent items"
  const firstEntity = entities[0];
  const firstEntityRows = firstEntity ? (mockDataMap[firstEntity.name] || []) : [];
  const recentItems = firstEntityRows.slice(-5).reverse();
  const nameField = firstEntity?.fields?.find((f: any) =>
    f.name === "name" || f.name.includes("_name") || f.name.includes("title")
  );

  // Simple bar chart data
  const barData = entities.slice(0, 5).map((e: any) => ({
    label: e.name,
    value: (mockDataMap[e.name] || []).length,
  }));
  const maxBar = Math.max(...barData.map((d) => d.value), 1);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
        {cards.map((item: any, i: number) => {
          const count = (mockDataMap[item.entity || item.name] || []).length;
          return (
            <div
              key={i}
              onClick={() => onCardClick(item.entity || item.name)}
              className={`sp-fade-in sp-stagger-${i + 1} group cursor-pointer rounded-xl p-3.5 text-white shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5`}
              style={{ background: gradients[i % gradients.length] }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-white/80">
                  {item.label || `Total ${item.name}`}
                </p>
                <div className="rounded-lg bg-white/15 p-1.5 transition-transform duration-200 group-hover:scale-110">
                  <TrendingUp className="h-3 w-3 text-white/80" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight">{count}</p>
              <p className="mt-1 text-[9px] text-white/60">
                {count === 0 ? "No data yet" : `${count} total item${count !== 1 ? "s" : ""}`}
              </p>
            </div>
          );
        })}
      </div>

      <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
        {/* Bar chart */}
        <div className="rounded-xl border border-gray-100/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-gray-900">Overview</p>
            <Activity className="h-3.5 w-3.5 text-gray-300" />
          </div>
          <div className="flex items-end gap-2 h-24">
            {barData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md transition-all duration-300"
                  style={{
                    height: `${Math.max((d.value / maxBar) * 80, 4)}px`,
                    background: d.value > 0
                      ? `linear-gradient(to top, ${primaryColor}, ${withAlpha(primaryColor, 0.6)})`
                      : "#e5e7eb",
                  }}
                />
                <span className="text-[8px] text-gray-400 truncate w-full text-center">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent items */}
        <div className="rounded-xl border border-gray-100/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-gray-900">Recent {firstEntity?.name || "Items"}</p>
            <span className="text-[9px] text-gray-400">{recentItems.length} item{recentItems.length !== 1 ? "s" : ""}</span>
          </div>
          {recentItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Box className="mb-2 h-5 w-5 text-gray-200" />
              <p className="text-[10px] text-gray-400">No items yet</p>
              <p className="mt-0.5 text-[9px] text-gray-300">Add data to see recent items</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentItems.map((row, i) => {
                const label = nameField ? row[nameField.name] : `Item ${i + 1}`;
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-gray-50 transition-all duration-150 cursor-pointer">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, ${statusColor(i)}, ${withAlpha(statusColor(i), 0.7)})` }}
                    >
                      {(label || "?")[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-gray-800 truncate">{label}</p>
                      <p className="text-[9px] text-gray-400">{row.created_at || "Just now"}</p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-gray-300" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-gray-100/80 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold text-gray-900 mb-3">Quick Actions</p>
        <div className={`grid gap-2 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
          {entities.slice(0, 4).map((e: any, i: number) => (
            <button
              key={i}
              onClick={() => onCardClick(e.name)}
              className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2.5 text-[10px] font-medium text-gray-600 transition-all duration-150 hover:border-gray-200 hover:bg-gray-50 hover:shadow-sm"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-md" style={{ backgroundColor: withAlpha(primaryColor, 0.1) }}>
                <Plus className="h-3 w-3" style={{ color: primaryColor }} />
              </div>
              Add {e.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Table Preview
   ═══════════════════════════════════════════════════════════════════ */
function TablePreview({
  entity, columns, rows, primaryColor,
  onRowClick, onAddClick, onEditClick, onDeleteClick,
  menuOpenRow, setMenuOpenRow,
  activeFilter, setActiveFilter,
  onSort, sortCol, sortDir, isMobile,
}: {
  entity: any;
  columns: string[];
  rows: any[];
  primaryColor: string;
  onRowClick: (row: any) => void;
  onAddClick: () => void;
  onEditClick: (row: any) => void;
  onDeleteClick: (i: number) => void;
  menuOpenRow: number | null;
  setMenuOpenRow: (i: number | null) => void;
  activeFilter: number;
  setActiveFilter: (i: number) => void;
  onSort: (col: string) => void;
  sortCol: string | null;
  sortDir: "asc" | "desc";
  isMobile: boolean;
}) {
  const visibleCols = isMobile ? columns.slice(0, 3) : columns.slice(0, 6);
  const statusField = entity.fields?.find((f: any) => f.name === "status" && f.enum_values?.length > 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold tracking-tight text-gray-900">
            {entity.name}s
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">{rows.length} total result{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-px"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` }}
        >
          <Plus className="h-3 w-3" />
          Add {entity.name}
        </button>
      </div>

      {/* Filter tabs */}
      {statusField && (
        <div className="flex gap-1.5 flex-wrap">
          <FilterTab label="All" active={activeFilter === 0} onClick={() => setActiveFilter(0)} primaryColor={primaryColor} />
          {statusField.enum_values.map((val: string, i: number) => (
            <FilterTab key={i} label={formatColumnName(val)} active={activeFilter === i + 1} onClick={() => setActiveFilter(i + 1)} primaryColor={primaryColor} dotColor={statusColor(i)} />
          ))}
        </div>
      )}

      {/* Table */}
      <div className={`overflow-hidden rounded-xl border border-gray-100/80 shadow-sm ${isMobile ? "overflow-x-auto" : ""}`}>
        <table className="w-full min-w-[400px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80">
              {visibleCols.map((col: string, i: number) => (
                <th
                  key={i}
                  onClick={() => onSort(col)}
                  className="cursor-pointer select-none px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-700 transition-colors duration-150"
                >
                  <span className="flex items-center gap-1">
                    {formatColumnName(col)}
                    {sortCol === col && (
                      <ArrowUpDown className="h-2.5 w-2.5 text-gray-500" />
                    )}
                  </span>
                </th>
              ))}
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length + 1} className="py-12 text-center">
                  <div className="flex flex-col items-center sp-fade-in">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50">
                      <Box className="h-5 w-5 text-gray-300" />
                    </div>
                    <p className="text-[11px] font-medium text-gray-500">No {entity.name}s yet</p>
                    <p className="mt-1 text-[10px] text-gray-400">Click "Add {entity.name}" to create your first one</p>
                  </div>
                </td>
              </tr>
            ) : rows.map((row, ri) => (
              <tr
                key={ri}
                onClick={() => onRowClick(row)}
                className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/80 transition-colors duration-100 group"
              >
                {visibleCols.map((col: string, ci: number) => {
                  const field = entity.fields.find((f: any) => f.name === col);
                  const val = row[col];
                  const isNameField = col === "name" || col.includes("_name") || col.includes("contact") || col.includes("customer");
                  const isNumeric = field?.db_type?.includes("INT") || field?.db_type?.includes("NUMERIC");
                  return (
                    <td key={ci} className="px-3 py-2.5">
                      {field?.badge_colors && val ? (
                        <StatusBadge label={formatColumnName(val)} color={field.badge_colors[val]} />
                      ) : isNameField && val ? (
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                            style={{ background: `linear-gradient(135deg, ${statusColor(ri)}, ${withAlpha(statusColor(ri), 0.7)})` }}
                          >
                            {String(val)[0]?.toUpperCase()}
                          </div>
                          <span className="text-[10px] font-medium text-gray-800">{val}</span>
                        </div>
                      ) : isNumeric && val && !String(val).startsWith("$") ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-700">{val}</span>
                          <div className="h-1 flex-1 max-w-[40px] rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${Math.min((Number(val) / 200) * 100, 100)}%`,
                              backgroundColor: withAlpha(primaryColor, 0.5),
                            }} />
                          </div>
                        </div>
                      ) : (
                        <span className={`text-[10px] ${ci === 0 ? "font-medium text-gray-800" : "text-gray-600"}`}>{val}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpenRow(menuOpenRow === ri ? null : ri); }}
                    className="rounded-lg p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-100 transition-all duration-150"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                  {menuOpenRow === ri && (
                    <div
                      className="absolute right-2 top-full z-10 w-32 rounded-xl border border-gray-200/80 bg-white py-1.5 shadow-xl sp-fade-in"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => onRowClick(row)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[10px] text-gray-600 hover:bg-gray-50 transition-colors duration-100">
                        <Eye className="h-3 w-3" /> View details
                      </button>
                      <button onClick={() => onEditClick(row)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[10px] text-gray-600 hover:bg-gray-50 transition-colors duration-100">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <div className="my-1 border-t border-gray-100" />
                      <button onClick={() => onDeleteClick(ri)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[10px] text-red-500 hover:bg-red-50 transition-colors duration-100">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-[10px] text-gray-400">Showing {rows.length} of {rows.length} results</p>
          <div className="flex gap-1">
            <button className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] text-gray-400 hover:bg-gray-50 transition-colors duration-150">Prev</button>
            <button className="rounded-lg px-2.5 py-1 text-[10px] font-medium text-white shadow-sm" style={{ backgroundColor: primaryColor }}>1</button>
            <button className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] text-gray-400 hover:bg-gray-50 transition-colors duration-150">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Board / Kanban Preview
   ═══════════════════════════════════════════════════════════════════ */
function BoardPreview({ entity, rows, statusField, primaryColor, onRowClick, onAddClick }: {
  entity: any;
  rows: any[];
  statusField: any;
  primaryColor: string;
  onRowClick: (row: any) => void;
  onAddClick: () => void;
}) {
  const statuses: string[] = statusField?.enum_values || [];
  const nameField = entity.fields?.find((f: any) =>
    f.name === "name" || f.name.includes("_name") || f.name.includes("title") || f.name.includes("subject")
  );
  const secondaryField = entity.fields?.find((f: any) =>
    f.name !== nameField?.name && f.name !== "status" &&
    !["id","org_id","created_at","updated_at","deleted_at","version"].includes(f.name)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold tracking-tight text-gray-900">{entity.name} Board</p>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` }}
        >
          <Plus className="h-3 w-3" />
          Add {entity.name}
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((status, si) => {
          const colRows = rows.filter((r) => r[statusField.name] === status);
          const color = statusColor(si);
          return (
            <div key={si} className="min-w-[180px] flex-1 sp-fade-in" style={{ animationDelay: `${si * 0.05}s` }}>
              {/* Column header */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] font-semibold text-gray-700">{formatColumnName(status)}</span>
                <span className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gray-100 px-1 text-[9px] font-medium text-gray-500">
                  {colRows.length}
                </span>
              </div>
              {/* Column body */}
              <div className="space-y-2 rounded-xl bg-gray-50/80 p-2 min-h-[120px]">
                {colRows.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <p className="text-[9px] text-gray-400">No items</p>
                  </div>
                ) : colRows.map((row, ri) => (
                  <div
                    key={ri}
                    onClick={() => onRowClick(row)}
                    className="cursor-pointer rounded-lg border border-gray-100/80 bg-white p-2.5 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-px"
                  >
                    <p className="text-[10px] font-medium text-gray-800 truncate">
                      {nameField ? row[nameField.name] : `Item ${ri + 1}`}
                    </p>
                    {secondaryField && row[secondaryField.name] && (
                      <p className="mt-1 text-[9px] text-gray-400 truncate">{row[secondaryField.name]}</p>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-[7px] font-bold text-gray-500 flex items-center justify-center">
                        U
                      </div>
                      <span className="text-[8px] text-gray-400">{row.created_at || "Now"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Calendar Preview
   ═══════════════════════════════════════════════════════════════════ */
function CalendarPreview({ entity, rows, dateField, primaryColor, onRowClick, onAddClick, calendarMonth, setCalendarMonth, calendarSelectedDate, setCalendarSelectedDate }: {
  entity: any;
  rows: any[];
  dateField: any;
  primaryColor: string;
  onRowClick: (row: any) => void;
  onAddClick: () => void;
  calendarMonth: Date;
  setCalendarMonth: (d: Date) => void;
  calendarSelectedDate: string | null;
  setCalendarSelectedDate: (d: string | null) => void;
}) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Map date strings to rows
  const dateMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const row of rows) {
      const val = row[dateField.name];
      if (!val) continue;
      // Normalize date
      const d = new Date(val);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(row);
    }
    return map;
  }, [rows, dateField.name]);

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const nameField = entity.fields?.find((f: any) =>
    f.name === "name" || f.name.includes("_name") || f.name.includes("title")
  );

  const selectedItems = calendarSelectedDate ? (dateMap[calendarSelectedDate] || []) : [];

  const prevMonth = () => setCalendarMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCalendarMonth(new Date(year, month + 1, 1));

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold tracking-tight text-gray-900">{entity.name} Calendar</p>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` }}
        >
          <Plus className="h-3 w-3" />
          Add {entity.name}
        </button>
      </div>

      <div className="rounded-xl border border-gray-100/80 bg-white shadow-sm overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button onClick={prevMonth} className="rounded-lg p-1.5 hover:bg-gray-50 transition-colors duration-150">
            <ChevronLeft className="h-3.5 w-3.5 text-gray-500" />
          </button>
          <p className="text-[11px] font-semibold text-gray-800">{monthNames[month]} {year}</p>
          <button onClick={nextMonth} className="rounded-lg p-1.5 hover:bg-gray-50 transition-colors duration-150">
            <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-50">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div key={d} className="px-1 py-2 text-center text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            if (day === null) return <div key={i} className="h-10 border-b border-r border-gray-50/50" />;
            const key = `${year}-${month}-${day}`;
            const hasItems = !!dateMap[key];
            const isSelected = calendarSelectedDate === key;
            const isToday = new Date().getFullYear() === year && new Date().getMonth() === month && new Date().getDate() === day;
            return (
              <button
                key={i}
                onClick={() => setCalendarSelectedDate(isSelected ? null : key)}
                className={`relative h-10 flex flex-col items-center justify-center border-b border-r border-gray-50/50 transition-all duration-100 ${
                  isSelected ? "bg-gray-50" : "hover:bg-gray-50/50"
                }`}
              >
                <span className={`text-[10px] ${isToday ? "font-bold" : ""} ${isSelected ? "font-semibold" : "text-gray-600"}`}
                  style={isToday ? { color: primaryColor } : isSelected ? { color: primaryColor } : {}}
                >
                  {day}
                </span>
                {hasItems && (
                  <div className="mt-0.5 flex gap-0.5">
                    {(dateMap[key] || []).slice(0, 3).map((_, di) => (
                      <div key={di} className="h-1 w-1 rounded-full" style={{ backgroundColor: primaryColor }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected date items */}
      {calendarSelectedDate && (
        <div className="rounded-xl border border-gray-100/80 bg-white p-3 shadow-sm sp-fade-in">
          <p className="text-[10px] font-semibold text-gray-700 mb-2">
            Items on this date ({selectedItems.length})
          </p>
          {selectedItems.length === 0 ? (
            <p className="text-[10px] text-gray-400 py-2">No items on this date</p>
          ) : (
            <div className="space-y-1.5">
              {selectedItems.map((row, i) => (
                <div key={i} onClick={() => onRowClick(row)}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-50 cursor-pointer transition-colors duration-150"
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                  <span className="text-[10px] font-medium text-gray-700">
                    {nameField ? row[nameField.name] : `Item ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Detail Preview
   ═══════════════════════════════════════════════════════════════════ */
function DetailPreview({
  entity, row, primaryColor, onEdit, onBack, isMobile,
}: {
  entity: any;
  row: any;
  primaryColor: string;
  onEdit: () => void;
  onBack: () => void;
  isMobile: boolean;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const fields = entity?.fields?.filter((f: any) =>
    !["id", "org_id", "deleted_at", "version"].includes(f.name)
  ) || [];

  const tabs = entity?.ui_config?.detail_view?.tabs || [{ name: "Overview", fields: fields.map((f: any) => f.name) }];
  const nameField = fields[0];
  const statusFieldDef = entity?.fields?.find((f: any) => f.name === "status");

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-xl border border-gray-100/80 bg-gradient-to-r from-gray-50 to-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})` }}
            >
              {String(row[nameField?.name] || "?")[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {row[nameField?.name] || entity?.name}
              </p>
              {row.status && statusFieldDef && (
                <div className="mt-1">
                  <StatusBadge label={formatColumnName(row.status)} color={statusFieldDef?.badge_colors?.[row.status]} />
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-medium text-gray-600 transition-all duration-150 hover:bg-gray-50 hover:shadow-sm"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-100">
        {tabs.map((tab: any, i: number) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-2 text-[10px] font-medium transition-all duration-150 border-b-2 ${
              i === activeTab
                ? "border-current"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
            style={i === activeTab ? { borderColor: primaryColor, color: primaryColor } : {}}
          >
            {tab.name || `Tab ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Fields grid */}
      <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
        {fields.map((f: any, i: number) => {
          const isNameLike = f.name === "name" || f.name.includes("_name") || f.name.includes("contact");
          return (
            <div key={i} className="rounded-xl border border-gray-100/60 bg-gray-50/50 p-3 transition-all duration-150 hover:bg-gray-50">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{formatColumnName(f.name)}</p>
              <div className="mt-1.5">
                {f.badge_colors && row[f.name] ? (
                  <StatusBadge label={formatColumnName(row[f.name])} color={f.badge_colors[row[f.name]]} />
                ) : isNameLike && row[f.name] ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, ${statusColor(i)}, ${withAlpha(statusColor(i), 0.7)})` }}
                    >
                      {String(row[f.name])[0]?.toUpperCase()}
                    </div>
                    <span className="text-[11px] font-medium text-gray-800">{row[f.name]}</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-800">{row[f.name] || "---"}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Form Preview
   ═══════════════════════════════════════════════════════════════════ */
function FormPreview({
  entity, formData, setFormData, onSubmit, onCancel, primaryColor, mode, isMobile,
}: {
  entity: any;
  formData: Record<string, any>;
  setFormData: (d: Record<string, any>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  primaryColor: string;
  mode: "create" | "edit";
  isMobile: boolean;
}) {
  const fields = entity?.fields?.filter((f: any) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})` }}
        >
          {mode === "create" ? <Plus className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </div>
        <div>
          <p className="text-[13px] font-semibold text-gray-900">
            {mode === "create" ? `New ${entity?.name}` : `Edit ${entity?.name}`}
          </p>
          <p className="text-[10px] text-gray-400">Fill in the details below</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100/80 bg-white p-4 shadow-sm space-y-3">
        {fields.map((f: any, i: number) => (
          <div key={i}>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {formatColumnName(f.name)}
              {!f.nullable && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {f.enum_values ? (
              <select
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-800 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-all duration-150"
              >
                <option value="">Select...</option>
                {f.enum_values.map((v: string) => (
                  <option key={v} value={v}>{formatColumnName(v)}</option>
                ))}
              </select>
            ) : f.db_type?.includes("BOOLEAN") ? (
              <label className="mt-1 flex items-center gap-2 text-[11px] text-gray-800 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={formData[f.name] === true || formData[f.name] === "Yes"}
                    onChange={(e) => setFormData({ ...formData, [f.name]: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={`h-5 w-9 rounded-full transition-colors duration-200 ${
                    formData[f.name] ? "" : "bg-gray-200"
                  }`}
                    style={formData[f.name] ? { backgroundColor: primaryColor } : {}}
                    onClick={() => setFormData({ ...formData, [f.name]: !formData[f.name] })}
                  >
                    <div className={`h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${
                      formData[f.name] ? "translate-x-4 ml-0.5" : "translate-x-0.5"
                    }`} />
                  </div>
                </div>
                {formatColumnName(f.name)}
              </label>
            ) : f.db_type?.includes("TEXT") && !f.db_type?.includes("VARCHAR") ? (
              <textarea
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-800 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-all duration-150 resize-none"
                placeholder={`Enter ${formatColumnName(f.name).toLowerCase()}...`}
              />
            ) : (
              <input
                type={f.db_type?.includes("INT") || f.db_type?.includes("NUMERIC") ? "number" : f.db_type?.includes("DATE") ? "date" : "text"}
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-800 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-all duration-150"
                placeholder={`Enter ${formatColumnName(f.name).toLowerCase()}...`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          className="flex-1 rounded-lg py-2 text-[11px] font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-px"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` }}
        >
          {mode === "create" ? `Create ${entity?.name}` : "Save Changes"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-5 py-2 text-[11px] font-medium text-gray-500 transition-all duration-150 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Shared Components
   ═══════════════════════════════════════════════════════════════════ */

function StatusBadge({ label, color }: { label: string; color?: string }) {
  const colorMap: Record<string, { bg: string; text: string; dot: string }> = {
    pink:   { bg: "bg-pink-50",   text: "text-pink-700",   dot: "bg-pink-500" },
    blue:   { bg: "bg-blue-50",   text: "text-blue-700",   dot: "bg-blue-500" },
    green:  { bg: "bg-emerald-50",text: "text-emerald-700",dot: "bg-emerald-500" },
    red:    { bg: "bg-red-50",    text: "text-red-700",    dot: "bg-red-500" },
    amber:  { bg: "bg-amber-50",  text: "text-amber-700",  dot: "bg-amber-500" },
    yellow: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
    orange: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
    slate:  { bg: "bg-slate-100", text: "text-slate-700",  dot: "bg-slate-500" },
    gray:   { bg: "bg-gray-100",  text: "text-gray-600",   dot: "bg-gray-400" },
  };
  const c = colorMap[color || "gray"] || colorMap.gray;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label}
    </span>
  );
}

function FilterTab({ label, active, onClick, primaryColor, dotColor }: {
  label: string;
  active: boolean;
  onClick: () => void;
  primaryColor: string;
  dotColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all duration-150 ${
        active ? "text-white shadow-sm" : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      }`}
      style={active ? { background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})` } : {}}
    >
      {dotColor && !active && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />}
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/ Id$/, "")
    .replace(/^Org$/, "")
    .replace(/^Id$/, "#");
}

function getBadgeClass(color?: string): string {
  const map: Record<string, string> = {
    pink: "bg-pink-50 text-pink-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    yellow: "bg-yellow-50 text-yellow-700",
    purple: "bg-purple-50 text-purple-700",
    indigo: "bg-indigo-50 text-indigo-700",
    orange: "bg-orange-50 text-orange-700",
    slate: "bg-slate-100 text-slate-700",
    gray: "bg-gray-100 text-gray-700",
  };
  return map[color || "gray"] || "bg-gray-100 text-gray-700";
}

function generateMockRows(entity: any, count: number): any[] {
  const fields = entity.fields || [];
  const rows: any[] = [];
  const firstNames = ["James", "Sofia", "Liam", "Emma", "Noah", "Olivia", "Ethan", "Ava", "Mason", "Isabella"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
  const companies = ["Alpha Corp", "Beta LLC", "Gamma Inc", "Delta Co", "Epsilon Ltd", "Zeta Group", "Eta Solutions", "Theta Partners"];

  for (let r = 0; r < count; r++) {
    const row: any = {};
    for (const f of fields) {
      if (["id", "org_id", "deleted_at", "version"].includes(f.name)) continue;
      if (f.name === "created_at" || f.name === "updated_at") {
        row[f.name] = new Date(Date.now() - Math.random() * 30 * 86400000).toLocaleDateString();
        continue;
      }
      if (f.enum_values?.length > 0) {
        row[f.name] = f.enum_values[Math.floor(Math.random() * f.enum_values.length)];
        continue;
      }
      if (f.db_type?.includes("BOOLEAN") || f.ts_type === "boolean") {
        row[f.name] = Math.random() > 0.5 ? "Yes" : "No";
        continue;
      }
      if (f.db_type?.includes("INTEGER") || f.db_type?.includes("NUMERIC") || f.ts_type === "number") {
        if (f.name.includes("price") || f.name.includes("amount") || f.name.includes("cost") || f.name.includes("rate") || f.name.includes("value") || f.name.includes("total") || f.name.includes("fee") || f.name.includes("budget")) {
          row[f.name] = `$${(Math.random() * 5000 + 50).toFixed(2)}`;
        } else {
          row[f.name] = Math.floor(Math.random() * 200 + 1);
        }
        continue;
      }
      if (f.name.includes("email")) {
        row[f.name] = `${firstNames[r % firstNames.length].toLowerCase()}@example.com`;
        continue;
      }
      if (f.name.includes("phone")) {
        row[f.name] = `(555) ${String(Math.floor(Math.random() * 900 + 100))}-${String(Math.floor(Math.random() * 9000 + 1000))}`;
        continue;
      }
      if (f.name === "name" || f.name.includes("_name") || f.name.includes("customer") || f.name.includes("client") || f.name.includes("owner") || f.name.includes("contact")) {
        row[f.name] = `${firstNames[r % firstNames.length]} ${lastNames[r % lastNames.length]}`;
        continue;
      }
      if (f.name.includes("company") || f.name.includes("organization")) {
        row[f.name] = companies[r % companies.length];
        continue;
      }
      if (f.name.includes("title") || f.name.includes("subject")) {
        const titles = ["Project Alpha", "Q4 Review", "New Initiative", "Bug Fix #42", "Feature Request", "Client Meeting", "Team Update", "Sprint Planning"];
        row[f.name] = titles[r % titles.length];
        continue;
      }
      if (f.name.includes("address") || f.name.includes("location")) {
        const addrs = ["123 Main St", "456 Oak Ave", "789 Pine Rd", "321 Elm Blvd", "654 Cedar Ln", "987 Maple Dr", "147 Birch Way", "258 Walnut Ct"];
        row[f.name] = addrs[r % addrs.length];
        continue;
      }
      if (f.name.includes("date") || f.db_type?.includes("DATE") || f.db_type?.includes("TIMESTAMP")) {
        row[f.name] = new Date(Date.now() + (Math.random() - 0.3) * 60 * 86400000).toLocaleDateString();
        continue;
      }
      if (f.name.includes("url") || f.name.includes("website")) {
        row[f.name] = "https://example.com";
        continue;
      }
      if (f.db_type === "TEXT") {
        row[f.name] = `${formatColumnName(f.name)} details for row ${r + 1}`;
        continue;
      }
      row[f.name] = `${formatColumnName(f.name)} ${r + 1}`;
    }
    rows.push(row);
  }
  return rows;
}
