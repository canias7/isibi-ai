import { useQuery } from "@tanstack/react-query";
import * as LucideIcons from "lucide-react";
import { TopNav } from "@/components/layout/TopNav";
import { getSpec } from "@/lib/spec";
import { get } from "@/api/client";

type LucideIcon = React.ComponentType<{ className?: string }>;

function resolveIcon(name: string): LucideIcon {
  const icon = (LucideIcons as Record<string, unknown>)[name];
  if (typeof icon === "function" || typeof icon === "object") return icon as LucideIcon;
  return LucideIcons.BarChart3;
}

export function DashboardPage() {
  const spec = getSpec();
  const dashboardConfig = spec.dashboard;

  // Fetch stats from backend
  const { data: stats } = useQuery<Record<string, unknown>>({
    queryKey: ["dashboard", "stats"],
    queryFn: () => get("/dashboard/stats"),
    retry: false,
  });

  // If the spec defines stat_cards, render them. Otherwise show a generic welcome.
  const statCards = dashboardConfig?.stat_cards ?? [];

  return (
    <div>
      <TopNav title="Dashboard" />
      <div className="p-6">
        {statCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {statCards.map((card) => {
              const Icon = resolveIcon(card.icon);
              const value = card.key ? stats?.[card.key] ?? "—" : "—";
              return (
                <div
                  key={card.key}
                  className="rounded-xl border border-slate-700 bg-slate-900 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-800 p-2">
                      <Icon className={`h-5 w-5 ${card.color}`} />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                        {card.label}
                      </p>
                      <p className="text-2xl font-bold text-white">
                        {typeof value === "number" ? value.toLocaleString() : String(value)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-8 text-center">
            <LucideIcons.LayoutDashboard className="mx-auto mb-3 h-10 w-10 text-slate-500" />
            <h2 className="text-lg font-semibold text-white">Welcome</h2>
            <p className="mt-1 text-sm text-slate-400">
              Your dashboard will populate once data flows in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
