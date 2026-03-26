/**
 * SpecPreview — renders a generated spec as a live UI preview.
 * Shows sidebar, table view, and detail view based on the spec JSON.
 */
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  Building2,
  Briefcase,
  CalendarDays,
  FileText,
  Package,
  Truck,
  Heart,
  Star,
  Box,
  ChevronRight,
  Search,
  Plus,
  MoreHorizontal,
  Bell,
} from "lucide-react";

// Map common icon names to Lucide components
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

export function SpecPreview({ spec, device }: SpecPreviewProps) {
  const [activeModule, setActiveModule] = useState(0);

  if (!spec || !spec.modules) return null;

  const modules = spec.modules || [];
  const entities = spec.entities || [];
  const currentModule = modules[activeModule];
  const currentEntity = currentModule?.entity
    ? entities.find((e: any) => e.name === currentModule.entity)
    : null;

  // Generate mock table data based on entity fields
  const mockRows = currentEntity ? generateMockRows(currentEntity, 5) : [];
  const tableColumns = currentEntity
    ? (currentEntity.ui_config?.list_view?.columns || currentEntity.fields
        .filter((f: any) => f.show_in_table !== false)
        .slice(0, 6)
        .map((f: any) => f.name))
    : [];

  const design = spec.design_system || {};
  const primaryColor = design.colors?.primary || "#000000";

  return (
    <div className="flex h-full overflow-hidden rounded-lg bg-white text-xs">
      {/* Mini sidebar */}
      {device !== "mobile" && (
        <div className="flex w-48 shrink-0 flex-col border-r border-gray-100 bg-gray-50">
          {/* App name */}
          <div className="border-b border-gray-100 px-3 py-2.5">
            <p className="text-[11px] font-bold text-black" style={{ color: primaryColor }}>
              {spec.app_name || spec.name || "My App"}
            </p>
          </div>

          {/* Module list */}
          <nav className="flex-1 space-y-0.5 px-2 py-2">
            {modules.map((mod: any, i: number) => {
              const Icon = resolveIcon(mod.sidebar_icon);
              const isActive = i === activeModule;
              return (
                <button
                  key={i}
                  onClick={() => setActiveModule(i)}
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
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold text-black">
              {currentModule?.name || "Dashboard"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 items-center rounded-md border border-gray-200 bg-white px-2">
              <Search className="mr-1.5 h-3 w-3 text-gray-400" />
              <span className="text-[10px] text-gray-400">Search...</span>
            </div>
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gray-100">
              <Bell className="h-3 w-3 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-3">
          {currentModule?.name === "Dashboard" || currentModule?.layout === "dashboard" ? (
            <DashboardPreview spec={spec} primaryColor={primaryColor} />
          ) : currentEntity ? (
            <TablePreview
              entity={currentEntity}
              columns={tableColumns}
              rows={mockRows}
              primaryColor={primaryColor}
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
function DashboardPreview({ spec, primaryColor }: { spec: any; primaryColor: string }) {
  const stats = spec.dashboard?.stat_cards || [];
  const entities = spec.entities || [];

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(stats.length > 0 ? stats : entities.slice(0, 4)).map((item: any, i: number) => (
          <div key={i} className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
            <p className="text-[10px] text-gray-500">
              {item.label || item.title || item.name || `Total ${item.name}`}
            </p>
            <p className="mt-1 text-lg font-bold text-black">
              {item.value || Math.floor(Math.random() * 500 + 50)}
            </p>
            <p className="mt-0.5 text-[9px] text-green-600">
              +{Math.floor(Math.random() * 20 + 5)}% this month
            </p>
          </div>
        ))}
      </div>

      {/* Recent activity placeholder */}
      <div className="rounded-lg border border-gray-100 bg-white p-3">
        <p className="text-[10px] font-medium text-black">Recent Activity</p>
        <div className="mt-2 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
              <div className="h-2 flex-1 rounded bg-gray-100" />
              <div className="h-2 w-12 rounded bg-gray-50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table Preview ───
function TablePreview({
  entity,
  columns,
  rows,
  primaryColor,
}: {
  entity: any;
  columns: string[];
  rows: any[];
  primaryColor: string;
}) {
  const visibleCols = columns.slice(0, 6);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-black">
          {entity.name}s
          <span className="ml-1.5 text-[10px] font-normal text-gray-400">
            ({rows.length})
          </span>
        </p>
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-white"
          style={{ backgroundColor: primaryColor }}
        >
          <Plus className="h-3 w-3" />
          Add {entity.name}
        </button>
      </div>

      {/* Quick filter tabs */}
      {entity.ui_config?.list_view?.quick_filter_tabs && (
        <div className="flex gap-1">
          {entity.ui_config.list_view.quick_filter_tabs.map((tab: any, i: number) => (
            <button
              key={i}
              className={`rounded-md px-2 py-1 text-[10px] ${
                i === 0
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {tab.label || tab}
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
                  className="px-2 py-1.5 text-left text-[10px] font-medium text-gray-500"
                >
                  {formatColumnName(col)}
                </th>
              ))}
              <th className="w-8 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                {visibleCols.map((col: string, ci: number) => {
                  const field = entity.fields.find((f: any) => f.name === col);
                  const val = row[col];
                  return (
                    <td key={ci} className="px-2 py-1.5">
                      {field?.badge_colors && val ? (
                        <span
                          className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            getBadgeClass(field.badge_colors[val])
                          }`}
                        >
                          {val}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-700">{val}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right">
                  <MoreHorizontal className="h-3 w-3 text-gray-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
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

  for (let r = 0; r < count; r++) {
    const row: any = {};
    for (const f of fields) {
      if (f.name === "id" || f.name === "org_id" || f.name === "deleted_at" || f.name === "version") continue;
      if (f.name === "created_at" || f.name === "updated_at") {
        row[f.name] = new Date(Date.now() - Math.random() * 30 * 86400000).toLocaleDateString();
        continue;
      }
      if (f.enum_values && f.enum_values.length > 0) {
        row[f.name] = f.enum_values[Math.floor(Math.random() * f.enum_values.length)];
        continue;
      }
      if (f.db_type?.includes("BOOLEAN") || f.ts_type === "boolean") {
        row[f.name] = Math.random() > 0.5 ? "Yes" : "No";
        continue;
      }
      if (f.db_type?.includes("INTEGER") || f.db_type?.includes("NUMERIC") || f.ts_type === "number") {
        row[f.name] = Math.floor(Math.random() * 1000);
        continue;
      }
      if (f.name.includes("email")) {
        row[f.name] = `user${r + 1}@example.com`;
        continue;
      }
      if (f.name.includes("phone")) {
        row[f.name] = `(555) ${String(Math.floor(Math.random() * 900 + 100))}-${String(Math.floor(Math.random() * 9000 + 1000))}`;
        continue;
      }
      if (f.name.includes("name") || f.name.includes("title")) {
        const names = ["Alpha Corp", "Beta LLC", "Gamma Inc", "Delta Co", "Epsilon Ltd", "Zeta Group", "Eta Solutions", "Theta Partners"];
        row[f.name] = names[r % names.length];
        continue;
      }
      if (f.name.includes("amount") || f.name.includes("value") || f.name.includes("price")) {
        row[f.name] = `$${(Math.random() * 10000).toFixed(2)}`;
        continue;
      }
      if (f.name.includes("date") || f.db_type?.includes("DATE") || f.db_type?.includes("TIMESTAMP")) {
        row[f.name] = new Date(Date.now() + Math.random() * 30 * 86400000).toLocaleDateString();
        continue;
      }
      if (f.name.includes("url") || f.name.includes("website")) {
        row[f.name] = "https://example.com";
        continue;
      }
      // Default text
      row[f.name] = `${formatColumnName(f.name)} ${r + 1}`;
    }
    rows.push(row);
  }
  return rows;
}
