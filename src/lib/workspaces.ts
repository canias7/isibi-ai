/** GoFarther AI — Workspaces
 *
 * Workspaces let one user keep multiple separate contexts on the same
 * account. Personal vs Work, client A vs client B, test vs prod — every
 * workspace gets its own chats, contacts, memory, templates, agents,
 * scheduled tasks, and learned preferences. The login, subscription,
 * billing, and (for now) connected apps stay shared across workspaces.
 *
 * Implementation: the existing multi-account storage scoping already
 * prefixes keys with `u_<userId>_`. We add a second prefix segment so
 * keys become `u_<userId>_w_<workspaceId>_<key>`. The active workspace
 * id lives in `u_<userId>_active_workspace_id` so each user has their
 * own last-selected workspace persisted across sessions.
 *
 * First-launch migration: when a user first opens a build with this
 * file, we auto-create a "Personal" workspace and walk every known
 * user-scoped key, moving its value under the new workspace prefix.
 * No data is lost — existing chats/contacts/memory just re-appear
 * inside the Personal workspace.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Workspace {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  createdAt: number;
}

/** A short palette new workspaces cycle through. Same family as the
 *  agent color picker so the whole app feels consistent. */
const WORKSPACE_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#22c55e', // green
  '#f97316', // orange
  '#06b6d4', // cyan
  '#8b5cf6', // purple
  '#eab308', // yellow
  '#ef4444', // red
];

/** Module-level cache for the active workspace id, mirrored to
 *  AsyncStorage. Keeps save/load fast without hitting disk. */
let _activeWorkspaceId: string | null | undefined = undefined;

/** Subscribers called when the active workspace changes. Used by the
 *  drawer/chat/agents/settings screens to re-fetch their local state. */
type WorkspaceChangeListener = (workspaceId: string) => void;
const _listeners: Set<WorkspaceChangeListener> = new Set();

export function onWorkspaceChange(fn: WorkspaceChangeListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _emitChange(id: string) {
  for (const fn of _listeners) {
    try { fn(id); } catch {}
  }
}

/** Device-wide key for the ACTIVE user's last-picked workspace. The
 *  active_user_id prefix is added by storage.ts' scopedKey so two
 *  different accounts on the same device remember different
 *  workspaces independently. */
const ACTIVE_WS_KEY = 'active_workspace_id';
/** Device-wide key that stores the list of workspaces for the current
 *  user. Same scoping — different users have different lists. */
const WS_LIST_KEY = 'workspace_list';
/** One-time marker showing that the legacy-to-workspace migration has
 *  run for this (user_id, install) pair. Like storage_migrated_v2. */
const WS_MIGRATED_MARKER = 'ws_migrated_v1';

/**
 * Read the currently active workspace id from AsyncStorage. Returns
 * null if no workspace exists yet (pre-migration), which callers should
 * treat as "storage is unscoped" — save/load will work the same as
 * before the workspaces feature shipped.
 *
 * The result is cached in memory until setActiveWorkspaceId is called.
 * getActiveUserId is NOT cached here because we rely on storage.ts'
 * _activeUserId cache instead.
 */
export async function getActiveWorkspaceId(): Promise<string | null> {
  if (_activeWorkspaceId !== undefined) return _activeWorkspaceId;
  try {
    // Read via scoped key so the answer is per-user
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) { _activeWorkspaceId = null; return null; }
    _activeWorkspaceId = await AsyncStorage.getItem(`u_${userId}_${ACTIVE_WS_KEY}`);
  } catch {
    _activeWorkspaceId = null;
  }
  return _activeWorkspaceId;
}

/** Synchronous variant for hot paths that already hydrated the cache.
 *  Returns null if the cache isn't warm yet. Storage.ts awaits the
 *  async version on first use so the sync path stays safe. */
export function getActiveWorkspaceIdSync(): string | null {
  return _activeWorkspaceId === undefined ? null : _activeWorkspaceId;
}

/** Reset the in-memory cache. Called by storage.ts after the user
 *  logs in/out so we don't leak the previous account's workspace id. */
export function resetWorkspaceCache() {
  _activeWorkspaceId = undefined;
}

/** Switch the active workspace. Persists to AsyncStorage (scoped to
 *  the current user), updates the in-memory cache, invalidates the
 *  storage.ts workspace cache so subsequent reads hit the new
 *  workspace, and notifies every subscriber so screens can re-fetch
 *  their state. */
export async function setActiveWorkspaceId(workspaceId: string): Promise<void> {
  try {
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) return;
    await AsyncStorage.setItem(`u_${userId}_${ACTIVE_WS_KEY}`, workspaceId);
    _activeWorkspaceId = workspaceId;
    // Storage.ts has its own cached workspace id — clear it so the
    // very next save/load picks up the new workspace without a race.
    try {
      const { invalidateWorkspaceCache } = require('./storage');
      if (typeof invalidateWorkspaceCache === 'function') invalidateWorkspaceCache();
    } catch {}
    _emitChange(workspaceId);
  } catch {
    // Best-effort — if the write fails we still updated the cache above
  }
}

/** List every workspace belonging to the active user. Guaranteed to
 *  return at least one (the default "Personal") — if the list is
 *  empty, we lazily create it. */
export async function getWorkspaces(): Promise<Workspace[]> {
  try {
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) return [];
    const raw = await AsyncStorage.getItem(`u_${userId}_${WS_LIST_KEY}`);
    const list = raw ? (JSON.parse(raw) as Workspace[]) : [];
    if (list.length === 0) {
      // No workspaces yet → seed with "Personal" and return it. The
      // ensureDefaultWorkspace() helper below handles the migration
      // case more thoroughly; this branch is a defensive fallback.
      const personal = await _createPersonalWorkspace(userId);
      return [personal];
    }
    return list;
  } catch {
    return [];
  }
}

async function _saveWorkspaceList(userId: string, list: Workspace[]): Promise<void> {
  await AsyncStorage.setItem(`u_${userId}_${WS_LIST_KEY}`, JSON.stringify(list));
}

async function _createPersonalWorkspace(userId: string): Promise<Workspace> {
  const personal: Workspace = {
    id: 'personal',
    name: 'Personal',
    color: WORKSPACE_COLORS[0],
    emoji: '🏠',
    createdAt: Date.now(),
  };
  await _saveWorkspaceList(userId, [personal]);
  await AsyncStorage.setItem(`u_${userId}_${ACTIVE_WS_KEY}`, personal.id);
  _activeWorkspaceId = personal.id;
  return personal;
}

/** Create a new workspace. Returns the full record with its generated
 *  id so the caller can immediately switch to it. */
export async function createWorkspace(
  name: string,
  opts: { color?: string; emoji?: string } = {},
): Promise<Workspace | null> {
  try {
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) return null;
    const list = await getWorkspaces();
    const id = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ws: Workspace = {
      id,
      name: name.trim() || 'New Workspace',
      color: opts.color || WORKSPACE_COLORS[list.length % WORKSPACE_COLORS.length],
      emoji: opts.emoji,
      createdAt: Date.now(),
    };
    await _saveWorkspaceList(userId, [...list, ws]);
    return ws;
  } catch {
    return null;
  }
}

/** Rename or re-color an existing workspace. */
export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<Workspace, 'name' | 'color' | 'emoji'>>,
): Promise<boolean> {
  try {
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) return false;
    const list = await getWorkspaces();
    const updated = list.map(w => (w.id === id ? { ...w, ...patch } : w));
    await _saveWorkspaceList(userId, updated);
    return true;
  } catch {
    return false;
  }
}

/** Delete a workspace and every AsyncStorage key scoped to it. Refuses
 *  to delete the user's last remaining workspace so they always have
 *  at least one to fall back to. If the deleted workspace was active,
 *  the first remaining workspace becomes active. */
export async function deleteWorkspace(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await AsyncStorage.getItem('active_user_id');
    if (!userId) return { ok: false, error: 'Not signed in' };
    const list = await getWorkspaces();
    if (list.length <= 1) {
      return { ok: false, error: "You can't delete your last workspace." };
    }
    const remaining = list.filter(w => w.id !== id);
    await _saveWorkspaceList(userId, remaining);

    // Wipe every key scoped to the deleted workspace
    const prefix = `u_${userId}_w_${id}_`;
    const allKeys = await AsyncStorage.getAllKeys();
    const mine = allKeys.filter(k => k.startsWith(prefix));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);

    // If the user was looking at the workspace they just deleted,
    // switch them to the first remaining one.
    if (_activeWorkspaceId === id) {
      await setActiveWorkspaceId(remaining[0].id);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error' };
  }
}

/**
 * Ensure the active user has at least one workspace. Runs on app
 * launch. If no workspaces exist, creates "Personal" and migrates any
 * pre-workspace data into it. Idempotent — subsequent calls are cheap.
 */
export async function ensureDefaultWorkspace(): Promise<string> {
  const userId = await AsyncStorage.getItem('active_user_id');
  if (!userId) return '';

  // Already migrated? Just return the active id (or seed if missing).
  const migrated = await AsyncStorage.getItem(`u_${userId}_${WS_MIGRATED_MARKER}`);
  if (migrated) {
    const active = await getActiveWorkspaceId();
    if (active) return active;
    // Migration ran but active id got lost — fall through to re-set it.
  }

  // Read existing list or create Personal
  const rawList = await AsyncStorage.getItem(`u_${userId}_${WS_LIST_KEY}`);
  let list: Workspace[] = rawList ? JSON.parse(rawList) : [];
  if (list.length === 0) {
    const personal = await _createPersonalWorkspace(userId);
    list = [personal];
  }

  // Pick active workspace (first one if nothing was stored before)
  const active = list[0].id;
  await AsyncStorage.setItem(`u_${userId}_${ACTIVE_WS_KEY}`, active);
  _activeWorkspaceId = active;

  // Migrate every pre-workspace user-scoped key into the active ws.
  // The pattern is: keys starting with `u_<userId>_` that do NOT
  // already contain the `w_` segment get moved under
  // `u_<userId>_w_<active>_<rest>`.
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userPrefix = `u_${userId}_`;
    const wsPrefix = `u_${userId}_w_`;
    const protectedKeys = new Set([
      `u_${userId}_${ACTIVE_WS_KEY}`,
      `u_${userId}_${WS_LIST_KEY}`,
      `u_${userId}_${WS_MIGRATED_MARKER}`,
    ]);
    const toMove: string[] = [];
    for (const k of allKeys) {
      if (!k.startsWith(userPrefix)) continue;
      if (k.startsWith(wsPrefix)) continue;
      if (protectedKeys.has(k)) continue;
      toMove.push(k);
    }
    if (toMove.length > 0) {
      const pairs = await AsyncStorage.multiGet(toMove);
      const writes: [string, string][] = [];
      for (const [k, v] of pairs) {
        if (v === null) continue;
        const tail = k.slice(userPrefix.length);
        writes.push([`u_${userId}_w_${active}_${tail}`, v]);
      }
      if (writes.length > 0) await AsyncStorage.multiSet(writes);
      await AsyncStorage.multiRemove(toMove);
    }
    await AsyncStorage.setItem(`u_${userId}_${WS_MIGRATED_MARKER}`, '1');
  } catch {
    // Best-effort — if migration fails the user still gets a working
    // Personal workspace, they just start fresh inside it.
  }
  return active;
}

/** Available color palette for the workspace picker UI. */
export function getWorkspaceColorPalette(): string[] {
  return [...WORKSPACE_COLORS];
}
