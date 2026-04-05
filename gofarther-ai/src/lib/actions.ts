/** GoFarther AI — Silent Action Handlers (all through backend, no screen opens) */

import { Alert, Linking } from 'react-native';
import * as Sharing from 'expo-sharing';
import { findContactNumber, findContactEmail } from './contacts';
import { getToken } from './api';

const TOOLS_V2 = 'https://isibi-backend.onrender.com/api/ghost/tools/v2';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Check if string is a phone number */
function isPhoneNumber(s: string): boolean {
  const cleaned = s.replace(/[\s\-\(\)\+]/g, '');
  return /^\d{7,}$/.test(cleaned);
}

/** Send SMS silently via backend (Twilio) */
export async function sendSMS(target: string, body?: string) {
  let number = target;
  if (!isPhoneNumber(target)) {
    const found = await findContactNumber(target);
    if (found) { number = found; }
    else { Alert.alert('Contact not found', `Could not find "${target}" in your contacts.`); return; }
  }

  const headers = await authHeaders();
  const res = await fetch(`${TOOLS_V2}/send-sms`, {
    method: 'POST', headers,
    body: JSON.stringify({ to: number, body: body || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || 'SMS failed');
  }
}

/** Make call silently via backend (Twilio) */
export async function makeCall(target: string, message?: string) {
  let number = target;
  if (!isPhoneNumber(target)) {
    const found = await findContactNumber(target);
    if (found) { number = found; }
    else { Alert.alert('Contact not found', `Could not find "${target}" in your contacts.`); return; }
  }

  const headers = await authHeaders();
  const res = await fetch(`${TOOLS_V2}/ai-call`, {
    method: 'POST', headers,
    body: JSON.stringify({ to: number, message: message || 'Hello, this is a call from GoFarther AI.' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || 'Call failed');
  }
}

/** Send email silently via backend (SendGrid) */
export async function sendEmail(to: string, subject?: string, body?: string) {
  const headers = await authHeaders();
  const res = await fetch(`${TOOLS_V2}/send-email`, {
    method: 'POST', headers,
    body: JSON.stringify({ to, subject: subject || 'No subject', body: body || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || 'Email failed');
  }
}

/** Open URL in browser — this one still opens a screen (intentional) */
export function openURL(url: string) {
  Linking.openURL(url);
}

/** Open Maps — still opens Maps app (intentional for navigation) */
export function openMaps(query: string) {
  Linking.openURL(`maps://?q=${encodeURIComponent(query)}`);
}

/** Open Maps with directions */
export function openDirections(from: string, to: string) {
  Linking.openURL(`maps://?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}`);
}

/** Search Google — now uses backend web search instead of opening browser */
export async function searchGoogle(query: string) {
  // This is handled by the web_search action in useChat now
  // Fallback: open browser
  Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

/** Parse and execute an action from AI response */
export async function executeAction(action: { type: string; target?: string; text?: string; key?: string }) {
  switch (action.type) {
    case 'call': await makeCall(action.target || '', action.text); break;
    case 'sms': await sendSMS(action.target || '', action.text); break;
    case 'email': await sendEmail(action.target || '', action.key, action.text); break;
    case 'open_url': openURL(action.target || ''); break;
    case 'maps': openMaps(action.target || ''); break;
    case 'directions': openDirections(action.text || 'current location', action.target || ''); break;
    case 'search': searchGoogle(action.target || ''); break;
    case 'open_file':
      if (action.target && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(action.target);
      }
      break;
    default: throw new Error(`Unknown action: ${action.type}`);
  }
}
