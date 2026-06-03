/**
 * Preference Analysis — learns user preferences from thumbs up/down reactions.
 *
 * Every ~20 reactions, collects liked/disliked AI messages, sends them to Claude
 * for pattern analysis, and stores the extracted rules as LearnedPreferences.
 * These preferences are injected into the system prompt automatically.
 */

import { chat } from './ai';
import {
  getChatSessions, getChatHistory,
  getLearnedPreferences, saveLearnedPreferences, LearnedPreference,
  getReactionCount, resetReactionCount,
} from './storage';

const REACTION_THRESHOLD = 20;
let _analyzing = false;  // Prevent concurrent runs

/** Check if we have enough reactions to run analysis */
export async function shouldRunAnalysis(): Promise<boolean> {
  const count = await getReactionCount();
  return count >= REACTION_THRESHOLD;
}

/** Run analysis if enough reactions have accumulated (fire-and-forget safe) */
export async function runAnalysisIfNeeded() {
  if (_analyzing) return;
  try {
    const should = await shouldRunAnalysis();
    if (should) await analyzeReactionPatterns();
  } catch (e) {
    console.warn('[PreferenceAnalysis] Error:', e);
  }
}

/** Collect thumbs-up/down messages and extract preference patterns */
export async function analyzeReactionPatterns() {
  if (_analyzing) return;
  _analyzing = true;

  try {
    const sessions = await getChatSessions();
    const liked: string[] = [];
    const disliked: string[] = [];

    // Collect reactions across all sessions
    for (const session of sessions.slice(0, 20)) {
      const messages = await getChatHistory(session.id);
      for (const msg of messages) {
        if (msg.role !== 'assistant' || !msg.content) continue;
        const snippet = msg.content.slice(0, 200);
        if (msg.reaction === 'up' && liked.length < 15) {
          liked.push(snippet);
        } else if (msg.reaction === 'down' && disliked.length < 15) {
          disliked.push(snippet);
        }
      }
      if (liked.length >= 15 && disliked.length >= 15) break;
    }

    // Need at least 5 total reactions to find patterns
    if (liked.length + disliked.length < 5) {
      await resetReactionCount();
      return;
    }

    const prompt = `Analyze these two groups of AI responses and extract user preference rules.

LIKED responses (user gave thumbs up):
${liked.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

DISLIKED responses (user gave thumbs down):
${disliked.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Extract 3-7 specific, actionable preference rules about what this user likes and dislikes. Focus on:
- Response length preferences
- Tone (casual vs formal)
- Format (bullets vs paragraphs)
- Detail level
- Humor usage
- Emoji usage
- Technical depth

Return ONLY a valid JSON array like:
[{"rule": "User prefers concise responses under 3 sentences", "confidence": 0.8}]

No other text, just the JSON array.`;

    const result = await chat(
      [{ role: 'user', content: prompt }],
      'You are a pattern analyzer. Return only valid JSON arrays. No markdown, no explanation.'
    );

    // Parse the JSON response
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      await resetReactionCount();
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { rule: string; confidence: number }[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      await resetReactionCount();
      return;
    }

    // Merge with existing preferences (replace duplicates, cap at 20)
    const existing = await getLearnedPreferences();
    const newPrefs: LearnedPreference[] = parsed.map(p => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      rule: p.rule,
      confidence: Math.min(1, Math.max(0, p.confidence || 0.7)),
      createdAt: Date.now(),
    }));

    // Keep existing prefs that aren't duplicated by new ones
    const combined = [...newPrefs, ...existing].slice(0, 20);
    await saveLearnedPreferences(combined);
    await resetReactionCount();

    console.log(`[PreferenceAnalysis] Extracted ${newPrefs.length} preferences from ${liked.length + disliked.length} reactions`);
  } catch (e) {
    console.warn('[PreferenceAnalysis] Analysis failed:', e);
  } finally {
    _analyzing = false;
  }
}
