import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email templates + brand profile. Body is plain text (kind 'text') or
// ready HTML (kind 'html'). generate writes copy or a designed layout; chat
// is the Lovable-style iterative builder; both can use Anthropic's built-in
// web_search + web_fetch tools to read links / search. upload hosts an image.
//
// App-level outcomes return HTTP 200 { error }; only infra failures stay 5xx.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";  // email building is structured HTML + copy; Sonnet handles it well at ~40% lower cost
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
async function callClaude(system: string, messages: { role: string; content: string }[], maxTokens: number, tools?: any[], timeoutMs = 55000): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const reqBody: Record<string, any> = { model: MODEL, max_tokens: maxTokens, system, messages };
  if (tools && tools.length) reqBody.tools = tools;
  const tag = tools && tools.length ? "withtools" : "plain";
  const t0 = Date.now();
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(timeoutMs), // never hang the function (and thus the UI) on a slow/stuck call
    });
  } catch (e) {
    console.error("anthropic_fetch_failed", tag, Date.now() - t0, String((e as Error)?.name || e));
    return null;
  }
  if (!r.ok) { let b = ""; try { b = (await r.text()).slice(0, 400); } catch { /* ignore */ } console.error("anthropic_error", r.status, tag, b); return null; }
  const data = await r.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
  const text = (data?.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("").trim();
  console.log("anthropic_ok", tag, Date.now() - t0, "chars", text.length);
  return text;
}
function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(text.slice(a, z + 1)) as Record<string, unknown>; } catch { return null; }
}

// mode 'text' -> plain text with {{name}}; mode 'design' -> a rich HTML newsletter
// using the brand + provided image URLs (first = hero, rest fill feature sections).
// Shared image policy: use REAL images (provided uploads first, otherwise real
// URLs the model finds with web tools); the server re-hosts every one so they
// load in the inbox. Never invent URLs; placeholder only when none is found.
const PLACEHOLDER_IMG = "<div style=\"background:#eeeeee;height:220px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999999;font-family:Arial,sans-serif;font-size:14px\">Image</div>";
const IMAGE_RULE = " IMAGES (mandatory - the email MUST be visual, never text-only): ALWAYS include a full-width hero image at the top, and a photo in EVERY product/feature section. NEVER omit an image and NEVER describe a picture in words. For each <img>, set src to a REAL photo URL if you found one via web_search/web_fetch; OTHERWISE set src=\"stock:KEYWORD\" where KEYWORD is a 1-3 word subject (e.g. <img src=\"stock:running shoes\">, <img src=\"stock:coffee cup\">, <img src=\"stock:city skyline\">). Give every <img> a matching descriptive alt too. The server turns every real URL and every stock:KEYWORD into a re-hosted image that always loads - so every <img> you write WILL render. Use any provided uploaded image URLs first (first = hero). For the brand LOGO, PREFER a clean styled text wordmark of the business name; only use an <img> logo if you have a real, verified logo URL you actually fetched.";
const EMAIL_RULES = " RENDERING (must work in every inbox, especially Outlook): build the layout with role=presentation <table> elements, NOT <div> - one outer table (align center, width 100%) wrapping an inner table at max-width 600px. Inline styles only; use a web-safe font stack everywhere (font-family:Arial,Helvetica,sans-serif). Begin the body with a hidden PREHEADER (the inbox preview line, ~50-90 chars summarizing the email): <div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff\">...</div>. Build the call-to-action as a BULLETPROOF button - a table cell with bgcolor + padding wrapping an <a> (never a styled <div>), with an <!--[if mso]> VML roundrect <![endif]--> fallback so Outlook shows it. Give every <img> a short descriptive alt and an explicit width. Keep the whole HTML under ~100KB so Gmail doesn't clip it.";
const QUALITY_RULES = " COPY QUALITY: subject under ~50 characters, specific and compelling but never clickbait; no ALL-CAPS, no '!!!', avoid spam-trigger words (FREE!!!, $$$, ACT NOW, GUARANTEED); exactly one primary call-to-action; keep a healthy text-to-image balance (never send one big image as the whole email).";

// ---- Image re-hosting: make every <img> actually render in the inbox ----
// We try the model's real URL (with a real browser UA so brand CDNs don't block
// us); if that fails we swap in a keyword-matched stock photo (from the alt) so
// there's never a broken/grey box. Whatever we get is uploaded to our bucket.
const OURS = "/storage/v1/object/public/email-assets/";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function sniffImage(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
async function fetchImage(u: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  try {
    const r = await fetch(u, { headers: { "user-agent": BROWSER_UA, accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
    let ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) { const s = sniffImage(buf); if (!s) return null; ct = s; }
    if (ct === "image/svg+xml") return null; // don't trust remote SVG in email
    return { buf, ct };
  } catch { return null; }
}
async function uploadImage(buf: Uint8Array, ct: string, uid: string): Promise<string | null> {
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
  const path = `${uid}/ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/email-assets/${path}`, { method: "POST", headers: { authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, "content-type": ct, "x-upsert": "true" }, body: buf });
  return up.ok ? `${SB_URL}${OURS}${path}` : null;
}
const STOP_WORDS = new Set(["the", "and", "for", "with", "your", "our", "new", "from", "this", "that", "image", "photo", "picture", "logo", "icon"]);
function altKeyword(tag: string): string {
  const m = tag.match(/\balt=["']([^"']*)["']/i);
  const words = (m?.[1] || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 2);
  return words.join(",") || "business,lifestyle";
}
// Keyword-matched real photo (keyless), with a guaranteed-loading final fallback.
function stockUrls(kw: string, seed: number): string[] {
  return [
    `https://loremflickr.com/1200/675/${encodeURIComponent(kw)}?lock=${seed + 1}`,
    `https://picsum.photos/seed/${encodeURIComponent(kw)}-${seed}/1200/675`,
    `https://picsum.photos/seed/sendra-${seed}/1200/675`, // always returns an image
  ];
}
// A logo is small/branded — a random stock photo would be wrong, so on failure we
// fall back to a text wordmark instead.
function isLogo(tag: string, src: string): boolean {
  return /\blogo\b/i.test(tag) || /logo|clearbit/i.test(src);
}
function brandName(tag: string, src: string): string {
  const alt = (tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "").replace(/\b(logo|icon|inc|llc|ltd|corp|co|the)\b/gi, "").replace(/[^A-Za-z0-9 &]+/g, " ").trim();
  if (alt) return alt.split(/\s+/).slice(0, 3).join(" ");
  const dom = src.match(/([a-z0-9-]+)\.(?:com|net|org|io|co|shop|store)/i)?.[1] || "";
  return dom ? dom.charAt(0).toUpperCase() + dom.slice(1) : "";
}
function wordmark(name: string): string {
  const n = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").slice(0, 40);
  return `<span style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;letter-spacing:.5px;color:inherit">${n}</span>`;
}
function setSrc(tag: string, url: string): string {
  return /\bsrc=/i.test(tag) ? tag.replace(/\bsrc=["'][^"']*["']/i, `src="${url}"`) : tag.replace(/<img\b/i, `<img src="${url}"`);
}
async function rehostImages(html: string, uid: string): Promise<string> {
  if (!html) return html;
  const tags = [...new Set(html.match(/<img\b[^>]*>/gi) || [])];
  if (!tags.length) return html;
  const replacements = new Map<string, string>();
  await Promise.all(tags.slice(0, 6).map(async (tag, i) => {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    if (src.includes(OURS)) return; // already on our bucket
    const stockReq = /^stock:/i.test(src.trim()) ? src.trim().slice(6) : ""; // model asked for a stock photo by keyword
    const logo = isLogo(tag, src);
    let url: string | null = null;
    // 1) try the model's real URL (skip for stock: requests)
    if (!stockReq && /^https?:\/\//i.test(src)) { const img = await fetchImage(src); if (img) url = await uploadImage(img.buf, img.ct, uid); }
    // 2) content images get a keyword-matched stock photo; logos do NOT (a random photo would be wrong)
    if (!url && !logo) {
      const kw = stockReq ? (stockReq.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(",") || "business,lifestyle") : altKeyword(tag);
      for (const c of stockUrls(kw, i)) { const img = await fetchImage(c); if (img) { url = await uploadImage(img.buf, img.ct, uid); if (url) break; } }
    }
    // Decide the replacement — never leave a broken <img> in the email.
    if (url) replacements.set(tag, setSrc(tag, url));
    else if (logo) { const nm = brandName(tag, src); replacements.set(tag, nm ? wordmark(nm) : ""); }
    else replacements.set(tag, ""); // content image we couldn't source at all (rare): drop it
  }));
  let out = html;
  for (const [oldTag, newTag] of replacements) out = out.split(oldTag).join(newTag);
  return out;
}
async function generate(prompt: string, mode: string, brand: Record<string, string>, images: string[]): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const brandBlock = brandLines(brand).length ? ` Match this brand - ${brandLines(brand).join("; ")}.` : "";
  const imgBlock = images.length
    ? ` Use these provided image URLs in order, first as the full-width hero, the rest in the feature sections: ${images.join(", ")}.`
    : "";
  const system = mode === "design"
    ? ("You are an expert email designer and copywriter. Produce ONE marketing newsletter email as clean, email-client-safe HTML. " +
      "Structure top to bottom: a header with the logo (or the business name as a wordmark if no logo); a full-width hero image; a bold headline; one or two short intro paragraphs; then one or more feature/product sections, each with an image, a short title and a line of copy (add a small rounded discount badge like '20% off' ONLY if the description mentions a deal); a single prominent call-to-action button (rounded, brand-color background, white text); and a footer with the business name and address. " +
      "Rules: inline styles ONLY (no style tag, no script tag, no external CSS, no markdown). One centered container, max-width 600px, width 100%, light background, mobile-friendly. Use the brand color for the button, links and accents (fall back to a tasteful blue if none). Every img must be display:block; width:100%; height:auto. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). End with the sign-off. Do NOT include an unsubscribe line (the system appends one). " +
      "You can use web_search to find details and web_fetch to read any URL in the request (e.g. a product or landing page) - use the page's real copy and real product image URLs in the email." +
      brandBlock + imgBlock + IMAGE_RULE + EMAIL_RULES + QUALITY_RULES +
      " Respond with ONLY a JSON object with two string keys: subject (short and compelling) and body (the full HTML).")
    : ("You are an expert email copywriter for a small business owner. From the user's short description, write ONE email they can send to their contacts. " +
      "Voice: warm, clear, human; concise and scannable; no corporate fluff, no clickbait. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). " +
      "Plain text only - no HTML, no markdown, no images, no placeholder brackets other than {{name}}. " +
      "Keep it under ~180 words with real line breaks between short paragraphs, and end with a simple sign-off. " +
      "Do NOT add an unsubscribe line (the system appends one)." + brandBlock +
      " Respond with ONLY a JSON object with two string keys, subject and body.");
  const tools = mode === "design" ? WEB_TOOLS : undefined;
  const max = mode === "design" ? 12000 : 1500;
  const msgs = [{ role: "user", content: prompt.slice(0, 2000) }];
  let raw = await callClaude(system, msgs, max, tools, 48000);
  if (!raw && tools) raw = await callClaude(system, msgs, max, undefined, 40000); // web tools failed/slow — build without them
  const o = parseJson(raw);
  if (o && o.subject && o.body) return { subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 50000) };
  return null;
}

// Lovable-style iterative builder: given the conversation + the CURRENT email
// HTML, create it (first turn) or edit it (later turns), and return the full
// updated email plus a one-line reply. Brand + image URLs ground the design.
async function chatDesign(messages: { role: string; content: string }[], current: string, brand: Record<string, string>, images: string[]): Promise<{ subject: string; body: string; reply: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const brandBlock = brandLines(brand).length ? ` Brand to match - ${brandLines(brand).join("; ")}.` : "";
  const imgBlock = images.length ? ` Provided image URLs you may place (first is the hero): ${images.join(", ")}.` : "";
  const curBlock = current.trim()
    ? ` The CURRENT email HTML is between <<< and >>>. Apply the user's latest instruction by editing it and keeping everything else the same. <<<${current.slice(0, 40000)}>>>`
    : " There is no email yet - create one from the user's request.";
  const system =
    "You are Sendra, an expert email designer and copywriter. You build and edit ONE marketing newsletter email as clean, email-client-safe HTML (inline styles only, no style or script tags, no markdown; one centered container max-width 600px, width 100%, mobile-friendly; every img display:block; width:100%; height:auto). " +
    "When creating fresh: logo header (or business-name wordmark), a hero image, bold headline, short intro, optional feature/product sections with images and a small discount badge only if a deal is mentioned, ONE call-to-action button in the brand color, and a footer with the business name and address. " +
    "Personalize the greeting with the literal token {{name}}. Do NOT add an unsubscribe line (the system appends one). " +
    "You can use web_search to look things up and web_fetch to read any link the user shares (a product or landing page) - pull its real copy and real product image URLs into the email." +
    brandBlock + imgBlock + IMAGE_RULE + EMAIL_RULES + QUALITY_RULES + curBlock +
    " You can also just chat: if the user only asks a question, says hi, or gives feedback that doesn't require changing the email, reply briefly and to the point and DO NOT include subject or body. Only include subject and body when you actually create or change the email." +
    " Respond with ONLY a JSON object: always include a short `reply`; include `subject` and `body` (the full HTML) ONLY when you created or changed the email.";
  const conv = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) }));
  if (!conv.length || conv[0].role !== "user") return null;
  let raw = await callClaude(system, conv, 12000, WEB_TOOLS, 48000);
  if (!raw) raw = await callClaude(system, conv, 12000, undefined, 40000); // web tools failed/slow — build without them
  const o = parseJson(raw);
  if (!o) return null;
  const reply = String(o.reply || "").slice(0, 600);
  const body = o.body ? String(o.body).slice(0, 50000) : "";
  const subject = o.subject ? String(o.subject).slice(0, 200) : "";
  if (!reply && !body) return null;
  return { subject, body, reply: reply || "Done." };
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
        headers: { authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, "content-type": ct, "x-upsert": "true" },
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
      if (!out) return json(req, { error: "generate_failed" });
      if (mode === "design" && out.body) { try { out.body = await rehostImages(out.body, uid); } catch (e) { console.error("rehost_failed", String((e as Error)?.message || e)); } }
      return json(req, { ...out, kind: mode === "design" ? "html" : "text" });
    }

    if (action === "chat") {
      if (!ANTHROPIC_KEY) return json(req, { error: "ai_unset" });
      const messages = Array.isArray(body?.messages) ? (body.messages as { role: string; content: string }[]) : [];
      const current = String(body?.body || "");
      const images = Array.isArray(body?.images) ? (body.images as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
      if (!messages.length) return json(req, { error: "missing_prompt" });
      const out = await chatDesign(messages, current, await getBrand(uid), images);
      if (!out) return json(req, { error: "generate_failed" });
      if (out.body) { try { out.body = await rehostImages(out.body, uid); } catch (e) { console.error("rehost_failed", String((e as Error)?.message || e)); } }
      return json(req, { ...out, kind: "html" });
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
