import * as LucideIcons from "lucide-react";

type LucideIcon = React.ComponentType<{ className?: string }>;

function resolveIcon(name: string): LucideIcon {
  const icon = (LucideIcons as Record<string, unknown>)[name];
  if (typeof icon === "function" || typeof icon === "object") return icon as LucideIcon;
  return LucideIcons.Inbox;
}

interface EmptyStateProps {
  icon: string;
  heading: string;
  subtext: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  heading,
  subtext,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const Icon = resolveIcon(icon);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 rounded-2xl bg-slate-800 p-4">
        <Icon className="h-10 w-10 text-slate-500" />
      </div>
      <h3 className="text-lg font-semibold text-white">{heading}</h3>
      <p className="mt-1 text-sm text-slate-400">{subtext}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
