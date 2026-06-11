// Per-device reminder notification sound. The chosen sound's audio is bundled
// natively — iOS app bundle + Android res/raw as `<id>.wav` — and previewed
// in-app from a small AAC copy at `public/sounds/<id>.m4a`. 'default' keeps the
// system sound (no bundled file). The picker lives in Settings.
export interface ReminderSound {
  id: string;      // 'default', or the bundled file base name (res/raw + bundle)
  label: string;   // shown in the picker
  section: string; // grouping header in the picker
}

export const REMINDER_SOUNDS: ReminderSound[] = [
  { id: 'default', label: 'Default', section: 'System' },
  { id: 'rem_chime', label: 'Chime', section: 'Classic' },
  { id: 'rem_bell', label: 'Bell', section: 'Classic' },
  { id: 'rem_marimba', label: 'Marimba', section: 'Classic' },
  { id: 'rem_drop', label: 'Drop', section: 'Classic' },
  { id: 'rem_glow', label: 'Glow', section: 'Classic' },
  { id: 'rem_pulse', label: 'Pulse', section: 'Classic' },
  { id: 'rem_boing', label: 'Boing', section: 'Fun' },
  { id: 'rem_trombone', label: 'Sad trombone', section: 'Fun' },
  { id: 'rem_whistle', label: 'Slide whistle', section: 'Fun' },
  { id: 'rem_honk', label: 'Honk', section: 'Fun' },
  { id: 'rem_tiptoe', label: 'Tiptoe', section: 'Fun' },
  { id: 'rem_tada', label: 'Ta-da', section: 'Fun' },
  { id: 'rem_wakeup', label: 'Wake up', section: 'Voice' },
  { id: 'rem_chipmunk', label: 'Wake up · chipmunk', section: 'Voice' },
  { id: 'rem_deep', label: 'Wake up · deep', section: 'Voice' },
  { id: 'rem_british', label: 'Wake up · British', section: 'Voice' },
  { id: 'rem_wakey', label: 'Wakey wakey', section: 'Voice' },
  { id: 'rem_scream', label: 'SCREAM — wake up!', section: 'Alarm' },
];

const KEY = 'gf_reminder_sound';
const IDS = new Set(REMINDER_SOUNDS.map((s) => s.id));

export function isReminderSound(v: unknown): v is string {
  return typeof v === 'string' && IDS.has(v);
}

export function loadReminderSound(): string {
  try {
    const v = localStorage.getItem(KEY);
    return isReminderSound(v) ? v : 'default';
  } catch {
    return 'default';
  }
}

export function saveReminderSound(id: string): void {
  try { if (isReminderSound(id)) localStorage.setItem(KEY, id); } catch { /* private mode — fine */ }
}

export function reminderSoundLabel(id: string): string {
  return REMINDER_SOUNDS.find((s) => s.id === id)?.label ?? 'Default';
}

// In-app preview, played from the small AAC copy. One shared element, so tapping
// another option cancels the one that's playing. 'default' has no file to play.
let previewEl: HTMLAudioElement | null = null;
export function previewReminderSound(id: string): void {
  try {
    if (previewEl) { previewEl.pause(); previewEl = null; }
    if (id === 'default') return;
    const a = new Audio(`${import.meta.env.BASE_URL}sounds/${id}.m4a`);
    a.volume = 0.9;
    void a.play().catch(() => { /* autoplay/codec — fine, just no preview */ });
    previewEl = a;
  } catch { /* ignore */ }
}
