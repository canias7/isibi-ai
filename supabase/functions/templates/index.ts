import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email templates + brand profile. A template's body is plain text
// (kind 'text', wrapped to HTML on send) or ready HTML (kind 'html' - flyer
// image, pasted design, or AI-designed layout). `generate` writes copy or a
// designed HTML layout with Claude, using the user's brand profile. `upload`
// hosts an image. Identity is server-verified; rows are service-role only.
//
// App-level outcomes return HTTP 200 { error } (supabase-js hides non-2xx
// bodies); only infra failures stay 5xx.
//
// POST { action, ... }:
//   list                                              -> { templates }
//   save     { id?, name, subject, body, kind? }      -> { id }
//   delete   { id }                                   -> { ok }
//   generate { prompt, mode? }                        -> { subject, body, kind }
//   upload   { dataB64, contentType }                 -> { url }
//   getBrand                                          -> { brand }
//   saveBrand { name, logo_url, color, voice, signoff } -> { ok }

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost",
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
  } catch {
    return null;
  }
}

async function getBrand(uid: string): Promise<Record<string, string>> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/brand_profiles?user_id=eq.${uid}&select=name,logo_url,color,voice,signoff,address`, { headers: sbHeaders });
    const row = (await r.json().catch(() => []))?.[0];
    return (row && typeof row === "object") ? row : {};
  } catch {
    return {};
  }
}

// Ask Claude for one email as JSON { subject, body }. mode 'text' -> plain text
// with {{name}}; mode 'design' -> a rich, email-client-safe HTML newsletter using
// the brand + the provided image URLs (first = hero, rest fill feature sections).
async function generate(prompt: string, mode: string, brand: Record<string, string>, images: string[]): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const b = brand || {};
  const parts: string[] = [];
  if (b.name) parts.push(`business name: ${b.name}`);
  if (b.voice) parts.push(`voice/tone: ${b.voice}`);
  if (b.signoff) parts.push(`sign off every email exactly with: ${b.signoff}`);
  if (b.color) parts.push(`brand color (hex) for buttons and accents: ${b.color}`);
  if (b.logo_url) parts.push(`logo image URL for the header: ${b.logo_url}`);
  if (b.address) parts.push(`footer business address: ${b.address}`);
  const brandBlock = parts.length ? ` Match this brand - ${parts.join("; ")}.` : "";
  const imgBlock = images.length
    ? ` Use these image URLs in order, first as the full-width hero, the rest in the feature sections: ${images.join(", ")}.`
    : " No images were provided - use light gray placeholder boxes (a div, background #eeeeee, height about 220px, centered muted 'Image' label) wherever an image would go.";

  const system = mode === "design"
    ? ("You are an expert email designer and copywriter. Produce ONE marketing newsletter email as clean, email-client-safe HTML. " +
      "Structure top to bottom: a header with the logo (or the business name as a wordmark if no logo); a full-width hero image; a bold headline; one or two short intro paragraphs; then one or more feature/product sections, each with an image, a short title and a line of copy (add a small rounded discount badge like '20% off' ONLY if the description mentions a deal); a single prominent call-to-action button (rounded, brand-color background, white text); and a footer with the business name and address. " +
      "Rules: inline styles ONLY (no style tag, no script tag, no external CSS, no markdown). One centered container, max-width 600px, width 100%, light background, mobile-friendly. Use the brand color for the button, links and accents (fall back to a tasteful blue if none). Every img must be display:block; width:100%; height:auto. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). End with the sign-off. Do NOT include an unsubscribe line (the system appends one)." +
      brandBlock + imgBlock +
      " Respond with ONLY a JSON object with two string keys: subject (short and compelling) and body (the full HTML).")
    : ("You are an expert email copywriter for a small business owner. From the user's short description, write ONE email they can send to their contacts. " +
      "Voice: warm, clear, human; concise and scannable; no corporate fluff, no clickbait. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). " +
      "Plain text only - no HTML, no markdown, no images, no placeholder brackets other than {{name}}. " +
      "Keep it under ~180 words with real line breaks between short paragraphs, and end with a simple sign-off. " +
      "Do NOT add an unsubscribe line (the system appends one)." + brandBlock +
      " Respond with ONLY a JSON object with two string keys, subject and body.");

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: mode === "design" ? 4000 : 1500, system, messages: [{ role: "user", content: prompt.slice(0, 2000) }] }),
    });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const data = await r.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
  const text = (data?.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("").trim();
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try {
    const o = JSON.parse(text.slice(a, z + 1)) as { subject?: unknown; body?: unknown };
    if (o.subject && o.body) return { subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 50000) };
  } catch { /* fall through */ }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  try {
    if (action === "list") {
      const r = await fetch(`${SB_URL}/rest/v1/templates?user_id=eq.${uid}&select=id,name,subject,body,kind,updated_at&order=updated_at.desc&limit=100`, { headers: sbHeaders });
      const templates = await r.json().catch(() => []);
      return json(req, { templates: Array.isArray(templates) ? templates : [] });
    }

    if (action === "getBrand") {
      return json(req, { brand: await getBrand(uid) });
    }

    if (action === "saveBrand") {
      const row = {
        user_id: uid,
        name: String(body?.name || "").slice(0, 200),
        logo_url: String(body?.logo_url || "").slice(0, 1000),
        color: String(body?.color || "").slice(0, 20),
        voice: String(body?.voice || "").slice(0, 500),
        signoff: String(body?.signoff || "").slice(0, 300),
        address: String(body?.address || "").slice(0, 300),
        updated_at: new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/brand_profiles?on_conflict=user_id`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      return r.ok ? json(req, { ok: true }) : json(req, { error: "save_failed" }, 502);
    }

    // Upload an image (base64) to the public email-assets bucket, return its URL.
    if (action === "upload") {
      const dataB64 = String(body?.dataB64 || "");
      const ct = String(body?.contentType || "image/png").toLowerCase();
      if (!dataB64) return json(req, { error: "missing_file" });
      if (!ct.startsWith("image/")) return json(req, { error: "bad_type" });
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0)); } catch { return json(req, { error: "bad_file" }); }
      if (bytes.length > 10 * 1024 * 1024) return json(req, { error: "too_large" });
      const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("png") ? "png" : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : "img";
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await fetch(`${SB_URL}/storage/v1/object/email-assets/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${SB_SERVICE}`, "content-type": ct, "x-upsert": "true" },
        body: bytes,
      });
      if (!up.ok) return json(req, { error: "upload_failed" }, 502);
      return json(req, { url: `${SB_URL}/storage/v1/object/public/email-assets/${path}` });
    }

    if (action === "generate") {
      if (!ANTHROPIC_KEY) return json(req, { error: "ai_unset" });
      const prompt = String(body?.prompt || "").trim();
      if (!prompt) return json(req, { error: "missing_prompt" });
      const mode = String(body?.mode || "text") === "design" ? "design" : "text";
      const images = Array.isArray(body?.images) ? (body.images as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
      const out = await generate(prompt, mode, await getBrand(uid), images);
      return out ? json(req, { ...out, kind: mode === "design" ? "html" : "text" }) : json(req, { error: "generate_failed" });
    }

    if (action === "save") {
      const name = String(body?.name || "").slice(0, 120);
      const subject = String(body?.subject || "").trim().slice(0, 200);
      const tbody = String(body?.body || "").slice(0, 50000);
      const kind = String(body?.kind || "text") === "html" ? "html" : "text";
      const id = body?.id ? String(body.id) : "";
      if (!subject || !tbody) return json(req, { error: "missing_content" });

      if (id) {
        const r = await fetch(`${SB_URL}/rest/v1/templates?id=eq.${id}&user_id=eq.${uid}`, {
          method: "PATCH",
          headers: { ...sbHeaders, Prefer: "return=representation" },
          body: JSON.stringify({ name, subject, body: tbody, kind, updated_at: new Date().toISOString() }),
        });
        const row = (await r.json().catch(() => []))?.[0];
        return row?.id ? json(req, { id: row.id }) : json(req, { error: "not_found" });
      }
      const r = await fetch(`${SB_URL}/rest/v1/templates`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, name: name || subject.slice(0, 60), subject, body: tbody, kind }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      return row?.id ? json(req, { id: row.id }) : json(req, { error: "save_failed" }, 502);
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/templates?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("templates error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
