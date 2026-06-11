// User-selectable chat model. "Auto" lets the backend route (Sonnet, bumped to
// Opus for hard/long asks); an explicit pick overrides it — and, importantly,
// makes the cost the user's deliberate choice. Chosen PER CHAT (see chatSync's
// loadChatModels), so different conversations can run on different models.

export type ModelChoice = 'auto' | 'haiku' | 'sonnet' | 'opus';

export interface ModelOption {
  id: ModelChoice;
  label: string;   // full name shown in the picker
  chip: string;    // short name shown on the composer chip
  sub: string;     // one-line "best for" + a cost cue
  dots: 1 | 2 | 3; // relative cost: $, $$, $$$ — so the burn is never a surprise
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'auto', label: 'Auto', chip: 'Auto', sub: 'Picks the right model for each message', dots: 2 },
  { id: 'haiku', label: 'Haiku 4.5', chip: 'Haiku', sub: 'Fastest and lightest — quick, simple chats', dots: 1 },
  { id: 'sonnet', label: 'Sonnet 4.6', chip: 'Sonnet', sub: 'Balanced — the everyday default', dots: 2 },
  { id: 'opus', label: 'Opus 4.8', chip: 'Opus', sub: 'Most capable — but burns your credits the fastest', dots: 3 },
];

const IDS: ModelChoice[] = ['auto', 'haiku', 'sonnet', 'opus'];

export function isModelChoice(v: unknown): v is ModelChoice {
  return typeof v === 'string' && (IDS as string[]).includes(v);
}

export function modelChip(m: ModelChoice): string {
  return MODEL_OPTIONS.find((o) => o.id === m)?.chip ?? 'Auto';
}
