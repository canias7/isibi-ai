import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// automations — drip sequences. An automation is a trigger tag + ordered `steps`
// ([{delay_days, subject, body}]). A 5-min cron posts { action: "run_due" }, which:
//   1) RECONCILES: enrolls any contact carrying the trigger tag that isn't enrolled
//      yet (so existing + newly-tagged contacts join automatically), and
//   2) ADVANCES: sends the due step for each active enrollment, then schedules the
//      next step (or marks it done). Suppressed / unsubscribed addresses stop.
//
// User CRUD (list/create/update/toggle/remove) is JWT-authed; run_due uses the
// shared cron secret. Sends reuse the campaign paths (box relay for self-hosted
// domains, Composio for the user's mailbox). Deploy verify_jwt=false.

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RELAY_URL = (Deno.env.get("MAILER_RELAY_URL") ?? "").replace(/[/]+$/, "");
const RELAY_TOKEN = Deno.env.get("MAILER_RELAY_TOKEN") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "https://gofarther.dev", "https://www.gofarther.dev", "ionic://localhost", "http://localhost", "https://localhost",
  "http://localhost:5173", "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}
async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch { return null; }
}
async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders, ...(init?.headers ?? {}) } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
const TAG_RE = /^[a-zA-Z0-9 _-]{1,60}$/;

// Sanitize a steps array from the client into [{delay_days, subject, body}].
// deno-lint-ignore no-explicit-any
function cleanSteps(raw: any): { delay_days: number; subject: string; body: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((s) => ({
    delay_days: Math.min(Math.max(Math.round(Number(s?.delay_days) || 0), 0), 365),
    subject: String(s?.subject ?? "").slice(0, 300),
    body: String(s?.body ?? "").slice(0, 200000),
  })).filter((s) => s.subject && s.body);
}

async function unsubToken(uid: string, email: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${uid}:${email.toLowerCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
async function unsubUrl(uid: string, email: string): Promise<string> {
  return `${SB_URL}/functions/v1/unsubscribe?u=${encodeURIComponent(uid)}&e=${encodeURIComponent(email)}&t=${await unsubToken(uid, email)}`;
}
function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s{2,}/g, " ").trim();
}
function footer(unsub: string): string {
  return `<br><br><hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888;font-family:system-ui,sans-serif">You're receiving this because you're on a list managed in Sendra. <a href="${unsub}" style="color:#888">Unsubscribe</a>.</p>`;
}

// Send via the user's connected mailbox (Composio).
async function sendOne(uid: string, app: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const outlook = app === "outlook" || app === "m365";
  const tool = outlook ? "OUTLOOK_OUTLOOK_SEND_EMAIL" : "GMAIL_SEND_EMAIL";
  const args = outlook ? { to, subject, body: html, is_html: true } : { recipient_email: to, subject, body: html, is_html: true };
  try {
    const r = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${tool}`, {
      method: "POST", headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args }),
    });
    const b = await r.json().catch(() => ({})) as Record<string, unknown>;
    const ok = r.ok && b?.error == null && b?.successful !== false;
    return ok ? { ok: true } : { ok: false, error: String(b?.error ?? `http_${r.status}`).slice(0, 200) };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) }; }
}
// Send via the self-hosted relay (the box; OpenDKIM signs). Returns the Message-ID (sans <>).
async function sendOneSelf(fromEmail: string | null, fromName: string | null, to: string, subject: string, html: string, unsub: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RELAY_URL || !RELAY_TOKEN) return { ok: false, error: "mail_server_unset" };
  try {
    const from = fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : "no-reply@gofarther.dev";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${RELAY_URL}/send`, {
      method: "POST", signal: ctrl.signal,
      headers: { authorization: `Bearer ${RELAY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text: htmlToText(html), list_unsubscribe: unsub }),
    }).finally(() => clearTimeout(t));
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { ok: false, error: `relay_${res.status}:${j?.error ?? ""}`.slice(0, 200) };
    return { ok: true, id: typeof j?.id === "string" ? j.id.replace(/[<>]/g, "") : undefined };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) }; }
}

async function cronSecret(): Promise<string> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/wf_cron_secret`, { method: "POST", headers: sbHeaders, body: "{}" });
    if (!r.ok) return "";
    const v = await r.json().catch(() => "");
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

// ---- the runner ----
async function isSuppressed(uid: string, email: string): Promise<boolean> {
  const r = await db(`email_suppressions?user_id=eq.${uid}&email=eq.${encodeURIComponent(email)}&select=email&limit=1`);
  return r.ok && ((await r.json()) as unknown[]).length > 0;
}

// Enroll contacts that carry an automation's trigger tag but aren't enrolled yet.
// deno-lint-ignore no-explicit-any
async function reconcile(a: any): Promise<number> {
  const steps = Array.isArray(a.steps) ? a.steps : [];
  if (!steps.length || !TAG_RE.test(a.trigger_tag || "")) return 0;
  const cr = await db(`contacts?user_id=eq.${a.user_id}&tags=cs.{"${a.trigger_tag}"}&select=email,name&limit=500`);
  const contacts = (cr.ok ? await cr.json() : []) as { email: string | null; name: string | null }[];
  if (!contacts.length) return 0;
  const er = await db(`automation_enrollments?automation_id=eq.${a.id}&select=email`);
  const enrolled = new Set(((er.ok ? await er.json() : []) as { email: string }[]).map((x) => x.email.toLowerCase()));
  const firstDelay = Math.max(0, Math.round(Number(steps[0]?.delay_days) || 0));
  const nextRun = new Date(Date.now() + firstDelay * 86400 * 1000).toISOString();
  const rows = contacts
    .map((c) => (c.email || "").trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e) && !enrolled.has(e))
    .slice(0, 200)
    .map((email) => ({ automation_id: a.id, user_id: a.user_id, email, name: contacts.find((c) => (c.email || "").trim().toLowerCase() === email)?.name ?? null, step: 0, status: "active", next_run_at: nextRun }));
  if (!rows.length) return 0;
  await db("automation_enrollments?on_conflict=automation_id,email", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  return rows.length;
}

async function runDue(): Promise<{ enrolled: number; sent: number; done: number }> {
  let enrolled = 0, sent = 0, done = 0;
  // 1) Reconcile enrollments for each enabled automation.
  const ar = await db(`automations?enabled=eq.true&select=id,user_id,trigger_tag,steps&limit=50`);
  const autos = (ar.ok ? await ar.json() : []) as Record<string, unknown>[];
  for (const a of (Array.isArray(autos) ? autos : [])) {
    try { enrolled += await reconcile(a); } catch { /* skip one */ }
  }
  // 2) Advance due enrollments (bounded send budget per run).
  const nowIso = new Date().toISOString();
  const dr = await db(`automation_enrollments?status=eq.active&next_run_at=lte.${encodeURIComponent(nowIso)}&select=id,automation_id,user_id,email,name,step,automations(enabled,steps,send_via,app,from_email,from_name)&order=next_run_at.asc&limit=100`);
  const due = (dr.ok ? await dr.json() : []) as Record<string, unknown>[];
  let budget = 60;
  for (const e of (Array.isArray(due) ? due : [])) {
    if (budget <= 0) break;
    // deno-lint-ignore no-explicit-any
    const a = (e as any).automations;
    const id = e.id as string;
    const uid = e.user_id as string;
    const email = String(e.email);
    const step = Number(e.step) || 0;
    const steps = Array.isArray(a?.steps) ? a.steps : [];
    if (!a || !a.enabled) { await db(`automation_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ next_run_at: new Date(Date.now() + 3600 * 1000).toISOString(), updated_at: nowIso }) }); continue; }
    if (step >= steps.length) { await db(`automation_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "done", updated_at: nowIso }) }); done++; continue; }
    if (await isSuppressed(uid, email)) { await db(`automation_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "stopped", updated_at: nowIso }) }); continue; }

    const stepObj = steps[step] as { subject: string; body: string };
    const who = (e.name as string) || "there";
    const unsub = await unsubUrl(uid, email);
    const html = `${String(stepObj.body).replace(/\{\{\s*name\s*\}\}/g, esc(who))}${footer(unsub)}`;
    let ok = false;
    if (a.send_via === "self") {
      const res = await sendOneSelf(a.from_email, a.from_name, email, stepObj.subject, html, unsub);
      ok = res.ok;
      if (res.ok) await db("messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: uid, to_email: email, from_email: a.from_email, subject: String(stepObj.subject).slice(0, 300), status: "sent", provider_msg_id: res.id ?? null, sent_at: nowIso }) });
    } else {
      ok = (await sendOne(uid, a.app || "gmail", email, stepObj.subject, html)).ok;
    }
    budget--;

    if (!ok) {
      // The send FAILED — do NOT advance the step, or the contact silently never
      // gets this email. Leave the enrollment on this step and retry in an hour;
      // a hard-bounced address gets suppressed by then, so the isSuppressed check
      // at the top of the loop naturally stops a permanently-failing retry.
      await db(`automation_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ next_run_at: new Date(Date.now() + 3600 * 1000).toISOString(), updated_at: new Date().toISOString() }) });
      await sleep(a.send_via === "self" ? 500 : 700);
      continue;
    }
    sent++;

    // Advance: schedule the next step, or finish.
    const nextStep = step + 1;
    const patch: Record<string, unknown> = { step: nextStep, updated_at: new Date().toISOString() };
    if (nextStep >= steps.length) { patch.status = "done"; done++; }
    else { const d = Math.max(0, Math.round(Number(steps[nextStep]?.delay_days) || 0)); patch.next_run_at = new Date(Date.now() + d * 86400 * 1000).toISOString(); }
    await db(`automation_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await sleep(a.send_via === "self" ? 500 : 700);
  }
  return { enrolled, sent, done };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  // Cron runner.
  if (action === "run_due") {
    const secret = await cronSecret();
    if (!secret || !token || token !== secret) return json(req, { error: "unauthorized" }, 401);
    try { return json(req, { ok: true, ...(await runDue()) }); }
    catch (e) { console.error("automations run_due:", String((e as Error)?.message || e)); return json(req, { error: "request_failed" }, 502); }
  }

  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  try {
    if (action === "list") {
      const r = await db(`automations?user_id=eq.${uid}&select=id,name,trigger_tag,send_via,app,from_email,from_name,steps,enabled,created_at&order=created_at.desc&limit=100`);
      const automations = (r.ok ? await r.json() : []) as { id: string }[];
      // Attach lightweight enrollment counts per automation.
      const out = [];
      for (const a of (Array.isArray(automations) ? automations : [])) {
        const cr = await db(`automation_enrollments?automation_id=eq.${a.id}&select=status`);
        const rows = (cr.ok ? await cr.json() : []) as { status: string }[];
        out.push({ ...a, enrolled: rows.length, active: rows.filter((x) => x.status === "active").length, done: rows.filter((x) => x.status === "done").length });
      }
      return json(req, { automations: out });
    }

    if (action === "create" || action === "update") {
      const name = String(body?.name || "Untitled automation").slice(0, 120);
      const triggerTag = String(body?.trigger_tag || "").trim();
      if (!TAG_RE.test(triggerTag)) return json(req, { error: "bad_tag" });
      const steps = cleanSteps(body?.steps);
      if (!steps.length) return json(req, { error: "no_steps" });
      const sendVia = String(body?.send_via || "mailbox").toLowerCase() === "self" ? "self" : "mailbox";
      const app = String(body?.app || "gmail").toLowerCase();
      let fromEmail: string | null = null, fromName: string | null = null;
      if (sendVia === "self") {
        const rawFrom = String(body?.from_email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(rawFrom)) return json(req, { error: "bad_from" });
        const dom = rawFrom.split("@")[1] || "";
        if (!/^[a-z0-9.-]+$/.test(dom)) return json(req, { error: "bad_from" });
        const dRes = await db(`sending_domains?user_id=eq.${uid}&domain=eq.${dom}&verified=eq.true&select=domain`);
        if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
        fromEmail = rawFrom;
        fromName = body?.from_name ? String(body.from_name).slice(0, 120) : null;
      }
      const row = { user_id: uid, name, trigger_tag: triggerTag, send_via: sendVia, app, from_email: fromEmail, from_name: fromName, steps, updated_at: new Date().toISOString() };
      if (action === "create") {
        const r = await db("automations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...row, enabled: false }) });
        const created = (await r.json().catch(() => []))?.[0];
        return created?.id ? json(req, { automation: created }) : json(req, { error: "create_failed" }, 502);
      }
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await db(`automations?id=eq.${id}&user_id=eq.${uid}`, { method: "PATCH", body: JSON.stringify(row) });
      return json(req, { ok: true });
    }

    if (action === "toggle") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await db(`automations?id=eq.${id}&user_id=eq.${uid}`, { method: "PATCH", body: JSON.stringify({ enabled: body?.enabled === true, updated_at: new Date().toISOString() }) });
      return json(req, { ok: true });
    }

    if (action === "remove") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await db(`automations?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE" });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("automations error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
