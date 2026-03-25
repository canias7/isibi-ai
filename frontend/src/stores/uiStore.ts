import { create } from "zustand";

interface SlideOverState {
  open: boolean;
  mode: "create" | "edit";
  entityTable: string | null;
  entityId: string | null;
}

interface UIState {
  sidebarCollapsed: boolean;
  slideOver: SlideOverState;
  toggleSidebar: () => void;
  openSlideOver: (table: string, mode: "create" | "edit", id?: string) => void;
  closeSlideOver: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  slideOver: { open: false, mode: "create", entityTable: null, entityId: null },
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openSlideOver: (table, mode, id) =>
    set({
      slideOver: { open: true, mode, entityTable: table, entityId: id ?? null },
    }),
  closeSlideOver: () =>
    set({
      slideOver: { open: false, mode: "create", entityTable: null, entityId: null },
    }),
}));
