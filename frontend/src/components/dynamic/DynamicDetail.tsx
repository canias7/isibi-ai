import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CellRenderer } from "./CellRenderer";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useEntityDetail, useDeleteEntity } from "@/hooks/useCrud";
import { useUIStore } from "@/stores/uiStore";
import type { EntitySpec, FieldSpec } from "@/types/spec";

interface DynamicDetailProps {
  entity: EntitySpec;
}

export function DynamicDetail({ entity }: DynamicDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = entity.ui_config.detail_view;
  const { data, isLoading } = useEntityDetail(entity.table, id);
  const deleteMutation = useDeleteEntity(entity.table);
  const openSlideOver = useUIStore((s) => s.openSlideOver);
  const [activeTab, setActiveTab] = useState(detail?.tabs?.[0]?.name ?? "Overview");

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton rows={6} cols={2} />
      </div>
    );
  }

  const record = data as Record<string, unknown> | undefined;
  if (!record) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-slate-400">Record not found</p>
      </div>
    );
  }

  // Build header
  const titleFields = detail?.header?.title_fields ?? [];
  const badgeFields = detail?.header?.badge_fields ?? [];
  const metaFields = detail?.header?.meta_fields ?? [];
  const title = titleFields.map((f) => record[f]).filter(Boolean).join(" ");

  const primaryFields = detail?.primary_fields ?? [];
  const secondaryFields = detail?.secondary_fields ?? [];

  const getField = (name: string) => entity.fields.find((f) => f.name === name);

  return (
    <div className="p-6">
      {/* Back button + header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{title || entity.name}</h1>
            <div className="mt-2 flex items-center gap-2">
              {badgeFields.map((fname) => {
                const field = getField(fname);
                return field ? (
                  <CellRenderer key={fname} field={field} value={record[fname]} />
                ) : null;
              })}
            </div>
            <div className="mt-2 flex items-center gap-4 text-sm text-slate-400">
              {metaFields.map((fname) => {
                const field = getField(fname);
                return (
                  <span key={fname} className="flex items-center gap-1">
                    <span className="capitalize">{fname.replace(/_/g, " ")}:</span>
                    {field ? (
                      <CellRenderer field={field} value={record[fname]} />
                    ) : (
                      String(record[fname] ?? "—")
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => openSlideOver(entity.table, "edit", id)}
              className="flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button
              onClick={async () => {
                if (id && confirm("Delete this record?")) {
                  await deleteMutation.mutateAsync(id);
                  navigate(-1);
                }
              }}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      {detail?.tabs && detail.tabs.length > 0 && (
        <div className="mb-6 flex gap-1 border-b border-slate-700">
          {detail.tabs.map((tab) => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.name
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      {/* Tab content — Overview shows field grid */}
      {activeTab === "Overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Primary fields */}
          <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Details
            </h3>
            <dl className="space-y-3">
              {primaryFields.map((fname) => {
                const field = getField(fname);
                return (
                  <div key={fname} className="flex justify-between">
                    <dt className="text-sm capitalize text-slate-400">
                      {fname.replace(/_/g, " ")}
                    </dt>
                    <dd className="text-sm text-slate-200">
                      {field ? (
                        <CellRenderer field={field} value={record[fname]} />
                      ) : (
                        String(record[fname] ?? "—")
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          {/* Secondary fields */}
          <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Additional Info
            </h3>
            <dl className="space-y-3">
              {secondaryFields.map((fname) => {
                const field = getField(fname);
                return (
                  <div key={fname} className="flex justify-between">
                    <dt className="text-sm capitalize text-slate-400">
                      {fname.replace(/_/g, " ")}
                    </dt>
                    <dd className="text-sm text-slate-200">
                      {field ? (
                        <CellRenderer field={field} value={record[fname]} />
                      ) : (
                        String(record[fname] ?? "—")
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      )}

      {/* Other tabs — placeholder */}
      {activeTab !== "Overview" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-8 text-center">
          <p className="text-slate-400">
            {activeTab} tab content — connects to data query from spec
          </p>
        </div>
      )}
    </div>
  );
}
