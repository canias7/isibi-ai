import { useState } from "react";
import { Plus } from "lucide-react";
import { TopNav } from "@/components/layout/TopNav";
import { DynamicTable } from "@/components/dynamic/DynamicTable";
import { DynamicForm } from "@/components/dynamic/DynamicForm";
import { useEntityList, useCreateEntity, useUpdateEntity, useDeleteEntity, useEntityDetail } from "@/hooks/useCrud";
import { useUIStore } from "@/stores/uiStore";
import type { EntitySpec } from "@/types/spec";

interface EntityListPageProps {
  entity: EntitySpec;
}

export function EntityListPage({ entity }: EntityListPageProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, isLoading } = useEntityList(entity.table, { cursor });
  const createMutation = useCreateEntity(entity.table);
  const updateMutation = useUpdateEntity(entity.table);
  const deleteMutation = useDeleteEntity(entity.table);

  const slideOver = useUIStore((s) => s.slideOver);
  const openSlideOver = useUIStore((s) => s.openSlideOver);
  const closeSlideOver = useUIStore((s) => s.closeSlideOver);

  const isFormOpen = slideOver.open && slideOver.entityTable === entity.table;

  // Fetch record for edit mode
  const editQuery = useEntityDetail(
    entity.table,
    isFormOpen && slideOver.mode === "edit" ? slideOver.entityId ?? undefined : undefined
  );

  return (
    <div>
      <TopNav title={entity.name + "s"} />

      {/* Action bar */}
      <div className="flex items-center justify-between border-b border-slate-700 px-6 py-3">
        <p className="text-sm text-slate-400">
          {data?.meta.total ?? 0} records
        </p>
        {entity.ui_config.create_form && (
          <button
            onClick={() => openSlideOver(entity.table, "create")}
            className="flex items-center gap-2 rounded-lg bg-pink-500 px-4 py-2 text-sm font-medium text-white hover:bg-pink-600"
          >
            <Plus className="h-4 w-4" />
            {entity.ui_config.create_form.title ?? `New ${entity.name}`}
          </button>
        )}
      </div>

      {/* Table */}
      <DynamicTable
        entity={entity}
        data={data?.data as Record<string, unknown>[] | undefined}
        loading={isLoading}
        meta={data?.meta}
        onEdit={(id) => openSlideOver(entity.table, "edit", id)}
        onDelete={(id) => {
          if (confirm("Delete this record?")) deleteMutation.mutate(id);
        }}
        onLoadMore={(c) => setCursor(c)}
        onCreateNew={() => openSlideOver(entity.table, "create")}
      />

      {/* SlideOver Form */}
      {isFormOpen && (
        <DynamicForm
          entity={entity}
          mode={slideOver.mode}
          defaultValues={
            slideOver.mode === "edit"
              ? (editQuery.data as Record<string, unknown> | undefined)
              : undefined
          }
          onSubmit={async (formData) => {
            if (slideOver.mode === "create") {
              await createMutation.mutateAsync(formData);
            } else if (slideOver.entityId) {
              await updateMutation.mutateAsync({
                id: slideOver.entityId,
                ...formData,
              });
            }
            closeSlideOver();
          }}
          onClose={closeSlideOver}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}
