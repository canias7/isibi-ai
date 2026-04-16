/** Group chats — requires backend API endpoints */
// POST /api/ghost/group-chat/create  { name, members[] }
// POST /api/ghost/group-chat/send    { groupId, message }
// GET  /api/ghost/group-chat/:id     returns messages
// WS   /api/ghost/group-chat/:id/ws  real-time updates

// For now, group chats are stored locally as a concept.
// When backend endpoints are ready, this module sends/receives from the server.

import { load, save } from './storage';

export interface GroupChat {
  id: string;
  name: string;
  members: string[]; // email addresses
  createdAt: number;
}

export async function getGroupChats(): Promise<GroupChat[]> {
  return load('group_chats', []);
}

export async function createGroupChat(name: string, members: string[]): Promise<GroupChat> {
  const groups = await getGroupChats();
  const group: GroupChat = { id: Date.now().toString(), name, members, createdAt: Date.now() };
  groups.push(group);
  await save('group_chats', groups);
  return group;
}

export async function deleteGroupChat(id: string) {
  const groups = await getGroupChats();
  await save('group_chats', groups.filter(g => g.id !== id));
}
