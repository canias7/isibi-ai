import { createClient } from '@supabase/supabase-js';

// Go Farther's Supabase project. The anon key is public by design (safe to ship
// in the client); it only permits what RLS + edge-function auth allow.
export const SUPABASE_URL = 'https://lkpfeqrelvziltfwpuxi.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcGZlcXJlbHZ6aWx0ZndwdXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1Mjk2NDMsImV4cCI6MjA5NjEwNTY0M30.DZ_mssAlWiGj-6xLG7Z_srt0taV-mXbbRzazQ29P2xw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // native app: no URL-based auth redirects
  },
});
