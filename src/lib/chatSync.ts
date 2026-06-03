/**
 * Chat Sync — pushes local conversations to the server and pulls remote ones.
 *
 * Strategy:
 *   - Push: after each message send, push session + new messages to server
 *   - Pull: on app launch, fetch remote sessions and merge into local storage
 *   - Merge: UUID-based dedup, last-write-wins for session metadata
 */

import { getToken } from './api';
import { syncChat, getRemoteSessions, getRemoteMessages, SyncSession, SyncMessage } from './api';
import { getChatSessions, saveChatSessions, getChatHistory, saveChatHistory, ChatSession, ChatMessage } from './storage';

/** Push a single session + its messages to the server */
export async function pushSession(sessionId: string) {
  const token = await getToken();
  if (!token) return; // Not logged in

  try {
    const sessions = await getChatSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const messages = await getChatHistory(sessionId);

    const syncSessions: SyncSession[] = [{
      id: session.id,
      title: session.title,
      agent_id: session.agentId,
      pinned: session.pinned || false,
      tag: session.tag,
      created_at: session.createdAt,
      updated_at: Date.now(),
    }];

    const syncMessages: SyncMessage[] = messages.map((m, i) => ({
      id: `${sessionId}_${m.timestamp}_${i}`,
      session_id: sessionId,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      reaction: m.reaction || null,
    }));

    await syncChat(syncSessions, syncMessages);
  } catch (e) {
    // Sync is best-effort — don't break the app
    console.warn('[ChatSync] Push failed:', e);
  }
}

/** Pull all remote sessions and merge into local storage */
export async function pullRemoteSessions() {
  const token = await getToken();
  if (!token) return;

  try {
    const { sessions: remoteSessions } = await getRemoteSessions();
    if (!remoteSessions?.length) return;

    const localSessions = await getChatSessions();
    const localMap = new Map(localSessions.map(s => [s.id, s]));

    let changed = false;

    for (const remote of remoteSessions) {
      const local = localMap.get(remote.id);
      if (!local) {
        // New session from server — add locally
        localMap.set(remote.id, {
          id: remote.id,
          title: remote.title,
          createdAt: remote.created_at,
          agentId: remote.agent_id,
          pinned: remote.pinned,
          tag: remote.tag,
        });
        changed = true;

        // Pull messages for this new session
        try {
          const { messages } = await getRemoteMessages(remote.id);
          if (messages?.length) {
            const localMsgs: ChatMessage[] = messages.map(m => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
              timestamp: m.timestamp,
              reaction: m.reaction as 'up' | 'down' | undefined,
            }));
            await saveChatHistory(remote.id, localMsgs);
          }
        } catch {
          // Skip messages if fetch fails
        }
      } else if (remote.updated_at > local.createdAt) {
        // Remote is newer — update metadata
        localMap.set(remote.id, {
          ...local,
          title: remote.title,
          pinned: remote.pinned,
          tag: remote.tag,
        });
        changed = true;
      }
    }

    if (changed) {
      const merged = Array.from(localMap.values());
      merged.sort((a, b) => b.createdAt - a.createdAt);
      await saveChatSessions(merged);
    }
  } catch (e) {
    console.warn('[ChatSync] Pull failed:', e);
  }
}
