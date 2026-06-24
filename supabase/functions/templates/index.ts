import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email templates. Body is plain text (kind 'text') or
// ready HTML (kind 'html'). generate writes copy or a designed layout; chat
// is the Lovable-style iterative builder. upload hosts an image.
//
// App-level outcomes return HTTP 200 { error }; only infra failures stay 5xx.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";  // email building is structured HTML + copy; Sonnet handles it well at ~40% lower cost
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

// deno-lint-ignore no-explicit-any
async function callClaude(system: string, messages: { role: string; content: string }[], maxTokens: number, tools?: any[], timeoutMs = 55000): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const reqBody: Record<string, any> = { model: MODEL, max_tokens: maxTokens, system, messages };
  if (tools && tools.length) reqBody.tools = tools;
  const tag = tools && tools.length ? "withtools" : "plain";
  // Retry transient Anthropic errors (overload / rate-limit / 5xx / network blip) with a
  // short backoff so a brief hiccup self-heals instead of surfacing as a failed build.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, attempt === 1 ? 800 : 2500));
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
      const name = String((e as Error)?.name || e);
      console.error("anthropic_fetch_failed", tag, Date.now() - t0, name);
      if (name === "TimeoutError" || name === "AbortError") return null; // genuinely slow/stuck — retrying won't help
      continue; // transient network blip — back off + retry
    }
    if (r.ok) {
      const data = await r.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
      const text = (data?.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("").trim();
      console.log("anthropic_ok", tag, Date.now() - t0, "chars", text.length);
      return text;
    }
    let b = ""; try { b = (await r.text()).slice(0, 400); } catch { /* ignore */ }
    console.error("anthropic_error", r.status, tag, b);
    if (r.status === 429 || r.status === 529 || r.status >= 500) continue; // overloaded/rate-limited — back off + retry
    return null; // 4xx (bad request / auth) — won't get better on retry
  }
  return null;
}
function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(text.slice(a, z + 1)) as Record<string, unknown>; } catch { return null; }
}

// mode 'text' -> plain text with {{name}}; mode 'design' -> a rich HTML newsletter.
const PLACEHOLDER_IMG = "<div style=\"background:#eeeeee;height:220px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999999;font-family:Arial,sans-serif;font-size:14px\">Image</div>";
const IMAGE_RULE = " IMAGES (mandatory - the email MUST be visual, never text-only): ALWAYS include a full-width hero image at the top, and a photo in EVERY product/feature section. NEVER omit an image and NEVER describe a picture in words. For each <img>, set src=\"stock:KEYWORD\" where KEYWORD is a 1-3 word subject (e.g. <img src=\"stock:running shoes\">, <img src=\"stock:coffee cup\">, <img src=\"stock:city skyline\">); or a real https image URL if you genuinely know one. Give every <img> a matching descriptive alt too. The server turns every stock:KEYWORD (and every real URL) into a re-hosted image that always loads - so every <img> you write WILL render. Use any provided uploaded image URLs first (first = hero). For the brand LOGO, PREFER a clean styled text wordmark of the business name; only use an <img> logo if you have a real, verified logo URL.";
const EMAIL_RULES = " RENDERING (must work in every inbox, especially Outlook): build the layout with role=presentation <table> elements, NOT <div> - one outer table (align center, width 100%) wrapping an inner table at max-width 600px. Inline styles only; use a web-safe font stack everywhere (font-family:Arial,Helvetica,sans-serif). Begin the body with a hidden PREHEADER (the inbox preview line, ~50-90 chars summarizing the email): <div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff\">...</div>. Build the call-to-action as a BULLETPROOF button - a table cell with bgcolor + padding wrapping an <a> (never a styled <div>), with an <!--[if mso]> VML roundrect <![endif]--> fallback so Outlook shows it. Give every <img> a short descriptive alt and an explicit width. Keep the whole HTML under ~100KB so Gmail doesn't clip it.";
const QUALITY_RULES = " COPY QUALITY: subject under ~50 characters, specific and compelling but never clickbait; no ALL-CAPS, no '!!!', avoid spam-trigger words (FREE!!!, $$$, ACT NOW, GUARANTEED); exactly one primary call-to-action; keep a healthy text-to-image balance (never send one big image as the whole email).";
const LINK_RULE = " LINKS: every button and text link MUST use a real, working https:// URL - the brand's official site or a likely product/landing page. NEVER use href=\"#\", an empty href, or javascript:. If unsure, point all CTAs at the brand's homepage. Open links in a new tab (target=\"_blank\").";
const SOCIAL_RULE = " SOCIAL ICONS: for a 'Follow us' row, render each platform as its own small <img> (about 32-40px), wrapped in an <a> to the profile URL, and set each icon's alt to the platform name EXACTLY - alt=\"Instagram\", alt=\"Facebook\", alt=\"X\", alt=\"TikTok\", alt=\"YouTube\", or alt=\"LinkedIn\". The server swaps in the correct brand icon for each, so don't worry about the icon source.";

// ---- Image re-hosting: make every <img> actually render in the inbox ----
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
// SSRF guard: block localhost / private / link-local / cloud-metadata targets.
function privateHost(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  if (/^(10|127|0)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:")) return true;
  return false;
}
// Fetch a user-supplied URL with SSRF protection: only public http(s) hosts, and
// redirects are followed manually so each hop is re-validated (a public host can't 302
// us to an internal address).
async function safeFetch(raw: string, headers: Record<string, string>, timeoutMs: number, maxHops = 3): Promise<Response | null> {
  let url = raw;
  for (let i = 0; i <= maxHops; i++) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || privateHost(u.hostname)) return null;
    const res = await fetch(u.toString(), { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      try { url = new URL(loc, u).toString(); } catch { return null; }
      continue;
    }
    return res;
  }
  return null;
}
async function fetchImage(u: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  try {
    const r = await safeFetch(u, { "user-agent": BROWSER_UA, accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8" }, 9000);
    if (!r || !r.ok) return null;
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
// Validate a body-supplied id before interpolating into a PostgREST URL (a `#` would
// truncate the trailing &user_id ownership filter; `&` could inject filters).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }
const STOP_WORDS = new Set(["the", "and", "for", "with", "your", "our", "new", "from", "this", "that", "image", "photo", "picture", "logo", "icon"]);
function altKeyword(tag: string): string {
  const m = tag.match(/\balt=["']([^"']*)["']/i);
  const words = (m?.[1] || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 2);
  return words.join(",") || "business,lifestyle";
}
function stockUrls(kw: string, seed: number): string[] {
  return [
    `https://loremflickr.com/1200/675/${encodeURIComponent(kw)}?lock=${seed + 1}`,
    `https://picsum.photos/seed/${encodeURIComponent(kw)}-${seed}/1200/675`,
    `https://picsum.photos/seed/sendra-${seed}/1200/675`, // always returns an image
  ];
}
function isLogo(tag: string, src: string): boolean {
  return /\blogo\b/i.test(tag) || /logo|clearbit/i.test(src);
}
// Social icons need the real brand glyph (a stock photo would be wrong). Detect the
// platform from the <img> alt/src and swap in a reliable hosted icon.
const SOCIAL_ICONS: Record<string, string> = {
  instagram: "https://img.icons8.com/color/96/instagram-new.png",
  facebook: "https://img.icons8.com/color/96/facebook-new.png",
  twitter: "https://img.icons8.com/color/96/twitterx.png",
  tiktok: "https://img.icons8.com/color/96/tiktok--v1.png",
  youtube: "https://img.icons8.com/color/96/youtube-play.png",
  linkedin: "https://img.icons8.com/fluency/96/linkedin.png",
  pinterest: "https://img.icons8.com/color/96/pinterest--v1.png",
};
function socialPlatform(tag: string): string {
  const h = tag.toLowerCase();
  if (h.includes("instagram")) return "instagram";
  if (h.includes("facebook")) return "facebook";
  if (h.includes("tiktok")) return "tiktok";
  if (h.includes("youtube")) return "youtube";
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("pinterest")) return "pinterest";
  if (h.includes("twitter") || h.includes("x.com") || /\balt=["']x["']/i.test(tag)) return "twitter";
  return "";
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
  await Promise.all(tags.slice(0, 12).map(async (tag, i) => {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    if (src.includes(OURS)) return; // already on our bucket
    const social = socialPlatform(tag);
    const stockReq = /^stock:/i.test(src.trim()) ? src.trim().slice(6) : ""; // model asked for a stock photo by keyword
    const logo = !social && isLogo(tag, src);
    let url: string | null = null;
    if (social) { const img = await fetchImage(SOCIAL_ICONS[social] || ""); if (img) url = await uploadImage(img.buf, img.ct, uid); }
    else {
      if (!stockReq && /^https?:\/\//i.test(src)) { const img = await fetchImage(src); if (img) url = await uploadImage(img.buf, img.ct, uid); }
      if (!url && !logo) {
        const kw = stockReq ? (stockReq.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(",") || "business,lifestyle") : altKeyword(tag);
        for (const c of stockUrls(kw, i)) { const img = await fetchImage(c); if (img) { url = await uploadImage(img.buf, img.ct, uid); if (url) break; } }
      }
    }
    if (url) replacements.set(tag, setSrc(tag, url));
    else if (logo) { const nm = brandName(tag, src); replacements.set(tag, nm ? wordmark(nm) : ""); }
    else replacements.set(tag, "");
  }));
  let out = html;
  for (const [oldTag, newTag] of replacements) out = out.split(oldTag).join(newTag);
  return out;
}
// Make every link work: dead/placeholder hrefs (#, empty, javascript:) are pointed
// at the email's primary real destination, and all links open in a new tab.
function normalizeLinks(html: string): string {
  if (!html) return html;
  const hrefs = [...html.matchAll(/<a\b[^>]*?\bhref=["']([^"']*)["']/gi)].map((m) => m[1]);
  const ok = (h: string) => /^(https?:\/\/|mailto:|tel:)/i.test(h);
  const primary = hrefs.find(ok) || "";
  return html.replace(/<a\b([^>]*)>/gi, (_tag, attrs) => {
    let a = attrs as string;
    const m = a.match(/\bhref=["']([^"']*)["']/i);
    const href = m ? m[1] : "";
    if ((!href || !ok(href)) && primary) a = m ? a.replace(/\bhref=["'][^"']*["']/i, `href="${primary}"`) : ` href="${primary}"${a}`;
    if (!/\btarget=/i.test(a)) a += ` target="_blank"`;
    if (!/\brel=/i.test(a)) a += ` rel="noopener noreferrer"`;
    return `<a${a}>`;
  });
}
// Pull real brand assets from a website the user pasted — name, tagline, brand color,
// logo and actual photos — so the email uses their real images instead of stock.
async function scrapeSite(url: string): Promise<{ name: string; description: string; color: string; logo: string; images: string[] } | null> {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let base: URL;
  try { base = new URL(u); } catch { return null; }
  let html = "";
  try {
    const r = await safeFetch(base.toString(), { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,*/*" }, 8000);
    if (!r || !r.ok) return null;
    if (!/text\/html/i.test(r.headers.get("content-type") || "")) return null;
    html = (await r.text()).slice(0, 800000);
  } catch { return null; }
  const meta = (key: string): string => {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"));
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"));
    return (a?.[1] || b?.[1] || "").trim();
  };
  const abs = (s: string): string => { try { return new URL(s, base).toString(); } catch { return ""; } };
  const dec = (s: string): string => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } }).trim();
  const name = dec((meta("og:site_name") || meta("og:title") || (html.match(/<title[^>]*>([^<]{0,120})<\/title>/i)?.[1] || "")).trim().slice(0, 120));
  const description = dec((meta("og:description") || meta("description") || meta("twitter:description")).slice(0, 400));
  const color = meta("theme-color").slice(0, 20);
  let logo = abs(html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon[^"']*["']/i)?.[1] || "");
  if (!logo) { const li = (html.match(/<img[^>]*(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i)?.[0] || "").match(/\bsrc=["']([^"']+)["']/i)?.[1] || ""; if (li) logo = abs(li); }
  const seen = new Set<string>();
  const images: string[] = [];
  const push = (s: string) => { const a = abs(s); if (a && /^https?:\/\//i.test(a) && !seen.has(a) && !/\.svg(\?|$)/i.test(a) && !/sprite|\bicon\b|favicon|pixel|spacer|1x1|tracking|loader|placeholder/i.test(a)) { seen.add(a); images.push(a); } };
  const og = meta("og:image") || meta("twitter:image"); if (og) push(og);
  for (const m of html.matchAll(/<img[^>]+?(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi)) { if (images.length >= 8) break; push(m[1]); }
  for (const m of html.matchAll(/<(?:img|source)[^>]+srcset=["']([^"']+)["']/gi)) { if (images.length >= 8) break; const first = m[1].split(",")[0]?.trim().split(/\s+/)[0]; if (first) push(first); }
  return { name, description, color, logo, images: images.slice(0, 6) };
}

async function generate(prompt: string, mode: string, images: string[]): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const imgBlock = images.length
    ? ` Use these provided image URLs in order, first as the full-width hero, the rest in the feature sections: ${images.join(", ")}.`
    : "";
  const system = mode === "design"
    ? ("You are an expert email designer and copywriter. Produce ONE marketing newsletter email as clean, email-client-safe HTML. " +
      "Structure top to bottom: a header with the logo (or the business name as a wordmark if no logo); a full-width hero image; a bold headline; one or two short intro paragraphs; then one or more feature/product sections, each with an image, a short title and a line of copy (add a small rounded discount badge like '20% off' ONLY if the description mentions a deal); a single prominent call-to-action button (rounded, brand-color background, white text); and a footer with the business name and address. " +
      "Rules: inline styles ONLY (no style tag, no script tag, no external CSS, no markdown). One centered container, max-width 600px, width 100%, light background, mobile-friendly. Use the brand color for the button, links and accents (fall back to a tasteful blue if none). Every img must be display:block; width:100%; height:auto. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). End with the sign-off. Do NOT include an unsubscribe line (the system appends one)." +
      imgBlock + IMAGE_RULE + EMAIL_RULES + QUALITY_RULES + LINK_RULE + SOCIAL_RULE +
      " Respond with ONLY a JSON object with two string keys: subject (short and compelling) and body (the full HTML).")
    : ("You are an expert email copywriter for a small business owner. From the user's short description, write ONE email they can send to their contacts. " +
      "Voice: warm, clear, human; concise and scannable; no corporate fluff, no clickbait. " +
      "Personalize the greeting with the literal token {{name}} (for example: 'Hi {{name}},'). " +
      "Plain text only - no HTML, no markdown, no images, no placeholder brackets other than {{name}}. " +
      "Keep it under ~180 words with real line breaks between short paragraphs, and end with a simple sign-off. " +
      "Do NOT add an unsubscribe line (the system appends one)." +
      " Respond with ONLY a JSON object with two string keys, subject and body.");
  const max = mode === "design" ? 12000 : 1500;
  const msgs = [{ role: "user", content: prompt.slice(0, 2000) }];
  let raw = await callClaude(system, msgs, max, undefined, 65000);
  if (!raw) raw = await callClaude(system, msgs, max, undefined, 40000); // one retry on a transient failure
  const o = parseJson(raw);
  if (o && o.subject && o.body) return { subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 50000) };
  return null;
}

// Lovable-style iterative builder: given the conversation + the CURRENT email
// HTML, create it (first turn) or edit it (later turns), and return the full
// updated email plus a one-line reply. Brand + image URLs ground the design.
async function chatDesign(messages: { role: string; content: string }[], current: string, images: string[]): Promise<{ subject: string; body: string; reply: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const imgBlock = images.length ? ` Provided image URLs you may place (first is the hero): ${images.join(", ")}.` : "";
  const curBlock = current.trim()
    ? ` The CURRENT email HTML is between <<< and >>>. Apply the user's latest instruction by editing it and keeping everything else the same. <<<${current.slice(0, 60000)}>>>`
    : " There is no email yet - create one from the user's request.";
  // If the user pasted a website URL, fetch it and pull real brand assets + images.
  let siteBlock = "";
  const lastUser = [...messages].reverse().find((m) => m.role !== "assistant")?.content || "";
  const urlM = lastUser.match(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i);
  if (urlM) {
    const site = await scrapeSite(urlM[1]);
    if (site && (site.images.length || site.name)) {
      const bits: string[] = [];
      if (site.name) bits.push(`business name: ${site.name}`);
      if (site.description) bits.push(`what they do: ${site.description}`);
      if (site.color) bits.push(`brand color: ${site.color}`);
      if (site.logo) bits.push(`logo image URL: ${site.logo}`);
      if (site.images.length) bits.push(`REAL photos from their site - put these EXACT urls in <img src> (first as the hero) and do NOT swap them for stock: ${site.images.join(", ")}`);
      siteBlock = ` I fetched the website the user gave you. Use this REAL brand info and STRONGLY prefer these REAL images over stock placeholders: ${bits.join("; ")}.`;
    }
  }
  const system =
    "You are Sendra, an expert email designer and copywriter. You build and edit ONE marketing newsletter email as clean, email-client-safe HTML (inline styles only, no style or script tags, no markdown; one centered container max-width 600px, width 100%, mobile-friendly; every img display:block; width:100%; height:auto). " +
    "When creating fresh: logo header (or business-name wordmark), a hero image, bold headline, short intro, optional feature/product sections with images and a small discount badge only if a deal is mentioned, ONE call-to-action button in the brand color, and a footer with the business name and address. " +
    "Personalize the greeting with the literal token {{name}}. Do NOT add an unsubscribe line (the system appends one)." +
    imgBlock + siteBlock + IMAGE_RULE + EMAIL_RULES + QUALITY_RULES + LINK_RULE + SOCIAL_RULE + curBlock +
    " When an email already exists: FIRST look at the user's LATEST message on its own. If it is ONLY a greeting, thanks, or acknowledgement with no design request - e.g. 'hi', 'hey', 'hello', 'yo', 'sup', 'thanks', 'ty', 'ok', 'okay', 'cool', 'nice', 'great', 'lol' - then DO NOT change the email at all: reply with one short friendly line and OMIT subject and body entirely (do not re-apply earlier requests). Same if they only ask a question (e.g. 'what subject works best?') - answer briefly with no body. OTHERWISE default to editing: treat the message as a change and return the full updated subject + body. This includes 'try again', 'redo', 'again', 'regenerate', 'another version', 'make it different', or any tweak - for 'try again'/'redo'/'another version', produce a genuinely fresh take (vary the copy and layout, keep the same brand/intent)." +
    " Respond with ONLY a JSON object: always include a short `reply`; include `subject` and `body` (the full updated HTML) whenever you create or change the email (which is almost always).";
  const conv = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) }));
  if (!conv.length || conv[0].role !== "user") return null;
  let raw = await callClaude(system, conv, 12000, undefined, 65000);
  if (!raw) raw = await callClaude(system, conv, 12000, undefined, 40000); // one retry on a transient failure
  const o = parseJson(raw);
  if (!o) return null;
  const reply = String(o.reply || "").slice(0, 600);
  const body = o.body ? String(o.body).slice(0, 50000) : "";
  const subject = o.subject ? String(o.subject).slice(0, 200) : "";
  if (!reply && !body) return null;
  return { subject, body, reply: reply || "Done." };
}

// Update a builder job row (best-effort; called from the background task).
async function updateJob(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/template_jobs?id=eq.${id}`, {
      method: "PATCH", headers: sbHeaders,
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  } catch { /* best-effort */ }
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
      const out = await generate(prompt, mode, images);
      if (!out) return json(req, { error: "generate_failed" });
      if (mode === "design" && out.body) { try { out.body = await rehostImages(out.body, uid); } catch (e) { console.error("rehost_failed", String((e as Error)?.message || e)); } out.body = normalizeLinks(out.body); }
      return json(req, { ...out, kind: mode === "design" ? "html" : "text" });
    }

    if (action === "chat") {
      if (!ANTHROPIC_KEY) return json(req, { error: "ai_unset" });
      const messages = Array.isArray(body?.messages) ? (body.messages as { role: string; content: string }[]) : [];
      const current = String(body?.body || "");
      const images = Array.isArray(body?.images) ? (body.images as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
      if (!messages.length) return json(req, { error: "missing_prompt" });
      const out = await chatDesign(messages, current, images);
      if (!out) return json(req, { error: "generate_failed" });
      if (out.body) { try { out.body = await rehostImages(out.body, uid); } catch (e) { console.error("rehost_failed", String((e as Error)?.message || e)); } out.body = normalizeLinks(out.body); }
      return json(req, { ...out, kind: "html" });
    }

    // Async builder: create a job, return its id immediately, and finish the work in a
    // background task — so it keeps running if the app is backgrounded or the connection
    // drops. The app polls the `job` action until status is done/error.
    if (action === "chat_async") {
      if (!ANTHROPIC_KEY) return json(req, { error: "ai_unset" });
      const messages = Array.isArray(body?.messages) ? (body.messages as { role: string; content: string }[]) : [];
      const current = String(body?.body || "");
      const images = Array.isArray(body?.images) ? (body.images as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
      if (!messages.length) return json(req, { error: "missing_prompt" });
      // Tidy this user's jobs older than an hour (keeps the table small) — best-effort.
      fetch(`${SB_URL}/rest/v1/template_jobs?user_id=eq.${uid}&created_at=lt.${new Date(Date.now() - 3600000).toISOString()}`, { method: "DELETE", headers: sbHeaders }).catch(() => {});
      // Fail jobs stuck "running" >5 min (the isolate died before updateJob ran) so the client stops polling a ghost.
      fetch(`${SB_URL}/rest/v1/template_jobs?user_id=eq.${uid}&status=eq.running&created_at=lt.${new Date(Date.now() - 300000).toISOString()}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "error", error: "stalled" }) }).catch(() => {});
      const jr = await fetch(`${SB_URL}/rest/v1/template_jobs`, { method: "POST", headers: { ...sbHeaders, Prefer: "return=representation" }, body: JSON.stringify({ user_id: uid, status: "running" }) });
      const job = (await jr.json().catch(() => []))?.[0];
      if (!job?.id) return json(req, { error: "job_failed" }, 502);
      const jobId = job.id as string;
      const work = (async () => {
        try {
          const out = await chatDesign(messages, current, images);
          if (!out) { await updateJob(jobId, { status: "error", error: "generate_failed" }); return; }
          let b = out.body;
          if (b) { try { b = await rehostImages(b, uid); } catch (e) { console.error("rehost_failed", String((e as Error)?.message || e)); } b = normalizeLinks(b); }
          await updateJob(jobId, { status: "done", subject: out.subject, body: b, reply: out.reply });
        } catch (e) {
          await updateJob(jobId, { status: "error", error: String((e as Error)?.message || e).slice(0, 200) });
        }
      })();
      // Keep the instance alive to finish the job even after we respond / the client leaves.
      try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(work); } catch { /* runtime without waitUntil */ }
      return json(req, { job_id: jobId });
    }

    // Poll a builder job.
    if (action === "job") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const r = await fetch(`${SB_URL}/rest/v1/template_jobs?id=eq.${id}&user_id=eq.${uid}&select=status,subject,body,reply,error`, { headers: sbHeaders });
      const j = (await r.json().catch(() => []))?.[0];
      return j ? json(req, { job: j }) : json(req, { error: "not_found" });
    }

    if (action === "save") {
      const name = String(body?.name || "").slice(0, 120);
      const subject = String(body?.subject || "").trim().slice(0, 200);
      const tbody = String(body?.body || "").slice(0, 50000);
      const kind = String(body?.kind || "text") === "html" ? "html" : "text";
      const chat = Array.isArray(body?.chat) ? (body.chat as unknown[]).slice(-40) : [];
      const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
      const id = vId(body?.id);   // "" => create a new template; valid uuid => update that one
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
      const id = vId(body?.id);
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
