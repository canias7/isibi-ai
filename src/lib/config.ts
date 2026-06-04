/**
 * Central backend configuration.
 *
 * Every backend call in the app derives from API_ORIGIN. To repoint the whole
 * app at a different backend (e.g. Render -> Supabase) change it here, or set
 * EXPO_PUBLIC_API_ORIGIN at build time — no other file needs to change.
 */
export const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? 'https://isibi-backend.onrender.com';

/**
 * Base for the `/api/ghost` API surface (chat, AI, tools, connectors, auth).
 * Override directly via EXPO_PUBLIC_GHOST_BASE — e.g. to point at the Supabase
 * Edge Function: https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/ghost
 */
export const GHOST_BASE =
  process.env.EXPO_PUBLIC_GHOST_BASE ?? `${API_ORIGIN}/api/ghost`;
