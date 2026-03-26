/**
 * SpecPreview — renders a generated spec as a live interactive UI preview.
 * Sidebar navigation, CRUD table with add/edit/delete, detail view, dashboard.
 */
import { useState, useMemo } from "react";
import {
  LayoutDashboard, Users, ShoppingCart, Building2, Briefcase,
  CalendarDays, FileText, Package, Truck, Heart, Star, Box,
  ChevronRight, Search, Plus, MoreHorizontal, Bell, X,
  ChevronLeft, Pencil, Trash2, Eye, Check, ArrowUpDown,
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

export function SpecPreview({ spec, device }: SpecPreviewProps) {
  const [activeModule, setActiveModule] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [menuOpenRow, setMenuOpenRow] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [notification, setNotification] = useState<string | null>(null);

  // Track mock data so we can add/edit/delete
  const [mockDataMap, setMockDataMap] = useState<Record<string, any[]>>({});

  if (!spec || !spec.modules) return null;

  const modules = spec.modules || [];
  const entities = spec.entities || [];
  const currentModule = modules[activeModule];
  const currentEntity = currentModule?.entity
    ? entities.find((e: any) => e.name === currentModule.entity)
    : null;

  // Generate or retrieve mock data for current entity
  const entityKey = currentEntity?.name || "";
  if (currentEntity && !mockDataMap[entityKey]) {
    mockDataMap[entityKey] = generateMockRows(currentEntity, 8);
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

  // Filter rows by search
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    // Filter by tab (status field)
    if (activeFilter > 0 && currentEntity) {
      const statusField = currentEntity.fields.find((f: any) => f.name === "status" || f.enum_values?.length > 0);
      if (statusField?.enum_values) {
        const filterValue = statusField.enum_values[activeFilter - 1];
        rows = rows.filter((row) => row[statusField.name] === filterValue);
      }
    }
    // Sort
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
    setSelectedRow(null);
    setSearchQuery("");
    setActiveFilter(0);
    setMenuOpenRow(null);
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
      // Add new row
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
      // Update existing row
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

  // Get form fields (fields that show in form)
  const formFields = currentEntity?.fields?.filter((f: any) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  return (
    <div className="flex h-full overflow-hidden rounded-lg bg-white text-xs" onClick={() => setMenuOpenRow(null)}>
      {/* Notification toast */}
      {notification && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-2 rounded-lg bg-green-500 px-3 py-2 text-[11px] font-medium text-white shadow-lg animate-in fade-in">
          <Check className="h-3 w-3" />
          {notification}
        </div>
      )}

      {/* Mini sidebar */}
      {device !== "mobile" && (
        <div className="flex w-48 shrink-0 flex-col border-r border-gray-100 bg-gray-50">
          <div className="border-b border-gray-100 px-3 py-2.5">
            <p className="text-[11px] font-bold text-black" style={{ color: primaryColor }}>
              {spec.app_name || spec.name || "My App"}
            </p>
          </div>
          <nav className="flex-1 space-y-0.5 px-2 py-2">
            {modules.map((mod: any, i: number) => {
              const Icon = resolveIcon(mod.sidebar_icon);
              const isActive = i === activeModule;
              return (
                <button
                  key={i}
                  onClick={() => handleModuleClick(i)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition ${
                    isActive
                      ? "bg-white font-medium text-black shadow-sm"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {mod.name}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2">
            {viewMode !== "list" && (
              <button
                onClick={() => { setViewMode("list"); setSelectedRow(null); }}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-black transition"
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </button>
            )}
            <p className="text-[11px] font-semibold text-black">
              {viewMode === "create" ? `New ${currentEntity?.name || ""}` :
               viewMode === "edit" ? `Edit ${currentEntity?.name || ""}` :
               viewMode === "detail" ? (selectedRow?.[formFields[0]?.name] || currentEntity?.name) :
               currentModule?.name || "Dashboard"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {viewMode === "list" && (
              <div className="flex h-6 items-center rounded-md border border-gray-200 bg-white px-2">
                <Search className="mr-1.5 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-20 bg-transparent text-[10px] text-black placeholder-gray-400 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")}>
                    <X className="h-2.5 w-2.5 text-gray-400" />
                  </button>
                )}
              </div>
            )}
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gray-100 cursor-pointer hover:bg-gray-200 transition">
              <Bell className="h-3 w-3 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-3">
          {viewMode === "create" || viewMode === "edit" ? (
            <FormPreview
              entity={currentEntity}
              formData={formData}
              setFormData={setFormData}
              onSubmit={handleFormSubmit}
              onCancel={() => { setViewMode("list"); setFormData({}); }}
              primaryColor={primaryColor}
              mode={viewMode}
            />
          ) : viewMode === "detail" && selectedRow ? (
            <DetailPreview
              entity={currentEntity}
              row={selectedRow}
              primaryColor={primaryColor}
              onEdit={() => handleEditClick(selectedRow)}
              onBack={() => setViewMode("list")}
            />
          ) : currentModule?.name === "Dashboard" || currentModule?.layout === "dashboard" ? (
            <DashboardPreview
              spec={spec}
              primaryColor={primaryColor}
              onCardClick={handleDashboardCardClick}
            />
          ) : currentEntity ? (
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
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-[10px] text-gray-400">{currentModule?.name}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Preview ───
function DashboardPreview({ spec, primaryColor, onCardClick }: { spec: any; primaryColor: string; onCardClick: (entity: string) => void }) {
  const stats = spec.dashboard?.stat_cards || [];
  const entities = spec.entities || [];
  const cards = stats.length > 0 ? stats : entities.slice(0, 4).map((e: any) => ({ label: `Total ${e.name}s`, entity: e.name }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((item: any, i: number) => (
          <div
            key={i}
            onClick={() => onCardClick(item.entity || item.name)}
            className="cursor-pointer rounded-lg border border-gray-100 bg-white p-3 shadow-sm transition hover:border-gray-200 hover:shadow-md"
          >
            <p className="text-[10px] text-gray-500">
              {item.label || `Total ${item.name}`}
            </p>
            <p className="mt-1 text-lg font-bold text-black">
              {Math.floor(Math.random() * 500 + 50)}
            </p>
            <p className="mt-0.5 text-[9px] text-green-600">
              +{Math.floor(Math.random() * 20 + 5)}% this month
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-gray-100 bg-white p-3">
        <p className="text-[10px] font-medium text-black">Recent Activity</p>
        <div className="mt-2 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
              <div className="h-2 flex-1 rounded bg-gray-100" />
              <div className="h-2 w-16 rounded bg-gray-50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table Preview ───
function TablePreview({
  entity, columns, rows, primaryColor,
  onRowClick, onAddClick, onEditClick, onDeleteClick,
  menuOpenRow, setMenuOpenRow,
  activeFilter, setActiveFilter,
  onSort, sortCol, sortDir,
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
}) {
  const visibleCols = columns.slice(0, 6);
  const statusField = entity.fields?.find((f: any) => f.name === "status" && f.enum_values?.length > 0);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-black">
          {entity.name}s
          <span className="ml-1.5 text-[10px] font-normal text-gray-400">({rows.length})</span>
        </p>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-white transition hover:opacity-90"
          style={{ backgroundColor: primaryColor }}
        >
          <Plus className="h-3 w-3" />
          Add {entity.name}
        </button>
      </div>

      {/* Filter tabs */}
      {statusField && (
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setActiveFilter(0)}
            className={`rounded-md px-2 py-1 text-[10px] transition ${
              activeFilter === 0 ? "bg-black text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {statusField.enum_values.map((val: string, i: number) => (
            <button
              key={i}
              onClick={() => setActiveFilter(i + 1)}
              className={`rounded-md px-2 py-1 text-[10px] transition ${
                activeFilter === i + 1 ? "bg-black text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {formatColumnName(val)}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-100">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {visibleCols.map((col: string, i: number) => (
                <th
                  key={i}
                  onClick={() => onSort(col)}
                  className="cursor-pointer select-none px-2 py-1.5 text-left text-[10px] font-medium text-gray-500 hover:text-black transition"
                >
                  <span className="flex items-center gap-1">
                    {formatColumnName(col)}
                    {sortCol === col && (
                      <ArrowUpDown className="h-2.5 w-2.5" />
                    )}
                  </span>
                </th>
              ))}
              <th className="w-8 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length + 1} className="py-8 text-center text-[10px] text-gray-400">
                  No results found
                </td>
              </tr>
            ) : rows.map((row, ri) => (
              <tr
                key={ri}
                onClick={() => onRowClick(row)}
                className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/80 transition"
              >
                {visibleCols.map((col: string, ci: number) => {
                  const field = entity.fields.find((f: any) => f.name === col);
                  const val = row[col];
                  return (
                    <td key={ci} className="px-2 py-1.5">
                      {field?.badge_colors && val ? (
                        <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${getBadgeClass(field.badge_colors[val])}`}>
                          {formatColumnName(val)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-700">{val}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpenRow(menuOpenRow === ri ? null : ri); }}
                    className="rounded p-0.5 hover:bg-gray-100 transition"
                  >
                    <MoreHorizontal className="h-3 w-3 text-gray-400" />
                  </button>
                  {menuOpenRow === ri && (
                    <div
                      className="absolute right-0 top-full z-10 w-28 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onRowClick(row)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50"
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                      <button
                        onClick={() => onEditClick(row)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-gray-600 hover:bg-gray-50"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        onClick={() => onDeleteClick(ri)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50"
                      >
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
          <p className="text-[9px] text-gray-400">Showing {rows.length} results</p>
          <div className="flex gap-1">
            <button className="rounded border border-gray-200 px-2 py-0.5 text-[9px] text-gray-400">Prev</button>
            <button className="rounded px-2 py-0.5 text-[9px] font-medium text-white" style={{ backgroundColor: primaryColor }}>1</button>
            <button className="rounded border border-gray-200 px-2 py-0.5 text-[9px] text-gray-400">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Preview ───
function DetailPreview({
  entity, row, primaryColor, onEdit, onBack,
}: {
  entity: any;
  row: any;
  primaryColor: string;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const fields = entity?.fields?.filter((f: any) =>
    !["id", "org_id", "deleted_at", "version"].includes(f.name)
  ) || [];

  const tabs = entity?.ui_config?.detail_view?.tabs || [{ name: "Overview", fields: fields.map((f: any) => f.name) }];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-black">
            {row[fields[0]?.name] || entity?.name}
          </p>
          {row.status && (
            <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${getBadgeClass(entity?.fields?.find((f: any) => f.name === "status")?.badge_colors?.[row.status])}`}>
              {formatColumnName(row.status)}
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] text-gray-600 transition hover:bg-gray-50"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100">
        {tabs.map((tab: any, i: number) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 text-[10px] font-medium transition border-b-2 ${
              i === activeTab
                ? "border-current text-black"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
            style={i === activeTab ? { borderColor: primaryColor, color: primaryColor } : {}}
          >
            {tab.name || `Tab ${i + 1}`}
          </button>
        ))}
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f: any, i: number) => (
          <div key={i} className="rounded-lg border border-gray-50 bg-gray-50/50 p-2">
            <p className="text-[9px] font-medium text-gray-400">{formatColumnName(f.name)}</p>
            <p className="mt-0.5 text-[10px] text-black">
              {f.badge_colors && row[f.name] ? (
                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${getBadgeClass(f.badge_colors[row[f.name]])}`}>
                  {formatColumnName(row[f.name])}
                </span>
              ) : (
                row[f.name] || "—"
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Form Preview ───
function FormPreview({
  entity, formData, setFormData, onSubmit, onCancel, primaryColor, mode,
}: {
  entity: any;
  formData: Record<string, any>;
  setFormData: (d: Record<string, any>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  primaryColor: string;
  mode: "create" | "edit";
}) {
  const fields = entity?.fields?.filter((f: any) =>
    f.show_in_form !== false &&
    !["id", "org_id", "created_at", "updated_at", "deleted_at", "version"].includes(f.name)
  ) || [];

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-black">
        {mode === "create" ? `New ${entity?.name}` : `Edit ${entity?.name}`}
      </p>

      <div className="space-y-2">
        {fields.map((f: any, i: number) => (
          <div key={i}>
            <label className="text-[10px] font-medium text-gray-500">
              {formatColumnName(f.name)}
              {!f.nullable && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {f.enum_values ? (
              <select
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[10px] text-black outline-none focus:border-gray-300"
              >
                <option value="">Select...</option>
                {f.enum_values.map((v: string) => (
                  <option key={v} value={v}>{formatColumnName(v)}</option>
                ))}
              </select>
            ) : f.db_type?.includes("BOOLEAN") ? (
              <label className="mt-0.5 flex items-center gap-1.5 text-[10px] text-black cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData[f.name] === true || formData[f.name] === "Yes"}
                  onChange={(e) => setFormData({ ...formData, [f.name]: e.target.checked })}
                  className="rounded"
                />
                {formatColumnName(f.name)}
              </label>
            ) : f.db_type?.includes("TEXT") && !f.db_type?.includes("VARCHAR") ? (
              <textarea
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                rows={2}
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[10px] text-black outline-none focus:border-gray-300 resize-none"
                placeholder={formatColumnName(f.name)}
              />
            ) : (
              <input
                type={f.db_type?.includes("INT") || f.db_type?.includes("NUMERIC") ? "number" : f.db_type?.includes("DATE") ? "date" : "text"}
                value={formData[f.name] || ""}
                onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[10px] text-black outline-none focus:border-gray-300"
                placeholder={formatColumnName(f.name)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          className="flex-1 rounded-md py-1.5 text-[10px] font-medium text-white transition hover:opacity-90"
          style={{ backgroundColor: primaryColor }}
        >
          {mode === "create" ? `Create ${entity?.name}` : "Save Changes"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-gray-200 px-4 py-1.5 text-[10px] text-gray-500 transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───

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
    blue: "bg-pink-50 text-pink-700",
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    yellow: "bg-yellow-50 text-yellow-700",
    purple: "bg-pink-50 text-pink-700",
    indigo: "bg-pink-50 text-pink-700",
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
