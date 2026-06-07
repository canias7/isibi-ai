export interface Connector {
  id: string;
  name: string;
  logo: string; // logo image URL
  color: string; // brand color (used for the fallback monogram)
  desc: string;
}

// Brand logos: simple-icons CDN where available, Google's favicon service for
// the few brands not in open icon sets.
const si = (slug: string) => `https://cdn.simpleicons.org/${slug}`;
const fav = (domain: string) => `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;

// All connectors run through Composio (OAuth + MCP). The endpoint slug is
// historical (`gmail-oauth`) but it connects any app via ?app=<id>.
export const CONNECT_API = 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth';

export const CONNECTORS: Connector[] = [
  { id: 'gdrive', name: 'Google Drive', logo: si('googledrive'), color: '#1FA463', desc: 'Search and read your files' },
  { id: 'gmail', name: 'Gmail', logo: si('gmail'), color: '#EA4335', desc: 'Read, search and draft emails' },
  { id: 'gcal', name: 'Google Calendar', logo: si('googlecalendar'), color: '#4285F4', desc: 'Check and create events' },
  { id: 'canva', name: 'Canva', logo: fav('canva.com'), color: '#00C4CC', desc: 'Designs and brand assets' },
  { id: 'figma', name: 'Figma', logo: si('figma'), color: '#F24E1E', desc: 'Design files and prototypes' },
  { id: 'notion', name: 'Notion', logo: si('notion'), color: '#111111', desc: 'Search and edit your workspace' },
  { id: 'atlassian', name: 'Atlassian Jira', logo: si('jira'), color: '#0052CC', desc: 'Search, read & create Jira issues' },
  { id: 'm365', name: 'Microsoft Outlook', logo: fav('outlook.com'), color: '#0078D4', desc: 'Outlook mail & calendar' },
  { id: 'slack', name: 'Slack', logo: fav('slack.com'), color: '#4A154B', desc: 'Read and send messages' },
  { id: 'hubspot', name: 'HubSpot', logo: si('hubspot'), color: '#FF7A59', desc: 'Contacts, deals & CRM' },
  { id: 'googlesheets', name: 'Google Sheets', logo: si('googlesheets'), color: '#0F9D58', desc: 'Read & edit spreadsheets' },
  { id: 'googledocs', name: 'Google Docs', logo: si('googledocs'), color: '#4285F4', desc: 'Read & write documents' },
  { id: 'excel', name: 'Microsoft Excel', logo: fav('office.com'), color: '#217346', desc: 'Spreadsheets & workbooks' },
  { id: 'one_drive', name: 'OneDrive', logo: fav('onedrive.com'), color: '#0078D4', desc: 'Find & manage your files' },
  { id: 'dropbox', name: 'Dropbox', logo: si('dropbox'), color: '#0061FF', desc: 'Find & share files' },
  { id: 'box', name: 'Box', logo: si('box'), color: '#0061D5', desc: 'Cloud files & folders' },
  { id: 'onenote', name: 'OneNote', logo: fav('onenote.com'), color: '#7719AA', desc: 'Notes & notebooks' },
  { id: 'airtable', name: 'Airtable', logo: si('airtable'), color: '#18BFFF', desc: 'Bases, tables & records' },
  { id: 'todoist', name: 'Todoist', logo: si('todoist'), color: '#E44332', desc: 'Tasks & to-dos' },
  { id: 'googletasks', name: 'Google Tasks', logo: si('googletasks'), color: '#4285F4', desc: 'Your Google to-dos' },
  { id: 'asana', name: 'Asana', logo: si('asana'), color: '#F06A6A', desc: 'Tasks & projects' },
  { id: 'trello', name: 'Trello', logo: si('trello'), color: '#0052CC', desc: 'Boards & cards' },
  { id: 'clickup', name: 'ClickUp', logo: si('clickup'), color: '#7B68EE', desc: 'Tasks & docs' },
  { id: 'monday', name: 'monday.com', logo: fav('monday.com'), color: '#FF3D57', desc: 'Work boards & items' },
  { id: 'miro', name: 'Miro', logo: si('miro'), color: '#FFD02F', desc: 'Boards & diagrams' },
  { id: 'calendly', name: 'Calendly', logo: si('calendly'), color: '#006BFF', desc: 'Scheduling & bookings' },
  { id: 'zoom', name: 'Zoom', logo: si('zoom'), color: '#0B5CFF', desc: 'Meetings & recordings' },
  { id: 'googlemeet', name: 'Google Meet', logo: si('googlemeet'), color: '#00897B', desc: 'Video meetings' },
  { id: 'microsoft_teams', name: 'Microsoft Teams', logo: fav('teams.microsoft.com'), color: '#6264A7', desc: 'Chats & channels' },
  { id: 'webex', name: 'Webex', logo: si('webex'), color: '#005073', desc: 'Meetings & messaging' },
  { id: 'telegram', name: 'Telegram', logo: si('telegram'), color: '#26A5E4', desc: 'Send & read messages' },
  { id: 'discord', name: 'Discord', logo: si('discord'), color: '#5865F2', desc: 'Servers & messages' },
  { id: 'linkedin', name: 'LinkedIn', logo: fav('linkedin.com'), color: '#0A66C2', desc: 'Posts & profile' },
  { id: 'reddit', name: 'Reddit', logo: si('reddit'), color: '#FF4500', desc: 'Browse & post' },
  { id: 'youtube', name: 'YouTube', logo: si('youtube'), color: '#FF0000', desc: 'Videos & channels' },
  { id: 'instagram', name: 'Instagram', logo: si('instagram'), color: '#E4405F', desc: 'Posts & media' },
  { id: 'twitter', name: 'X (Twitter)', logo: si('x'), color: '#000000', desc: 'Post & read tweets' },
  { id: 'spotify', name: 'Spotify', logo: si('spotify'), color: '#1DB954', desc: 'Music & playlists' },
  { id: 'salesforce', name: 'Salesforce', logo: fav('salesforce.com'), color: '#00A1E0', desc: 'CRM records & leads' },
  { id: 'pipedrive', name: 'Pipedrive', logo: fav('pipedrive.com'), color: '#017737', desc: 'Deals & contacts' },
  { id: 'zoho', name: 'Zoho', logo: si('zoho'), color: '#E42527', desc: 'CRM & business apps' },
  { id: 'zendesk', name: 'Zendesk', logo: si('zendesk'), color: '#03363D', desc: 'Support tickets' },
  { id: 'intercom', name: 'Intercom', logo: si('intercom'), color: '#1F8DED', desc: 'Conversations & contacts' },
  { id: 'freshdesk', name: 'Freshdesk', logo: fav('freshdesk.com'), color: '#06C167', desc: 'Support tickets' },
  { id: 'shopify', name: 'Shopify', logo: si('shopify'), color: '#7AB55C', desc: 'Orders, products & customers' },
  { id: 'stripe', name: 'Stripe', logo: si('stripe'), color: '#635BFF', desc: 'Payments & customers' },
  { id: 'square', name: 'Square', logo: si('square'), color: '#3E4348', desc: 'Payments & catalog' },
  { id: 'quickbooks', name: 'QuickBooks', logo: si('quickbooks'), color: '#2CA01C', desc: 'Invoices & accounting' },
  { id: 'xero', name: 'Xero', logo: si('xero'), color: '#13B5EA', desc: 'Accounting & invoices' },
  { id: 'typeform', name: 'Typeform', logo: si('typeform'), color: '#262627', desc: 'Forms & responses' },
  { id: 'jotform', name: 'Jotform', logo: fav('jotform.com'), color: '#0099FF', desc: 'Forms & submissions' },
  { id: 'mailchimp', name: 'Mailchimp', logo: si('mailchimp'), color: '#FFE01B', desc: 'Campaigns & audiences' },
  { id: 'sendgrid', name: 'SendGrid', logo: fav('sendgrid.com'), color: '#1A82E2', desc: 'Send transactional email' },
  { id: 'klaviyo', name: 'Klaviyo', logo: fav('klaviyo.com'), color: '#000000', desc: 'Email & SMS marketing' },
];

export const byId = (id: string) => CONNECTORS.find((c) => c.id === id);

// Apps surfaced in the Connectors screen for now. Everything else stays defined
// above (and fully wired on the backend — connected accounts, workflows, byId
// lookups all keep working) but is hidden from the UI until we've tested it.
// Widen this set to bring more apps back into the frontend.
export const VISIBLE_CONNECTOR_IDS = new Set<string>(['gmail', 'm365', 'excel']);
