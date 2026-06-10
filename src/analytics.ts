import { supabase } from './supabase';

// Product analytics, privacy-first: counts of WHAT happened, never content.
// Events go straight into app_events via PostgREST — RLS only lets a signed-in
// user insert rows tagged with their own id, and nothing client-side can read
// them back. Fire-and-forget: analytics must never slow or break the app.
export function track(event: string, props: Record<string, string | number | boolean> = {}): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return; // anonymous sessions aren't tracked
      await supabase.from('app_events').insert({ user_id: uid, event, props });
    } catch {
      /* never surface */
    }
  })();
}
