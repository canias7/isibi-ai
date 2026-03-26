import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CellRenderer } from "./CellRenderer";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useFilterStore } from "@/stores/filterStore";
import type { EntitySpec, FieldSpec } from "@/types/spec";

interface DynamicTableProps {
  entity: EntitySpec;
  data: Record<string, unknown>[] | undefined;
  loading: boolean;
  meta?: { total: number; has_more: boolean; cursor: string | null };
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onLoadMore?: (cursor: string) => void;
  onCreateNew?: () => void;
}

function resolveColumns(entity: EntitySpec): { key: string; label: string; field?: FieldSpec }[] {
  const listView = entity.ui_config.list_view;
  if (!listView) return [];

  return listView.columns
    .filter((c) => c !== "selection_checkbox" && c !== "row_actions")
    .map((colKey) => {
      // Composite column like "first_name+last_name"
      if (colKey.includes("+")) {
        return {
          key: colKey,
          label: colKey
            .split("+")
            .map((k) => k.replace(/_/g, " "))
            .join(" & "),
        };
      }
      const field = entity.fields.find((f) => f.name === colKey);
      return {
        key: colKey,
        label: colKey.replace(/_/g, " "),
        field,
      };
    });
}

function getCompositeValue(row: Record<string, unknown>, key: string): string {
  return key
    .split("+")
    .map((k) => String(row[k] ?? ""))
    .join(" ")
    .trim();
}

export function DynamicTable({
  entity,
  data,
  loading,
  meta,
  onEdit,
  onDelete,
  onLoadMore,
  onCreateNew,
}: DynamicTableProps) {
  const navigate = useNavigate();
  const columns = resolveColumns(entity);
  const listView = entity.ui_config.list_view;
  const tabs = listView?.quick_filter_tabs;
  const activeTab = useFilterStore((s) => s.activeTab[entity.table] ?? tabs?.[0] ?? "All");
  const setActiveTab = useFilterStore((s) => s.setActiveTab);

  if (loading) return <LoadingSkeleton rows={8} cols={columns.length} />;

  if (!data || data.length === 0) {
    const es = listView?.empty_state;
    return (
      <EmptyState
        icon={es?.icon ?? "Users"}
        heading={es?.heading ?? "No records"}
        subtext={es?.subtext ?? "Create your first record."}
        actionLabel={es?.action_label}
        onAction={onCreateNew}
      />
    );
  }

  return (
    <div>
      {/* Quick filter tabs */}
      {tabs && tabs.length > 0 && (
        <div className="flex gap-1 border-b border-slate-700 px-4">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(entity.table, tab)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activeTab === tab
                  ? "border-pink-500 text-pink-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-800">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  {col.label}
                </th>
              ))}
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {data.map((row, idx) => {
              const id = String(row.id);
              const detailRoute = entity.ui_config.detail_view?.route?.replace(":id", id);
              return (
                <tr
                  key={id}
                  onClick={() => detailRoute && navigate(detailRoute)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-slate-800",
                    idx % 2 === 0 ? "bg-slate-900" : "bg-slate-800/50"
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      {col.key.includes("+") ? (
                        <span className="font-medium text-white">
                          {getCompositeValue(row, col.key)}
                        </span>
                      ) : col.field ? (
                        <CellRenderer field={col.field} value={row[col.key]} />
                      ) : (
                        <span className="text-slate-300">{String(row[col.key] ?? "—")}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <button
                          onClick={() => onEdit(id)}
                          className="rounded-md p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(id)}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-950 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {meta?.has_more && meta.cursor && onLoadMore && (
        <div className="flex justify-center border-t border-slate-700 py-4">
          <button
            onClick={() => onLoadMore(meta.cursor!)}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Load more ({meta.total} total)
          </button>
        </div>
      )}
    </div>
  );
}
