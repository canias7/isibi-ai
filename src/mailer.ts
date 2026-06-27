import { supabase } from './supabase';

// mailer — client for the multi-tenant sending-domain control plane (the `mailer`
// Edge Function). A user adds their own domain, we hand back the DNS records to
// publish, verify them, and (once the production mail server is wired) send from
// the verified domain. See supabase/functions/mailer.

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mailer', { body });
  if (error) {
    let msg = error.message || 'Request failed';
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) { const j = await ctx.json(); if (j?.error) msg = j.error; }
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const d = (data ?? {}) as { error?: string } & T;
  if (d.error) throw new Error(d.error);
  return d as T;
}

// A DNS record the customer must publish for their domain.
export interface DnsRecord {
  type: string;     // "TXT"
  name: string;     // e.g. s1._domainkey.acme.com
  value: string;    // the record value
  purpose: string;  // "DKIM" | "SPF" | "DMARC"
}
export interface SendingDomain {
  domain: string;
  verified: boolean;
  verified_at?: string | null;
  created_at?: string;
}
export interface DomainSetup { domain: string; verified: boolean; records: DnsRecord[] }

// Add a domain → returns the DNS records to publish (DKIM + SPF include + DMARC).
export async function mailerAddDomain(domain: string): Promise<DomainSetup> {
  return invoke<DomainSetup>({ action: 'domain_add', domain });
}

// Re-fetch the records for a domain already added.
export async function mailerDomainRecords(domain: string): Promise<DomainSetup> {
  return invoke<DomainSetup>({ action: 'domain_records', domain });
}

// Check the customer actually published the DKIM + SPF records.
export async function mailerVerifyDomain(domain: string): Promise<{ domain: string; verified: boolean; checks: { dkim: boolean; spf: boolean } }> {
  return invoke({ action: 'domain_verify', domain });
}

// List the user's sending domains + their verification status.
export async function mailerListDomains(): Promise<SendingDomain[]> {
  const { domains } = await invoke<{ domains: SendingDomain[] }>({ action: 'domain_list' });
  return Array.isArray(domains) ? domains : [];
}

export async function mailerRemoveDomain(domain: string): Promise<void> {
  await invoke({ action: 'domain_remove', domain });
}

// Send from a verified domain. `from` can be a full address ("Acme <hi@acme.com>"),
// a bare address ("hi@acme.com"), or just the domain ("acme.com" → no-reply@acme.com).
// The domain must be one the user has added and verified. Returns the message id.
export async function mailerSend(p: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }): Promise<{ id?: string | null }> {
  return invoke({ action: 'send', ...p });
}
