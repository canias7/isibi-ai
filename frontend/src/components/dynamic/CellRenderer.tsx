import { StatusBadge } from "@/components/ui/StatusBadge";
import type { FieldSpec } from "@/types/spec";
import { format } from "date-fns";

// ── Color resolution ────────────────────────────────────────────────
// All badge colors come from field.badge_colors in the spec.
// No hardcoded CRM/HR/etc. color maps — the AI puts the right colors
// in the spec when it generates it.

const FALLBACK_COLORS = [
  "pink", "green", "pink", "amber", "pink", "orange", "red", "slate",
];

function getBadgeColor(field: FieldSpec, value: string): string {
  // 1. Explicit color from spec
  if (field.badge_colors?.[value]) return field.badge_colors[value];

  // 2. Deterministic fallback based on value hash (consistent color per value)
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// ── Cell Renderer ───────────────────────────────────────────────────

interface CellRendererProps {
  field: FieldSpec;
  value: unknown;
}

export function CellRenderer({ field, value }: CellRendererProps) {
  if (value == null) {
    return <span className="text-slate-600">—</span>;
  }

  // Badges — any enum or field with a badge display component
  if (
    field.display_component?.includes("Badge") ||
    field.db_type.startsWith("ENUM")
  ) {
    return (
      <StatusBadge value={String(value)} color={getBadgeColor(field, String(value))} />
    );
  }

  // Currency
  if (field.display_component === "CurrencyDisplay") {
    return (
      <span className="tabular-nums font-medium">
        ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </span>
    );
  }

  // Tags / pill arrays
  if (field.display_component === "TagPills" && Array.isArray(value)) {
    const max = field.display_max_visible ?? 3;
    const visible = value.slice(0, max);
    const overflow = value.length - max;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((tag: string) => (
          <span
            key={tag}
            className="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
          >
            {tag}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-xs text-slate-500">+{overflow}</span>
        )}
      </div>
    );
  }

  // Dates
  if (
    field.display_component === "RelativeDate" ||
    field.display_component === "AbsoluteDate" ||
    field.db_type.includes("TIMESTAMPTZ") ||
    field.db_type === "DATE"
  ) {
    try {
      return (
        <span className="text-sm text-slate-400">
          {format(new Date(String(value)), "MMM d, yyyy")}
        </span>
      );
    } catch {
      return <span className="text-sm text-slate-400">{String(value)}</span>;
    }
  }

  // Avatar placeholder
  if (field.display_component === "AgentAvatar" || field.display_component === "Avatar") {
    const initial = String(value).charAt(0).toUpperCase();
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pink-950 text-xs text-pink-400">
        {initial}
      </span>
    );
  }

  // Score / progress bar
  if (field.display_component === "ScoreBar" || field.display_component === "ProbabilityBar") {
    const score = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-16 rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-pink-500"
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
        <span className="text-xs text-slate-400">{score}</span>
      </div>
    );
  }

  // Number badge (e.g. count)
  if (field.display_component === "NumberBadge") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
        {Number(value).toLocaleString()}
      </span>
    );
  }

  // Color swatch
  if (field.display_component === "ColorSwatch") {
    return (
      <div className="flex items-center gap-2">
        <div
          className="h-4 w-4 rounded-full border border-slate-600"
          style={{ backgroundColor: String(value) }}
        />
        <span className="text-xs text-slate-400">{String(value)}</span>
      </div>
    );
  }

  // Boolean
  if (typeof value === "boolean") {
    return (
      <span className={value ? "text-green-400" : "text-slate-500"}>
        {value ? "Yes" : "No"}
      </span>
    );
  }

  // Default text
  return <span className="text-sm text-slate-300">{String(value)}</span>;
}
