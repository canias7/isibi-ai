export interface AppProject {
  id: string;
  name: string;
  status: string;
  prompt?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UptimeData {
  uptime_pct?: number;
  response_time_ms?: number;
  last_check?: string;
  status?: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  action_url?: string;
  created_at: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface GhostField {
  entity: string;
  table: string;
  fields: Record<string, string>;
}

// The isibi bridge exposed by preload.js
export interface IsibiBridge {
  login: (email: string, password: string) => Promise<{ access_token?: string; detail?: string; error?: string }>;
  getToken: () => Promise<string | null>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  getApps: () => Promise<AppProject[] | { error: string }>;
  getAppStatus: (id: string) => Promise<{ url?: string; deployed?: boolean; status?: string }>;
  getUptime: (id: string) => Promise<UptimeData>;
  healthCheck: (id: string) => Promise<UptimeData>;
  restartApp: (id: string) => Promise<unknown>;
  deployApp: (id: string) => Promise<unknown>;
  getNotifications: () => Promise<{ data: NotificationItem[] }>;
  getUnreadCount: () => Promise<{ count: number }>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openAppWindow: (id: string, url: string) => Promise<void>;
  setSetting: (key: string, val: boolean) => Promise<void>;
  getSetting: (key: string) => Promise<boolean>;
  onStatusUpdate: (cb: (data: AppProject[]) => void) => void;
  isDesktop: boolean;
  platform: string;
  version: string;
}

declare global {
  interface Window {
    isibi: IsibiBridge;
  }
}
