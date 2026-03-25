import { cn } from "@/lib/cn";

const colorMap: Record<string, string> = {
  blue: "bg-blue-950 text-blue-400",
  yellow: "bg-yellow-950 text-yellow-400",
  indigo: "bg-indigo-950 text-indigo-400",
  purple: "bg-purple-950 text-purple-400",
  green: "bg-green-950 text-green-400",
  red: "bg-red-950 text-red-400",
  slate: "bg-slate-800 text-slate-400",
  orange: "bg-orange-950 text-orange-400",
  amber: "bg-amber-950 text-amber-400",
};

interface StatusBadgeProps {
  value: string;
  color?: string;
  className?: string;
}

export function StatusBadge({ value, color = "slate", className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        colorMap[color] ?? colorMap.slate,
        className
      )}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
