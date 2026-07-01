import { supabase } from './supabase';

// Wingup — client for the social-media agent's backend (the `wingup` Edge
// Function). Every call carries the user's Supabase session automatically via
// supabase.functions.invoke; the function verifies it server-side and runs the
// matching Instagram tool through Composio. See supabase/functions/wingup.
//
// Errors: the function returns a JSON { error } with a non-2xx status for both
// validation and upstream failures. invoke() surfaces that as `error.context`
// (the Response), so we read the friendly message back out of it.

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('wingup', { body });
  if (error) {
    let msg = error.message || 'Request failed';
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) { const j = await ctx.json(); if (j?.error) msg = j.error; }
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const d = (data ?? {}) as { error?: string } & T;
  if (d.error) throw new Error(d.error);
  return d as T;
}

// An image to post: an http(s) URL Instagram can fetch, or a data: URL (a camera
// /library pick) which the backend hosts publicly before posting.
function imageBody(image: string): Record<string, string> {
  return image.startsWith('data:') ? { image_b64: image } : { image_url: image };
}

// ---- Profile / reads ----
export interface IgAccount {
  id?: string;
  username?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  biography?: string;
  profile_picture_url?: string | null;
  website?: string | null;
}
export async function wingupAccount(): Promise<IgAccount> {
  const { account } = await invoke<{ account: IgAccount }>({ action: 'account' });
  return account ?? {};
}

// One recent post (Graph-API media object — fields are all optional in practice).
export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  // Engagement counts — present only when the backend requests them on the media
  // fields. The home feed renders them when available and falls back gracefully.
  like_count?: number;
  comments_count?: number;
}
export async function wingupMedia(): Promise<{ data: IgMedia[]; paging?: unknown }> {
  const { media } = await invoke<{ media: { data?: IgMedia[]; paging?: unknown } }>({ action: 'media' });
  return { data: Array.isArray(media?.data) ? media.data : [], paging: media?.paging };
}

// One account-insight metric (e.g. reach, follower_count) and its time series.
export interface IgInsightValue { value: number | string | null; end_time?: string }
export interface IgInsight {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  period?: string;
  values?: IgInsightValue[];
}
export async function wingupInsights(): Promise<{ data: IgInsight[] }> {
  const { insights } = await invoke<{ insights: { data?: IgInsight[] } }>({ action: 'insights' });
  return { data: Array.isArray(insights?.data) ? insights.data : [] };
}

// ---- Publish ----
// Single-photo post. Returns the published media id when Instagram provides it.
export async function wingupPublish(p: { caption: string; image: string }): Promise<{ id: string | null }> {
  const r = await invoke<{ ok: boolean; id: string | null }>({ action: 'publish', caption: p.caption, ...imageBody(p.image) });
  return { id: r.id ?? null };
}

// Carousel post (2–10 photos), each an http(s) or data: URL.
export async function wingupPublishCarousel(p: { caption: string; images: string[] }): Promise<{ id: string | null }> {
  const images = p.images.map((image) => imageBody(image));
  const r = await invoke<{ ok: boolean; id: string | null }>({ action: 'publish_carousel', caption: p.caption, images });
  return { id: r.id ?? null };
}

// ---- Engage ----
// One comment on a post (Graph-API comment object — fields optional in practice).
export interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}
export async function wingupPostComments(igPostId: string): Promise<{ data: IgComment[] }> {
  const { comments } = await invoke<{ comments: { data?: IgComment[] } }>({ action: 'post_comments', ig_post_id: igPostId });
  return { data: Array.isArray(comments?.data) ? comments.data : [] };
}
export async function wingupReplyComment(igCommentId: string, message: string): Promise<void> {
  await invoke({ action: 'reply_comment', ig_comment_id: igCommentId, message });
}

// ---- Direct messages ----
export async function wingupConversations(): Promise<unknown> {
  const { conversations } = await invoke<{ conversations: unknown }>({ action: 'conversations' });
  return conversations;
}
export async function wingupMessages(conversationId: string): Promise<unknown> {
  const { messages } = await invoke<{ messages: unknown }>({ action: 'messages', conversation_id: conversationId });
  return messages;
}
export async function wingupConversation(conversationId: string): Promise<unknown> {
  const { conversation } = await invoke<{ conversation: unknown }>({ action: 'conversation', conversation_id: conversationId });
  return conversation;
}
export async function wingupSendDm(recipientId: string, text: string): Promise<void> {
  await invoke({ action: 'send_dm', recipient_id: recipientId, text });
}
export async function wingupSendDmImage(recipientId: string, image: string): Promise<void> {
  await invoke({ action: 'send_dm_image', recipient_id: recipientId, ...imageBody(image) });
}
export async function wingupMarkSeen(recipientId: string): Promise<void> {
  await invoke({ action: 'mark_seen', recipient_id: recipientId });
}

// ---- YouTube (test wiring) ----
// Fire the two read tools and hand back the raw envelope so the caller can log
// exactly what Composio returned. These don't throw — a failed tool resolves to
// its error string so a smoke test can report per-tool status in one pass.
export async function wingupYtChannel(): Promise<{ ok: boolean; channel?: unknown; error?: string }> {
  try {
    const { channel } = await invoke<{ channel: unknown }>({ action: 'yt_channel' });
    return { ok: true, channel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'yt_channel failed' };
  }
}
export async function wingupYtVideos(): Promise<{ ok: boolean; videos?: unknown; error?: string }> {
  try {
    const { videos } = await invoke<{ videos: unknown }>({ action: 'yt_videos' });
    return { ok: true, videos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'yt_videos failed' };
  }
}

// True when an image can actually be posted to Instagram: a real raster image,
// either hosted (http/https) or a non-SVG data: URL. The stubbed generator emits
// an SVG data URI, which Instagram can't ingest — callers use this to gate "Post".
export function isPostableImage(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  return /^data:image\//i.test(url) && !/^data:image\/svg/i.test(url);
}
