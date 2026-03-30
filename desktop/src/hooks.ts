const APP_COLORS = [
  '#ec4899', '#8b5cf6', '#06b6d4', '#f59e0b',
  '#10b981', '#6366f1', '#14b8a6', '#f43f5e',
];

export function useAppColor(name: string): string {
  const h = [...(name || 'A')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return APP_COLORS[h % APP_COLORS.length];
}

export function useTimeAgo(iso?: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function useStatusInfo(status: string): { cls: string; label: string } {
  if (status === 'deployed') return { cls: 'online', label: 'Online' };
  if (status === 'generating' || status === 'building') return { cls: 'deploying', label: status === 'generating' ? 'Generating' : 'Building' };
  if (status === 'error') return { cls: 'error', label: 'Error' };
  if (status === 'ready') return { cls: 'offline', label: 'Ready' };
  return { cls: 'offline', label: 'Offline' };
}
