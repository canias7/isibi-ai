/** GoFarther AI — Mobile Action Handlers */

import { Linking, Alert } from 'react-native';

/** Make a phone call */
export function makeCall(number: string) {
  Linking.openURL(`tel:${number}`);
}

/** Send SMS */
export function sendSMS(number: string, body?: string) {
  const url = body ? `sms:${number}&body=${encodeURIComponent(body)}` : `sms:${number}`;
  Linking.openURL(url);
}

/** Send email */
export function sendEmail(to: string, subject?: string, body?: string) {
  let url = `mailto:${to}`;
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  if (params.length) url += '?' + params.join('&');
  Linking.openURL(url);
}

/** Open URL in browser */
export function openURL(url: string) {
  Linking.openURL(url);
}

/** Open Maps with search */
export function openMaps(query: string) {
  Linking.openURL(`maps://?q=${encodeURIComponent(query)}`);
}

/** Open Maps with directions */
export function openDirections(from: string, to: string) {
  Linking.openURL(`maps://?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}`);
}

/** Search Google */
export function searchGoogle(query: string) {
  Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

/** Search YouTube */
export function searchYouTube(query: string) {
  Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
}

/** Open app by URL scheme */
export function openApp(scheme: string) {
  Linking.openURL(scheme).catch(() => {
    Alert.alert('App not found', 'The requested app is not installed.');
  });
}

/** Parse and execute an action from AI response */
export function executeAction(action: { type: string; target?: string; text?: string; key?: string }) {
  switch (action.type) {
    case 'call': makeCall(action.target || ''); break;
    case 'sms': sendSMS(action.target || '', action.text); break;
    case 'email': sendEmail(action.target || '', action.key, action.text); break;
    case 'open_url': openURL(action.target || ''); break;
    case 'maps': openMaps(action.target || ''); break;
    case 'directions': openDirections(action.text || 'current location', action.target || ''); break;
    case 'search': searchGoogle(action.target || ''); break;
    case 'youtube': searchYouTube(action.target || ''); break;
    default: console.log('Unknown action:', action.type);
  }
}
