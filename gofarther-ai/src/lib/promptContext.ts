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
  getEmailTemplates,
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

  const [savedContacts, memory, custom, nick, learnedPrefs, emailTemplates] = await Promise.all([
    getSavedContacts().catch(() => []),
    getMemory().catch(() => []),
    getCustomInstructions().catch(() => ''),
    getUserNickname().catch(() => ''),
    getLearnedPreferences().catch(() => []),
    getEmailTemplates().catch(() => []),
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

  // ── Outbound email policy ─────────────────────────────────────────────
  parts.push(
    '\n\n=== OUTBOUND EMAIL POLICY ===\nAll outbound emails MUST go through the user\'s connected email app (Gmail, Outlook, Neo, Titan, or IMAP). GoFarther\'s plan executor routes an `{"type":"plan","steps":[{"id":"send","type":"email","params":{...}}]}` step automatically through whichever mail app the user has connected, so you simply emit a plan with an email step — DO NOT emit a direct gmail.send_email or outlook_mail.send_email connector action when the user wants to send mail. If the user has NO mail app connected, tell them to connect one in Settings → Connect Apps before trying to send.',
  );

  // ── Email templates (AI-memory replacement for the templates section) ─
  if (emailTemplates && emailTemplates.length > 0) {
    parts.push(
      '\n\n=== EMAIL TEMPLATES ===\nThe user has these saved email templates. When they refer to a template by name (e.g. "send the welcome email to john@x.com", "send my invoice reminder template"), use the matching subject and body from this list directly — do NOT ask the user what the subject or body should be.\n' +
        emailTemplates
          .map((t: any) => {
            const desc = t.description ? ` — ${t.description}` : '';
            const bodyPreview = (t.body || '').replace(/<[^>]+>/g, '').slice(0, 300);
            return `• "${t.name}"${desc}\n   Subject: ${t.subject}\n   Body: ${bodyPreview}${(t.body || '').length > 300 ? '…' : ''}`;
          })
          .join('\n'),
    );
  }

  // ── Template learning sidecar rule ────────────────────────────────────
  if (includeContactLearningRule) {
    parts.push(
      '\n\nTEMPLATE LEARNING:\nWhen the user asks you to "save this as my welcome email template" / "remember this as my invoice reminder" / "save this email as <name>", attach a `save_template` sidecar to the action you emit. ANY action type can carry it — the client persists the template before running the main action.\n\nSidecar format: "save_template":{"name":"<short name lowercased>","subject":"<subject>","body":"<html or plain body>","description":"<optional when to use it>"}\n\nExample — user says "save this as my welcome email: Subject: Welcome to the team, Body: Hi, glad to have you...":\n{"type":"message","save_template":{"name":"welcome email","subject":"Welcome to the team","body":"<p>Hi, glad to have you...</p>","description":"Sent to new team members on their first day"}}\n\nTemplate usage: when the user says "send my welcome email to new@hire.com", look up the template above, use its subject + body, and emit a plan email step with those values filled in. Do not ask the user to restate the content.',
    );
  }

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
