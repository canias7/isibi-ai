import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, del } from "@/api/client";

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    cursor: string | null;
    has_more: boolean;
  };
}

export function useEntityList<T = Record<string, unknown>>(
  table: string,
  params?: { limit?: number; cursor?: string | null }
) {
  const limit = params?.limit ?? 25;
  const cursor = params?.cursor;
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("cursor", cursor);

  return useQuery<PaginatedResponse<T>>({
    queryKey: [table, "list", { limit, cursor }],
    queryFn: () => get<PaginatedResponse<T>>(`/${table}?${qs}`),
  });
}

export function useEntityDetail<T = Record<string, unknown>>(
  table: string,
  id: string | undefined
) {
  return useQuery<T>({
    queryKey: [table, "detail", id],
    queryFn: () => get<T>(`/${table}/${id}`),
    enabled: !!id,
  });
}

export function useCreateEntity(table: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      post(`/${table}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
    },
  });
}

export function useUpdateEntity(table: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) =>
      patch(`/${table}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
    },
  });
}

export function useDeleteEntity(table: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/${table}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
    },
  });
}
