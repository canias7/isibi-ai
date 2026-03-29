import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserApp {
  id: string;
  name: string;
  type: "software" | "website" | "app" | "agent";
  status: "online" | "offline";
  color: string;
  source: "created" | "marketplace";
  projectId?: string; // links to the project
  htmlContent?: string; // the actual app code — editable until downloaded to PC
  createdAt: string;
}

interface AppStore {
  apps: UserApp[];
  addApp: (app: Omit<UserApp, "id" | "createdAt">) => string;
  removeApp: (id: string) => void;
  toggleStatus: (id: string) => void;
  updateApp: (id: string, updates: Partial<UserApp>) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      apps: [],

      addApp: (app) => {
        // Prevent duplicates — if same projectId exists, update it instead
        const existing = app.projectId
          ? useAppStore.getState().apps.find((a) => a.projectId === app.projectId)
          : null;
        if (existing) {
          set((s) => ({
            apps: s.apps.map((a) =>
              a.id === existing.id ? { ...a, ...app, id: existing.id, createdAt: existing.createdAt } : a
            ),
          }));
          return existing.id;
        }
        const id = crypto.randomUUID();
        set((s) => ({
          apps: [
            ...s.apps,
            { ...app, id, createdAt: new Date().toISOString() },
          ],
        }));
        return id;
      },

      removeApp: (id) =>
        set((s) => ({ apps: s.apps.filter((a) => a.id !== id) })),

      toggleStatus: (id) =>
        set((s) => ({
          apps: s.apps.map((a) =>
            a.id === id
              ? { ...a, status: a.status === "online" ? "offline" : "online" }
              : a
          ),
        })),

      updateApp: (id, updates) =>
        set((s) => ({
          apps: s.apps.map((a) => (a.id === id ? { ...a, ...updates } : a)),
        })),
    }),
    { name: "isibi-apps" }
  )
);
