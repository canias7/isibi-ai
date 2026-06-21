import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email templates + brand profile. Body is plain text (kind 'text') or
// ready HTML (kind 'html'). generate writes copy or a designed layout; chat
// is the Lovable-style iterative builder; both can use Anthropic's built-in
// web_search + web_fetch tools to read links / search. upload hosts an image.
//
// App-level outcomes return HTTP 200 { error }; only infra failures stay 5xx.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
// Built-in Anthropic server-side tools: web_fetch reads any URL the user shares
// (product/landing page), web_search looks things up. GA on Opus 4.8 (no beta
// header); Claude runs them and returns the finished answer in one call.
const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];
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

function brandLines(b: Record<string, string>): string[] {
  const parts: string[] = [];
  if (b.name) parts.push(`business name: ${b.name}`);
  if (b.voice) parts.push(`voice/tone: ${b.voice}`);
  if (b.signoff) parts.push(`sign off with: ${b.signoff}`);
  if (b.color) parts.push(`brand color (hex): ${b.color}`);
  if (b.logo_url) parts.push(`logo image URL: ${b.logo_url}`);
  if (b.address) parts.push(`footer address: ${b.address}`);
  return parts;
}

// deno-lint-ignore no-explicit-any
async function callClaude(system: string, messages: { role: string; content: string }[], maxTokens: number, tools?: any[]): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const reqBody: Record<string, any> = { model: MODEL, max_tokens: maxTokens, system, messages };
  if (tools && tools.length) reqBody.tools = tools;
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody),
    });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const data = await r.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
  return (data?.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("").trim();
}
function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(text.slice(a, z + 1)) as Record<string, unknown>; } catch { return null; }
}

// mode 'text' -> plain text with {{name}}; mode 'design' -> a rich HTML newsletter
// using the brand + provided image URLs (first = hero, rest fill feature sections).
async function generate(prompt: string, mode: string, brand: Record<string, string>, images: string[]): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const brandBlock = brandLines(brand).length ? ` Match this brand - ${brandLines(brand).join("; ")}.` : "";
  const imgBlock = images.length
    ? ` Use these image URLs in order, first as the full-width hero, the rest in the feature sections: ${images.join(", ")}.`
    : " No images were provided - use light gray placeholder boxes (a div, background #eeeeee, height about 220px, centered muted 'Image' label) wherever an image would go.";
  const system = mode === "design"
    ? ("You are an expert email designer and copywriter. Produce ONE marketing newsletter email as clean, email-client-safe HTML. " +
      "Structure top to bottom: a header with the logo (or the business name as a wordmark if no logo); a full-width hero image; a bold headline; one or two short intro paragraphs; then one or more feature/product sections, each with an image, a short title and a line of copy (add a small rounded discount badge like '20% off' ONLY if the description mentions a deal); a single prominent call-to-action button (rounded, brand-color background, white text); and a footer with the business name and address. " +
      "Rules: inline styles ONLY (no style tag, no script tag, no external CSS, no markdown). One centered container, max-width 600px, width 100%, light background, mobile-friendly. Use the brand color for the button, links and accents (fall back to a tasteful blue if none). Every img must be display:block; width:100%; height:auto. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). End with the sign-off. Do NOT include an unsubscribe line (the system appends one). " +
      "You can use web_search to find details and web_fetch to read any URL in the request (e.g. a product or landing page) - use the page's real copy and image URLs in the email." +
      brandBlock + imgBlock +
      " Respond with ONLY a JSON object with two string keys: subject (short and compelling) and body (the full HTML).")
    : ("You are an expert email copywriter for a small business owner. From the user's short description, write ONE email they can send to their contacts. " +
      "Voice: warm, clear, human; concise and scannable; no corporate fluff, no clickbait. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). " +
      "Plain text only - no HTML, no markdown, no images, no placeholder brackets other than {{name}}. " +
      "Keep it under ~180 words with real line breaks between short paragraphs, and end with a simple sign-off. " +
      "Do NOT add an unsubscribe line (the system appends one)." + brandBlock +
      " Respond with ONLY a JSON object with two string keys, subject and body.");
  const o = parseJson(await callClaude(system, [{ role: "user", content: prompt.slice(0, 2000) }], mode === "design" ? 8000 : 1500, mode === "design" ? WEB_TOOLS : undefined));
  if (o && o.subject && o.body) return { subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 50000) };
  return null;
}

// Lovable-style iterative builder: given the conversation + the CURRENT email
// HTML, create it (first turn) or edit it (later turns), and return the full
// updated email plus a one-line reply. Brand + image URLs ground the design.
async function chatDesign(messages: { role: string; content: string }[], current: string, brand: Record<string, string>, images: string[]): Promise<{ subject: string; body: string; reply: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const brandBlock = brandLines(brand).length ? ` Brand to match - ${brandLines(brand).join("; ")}.` : "";
  const imgBlock = images.length ? ` Image URLs you may place (first is the hero): ${images.join(", ")}.` : "";
  const curBlock = current.trim()
    ? ` The CURRENT email HTML is between <<< and >>>. Apply the user's latest instruction by editing it and keeping everything else the same. <<<${current.slice(0, 40000)}>>>`
    : " There is no email yet - create one from the user's request.";
  const system =
    "You are Sendra, an expert email designer and copywriter. You build and edit ONE marketing newsletter email as clean, email-client-safe HTML (inline styles only, no style or script tags, no markdown; one centered container max-width 600px, width 100%, mobile-friendly; every img display:block; width:100%; height:auto). " +
    "When creating fresh: logo header (or business-name wordmark), optional hero image, bold headline, short intro, optional feature/product sections with images and a small discount badge only if a deal is mentioned, ONE call-to-action button in the brand color, and a footer with the business name and address. " +
    "Personalize the greeting with the literal token {{name}}. Do NOT add an unsubscribe line (the system appends one). " +
    "You can use web_search to look things up and web_fetch to read any link the user shares (a product or landing page) - pull its real copy and image URLs into the email." +
    brandBlock + imgBlock + curBlock +
    " The reply must be ONE short, friendly sentence describing what you did. Respond with ONLY a JSON object with three string keys: subject, body (the full HTML), and reply.";
  const conv = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) }));
  if (!conv.length || conv[0].role !== "user") return null;
  const o = parseJson(await callClaude(system, conv, 8000, WEB_TOOLS));
  if (o && o.subject && o.body) return { subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 50000), reply: String(o.reply || "Done.").slice(0, 300) };
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
      const r = await fetch(`${SB_URL}/rest/v1/templates?user_id=eq.${uid}&select=id,name,subject,body,kind,chat,blocks,updated_at&order=updated_at.desc&limit=100`, { headers: sbHeaders });
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

    if (action === "chat") {
      if (!ANTHROPIC_KEY) return json(req, { error: "ai_unset" });
      const messages = Array.isArray(body?.messages) ? (body.messages as { role: string; content: string }[]) : [];
      const current = String(body?.body || "");
      const images = Array.isArray(body?.images) ? (body.images as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
      if (!messages.length) return json(req, { error: "missing_prompt" });
      const out = await chatDesign(messages, current, await getBrand(uid), images);
      return out ? json(req, { ...out, kind: "html" }) : json(req, { error: "generate_failed" });
    }

    if (action === "save") {
      const name = String(body?.name || "").slice(0, 120);
      const subject = String(body?.subject || "").trim().slice(0, 200);
      const tbody = String(body?.body || "").slice(0, 50000);
      const kind = String(body?.kind || "text") === "html" ? "html" : "text";
      const chat = Array.isArray(body?.chat) ? (body.chat as unknown[]).slice(-40) : [];
      const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
      const id = body?.id ? String(body.id) : "";
      if (!subject || !tbody) return json(req, { error: "missing_content" });

      if (id) {
        const r = await fetch(`${SB_URL}/rest/v1/templates?id=eq.${id}&user_id=eq.${uid}`, {
          method: "PATCH",
          headers: { ...sbHeaders, Prefer: "return=representation" },
          body: JSON.stringify({ name, subject, body: tbody, kind, chat, blocks, updated_at: new Date().toISOString() }),
        });
        const row = (await r.json().catch(() => []))?.[0];
        return row?.id ? json(req, { id: row.id }) : json(req, { error: "not_found" });
      }
      const r = await fetch(`${SB_URL}/rest/v1/templates`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, name: name || subject.slice(0, 60), subject, body: tbody, kind, chat, blocks }),
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
