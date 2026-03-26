import { NavLink } from "react-router-dom";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/uiStore";
import { getAllModules } from "@/lib/spec";

type LucideIcon = React.ComponentType<{ className?: string }>;

/**
 * Resolve a Lucide icon by name from the spec.
 * e.g. "Users" → lucide-react's Users icon
 * Falls back to Box for unknown icons.
 */
function resolveIcon(name?: string): LucideIcon {
  if (!name) return LucideIcons.Box;
  const icon = (LucideIcons as Record<string, unknown>)[name];
  if (typeof icon === "function" || typeof icon === "object") return icon as LucideIcon;
  // Try PascalCase conversion: "shopping-cart" → "ShoppingCart"
  const pascal = name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const icon2 = (LucideIcons as Record<string, unknown>)[pascal];
  if (typeof icon2 === "function" || typeof icon2 === "object") return icon2 as LucideIcon;
  return LucideIcons.Box;
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  collapsed,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-pink-600/20 text-pink-400"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  const modules = getAllModules();
  const sorted = [...modules].sort((a, b) => a.sidebar_order - b.sidebar_order);
  const mainItems = sorted.filter((m) => m.sidebar_order < 8);
  const bottomItems = sorted.filter((m) => m.sidebar_order >= 8);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-slate-700 bg-slate-900 transition-all",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-slate-700 px-3">
        {!collapsed && (
          <span className="text-lg font-bold text-white">isibi.ai</span>
        )}
        <button
          onClick={toggle}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          {collapsed ? (
            <LucideIcons.ChevronRight className="h-4 w-4" />
          ) : (
            <LucideIcons.ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {mainItems.map((mod) => (
          <SidebarLink
            key={mod.route}
            to={mod.route}
            label={mod.name}
            icon={resolveIcon(mod.sidebar_icon ?? mod.name)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {bottomItems.length > 0 && (
        <nav className="border-t border-slate-700 p-3">
          {bottomItems.map((mod) => (
            <SidebarLink
              key={mod.route}
              to={mod.route}
              label={mod.name}
              icon={resolveIcon(mod.sidebar_icon ?? mod.name)}
              collapsed={collapsed}
            />
          ))}
        </nav>
      )}
    </aside>
  );
}
