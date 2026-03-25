import { cn } from "@/lib/cn";

export function LoadingSkeleton({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="animate-pulse">
      {/* Header row */}
      <div className="flex gap-4 border-b border-slate-700 bg-slate-800 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className="h-3 flex-1 rounded bg-slate-700"
          />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className={cn(
            "flex gap-4 px-4 py-3",
            r % 2 === 0 ? "bg-slate-900" : "bg-slate-800/50"
          )}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-3 flex-1 rounded bg-slate-800"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
