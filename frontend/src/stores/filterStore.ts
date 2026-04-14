import { create } from "zustand";

interface FilterState {
  filters: Record<string, Record<string, unknown>>;
  activeTab: Record<string, string>;
  setFilter: (entity: string, key: string, value: unknown) => void;
  resetFilters: (entity: string) => void;
  setActiveTab: (entity: string, tab: string) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  filters: {},
  activeTab: {},
  setFilter: (entity, key, value) =>
    set((s) => ({
      filters: {
        ...s.filters,
        [entity]: { ...s.filters[entity], [key]: value },
      },
    })),
  resetFilters: (entity) =>
    set((s) => ({
      filters: { ...s.filters, [entity]: {} },
    })),
  setActiveTab: (entity, tab) =>
    set((s) => ({
      activeTab: { ...s.activeTab, [entity]: tab },
    })),
}));
