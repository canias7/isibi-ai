import { DynamicDetail } from "@/components/dynamic/DynamicDetail";
import { DynamicForm } from "@/components/dynamic/DynamicForm";
import { useUpdateEntity, useEntityDetail } from "@/hooks/useCrud";
import { useUIStore } from "@/stores/uiStore";
import type { EntitySpec } from "@/types/spec";
import { useParams } from "react-router-dom";

interface EntityDetailPageProps {
  entity: EntitySpec;
}

export function EntityDetailPage({ entity }: EntityDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const slideOver = useUIStore((s) => s.slideOver);
  const closeSlideOver = useUIStore((s) => s.closeSlideOver);
  const updateMutation = useUpdateEntity(entity.table);

  const isFormOpen =
    slideOver.open &&
    slideOver.entityTable === entity.table &&
    slideOver.mode === "edit";

  const editQuery = useEntityDetail(
    entity.table,
    isFormOpen ? slideOver.entityId ?? undefined : undefined
  );

  return (
    <>
      <DynamicDetail entity={entity} />

      {isFormOpen && (
        <DynamicForm
          entity={entity}
          mode="edit"
          defaultValues={editQuery.data as Record<string, unknown> | undefined}
          onSubmit={async (formData) => {
            if (slideOver.entityId) {
              await updateMutation.mutateAsync({
                id: slideOver.entityId,
                ...formData,
              });
            }
            closeSlideOver();
          }}
          onClose={closeSlideOver}
          isLoading={updateMutation.isPending}
        />
      )}
    </>
  );
}
