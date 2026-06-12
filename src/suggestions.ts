// Home-screen suggestions, picked fresh each visit instead of the same two
// hardcoded prompts forever: up to two drawn from the apps the user actually
// connected, one from the time of day, topped up from an evergreen pool. A
// brand-new user (nothing connected) leads with "What can you do?".

const BY_APP: Record<string, string[]> = {
  gmail: ['Summarize my inbox', 'Any emails I should answer today?'],
  m365: ['Summarize my Outlook inbox', 'Any emails I should answer today?'],
  gcal: ['What’s on my calendar today?', 'When am I free this week?'],
  gdrive: ['Find my most recent file in Drive'],
  slack: ['Catch me up on Slack'],
  notion: ['What did I touch in Notion this week?'],
  googlesheets: ['Pull the latest numbers from my sheet'],
  googledocs: ['Summarize my latest doc'],
  todoist: ['What’s on my to-do list?'],
  googletasks: ['What’s on my task list?'],
  hubspot: ['Any new leads in HubSpot?'],
};

const MORNING = ['Plan my morning', 'What’s the weather today?'];
const AFTERNOON = ['What’s left on my plate today?', 'What’s the weather this evening?'];
const EVENING = ['Recap my day', 'What’s on tomorrow?'];

const EVERGREEN = [
  'What can you do?',
  'Remind me to stretch at 3pm',
  'What’s the weather this weekend?',
  'Set up a morning digest workflow',
];

function take<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A larger shuffled pool for the home screen's CYCLING suggestions: every
// app-based prompt the user can use, plus the daypart and evergreen ones,
// deduped and shuffled — so the home rotates through fresh sets of 3 instead
// of showing the same three forever.
export function suggestionPool(apps: string[], hour: number, rand: () => number = Math.random): string[] {
  const daypart = hour < 12 ? MORNING : hour < 18 ? AFTERNOON : EVENING;
  const pool: string[] = [];
  if (apps.length === 0) pool.push(EVERGREEN[0]);
  for (const id of apps.filter((a) => BY_APP[a])) pool.push(...BY_APP[id]);
  pool.push(...daypart, ...EVERGREEN);
  return shuffle([...new Set(pool)], rand);
}

// `rand` is injectable so tests are deterministic.
export function pickSuggestions(apps: string[], hour: number, rand: () => number = Math.random): string[] {
  const daypart = hour < 12 ? MORNING : hour < 18 ? AFTERNOON : EVENING;
  const out: string[] = [];
  if (apps.length === 0) out.push(EVERGREEN[0]);
  for (const id of shuffle(apps.filter((a) => BY_APP[a]), rand).slice(0, 2)) out.push(take(BY_APP[id], rand));
  out.push(take(daypart, rand));
  for (const e of shuffle(EVERGREEN, rand)) out.push(e);
  return [...new Set(out)].slice(0, 3);
}
