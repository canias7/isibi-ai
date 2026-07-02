import {
  IconInbox, IconArrowUp, IconContacts, IconChat, IconWaveform, IconClock,
  IconChart, IconGlobe, IconDoc, IconWebhook, IconCalendar,
  IconHome, IconPhotos, IconFilm, IconUser, IconCompose, IconPlus,
} from './icons';

// Nav for the hub's pages — Marketing (Sendra) and Studio (Wingup) — shared
// between the unified desktop sidebars (App.tsx) and the screens' own mobile
// chrome (Sendra's drawer, Wingup's tabs). Lives outside the lazily-loaded
// screens so the shell can render it without pulling their chunks into the
// main bundle.

type IconCmp = typeof IconCompose;

export type SendraTab = 'texts' | 'campaigns' | 'templates' | 'domains' | 'schedule' | 'webhook' | 'emails' | 'logs' | 'deliver' | 'automations';
export type SendraNavId = SendraTab | 'inbox' | 'contacts';
export type SocialNavId = 'landing' | 'gallery' | 'studio' | 'more' | 'post';

// A sidebar click, delivered to whichever screen owns the target area.
// `n` makes every click a fresh request even when the id repeats.
export type MktNavRequest = { area: 'email' | 'social'; id: string; n: number };

// Sendra sections. 'inbox'/'contacts' open the mail workspace; the rest are tabs.
export const SENDRA_TOOLS: { id: SendraNavId; name: string; desc: string; Icon: IconCmp }[] = [
  { id: 'inbox', name: 'Inbox', desc: 'All your mail', Icon: IconInbox },
  { id: 'emails', name: 'Emails', desc: 'Sent emails', Icon: IconArrowUp },
  { id: 'contacts', name: 'Contacts', desc: 'Your people', Icon: IconContacts },
  { id: 'texts', name: 'Text', desc: 'Send an SMS', Icon: IconChat },
  { id: 'campaigns', name: 'Campaigns', desc: 'Email & SMS', Icon: IconWaveform },
  { id: 'logs', name: 'Logs', desc: 'Every email sent', Icon: IconClock },
  { id: 'deliver', name: 'Deliverability', desc: 'Are emails landing?', Icon: IconChart },
  { id: 'domains', name: 'Domains', desc: 'Send from your address', Icon: IconGlobe },
  { id: 'templates', name: 'Templates', desc: 'Reusable messages', Icon: IconDoc },
  { id: 'webhook', name: 'Webhooks', desc: 'Post events out', Icon: IconWebhook },
  { id: 'automations', name: 'Automations', desc: 'Drip sequences', Icon: IconWaveform },
  { id: 'schedule', name: 'Schedule', desc: 'Plan sends ahead', Icon: IconCalendar },
];

// Wingup destinations, same ids as its internal views.
export const SOCIAL_TOOLS: { id: SocialNavId; name: string; Icon: IconCmp }[] = [
  { id: 'landing', name: 'Home', Icon: IconHome },
  { id: 'gallery', name: 'Gallery', Icon: IconPhotos },
  { id: 'studio', name: 'Studio', Icon: IconFilm },
  { id: 'more', name: 'Profile', Icon: IconUser },
  { id: 'post', name: 'New post', Icon: IconPlus },
];
