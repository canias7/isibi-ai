/** Shared user-context snippet for the LLM system prompt.
 *
 * Saved contacts, memory facts, learned preferences, custom instructions, and
 * the user's nickname belong in EVERY system prompt — not just the main chat
 * screen. This helper builds that shared block so agents, voice chat, the
 * scheduler, and any future surface can all call one function and inject the
 * same context.
 *
 * Keep this file free of UI imports so it can be called from background
 * contexts (scheduler, workers, etc.) without pulling in React.
 */

import {
  getSavedContacts,
  getMemory,
  getCustomInstructions,
  getUserNickname,
  getLearnedPreferences,
} from './storage';

export interface UserContextOptions {
  /** Drop the "no saved contacts yet" line when there are none. Agents and
   * voice chat prefer the shorter variant. */
  terseWhenEmpty?: boolean;
  /** Skip the contact-learning sidecar rule. The main chat handles the
   * sidecar via useChat.ts; background surfaces (scheduler) don't need it. */
  includeContactLearningRule?: boolean;
}

/** Returns the shared user-context block to append to any system prompt.
 * Safe to call from anywhere. Returns an empty string if nothing is set. */
export async function buildUserContextPrompt(opts: UserContextOptions = {}): Promise<string> {
  const { terseWhenEmpty = false, includeContactLearningRule = true } = opts;

  const [savedContacts, memory, custom, nick, learnedPrefs] = await Promise.all([
    getSavedContacts().catch(() => []),
    getMemory().catch(() => []),
    getCustomInstructions().catch(() => ''),
    getUserNickname().catch(() => ''),
    getLearnedPreferences().catch(() => []),
  ]);

  const parts: string[] = [];

  // ── Saved contacts ─────────────────────────────────────────────────────
  if (savedContacts.length > 0) {
    parts.push(
      '\n\nThe user has saved these contacts. When they refer to someone by label (e.g. "my boss", "my mom", "my assistant"), use the matching contact info from this list — do NOT ask them for it again:\n' +
        savedContacts
          .map(
            (c: any) =>
              `- ${c.label} = ${c.name}${c.email ? ` (${c.email})` : ''}${c.phone ? ` (${c.phone})` : ''}`,
          )
          .join('\n'),
    );
  } else if (!terseWhenEmpty) {
    parts.push('\n\nThe user has no saved contacts yet.');
  }

  // Contact-learning sidecar rule (can be disabled for non-chat surfaces)
  if (includeContactLearningRule) {
    parts.push(
      '\n\nCRITICAL CONTACT-LEARNING RULE:\nWhenever the user refers to someone by a *relationship label* ("my boss", "my mom", "my wife", "my assistant", "my lawyer", "my accountant", "my landlord", "my CPA", "my partner", etc.) AND they give you the email or phone for the FIRST time, you MUST remember it so you never ask again. You do this by attaching a `save_contact` sidecar field to whatever action you\'re already emitting. ANY action type can carry this sidecar — the client saves the contact first, then runs the main action.\n\nSidecar format: "save_contact":{"label":"<relationship lowercased>","name":"<person name if known, else same as label>","email":"<email>","phone":"<phone>"}\n\nContact Rules:\n1. If the relationship label is ALREADY in the saved contacts list above, do NOT re-save and do NOT ask for the email — use the stored email/phone silently.\n2. Only attach the sidecar the FIRST time you learn the info. After that, the list above will have it.\n3. The label MUST be the relationship phrase as the user said it, lowercased ("my boss", not "John" or "Boss").\n4. When the user says "send this to my boss" and "my boss" is already in the list, ALWAYS substitute the stored email directly into the action — never ask "what is their email?" again.',
    );
  }

  // ── Email subject rule (applies everywhere) ───────────────────────────
  parts.push(
    '\n\n=== EMAIL SUBJECT LINES ===\nNEVER ask the user for a subject line when sending an email. ALWAYS generate a reasonable subject yourself based on context ("Budget report", "Following up on <topic>", "Quick update", etc.). Only use the user\'s exact phrasing if they explicitly told you what the subject should be.',
  );

  // ── Memory facts ───────────────────────────────────────────────────────
  if (memory && memory.length > 0) {
    parts.push(
      '\n\nThe user has told you these facts about themselves — use them whenever relevant:\n' +
        memory.map((m: any) => `- ${typeof m === 'string' ? m : m.fact || m.text || ''}`).join('\n'),
    );
  }

  // ── Learned preferences ────────────────────────────────────────────────
  if (learnedPrefs && learnedPrefs.length > 0) {
    parts.push(
      '\n\nYou have learned these preferences from the user\'s reactions:\n' +
        learnedPrefs.map((p: any) => `- ${typeof p === 'string' ? p : p.text || p.pref || ''}`).join('\n'),
    );
  }

  // ── Custom instructions ────────────────────────────────────────────────
  if (custom && custom.trim()) {
    parts.push(`\n\nThe user has set these custom instructions:\n${custom.trim()}`);
  }

  // ── Nickname ───────────────────────────────────────────────────────────
  if (nick && nick.trim()) {
    parts.push(
      `\n\nIMPORTANT: The user's name/nickname is "${nick.trim()}". Use it naturally — greet them by name, refer to them by name occasionally.`,
    );
  }

  return parts.join('');
}
