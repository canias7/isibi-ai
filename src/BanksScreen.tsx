import { useState, useEffect, useCallback } from 'react';
import { IconArrowLeft } from './icons';
import { supabase } from './supabase';

// Banks — bank-account linking via Plaid. Deliberately SEPARATE from the Composio
// connectors: its own screen, its own backend (`plaid` Edge Function), read-only.

type PlaidExit = { error_code?: string; error_message?: string; display_message?: string } | null;
interface PlaidLink {
  create(opts: {
    token: string;
    onSuccess: (publicToken: string) => void;
    onExit?: (err: PlaidExit) => void;
  }): { open: () => void };
}
declare global { interface Window { Plaid?: PlaidLink } }

const PLAID_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
function loadPlaid(): Promise<PlaidLink> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const done = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Failed to load Plaid')));
    const existing = document.querySelector(`script[src="${PLAID_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('Failed to load Plaid')));
      return;
    }
    const s = document.createElement('script');
    s.src = PLAID_SCRIPT; s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('Failed to load Plaid'));
    document.head.appendChild(s);
  });
}

type Bank = { id: string; institution: string; linked_at: string };
type Acct = { bank: string; name: string; mask?: string; type?: string; available?: number; current?: number; currency?: string; error?: string };
type Txn = { bank: string; name: string; amount: number; date: string; currency?: string; pending?: boolean; error?: string };

async function call(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('plaid', { body: { action, ...extra } });
  if (error) throw new Error(error.message || 'Request failed');
  const d = (data || {}) as Record<string, unknown>;
  if (d.error) throw new Error(String(d.error));
  return d;
}

export default function BanksScreen({ onClose }: { onClose: () => void }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState('');
  const [accts, setAccts] = useState<Acct[] | null>(null);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try { const d = await call('list'); setBanks((d.banks as Bank[]) || []); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function linkBank() {
    setErr(''); setLinking(true);
    try {
      const d = await call('create_link_token');
      const linkToken = d.link_token as string | undefined;
      if (!linkToken) throw new Error('Could not start linking.');
      const Plaid = await loadPlaid();
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: (publicToken: string) => {
          void (async () => {
            try { await call('exchange', { public_token: publicToken }); await refresh(); }
            catch (e) { setErr(String((e as Error).message)); }
          })();
        },
        onExit: (e: PlaidExit) => { if (e) setErr(e.display_message || e.error_message || ''); },
      });
      handler.open();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setLinking(false);
    }
  }

  async function checkBalances() {
    setBusy('balances'); setErr(''); setTxns(null);
    try { const d = await call('balances'); setAccts((d.accounts as Acct[]) || []); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(''); }
  }
  async function checkTxns() {
    setBusy('txns'); setErr(''); setAccts(null);
    try { const d = await call('transactions'); setTxns((d.transactions as Txn[]) || []); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(''); }
  }
  async function unlink(id: string) {
    setErr('');
    try { await call('unlink', { id }); setAccts(null); setTxns(null); await refresh(); }
    catch (e) { setErr(String((e as Error).message)); }
  }

  const money = (n: number | undefined | null, c?: string) => (n == null ? '—' : `${c || 'USD'} ${n.toFixed(2)}`);

  return (
    <div className="page bank-page" role="dialog" aria-label="Banks">
      <div className="page-inner">
        <div className="bank-head">
          <button className="bank-back" onClick={onClose} aria-label="Back"><IconArrowLeft size={22} /></button>
          <h1 className="page-title">Banks</h1>
        </div>
        <p className="page-sub">Link a bank account (read-only) through Plaid. Sandbox mode — at the test bank use <b>user_good</b> / <b>pass_good</b>.</p>

        <button className="bank-link-btn" onClick={() => void linkBank()} disabled={linking}>
          {linking ? 'Opening…' : '+ Link a bank account'}
        </button>

        {err && <div className="bank-err">{err}</div>}

        {loading ? (
          <div className="bank-empty">Loading…</div>
        ) : banks.length === 0 ? (
          <div className="bank-empty">No banks linked yet.</div>
        ) : (
          <>
            <div className="bank-list">
              {banks.map((b) => (
                <div key={b.id} className="bank-row">
                  <span className="bank-name">{b.institution}</span>
                  <button className="bank-unlink" onClick={() => void unlink(b.id)}>Unlink</button>
                </div>
              ))}
            </div>
            <div className="bank-actions">
              <button onClick={() => void checkBalances()} disabled={!!busy}>{busy === 'balances' ? 'Checking…' : 'Check balances'}</button>
              <button onClick={() => void checkTxns()} disabled={!!busy}>{busy === 'txns' ? 'Loading…' : 'Recent transactions'}</button>
            </div>
          </>
        )}

        {accts && (
          <div className="bank-data">
            {accts.length === 0 ? <div className="bank-empty">No accounts.</div> : accts.map((a, i) => (
              <div key={i} className="bank-data-row">
                {a.error ? <span className="bank-err-inline">{a.bank}: {a.error}</span> : (<>
                  <span>{a.name}{a.mask ? ` ••${a.mask}` : ''}</span>
                  <span className="bank-amt">{money(a.current, a.currency)}</span>
                </>)}
              </div>
            ))}
          </div>
        )}

        {txns && (
          <div className="bank-data">
            {txns.length === 0 ? <div className="bank-empty">No transactions.</div> : txns.map((t, i) => (
              <div key={i} className="bank-data-row">
                {t.error ? <span className="bank-err-inline">{t.bank}: {t.error}</span> : (<>
                  <span className="bank-txn-name">{t.date} · {t.name}{t.pending ? ' (pending)' : ''}</span>
                  <span className="bank-amt">{money(t.amount, t.currency)}</span>
                </>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
