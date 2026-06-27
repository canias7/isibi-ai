import type { DnsRecord } from './mailer';

// Domain Connect — one-click DNS setup for the self-hosted sender.
//
// Discovers whether a domain's DNS host supports Domain Connect and, once our
// template is live, builds the "apply" URL that writes the records after a single
// Authorize click. Everywhere else the app falls back to the manual records.
//
// Our template (providerId/serviceId below) is filed at
// github.com/Domain-Connect/Templates; each provider syncs it on its own
// schedule, so the one-click stays gated behind `live` until it's picked up AND
// the production mail server is up (so the records it writes actually deliver).
// Discovery itself works today — it just reports support.

export const DOMAIN_CONNECT = {
  providerId: 'gofarther.dev',
  serviceId: 'sender',
  // Flip to true once the template is merged + synced by providers and the
  // production mail server (mail.gofarther.dev) is live. See mailserver/PRODUCTION-SETUP.md.
  live: false,
  // Where the host returns the user after they Authorize.
  returnUrl: 'https://gofarther.dev/',
};

export interface DcSupport {
  supported: boolean;   // the host speaks Domain Connect
  host?: string;        // the discovered host (e.g. "domainconnect.cloudflare.com")
  applyUrl?: string;    // present only when one-click is live + supported
}

// DNS-over-HTTPS TXT lookup (browser-safe — no server needed).
async function dohTxt(name: string): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' } });
    const j = await r.json();
    return (j.Answer ?? []).map((a: { data?: string }) => String(a.data ?? '').replace(/^"|"$/g, '').replace(/"\s+"/g, ''));
  } catch { return []; }
}

// Discover the domain's Domain Connect host and (when our template is live) the
// one-click apply URL with this domain's records baked in as variables.
export async function discoverDomainConnect(domain: string, records: DnsRecord[]): Promise<DcSupport> {
  const txt = await dohTxt(`_domainconnect.${domain}`);
  const host = txt.map((t) => t.trim()).find((t) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t));
  if (!host) return { supported: false };
  // Confirm the host actually serves Domain Connect settings (and get its sync UX URL).
  let urlSyncUX = `https://${host}`;
  try {
    const res = await fetch(`https://${host}/v2/${encodeURIComponent(domain)}/settings`, { headers: { accept: 'application/json' } });
    if (!res.ok) return { supported: false, host };
    const s = await res.json();
    if (s?.urlSyncUX) urlSyncUX = String(s.urlSyncUX);
  } catch {
    return { supported: false, host };
  }
  if (!DOMAIN_CONNECT.live) return { supported: true, host };
  return { supported: true, host, applyUrl: buildApplyUrl(domain, records, urlSyncUX) };
}

// Map our DnsRecord[] to the template's variables and build the synchronous apply URL.
function buildApplyUrl(domain: string, records: DnsRecord[], urlSyncUX: string): string {
  const dkim = records.find((r) => r.purpose === 'DKIM');
  const dkimp = dkim?.value.match(/p=([A-Za-z0-9+/=]+)/)?.[1] ?? '';
  const params = new URLSearchParams({ domain });
  if (dkimp) params.set('dkimp', dkimp);
  if (DOMAIN_CONNECT.returnUrl) params.set('redirect_uri', DOMAIN_CONNECT.returnUrl);
  const base = urlSyncUX.replace(/\/+$/, '');
  return `${base}/v2/domainTemplates/providers/${DOMAIN_CONNECT.providerId}/services/${DOMAIN_CONNECT.serviceId}/apply?${params.toString()}`;
}
