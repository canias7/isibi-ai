import {
  IconInbox, IconArrowUp, IconContacts, IconWaveform, IconClock,
  IconChart, IconGlobe, IconDoc, IconWebhook, IconCalendar, IconCheck,
  IconHome, IconPhotos, IconFilm, IconUser, IconCompose, IconPlus,
} from './icons';

// The Marketing page's nav, shared between the unified desktop sidebar
// (App.tsx) and Sendra's mobile drawer (AgentsScreen). Lives outside the
// lazily-loaded screens so the shell can render it without pulling their
// chunks into the main bundle.

type IconCmp = typeof IconCompose;

export type SendraTab = 'campaigns' | 'templates' | 'domains' | 'schedule' | 'webhook' | 'emails' | 'logs' | 'deliver' | 'automations' | 'subscriptions';
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
  { id: 'subscriptions', name: 'Subscriptions', desc: 'Unsubscribes & bounces', Icon: IconCheck },
  { id: 'campaigns', name: 'Campaigns', desc: 'Email your lists', Icon: IconWaveform },
  { id: 'logs', name: 'Logs', desc: 'Every email sent', Icon: IconClock },
  { id: 'deliver', name: 'Deliverability', desc: 'Are emails landing?', Icon: IconChart },
  { id: 'domains', name: 'Domains', desc: 'Send from your address', Icon: IconGlobe },
  { id: 'templates', name: 'Templates', desc: 'Reusable messages', Icon: IconDoc },
  { id: 'webhook', name: 'Webhooks', desc: 'Post events out', Icon: IconWebhook },
  { id: 'automations', name: 'Automations', desc: 'Drip sequences', Icon: IconWaveform },
  { id: 'schedule', name: 'Schedule', desc: 'Plan sends ahead', Icon: IconCalendar },
];

// Wingup destinations, same ids as its internal views. Unused since the
// screen stopped shipping — kept with it.
export const SOCIAL_TOOLS: { id: SocialNavId; name: string; Icon: IconCmp }[] = [
  { id: 'landing', name: 'Home', Icon: IconHome },
  { id: 'gallery', name: 'Gallery', Icon: IconPhotos },
  { id: 'studio', name: 'Studio', Icon: IconFilm },
  { id: 'more', name: 'Profile', Icon: IconUser },
  { id: 'post', name: 'New post', Icon: IconPlus },
];
