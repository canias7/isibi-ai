/**
 * SpecPreview — renders a generated spec as a live interactive UI preview.
 * Sidebar navigation, CRUD table with add/edit/delete, detail view, dashboard,
 * Kanban board view, Calendar view, and mobile-responsive layout.
 */
import { useState, useMemo, useEffect, useCallback, memo } from "react";
import {
  LayoutDashboard, Users, ShoppingCart, Building2, Briefcase,
  CalendarDays, FileText, Package, Truck, Heart, Star, Box,
  ChevronRight, Search, Plus, MoreHorizontal, Bell, X,
  ChevronLeft, Pencil, Trash2, Eye, Check, ArrowUpDown,
  Table2, Columns3, Calendar, TrendingUp, Zap, Activity,
  Home, Settings, Menu, Wifi, WifiOff, Loader2, RefreshCw,
  BarChart3,
} from "lucide-react";
import { get, post, patch, del } from "@/api/client";
import type { AppSpec, EntitySpec, FieldSpec, ModuleSpec } from "@/types/spec";

/** A single data row — keys are field names, values are whatever the DB returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataRow = Record<string, any>;

/** Shape returned by the bar-chart helper in the dashboard. */
interface BarDatum { label: string; value: number; }

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, ShoppingCart, Building2, Briefcase,
  CalendarDays, FileText, Package, Truck, Heart, Star, Box,
};

function resolveIcon(name?: string) {
  if (!name) return Box;
  return ICON_MAP[name] || Box;
}

interface SpecPreviewProps {
  spec: AppSpec;
  device: "desktop" | "tablet" | "mobile";
  projectId?: string | null;
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

export function SpecPreview({ spec, device, projectId }: SpecPreviewProps) {
  ensureAnimations();

  const [activeModule, setActiveModule] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [listStyle, setListStyle] = useState<ListStyle>("table");
  const [selectedRow, setSelectedRow] = useState<DataRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState(0);
  const [formData, setFormData] = useState<Record<string, string | number | boolean>>({});
  const [menuOpenRow, setMenuOpenRow] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [notification, setNotification] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);

  // Live mode — toggle between mock data and real API
  const [liveMode, setLiveMode] = useState(false);
  const [liveDataMap, setLiveDataMap] = useState<Record<string, DataRow[]>>({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});

  // Track mock data so we can add/edit/delete
  const [mockDataMap, setMockDataMap] = useState<Record<string, DataRow[]>>({});

  if (!spec || !spec.modules) return null;

  const modules = spec.modules || [];
  const entities = spec.entities || [];
  const currentModule = modules[activeModule];
  const currentEntity = currentModule?.entity
    ? entities.find((e: EntitySpec) => e.name === currentModule.entity) ?? null
    : null;

  const isMobile = device === "mobile";
  const canGoLive = !!projectId;

  // Fetch live data from API
  const fetchLiveData = useCallback(async (tableName: string) => {
    if (!projectId || !tableName) return;
    setLiveLoading(true);
    try {
      const res = await get<{ data: DataRow[]; total?: number }>(
        `/apps/${projectId}/data/${tableName}?page_size=100`
      );
      const rows = Array.isArray(res) ? res : (res?.data || []);
      setLiveDataMap((prev) => ({ ...prev, [tableName]: rows }));
      setLiveCounts((prev) => ({ ...prev, [tableName]: rows.length }));
    } catch {
      setLiveDataMap((prev) => ({ ...prev, [tableName]: [] }));
    } finally {
      setLiveLoading(false);
    }
  }, [projectId]);

  // Fetch live data when switching entities in live mode
  useEffect(() => {
    if (liveMode && currentEntity?.table && projectId) {
      if (!liveDataMap[currentEntity.table]) {
        fetchLiveData(currentEntity.table);
      }
    }
  }, [liveMode, currentEntity?.table, projectId]);

  // Live CRUD operations
  const liveCreate = async (tableName: string, data: Record<string, string | number | boolean>) => {
    if (!projectId) return;
    try {
      await post(`/apps/${projectId}/data/${tableName}`, data);
      showNotification("Created successfully");
      await fetchLiveData(tableName);
    } catch (err: unknown) {
      showNotification((err as Record<string, string>)?.detail || "Create failed");
    }
  };

  const liveUpdate = async (tableName: string, rowId: string, data: Record<string, string | number | boolean>) => {
    if (!projectId) return;
    try {
      await patch(`/apps/${projectId}/data/${tableName}/${rowId}`, data);
      showNotification("Updated successfully");
      await fetchLiveData(tableName);
    } catch (err: unknown) {
      showNotification((err as Record<string, string>)?.detail || "Update failed");
    }
  };

  const liveDelete = async (tableName: string, rowId: string) => {
    if (!projectId) return;
    try {
      await del(`/apps/${projectId}/data/${tableName}/${rowId}`);
      showNotification("Deleted successfully");
      await fetchLiveData(tableName);
    } catch (err: unknown) {
      showNotification((err as Record<string, string>)?.detail || "Delete failed");
    }
  };

  // Data source — mock or live
  const entityKey = currentEntity?.name || "";
  const entityTable = currentEntity?.table || "";
  // Initialize mock data lazily (avoid direct mutation — use setter)
  useEffect(() => {
    if (currentEntity && entityKey && !mockDataMap[entityKey]) {
      setMockDataMap((prev) => ({ ...prev, [entityKey]: [] }));
    }
  }, [entityKey, currentEntity]);
  const allRows = liveMode && entityTable
    ? (liveDataMap[entityTable] || [])
    : (mockDataMap[entityKey] || []);

  const tableColumns = currentEntity
    ? (currentEntity.ui_config?.list_view?.columns || currentEntity.fields
        .filter((f: FieldSpec) => f.show_in_table !== false)
        .slice(0, 6)
        .map((f: FieldSpec) => f.name))
    : [];

  const design = spec.design_system || {};
  const primaryColor = design.colors?.primary || "#000000";

  // Detect features
  const statusField = currentEntity?.fields?.find((f: FieldSpec) => f.name === "status" && (f.enum_values?.length ?? 0) > 0);
  const dateField = currentEntity?.fields?.find((f: FieldSpec) =>
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
      const sf = currentEntity.fields.find((f: FieldSpec) => f.name === "status" || (f.enum_values?.length ?? 0) > 0);
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

  const handleRowClick = (row: DataRow) => {
    setSelectedRow(row);
    setViewMode("detail");
    setMenuOpenRow(null);
  };

  const handleAddClick = () => {
    setFormData({});
    setViewMode("create");
  };

  const handleEditClick = (row: DataRow) => {
    setFormData({ ...row });
    setSelectedRow(row);
    setViewMode("edit");
    setMenuOpenRow(null);
  };

  const handleDeleteClick = async (rowIndex: number) => {
    if (liveMode && entityTable) {
      const row = allRows[rowIndex];
      if (row?.id) {
        await liveDelete(entityTable, row.id);
      }
    } else {
      const updated = [...allRows];
      updated.splice(rowIndex, 1);
      setMockDataMap({ ...mockDataMap, [entityKey]: updated });
      showNotification("Deleted successfully");
    }
    setMenuOpenRow(null);
  };

  const handleFormSubmit = async () => {
    if (liveMode && entityTable) {
      // Live mode — real API calls
      const cleanData: Record<string, string | number | boolean> = {};
      for (const f of currentEntity?.fields || []) {
        if (["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)) continue;
        if (formData[f.name] !== undefined && formData[f.name] !== "") {
          cleanData[f.name] = formData[f.name];
        }
      }
      if (viewMode === "create") {
        await liveCreate(entityTable, cleanData);
      } else if (viewMode === "edit" && selectedRow?.id) {
        await liveUpdate(entityTable, selectedRow.id, cleanData);
      }
    } else {
      // Mock mode
      if (viewMode === "create") {
        const newRow: DataRow = {};
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
    const idx = modules.findIndex((m: ModuleSpec) => m.entity === entityName);
    if (idx >= 0) handleModuleClick(idx);
  };

  const formFields = currentEntity?.fields?.filter((f: FieldSpec) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  const isDashboard = currentModule?.name === "Dashboard" || currentModule?.layout === "dashboard";

  /* ── Render ─── */
  return (
    <div style={{
      display: 'flex', height: '100%', overflow: 'hidden',
      borderRadius: 12, background: '#ffffff', color: '#111827',
      fontSize: 12, lineHeight: 1.5,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }} onClick={() => setMenuOpenRow(null)}>
      {/* Notification toast — matches deployer .toast */}
      {notification && (
        <div className="sp-fade-in" style={{
          position: 'absolute', top: 16, right: 16, zIndex: 200,
          padding: '14px 16px', borderRadius: 12,
          fontSize: 13, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 10px 40px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.03)',
          background: '#fff', border: '1px solid #e5e7eb',
          color: '#111827', borderLeft: `3px solid #10b981`,
        }}>
          <Check style={{ width: 16, height: 16, color: '#10b981' }} />
          {notification}
        </div>
      )}

      {/* ── Sidebar (desktop/tablet) ─── */}
      {!isMobile && (
        <div style={{
          width: 208,
          background: 'linear-gradient(to bottom, rgba(249,250,251,0.8), #ffffff)',
          borderRight: '1px solid rgba(243,244,246,0.8)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          {/* Sidebar header — app logo + name + Workspace */}
          <div style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid rgba(243,244,246,0.8)',
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 8,
              background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 10, flexShrink: 0,
              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            }}>
              {(spec?.app_name || spec?.name || "A")[0]?.toUpperCase() || "A"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 12, fontWeight: 600, color: '#111827',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                letterSpacing: '-0.02em', margin: 0,
              }}>
                {spec?.app_name || spec?.name || "My App"}
              </p>
              {/* Deployer hides this subtitle (display:none) */}
            </div>
          </div>

          {/* Sidebar nav with section label */}
          <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontSize: 9, fontWeight: 600, color: '#9ca3af',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              padding: '4px 10px 4px',
            }}>Navigation</div>
            {modules.map((mod: ModuleSpec, i: number) => {
              const Icon = resolveIcon(mod.sidebar_icon);
              const isActive = i === activeModule;
              return (
                <button
                  key={mod.name || i}
                  onClick={() => handleModuleClick(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', textAlign: 'left',
                    padding: '8px 10px', border: 'none',
                    borderRadius: 8, fontSize: 11, fontWeight: 500,
                    color: isActive ? '#ffffff' : '#6b7280',
                    cursor: 'pointer', margin: 0,
                    transition: 'all 0.15s ease',
                    background: isActive
                      ? `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`
                      : 'none',
                    boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'rgba(243,244,246,0.8)'; (e.currentTarget as HTMLElement).style.color = '#1f2937'; }}}
                  onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}}
                >
                  <Icon style={{ width: 14, height: 14, flexShrink: 0, opacity: isActive ? 1 : 0.7 }} />
                  {mod.name}
                </button>
              );
            })}
            {/* INSIGHTS section label */}
            <div style={{
              fontSize: 9, fontWeight: 600, color: '#9ca3af',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              padding: '12px 10px 4px',
            }}>Insights</div>
            {/* Analytics — deployer always shows this */}
            <button
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', textAlign: 'left',
                padding: '8px 10px', border: 'none',
                borderRadius: 8, fontSize: 11, fontWeight: 500,
                color: '#6b7280', cursor: 'pointer', margin: 0,
                background: 'none', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(243,244,246,0.8)'; (e.currentTarget as HTMLElement).style.color = '#1f2937'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
            >
              <BarChart3 style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.7 }} />
              Analytics
            </button>
            {/* Overview — deployer shows this when 3+ entities */}
            {entities.length >= 3 && (
              <button
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', textAlign: 'left',
                  padding: '8px 10px', border: 'none',
                  borderRadius: 8, fontSize: 11, fontWeight: 500,
                  color: '#6b7280', cursor: 'pointer', margin: 0,
                  background: 'none', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(243,244,246,0.8)'; (e.currentTarget as HTMLElement).style.color = '#1f2937'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
              >
                <Home style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.7 }} />
                Overview
              </button>
            )}
          </nav>

          {/* Sidebar footer — matches deployer .sidebar-footer */}
          <div style={{
            padding: 12,
            borderTop: '1px solid rgba(243,244,246,0.8)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'linear-gradient(to bottom right, #e5e7eb, #d1d5db)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#4b5563', flexShrink: 0,
              }}>U</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>User</p>
                <p style={{ fontSize: 9, color: '#9ca3af', margin: 0 }}>Member</p>
              </div>
            </div>
            {/* Logout button — matches deployer .logout-btn */}
            <button style={{
              background: 'none', border: '1px solid #e5e7eb',
              padding: '4px 10px', borderRadius: 6,
              fontSize: 11, color: '#9ca3af', cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}>
              <Settings style={{ width: 10, height: 10, opacity: 0.5 }} />
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ─── */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {/* Top bar — matches deployer .topbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 42,
          borderBottom: '1px solid rgba(243,244,246,0.8)',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(8px)',
          flexShrink: 0, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
            {viewMode !== "list" && (
              <button
                onClick={() => { setViewMode("list"); setSelectedRow(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  borderRadius: 8, padding: '4px 8px', fontSize: 10,
                  color: '#9ca3af', border: 'none', background: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <ChevronLeft style={{ width: 12, height: 12 }} />
                Back
              </button>
            )}
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                {spec?.app_name || spec?.name || "App"}
              </span>
              <span style={{ fontSize: 10, color: '#d1d5db', fontWeight: 400 }}>/</span>
              <span style={{ fontSize: 13, color: '#111827', fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {viewMode === "create" ? `New ${currentEntity?.name || ""}` :
                 viewMode === "edit" ? `Edit ${currentEntity?.name || ""}` :
                 viewMode === "detail" ? (selectedRow?.[formFields[0]?.name] || currentEntity?.name) :
                 currentModule?.name || "Dashboard"}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Live/Mock toggle */}
            {canGoLive && (
              <button
                onClick={() => {
                  setLiveMode(!liveMode);
                  if (!liveMode && currentEntity?.table) {
                    fetchLiveData(currentEntity.table);
                  }
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-all duration-150 ${
                  liveMode
                    ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
                title={liveMode ? "Switch to mock data" : "Switch to live database"}
              >
                {liveLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : liveMode ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                {liveMode ? "Live" : "Mock"}
              </button>
            )}
            {liveMode && (
              <button
                onClick={() => currentEntity?.table && fetchLiveData(currentEntity.table)}
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 transition"
                title="Refresh data"
              >
                <RefreshCw className={`h-3 w-3 text-gray-500 ${liveLoading ? "animate-spin" : ""}`} />
              </button>
            )}
            {/* Notification bell — matches deployer .notif-bell */}
            <button style={{
              position: 'relative', background: '#f9fafb', border: 'none', cursor: 'pointer',
              padding: 5, borderRadius: 8, color: '#6b7280',
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <Bell style={{ width: 14, height: 14 }} />
              <span style={{
                position: 'absolute', top: -2, right: -2,
                width: 8, height: 8, background: primaryColor,
                borderRadius: '50%', border: '2px solid #fff',
              }} />
            </button>
            {/* Topbar avatar — matches deployer .topbar-avatar (rounded square) */}
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: '#f9fafb',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all 0.15s ease',
              fontSize: 10, fontWeight: 600, color: '#4b5563',
            }}>
              {(spec?.app_name || spec?.name || "A")[0]?.toUpperCase() || "A"}
            </div>
          </div>
        </div>

        {/* Page content — matches deployer .content */}
        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '12px 12px 64px' : 16 }}>
          <div className="sp-fade-in" key={`${activeModule}-${viewMode}-${listStyle}`}>
            {(viewMode === "create" || viewMode === "edit") && currentEntity ? (
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
            ) : viewMode === "detail" && selectedRow && currentEntity ? (
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
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
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
            {modules.slice(0, 5).map((mod: ModuleSpec, i: number) => {
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
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  active: boolean;
  onClick: () => void;
  primaryColor: string;
}) {
  /* Matches deployer .view-toggle-btn */
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px', borderRadius: 8,
        fontSize: 10, fontWeight: 500,
        cursor: 'pointer', border: 'none',
        background: active
          ? `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`
          : '#f9fafb',
        color: active ? '#ffffff' : '#6b7280',
        transition: 'all 0.15s ease',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'inherit',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      <Icon style={{ width: 12, height: 12 }} />
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Dashboard Preview
   ═══════════════════════════════════════════════════════════════════ */
const DashboardPreview = memo(function DashboardPreview({ spec, primaryColor, onCardClick, mockDataMap, isMobile }: {
  spec: AppSpec;
  primaryColor: string;
  onCardClick: (entity: string) => void;
  mockDataMap: Record<string, DataRow[]>;
  isMobile: boolean;
}) {
  const stats = spec.dashboard?.stat_cards || [];
  const entities = spec.entities || [];
  const cards = stats.length > 0 ? stats : entities.slice(0, 4).map((e: EntitySpec) => ({ label: `Total ${e.name}s`, entity: e.name }));

  // Deployer stat-card gradient colors: primary, green, amber, purple
  const statGradients = [
    `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})`,
    `linear-gradient(135deg, #10b981, #34d399)`,
    `linear-gradient(135deg, #f59e0b, #fbbf24)`,
    `linear-gradient(135deg, #8b5cf6, #a78bfa)`,
  ];

  // First entity data for "recent items"
  const firstEntity = entities[0];
  const firstEntityRows = firstEntity ? (mockDataMap[firstEntity.name] || []) : [];
  const recentItems = firstEntityRows.slice(-5).reverse();
  const nameField = firstEntity?.fields?.find((f: FieldSpec) =>
    f.name === "name" || f.name.includes("_name") || f.name.includes("title")
  );

  // Simple bar chart data
  const barData: BarDatum[] = entities.slice(0, 5).map((e: EntitySpec) => ({
    label: e.name,
    value: (mockDataMap[e.name] || []).length,
  }));
  const maxBar = Math.max(...barData.map((d: BarDatum) => d.value), 1);

  return (
    <div>
      {/* Stat cards — matches deployer .stats-grid + .stat-card */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: 12, marginBottom: 16,
      }}>
        {cards.map((item, i: number) => {
          const entityKey = ('entity' in item ? item.entity : undefined) || ('name' in item ? item.name : undefined) || '';
          const count = (mockDataMap[entityKey] || []).length;
          return (
            <div
              key={i}
              onClick={() => onCardClick(entityKey)}
              className={`sp-fade-in sp-stagger-${i + 1}`}
              style={{
                borderRadius: 12, padding: 14, color: '#ffffff',
                background: statGradients[i % statGradients.length],
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                cursor: 'pointer', position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                  {item.label || `Total ${'name' in item ? item.name : ''}s`}
                </span>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)',
                }}>
                  <TrendingUp style={{ width: 12, height: 12 }} />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.2, marginTop: 8 }}>{count}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {count === 0 ? "No data yet" : `${count} total item${count !== 1 ? "s" : ""}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart + Recent activity in grid — matches deployer .dashboard-grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Bar chart — matches deployer .chart-container */}
        <div style={{
          background: '#fff', border: '1px solid rgba(243,244,246,0.8)',
          borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: '#111827', margin: 0 }}>Overview</h3>
            <Activity style={{ width: 14, height: 14, color: '#d1d5db' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96, paddingTop: 4, position: 'relative' }}>
            {barData.map((d: BarDatum, i: number) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4, position: 'relative' }}>
                <div
                  style={{
                    width: '100%',
                    borderRadius: '4px 4px 0 0',
                    minHeight: 4,
                    height: `${Math.max((d.value / maxBar) * 80, 4)}px`,
                    background: d.value > 0
                      ? `linear-gradient(to top, ${primaryColor}, ${withAlpha(primaryColor, 0.6)})`
                      : "#e5e7eb",
                    transition: 'all 0.3s ease',
                  }}
                />
                <span style={{ fontSize: 8, color: '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent items — matches deployer .activity-list */}
        <div style={{
          background: '#fff', border: '1px solid rgba(243,244,246,0.8)',
          borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: '#111827', margin: 0 }}>Recent {firstEntity?.name || "Items"}</h3>
            <span style={{ fontSize: 9, color: '#9ca3af' }}>{recentItems.length} item{recentItems.length !== 1 ? "s" : ""}</span>
          </div>
          <div style={{ padding: '4px 0' }}>
          {recentItems.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0', textAlign: 'center' }}>
              <Box style={{ width: 20, height: 20, color: '#e5e7eb', marginBottom: 8 }} />
              <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>No items yet</p>
              <p style={{ fontSize: 9, color: '#d1d5db', margin: '2px 0 0' }}>Add data to see recent items</p>
            </div>
          ) : (
            recentItems.map((row, i) => {
              const label = nameField ? row[nameField.name] : `Item ${i + 1}`;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 16px', borderRadius: 8, margin: '0 8px',
                  cursor: 'pointer', transition: 'background 150ms ease',
                }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: '#ffffff',
                    background: `linear-gradient(135deg, ${statusColor(i)}, ${withAlpha(statusColor(i), 0.7)})`,
                  }}>
                    {(label || "?")[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: '#1f2937' }}>{label}</span>
                    <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 400 }}>{row.created_at || "Just now"}</span>
                  </div>
                  <ChevronRight style={{ width: 12, height: 12, color: '#d1d5db' }} />
                </div>
              );
            })
          )}
          </div>
        </div>
      </div>

      {/* Quick actions — matches deployer quick-actions style */}
      <div style={{
        border: '1px solid rgba(243,244,246,0.8)', borderRadius: 12,
        background: '#fff', padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Quick Actions</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {entities.slice(0, 4).map((e: EntitySpec, i: number) => (
            <button
              key={i}
              onClick={() => onCardClick(e.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: '1px solid rgba(243,244,246,1)', borderRadius: 8,
                padding: '10px 12px', background: '#fff', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 10, fontWeight: 500,
                color: '#4b5563', transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(229,231,235,1)'; el.style.background = '#f9fafb'; }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(243,244,246,1)'; el.style.background = '#fff'; }}
            >
              <span style={{
                display: 'flex', width: 20, height: 20,
                alignItems: 'center', justifyContent: 'center',
                borderRadius: 6, background: withAlpha(primaryColor, 0.1),
              }}>
                <Plus style={{ width: 12, height: 12, color: primaryColor }} />
              </span>
              Add {e.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════
   Table Preview
   ═══════════════════════════════════════════════════════════════════ */
const TablePreview = memo(function TablePreview({
  entity, columns, rows, primaryColor,
  onRowClick, onAddClick, onEditClick, onDeleteClick,
  menuOpenRow, setMenuOpenRow,
  activeFilter, setActiveFilter,
  onSort, sortCol, sortDir, isMobile,
  searchQuery, setSearchQuery,
}: {
  entity: EntitySpec;
  columns: string[];
  rows: DataRow[];
  primaryColor: string;
  onRowClick: (row: DataRow) => void;
  onAddClick: () => void;
  onEditClick: (row: DataRow) => void;
  onDeleteClick: (i: number) => void;
  menuOpenRow: number | null;
  setMenuOpenRow: (i: number | null) => void;
  activeFilter: number;
  setActiveFilter: (i: number) => void;
  onSort: (col: string) => void;
  sortCol: string | null;
  sortDir: "asc" | "desc";
  isMobile: boolean;
  searchQuery?: string;
  setSearchQuery?: (q: string) => void;
}) {
  const visibleCols = isMobile ? columns.slice(0, 3) : columns.slice(0, 6);
  const statusField = entity.fields?.find((f: FieldSpec) => f.name === "status" && (f.enum_values?.length ?? 0) > 0);
  const enumField = entity.fields?.find((f: FieldSpec) => (f.enum_values?.length ?? 0) > 0 && !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name));

  return (
    <div>
      {/* Header row — matches deployer table header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.02em', color: '#111827', margin: 0 }}>{entity.name}s</p>
          <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, margin: 0 }}>{rows.length} total result{rows.length !== 1 ? "s" : ""}</p>
        </div>
        {/* Add button — matches deployer .btn.btn-primary */}
        <button
          onClick={onAddClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', border: 'none', borderRadius: 8,
            fontSize: 10, fontWeight: 500, cursor: 'pointer',
            background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`,
            color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
        >
          <Plus style={{ width: 12, height: 12 }} />
          Add {entity.name}
        </button>
      </div>

      {/* Status/filter tabs — matches deployer .status-tabs */}
      {(statusField || enumField) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <FilterTab label="All" active={activeFilter === 0} onClick={() => setActiveFilter(0)} primaryColor={primaryColor} />
          {(statusField || enumField)?.enum_values?.map((val: string, i: number) => (
            <FilterTab key={i} label={formatColumnName(val)} active={activeFilter === i + 1} onClick={() => setActiveFilter(i + 1)} primaryColor={primaryColor} dotColor={statusColor(i)} />
          ))}
        </div>
      )}

      {/* Search bar — matches deployer .search-input */}
      {setSearchQuery && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px',
          border: '1px solid rgba(229,231,235,0.8)', borderRadius: 8,
          background: '#fff', minWidth: 160, height: 28,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: 12,
          maxWidth: 240,
        }}>
          <Search style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery || ""}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${entity.name}...`}
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 11, color: '#1f2937', width: '100%', fontFamily: 'inherit',
            }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}>
              <X style={{ width: 10, height: 10, color: '#9ca3af' }} />
            </button>
          )}
        </div>
      )}

      {/* Table — matches deployer .table-container */}
      <div style={{
        background: '#fff', border: '1px solid rgba(243,244,246,0.8)',
        borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto', position: 'relative' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, minWidth: 400 }}>
            <thead>
              <tr>
                {/* Checkbox column — matches deployer bulk-cb */}
                <th style={{
                  width: 36, padding: '8px 8px', cursor: 'default',
                  background: 'rgba(249,250,251,0.8)',
                  borderBottom: '1px solid rgba(243,244,246,1)',
                }}>
                  <input type="checkbox" style={{ width: 16, height: 16, accentColor: primaryColor, cursor: 'pointer', margin: 0 }} readOnly />
                </th>
                {visibleCols.map((col: string, i: number) => (
                  <th
                    key={i}
                    onClick={() => onSort(col)}
                    style={{
                      textAlign: 'left', padding: '8px 12px',
                      background: 'rgba(249,250,251,0.8)',
                      borderBottom: '1px solid rgba(243,244,246,1)',
                      fontWeight: 600, fontSize: 10,
                      color: sortCol === col ? '#374151' : '#9ca3af',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    }}
                  >
                    {formatColumnName(col)}
                    <span style={{ display: 'inline-block', marginLeft: 4, fontSize: 9, opacity: sortCol === col ? 1 : 0.4 }}>
                      {sortCol === col ? (sortDir === 'asc' ? '\u25B4' : '\u25BE') : '\u25B4\u25BE'}
                    </span>
                  </th>
                ))}
                <th style={{
                  textAlign: 'right', padding: '8px 12px', cursor: 'default',
                  background: 'rgba(249,250,251,0.8)',
                  borderBottom: '1px solid rgba(243,244,246,1)',
                  fontSize: 10, fontWeight: 600, color: '#9ca3af',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length + 2} style={{ textAlign: 'center', padding: '48px 16px', color: '#9ca3af' }}>
                    <div className="sp-fade-in" style={{ maxWidth: 280, margin: '0 auto' }}>
                      {/* Empty state icon — matches deployer .empty-state-icon */}
                      <div style={{
                        width: 40, height: 40, margin: '0 auto 12px', borderRadius: 12,
                        background: '#f9fafb',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Box style={{ width: 20, height: 20, opacity: 0.4, color: '#d1d5db' }} />
                      </div>
                      <p style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', marginBottom: 4 }}>No {entity.name}s yet</p>
                      <p style={{ fontSize: 10, marginBottom: 16, color: '#9ca3af', lineHeight: 1.5 }}>Create your first {entity.name.toLowerCase()} to get started.</p>
                      <button
                        onClick={onAddClick}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', border: 'none', borderRadius: 8,
                          fontSize: 10, fontWeight: 500, cursor: 'pointer',
                          background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`,
                          color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                          fontFamily: 'inherit',
                        }}
                      >
                        <Plus style={{ width: 12, height: 12 }} />
                        Add {entity.name}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row, ri) => (
                <tr
                  key={ri}
                  onClick={() => onRowClick(row)}
                  style={{ cursor: 'pointer', transition: 'all 100ms ease' }}
                  className="group"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(249,250,251,0.8)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {/* Checkbox */}
                  <td style={{ width: 36, padding: '10px 8px', borderBottom: '1px solid rgba(249,250,251,1)' }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" style={{ width: 16, height: 16, accentColor: primaryColor, cursor: 'pointer', margin: 0 }} />
                  </td>
                  {visibleCols.map((col: string, ci: number) => {
                    const field = entity.fields.find((f: FieldSpec) => f.name === col);
                    const val = row[col];
                    const isNameField = col === "name" || col.includes("_name") || col.includes("contact") || col.includes("customer");
                    return (
                      <td key={ci} style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid rgba(249,250,251,1)',
                        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontSize: 10, color: ci === 0 ? '#1f2937' : '#4b5563',
                        fontWeight: ci === 0 ? 500 : 400,
                      }}>
                        {field?.badge_colors && val ? (
                          <StatusBadge label={formatColumnName(val)} color={field.badge_colors[val]} />
                        ) : field?.enum_values && val ? (
                          <StatusBadge label={formatColumnName(val)} color={undefined} />
                        ) : isNameField && val ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: '50%',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0, textTransform: 'uppercase',
                              background: `linear-gradient(135deg, ${statusColor(ri)}, ${withAlpha(statusColor(ri), 0.7)})`,
                            }}>
                              {String(val)[0]?.toUpperCase()}
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 500, color: '#1f2937' }}>{val}</span>
                          </div>
                        ) : (
                          <span>{val}</span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{
                    padding: '10px 12px', textAlign: 'right', position: 'relative',
                    borderBottom: '1px solid rgba(249,250,251,1)',
                  }}>
                    <div style={{ display: 'inline-flex', gap: 2 }} className="opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditClick(row); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#9ca3af' }}
                        title="Edit"
                      >
                        <Pencil style={{ width: 12, height: 12 }} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenRow(menuOpenRow === ri ? null : ri); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#9ca3af' }}
                      >
                        <MoreHorizontal style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                    {menuOpenRow === ri && (
                      <div
                        className="sp-fade-in"
                        style={{
                          position: 'absolute', right: 8, top: '100%', zIndex: 10,
                          width: 132, borderRadius: 12,
                          border: '1px solid rgba(229,231,235,0.8)',
                          background: '#fff', padding: '6px 0',
                          boxShadow: '0 10px 40px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.03)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => onRowClick(row)}
                          style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 10, color: '#4b5563', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Eye style={{ width: 12, height: 12 }} /> View details
                        </button>
                        <button onClick={() => onEditClick(row)}
                          style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 10, color: '#4b5563', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Pencil style={{ width: 12, height: 12 }} /> Edit
                        </button>
                        <div style={{ margin: '4px 0', borderTop: '1px solid #f3f4f6' }} />
                        <button onClick={() => onDeleteClick(ri)}
                          style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 10, color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <Trash2 style={{ width: 12, height: 12 }} /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination — matches deployer .table-footer */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', marginTop: 8, fontSize: 10, color: '#9ca3af' }}>
          <span>Showing {rows.length} of {rows.length} results</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button style={{
              padding: '4px 10px', borderRadius: 8,
              border: '1px solid #e5e7eb', background: '#fff',
              fontSize: 10, fontWeight: 500, color: '#9ca3af',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Prev</button>
            <button style={{
              padding: '4px 10px', borderRadius: 8,
              border: `1px solid ${primaryColor}`,
              background: primaryColor, color: '#fff',
              fontSize: 10, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            }}>1</button>
            <button style={{
              padding: '4px 10px', borderRadius: 8,
              border: '1px solid #e5e7eb', background: '#fff',
              fontSize: 10, fontWeight: 500, color: '#9ca3af',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════
   Board / Kanban Preview
   ═══════════════════════════════════════════════════════════════════ */
const BoardPreview = memo(function BoardPreview({ entity, rows, statusField, primaryColor, onRowClick, onAddClick }: {
  entity: EntitySpec;
  rows: DataRow[];
  statusField: FieldSpec | undefined;
  primaryColor: string;
  onRowClick: (row: DataRow) => void;
  onAddClick: () => void;
}) {
  if (!statusField) return null;
  const statuses: string[] = statusField.enum_values || [];
  const nameField = entity.fields?.find((f: FieldSpec) =>
    f.name === "name" || f.name.includes("_name") || f.name.includes("title") || f.name.includes("subject")
  );
  const secondaryField = entity.fields?.find((f: FieldSpec) =>
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
});

/* ═══════════════════════════════════════════════════════════════════
   Calendar Preview
   ═══════════════════════════════════════════════════════════════════ */
const CalendarPreview = memo(function CalendarPreview({ entity, rows, dateField, primaryColor, onRowClick, onAddClick, calendarMonth, setCalendarMonth, calendarSelectedDate, setCalendarSelectedDate }: {
  entity: EntitySpec;
  rows: DataRow[];
  dateField: FieldSpec;
  primaryColor: string;
  onRowClick: (row: DataRow) => void;
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
    const map: Record<string, DataRow[]> = {};
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

  const nameField = entity.fields?.find((f: FieldSpec) =>
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
});

/* ═══════════════════════════════════════════════════════════════════
   Detail Preview
   ═══════════════════════════════════════════════════════════════════ */
const DetailPreview = memo(function DetailPreview({
  entity, row, primaryColor, onEdit, onBack, isMobile,
}: {
  entity: EntitySpec;
  row: DataRow;
  primaryColor: string;
  onEdit: () => void;
  onBack: () => void;
  isMobile: boolean;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const fields = entity?.fields?.filter((f: FieldSpec) =>
    !["id", "org_id", "deleted_at", "version"].includes(f.name)
  ) || [];

  // Deployer uses: Overview, Details, Related, Activity, Files, Comments
  const defaultTabs = [
    { name: "Overview" },
    { name: "Details" },
    { name: "Related" },
    { name: "Activity" },
    { name: "Files" },
    { name: "Comments" },
  ];
  const tabs = entity?.ui_config?.detail_view?.tabs || defaultTabs;
  const nameField = fields[0];
  const statusFieldDef = entity?.fields?.find((f: FieldSpec) => f.name === "status");

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Header card — matches deployer .detail-header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        border: '1px solid rgba(243,244,246,0.8)', borderRadius: 12,
        padding: 16, marginBottom: 16,
        background: 'linear-gradient(to right, #f9fafb, #ffffff)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
            background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.7)})`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}>
            {String(row[nameField?.name] || "?")[0]?.toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: 0 }}>
              {row[nameField?.name] || entity?.name}
            </p>
            {row.status && statusFieldDef && (
              <div style={{ marginTop: 4, display: 'inline-flex' }}>
                <StatusBadge label={formatColumnName(row.status)} color={statusFieldDef?.badge_colors?.[row.status]} />
              </div>
            )}
          </div>
        </div>
        {/* Edit button — matches deployer .btn */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onEdit}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', border: '1px solid #e5e7eb',
              borderRadius: 8, fontSize: 10, fontWeight: 500,
              cursor: 'pointer', background: '#fff', color: '#111827',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            <Pencil style={{ width: 12, height: 12 }} /> Edit
          </button>
        </div>
      </div>

      {/* Tabs — matches deployer .detail-tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb',
        marginBottom: 0, overflowX: 'auto',
      }}>
        {tabs.map((tab: { name: string }, i: number) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            style={{
              padding: '8px 12px', fontSize: 10, fontWeight: 500,
              color: i === activeTab ? primaryColor : '#9ca3af',
              cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: i === activeTab ? `2px solid ${primaryColor}` : '2px solid transparent',
              background: 'none', border: 'none',
              borderBottomStyle: 'solid', borderBottomWidth: 2,
              borderBottomColor: i === activeTab ? primaryColor : 'transparent',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.name || `Tab ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Fields grid — matches deployer .detail-fields-grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 12, marginTop: 16,
      }}>
        {fields.map((f: FieldSpec, i: number) => {
          const isNameLike = f.name === "name" || f.name.includes("_name") || f.name.includes("contact");
          return (
            <div key={i} style={{
              padding: 12, border: '1px solid rgba(243,244,246,0.6)',
              borderRadius: 12, background: 'rgba(249,250,251,0.5)',
              transition: 'background 0.15s ease',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {/* Label — matches deployer .detail-field-label */}
              <span style={{
                fontSize: 9, fontWeight: 600, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{formatColumnName(f.name)}</span>
              {/* Value — matches deployer .detail-field-value */}
              <div>
                {f.badge_colors && row[f.name] ? (
                  <StatusBadge label={formatColumnName(row[f.name])} color={f.badge_colors[row[f.name]]} />
                ) : f.enum_values && row[f.name] ? (
                  <StatusBadge label={formatColumnName(row[f.name])} color={undefined} />
                ) : isNameLike && row[f.name] ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 700, color: '#fff',
                      background: `linear-gradient(135deg, ${statusColor(i)}, ${withAlpha(statusColor(i), 0.7)})`,
                    }}>
                      {String(row[f.name])[0]?.toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#1f2937' }}>{row[f.name]}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: row[f.name] ? '#1f2937' : '#c0c5ce', fontStyle: row[f.name] ? 'normal' : 'italic' }}>
                    {row[f.name] || "---"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════
   Form Preview
   ═══════════════════════════════════════════════════════════════════ */
const FormPreview = memo(function FormPreview({
  entity, formData, setFormData, onSubmit, onCancel, primaryColor, mode, isMobile,
}: {
  entity: EntitySpec;
  formData: Record<string, string | number | boolean>;
  setFormData: (d: Record<string, string | number | boolean>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  primaryColor: string;
  mode: "create" | "edit";
  isMobile: boolean;
}) {
  const fields = entity?.fields?.filter((f: FieldSpec) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  /* Deployer form uses a slide-over panel. We render inline but match the visual structure:
     - Header with title
     - Body with form groups (label uppercase 10px 600, required asterisk in primary)
     - Footer with gradient submit + outline cancel */

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    border: '1px solid #e5e7eb', borderRadius: 8,
    fontSize: 11, color: '#1f2937', background: '#fff',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    marginTop: 4,
  };

  return (
    <div>
      {/* Slide-over header — matches deployer .slide-over-header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 0', borderBottom: '1px solid #e5e7eb', marginBottom: 0,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: 0 }}>
          {mode === "create" ? `New ${entity?.name}` : `Edit ${entity?.name}`}
        </h3>
        <button onClick={onCancel} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#9ca3af', padding: 6, borderRadius: 8,
        }}>
          <X style={{ width: 20, height: 20 }} />
        </button>
      </div>

      {/* Slide-over body — matches deployer .slide-over-body */}
      <div style={{ padding: '24px 0' }}>
        {fields.map((f: FieldSpec, i: number) => (
          <div key={i} style={{ marginBottom: 12 }}>
            {/* Label — matches deployer .form-group label */}
            <label style={{
              display: 'block', fontSize: 10, fontWeight: 600,
              color: '#6b7280', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {formatColumnName(f.name)}
              {!f.nullable && (
                <span style={{ color: '#f87171', marginLeft: 2, fontSize: 12, lineHeight: 1 }}>*</span>
              )}
            </label>
            {f.enum_values ? (
              <select
                value={String(formData[f.name] ?? "")}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">Select...</option>
                {f.enum_values.map((v: string) => (
                  <option key={v} value={v}>{formatColumnName(v)}</option>
                ))}
              </select>
            ) : f.db_type?.includes("BOOLEAN") ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: '#1f2937', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData[f.name] === true || formData[f.name] === "Yes"}
                  onChange={(e) => setFormData({ ...formData, [f.name]: e.target.checked })}
                  style={{ width: 'auto', accentColor: primaryColor }}
                />
                {formatColumnName(f.name)}
              </label>
            ) : f.db_type?.includes("TEXT") && !f.db_type?.includes("VARCHAR") ? (
              <textarea
                value={String(formData[f.name] ?? "")}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                rows={3}
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                placeholder={`Enter ${formatColumnName(f.name).toLowerCase()}...`}
              />
            ) : (
              <input
                type={f.db_type?.includes("INT") || f.db_type?.includes("NUMERIC") ? "number" : f.db_type?.includes("DATE") ? "date" : "text"}
                value={String(formData[f.name] ?? "")}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                style={inputStyle}
                placeholder={`Enter ${formatColumnName(f.name).toLowerCase()}...`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Slide-over footer — matches deployer .slide-over-footer */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        padding: '16px 0', borderTop: '1px solid #e5e7eb',
      }}>
        <button
          onClick={onCancel}
          style={{
            background: 'transparent', color: '#6b7280',
            border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '8px 16px', fontSize: 10, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          style={{
            background: `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`,
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 10, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          {mode === "create" ? `Create ${entity?.name}` : "Save Changes"}
        </button>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════
   Shared Components
   ═══════════════════════════════════════════════════════════════════ */

function StatusBadge({ label, color }: { label: string; color?: string }) {
  /* Matches deployer .badge with ::before dot */
  const colorMap: Record<string, { bg: string; text: string; dot: string }> = {
    pink:    { bg: "#fdf2f8", text: "#9d174d", dot: "#ec4899" },
    blue:    { bg: "#eff6ff", text: "#1e40af", dot: "#3b82f6" },
    green:   { bg: "#ecfdf5", text: "#065f46", dot: "#10b981" },
    red:     { bg: "#fef2f2", text: "#991b1b", dot: "#ef4444" },
    amber:   { bg: "#fffbeb", text: "#92400e", dot: "#f59e0b" },
    yellow:  { bg: "#fffbeb", text: "#92400e", dot: "#f59e0b" },
    purple:  { bg: "#faf5ff", text: "#6b21a8", dot: "#a855f7" },
    indigo:  { bg: "#eef2ff", text: "#3730a3", dot: "#6366f1" },
    orange:  { bg: "#fff7ed", text: "#9a3412", dot: "#f97316" },
    slate:   { bg: "#f8fafc", text: "#475569", dot: "#94a3b8" },
    gray:    { bg: "#f8fafc", text: "#475569", dot: "#94a3b8" },
  };
  const c = colorMap[color || "gray"] || colorMap.gray;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 9999,
      fontSize: 9, fontWeight: 500, whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
      background: c.bg, color: c.text,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: c.dot }} />
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
  /* Matches deployer .status-tab */
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px', borderRadius: 8,
        fontSize: 10, fontWeight: 500,
        cursor: 'pointer', border: 'none',
        background: active
          ? `linear-gradient(135deg, ${primaryColor}, ${withAlpha(primaryColor, 0.8)})`
          : '#f9fafb',
        color: active ? '#ffffff' : '#6b7280',
        transition: 'all 0.15s ease',
        fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6,
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {dotColor && !active && <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', backgroundColor: dotColor }} />}
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

function generateMockRows(entity: EntitySpec, count: number): DataRow[] {
  const fields: FieldSpec[] = entity.fields || [];
  const rows: DataRow[] = [];
  const firstNames = ["James", "Sofia", "Liam", "Emma", "Noah", "Olivia", "Ethan", "Ava", "Mason", "Isabella"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
  const companies = ["Alpha Corp", "Beta LLC", "Gamma Inc", "Delta Co", "Epsilon Ltd", "Zeta Group", "Eta Solutions", "Theta Partners"];

  for (let r = 0; r < count; r++) {
    const row: DataRow = {};
    for (const f of fields) {
      if (["id", "org_id", "deleted_at", "version"].includes(f.name)) continue;
      if (f.name === "created_at" || f.name === "updated_at") {
        row[f.name] = new Date(Date.now() - Math.random() * 30 * 86400000).toLocaleDateString();
        continue;
      }
      if ((f.enum_values?.length ?? 0) > 0) {
        row[f.name] = f.enum_values![Math.floor(Math.random() * f.enum_values!.length)];
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
