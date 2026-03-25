import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { EntityListPage } from "@/pages/EntityListPage";
import { EntityDetailPage } from "@/pages/EntityDetailPage";
import { loadSpec, getAllModules, getEntityForModule } from "@/lib/spec";
import type { ModuleSpec } from "@/types/spec";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function SpecDrivenRoutes({ modules }: { modules: ModuleSpec[] }) {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {modules.map((mod) => {
          const entity = getEntityForModule(mod);

          // Dashboard is a special page
          if (mod.name === "Dashboard") {
            return (
              <Route key={mod.route} path={mod.route} element={<DashboardPage />} />
            );
          }

          // Modules with a matching entity get dynamic CRUD pages
          if (entity) {
            return [
              <Route
                key={mod.route}
                path={mod.route}
                element={<EntityListPage entity={entity} />}
              />,
              // Detail route: use spec's detail_view.route or fallback to /:id
              entity.ui_config.detail_view?.route ? (
                <Route
                  key={entity.ui_config.detail_view.route}
                  path={entity.ui_config.detail_view.route}
                  element={<EntityDetailPage entity={entity} />}
                />
              ) : mod.detail_route ? (
                <Route
                  key={mod.detail_route}
                  path={mod.detail_route}
                  element={<EntityDetailPage entity={entity} />}
                />
              ) : (
                <Route
                  key={`${mod.route}/:id`}
                  path={`${mod.route}/:id`}
                  element={<EntityDetailPage entity={entity} />}
                />
              ),
            ];
          }

          // Modules without entity match → placeholder page
          return (
            <Route
              key={mod.route}
              path={mod.route}
              element={
                <div className="p-6">
                  <h1 className="text-2xl font-bold text-white">{mod.name}</h1>
                  <p className="mt-2 text-slate-400">
                    This module is defined in the spec but has no entity mapping yet.
                  </p>
                </div>
              }
            />
          );
        })}
      </Route>
    </Routes>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [modules, setModules] = useState<ModuleSpec[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSpec()
      .then(() => {
        setModules(getAllModules());
        setReady(true);
      })
      .catch((err) => {
        setError(String(err));
        setReady(true);
      });
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading spec…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-6 text-center">
          <h2 className="text-lg font-semibold text-red-400">Failed to load spec</h2>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SpecDrivenRoutes modules={modules} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
