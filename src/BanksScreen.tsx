import { useState, useEffect, useCallback } from 'react';
import { Browser } from '@capacitor/browser';
import { IconArrowLeft } from './icons';
import { supabase } from './supabase';

// Banks — bank-account linking via Plaid Hosted Link (Plaid hosts the Link page, so
// real OAuth banks work on a phone). SEPARATE from the Composio connectors: own
// screen, own backend (`plaid` Edge Function), read-only.

type Bank = { id: string; institution: string; linked_at: string };
type Acct = { bank: string; name: string; mask?: string; type?: string; available?: number; current?: number; currency?: string; error?: string };
type Txn = { bank: string; name: string; amount: number; date: string; currency?: string; pending?: boolean; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const url = d.hosted_link_url as string | undefined;
      const linkToken = d.link_token as string | undefined;
      if (!url || !linkToken) throw new Error('Could not start linking.');
      await Browser.open({ url });

      // Plaid hosts the Link page in the browser; poll the backend until the
      // session completes (a public token is exchanged + stored server-side).
      let closedAt = 0;
      const sub = await Browser.addListener('browserFinished', () => { closedAt = Date.now(); });
      const start = Date.now();
      let done = false;
      while (!done) {
        await sleep(2500);
        try {
          const c = await call('complete', { link_token: linkToken });
          if (c.ok) { done = true; break; }
        } catch { /* keep polling */ }
        if ((closedAt && Date.now() - closedAt > 12000) || Date.now() - start > 300000) break;
      }
      await sub.remove();
      if (done) { await Browser.close().catch(() => {}); await refresh(); }
      else setErr("Linking didn't finish — give it another try.");
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
          {linking ? 'Linking… (finish in the browser)' : '+ Link a bank account'}
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
