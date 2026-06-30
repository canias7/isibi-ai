import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCheck, IconCompose, IconCalendar,
  IconWaveform, IconPhotos, IconChart, IconBolt, IconPlus,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { CONNECTORS } from './connectorData';
import { WINGUP_LOGO } from './wingupLogo';
import {
  wingupAccount, wingupMedia, wingupInsights, wingupPublish,
  isPostableImage, type IgAccount, type IgMedia, type IgInsight,
} from './wingup';

// Wingup — the social media agent. The landing is intentionally blank for now
// (no model picker, no cards) painted over Wingup's dark blue theme.
//
// Sibling to AgentsScreen: it reuses the .memg overlay shell (fixed full-screen,
// focus trap, animated close) but paints its OWN theme via .wingup-* in
// agents.css.
//
// The compose → generate → review → publish flow still lives below (the
// 'compose' view) — Instagram publishing is wired end-to-end (see runPublish →
// src/wingup.ts → the `wingup` Edge Function → Composio) — but it has no entry
// point right now; the landing is blank.

// The screen's views. 'landing' is the home dashboard; 'studio' is where you
// generate media; 'post' is the publish-to-socials flow (the ＋ button);
// 'gallery' is the generated-media shelf; 'posts' is the full Instagram post
// history (from the home feed); 'more' is the secondary menu (incl. Insights);
// the rest are read/placeholder views.
type View = 'landing' | 'studio' | 'generate' | 'post' | 'more' | 'posts' | 'calendar' | 'campaigns' | 'gallery' | 'insights' | 'metaads';
type IconCmp = typeof IconCompose;

// Studio is project-based: empty shows just a ＋; with projects it shows their
// cards. Tapping ＋ opens a vertical word list of these categories to start one.
const STUDIO_CATEGORIES = [
  '3D', 'Cartoon', 'Commercial', 'Documentary', 'Fitness',
  'Marketing', 'Music video', 'Quiz / trivia', 'Transitions', 'Weather report',
];
interface Project { id: string; type: string }

// A piece of media the user has generated with Wingup — the Gallery's contents.
// (Backed by a store once generation is wired; empty until then.)
type GenKind = 'video' | 'image';
interface GenItem { id: string; kind: GenKind; url: string; thumb?: string; caption?: string; posted?: boolean }

// The placeholder views, by id, for the "coming soon" empty states.
const PLACEHOLDERS: Record<Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'more' | 'posts'>, { title: string; emoji: string; Icon: IconCmp }> = {
  calendar: { title: 'Content calendar', emoji: '📅', Icon: IconCalendar },
  campaigns: { title: 'Campaigns', emoji: '📣', Icon: IconWaveform },
  gallery: { title: 'Your media', emoji: '🖼️', Icon: IconPhotos },
  insights: { title: 'Insights', emoji: '📊', Icon: IconChart },
  metaads: { title: 'Meta Ads', emoji: '📢', Icon: IconBolt },
};

// The social platforms Wingup can post to, by connector id. We intersect this
// with the user's connApps so chips only show accounts they've actually linked.
const SOCIAL_IDS = ['twitter', 'instagram', 'facebook', 'reddit', 'youtube', 'linkedin'];

type Step = 'compose' | 'generating' | 'result' | 'posting' | 'done';
type Generated = { caption: string; imageUrl: string };

// A branded placeholder "image": an amber gradient card with the prompt's first
// few words overlaid, returned as an SVG data URI so it renders offline. Swapped
// for a real image-model result once generation is wired (see generateContent).
function mockImage(prompt: string): string {
  // A short, safe headline pulled from the prompt — keeps the preview feeling tied
  // to what the user actually asked for.
  const words = prompt.trim().split(/\s+/).slice(0, 5).join(' ');
  const headline = (words.length > 42 ? `${words.slice(0, 42)}…` : words) || 'Your post';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#F59E0B"/><stop offset=".55" stop-color="#FB7185"/><stop offset="1" stop-color="#FB923C"/>
</linearGradient>
<radialGradient id="glow" cx="28%" cy="26%" r="70%">
<stop offset="0" stop-color="#fff3d6" stop-opacity=".85"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="640" height="640" fill="url(#bg)"/>
<rect width="640" height="640" fill="url(#glow)"/>
<text x="50" y="540" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="46" font-weight="800" fill="#fff8e8">${esc(headline)}</text>
<text x="50" y="588" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="600" fill="#fff8e8" opacity="0.85">Made with Wingup</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Produce a caption + image for the prompt. STUBBED: returns mock data after a
// short delay so the flow feels real (the caption meaningfully echoes the prompt
// and optional brand voice).
// TODO: wire real generation (OpenAI for copy + an image model). Stubbed for now.
async function generateContent(prompt: string, tone: string): Promise<Generated> {
  await new Promise((r) => setTimeout(r, 1200)); // simulate model latency
  const topic = prompt.trim().replace(/[.!?\s]+$/, '');
  const voice = tone.trim();
  // A few light variations so "Regenerate" visibly changes the copy.
  const openers = ['Big news:', 'Let’s talk about', 'Here’s the thing —', 'Just shipped:'];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const voiceLine = voice ? `\n\n(${voice} voice)` : '';
  const caption =
    `${opener} ${topic}. ` +
    `We’ve been pouring everything into this, and we can’t wait for you to see it. ` +
    `What would make ${topic.toLowerCase()} a win for you? 👇${voiceLine}\n\n#${topic.replace(/[^a-z0-9]+/gi, '')} #GoFarther`;
  return { caption, imageUrl: mockImage(prompt) };
}

// A compact relative time ("3h", "2d", "5w") from an ISO timestamp, for the feed.
function relTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 604800) return `${Math.round(s / 86400)}d`;
  if (s < 2629800) return `${Math.round(s / 604800)}w`;
  return `${Math.round(s / 2629800)}mo`;
}

// Friendly label for a Graph-API media_type.
function mediaTypeLabel(t?: string): string {
  switch (t) {
    case 'VIDEO': return 'Video';
    case 'REEL': return 'Reel';
    case 'CAROUSEL_ALBUM': return 'Carousel';
    default: return 'Photo';
  }
}

// The numeric series for an insight metric (its values, in order). Empty if none.
function insightSeries(it?: IgInsight): number[] {
  if (!it || !Array.isArray(it.values)) return [];
  return it.values.map((v) => (typeof v.value === 'number' ? v.value : Number(v.value)))
    .filter((n) => Number.isFinite(n)) as number[];
}

// Pull the headline "reach" metric from the insights list (name/title contains
// "reach"), falling back to the first metric so the hero always has something.
function reachMetric(insights: IgInsight[] | null): IgInsight | undefined {
  if (!insights || !insights.length) return undefined;
  return insights.find((i) => /reach/i.test(`${i.name ?? ''} ${i.title ?? ''}`)) ?? insights[0];
}

// Studio's category picker — a centered vertical reel. Flick to spin; the item
// in the centre is the selection. Tap the centre to start that project; tap a
// neighbour to bring it to the centre.
function StudioPicker({ categories, onPick }: { categories: string[]; onPick: (c: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Mark the item nearest the strip's vertical centre as active.
  const recompute = () => {
    const el = ref.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < el.children.length; i += 1) {
      const c = el.children[i] as HTMLElement;
      const cm = c.offsetTop + c.offsetHeight / 2;
      const d = Math.abs(cm - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    setActive((p) => (p === best ? p : best));
  };

  // Pad top/bottom by half the viewport so the first/last item can reach centre.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = Math.max(0, el.clientHeight / 2 - 30);
    el.style.paddingTop = `${pad}px`;
    el.style.paddingBottom = `${pad}px`;
    recompute();
  }, []);

  const go = (i: number) => {
    void tap();
    const el = ref.current;
    const c = el?.children[i] as HTMLElement | undefined;
    if (!el || !c) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: c.offsetTop - (el.clientHeight - c.offsetHeight) / 2, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className="wingup-reel" ref={ref} onScroll={recompute}>
      {categories.map((c, i) => {
        const d = Math.min(3, Math.abs(i - active));
        return (
          <button key={c} type="button" className={`wingup-reel-it d${d}`} onClick={() => (i === active ? onPick(c) : go(i))}>
            {c}
          </button>
        );
      })}
    </div>
  );
}

export default function WingupScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [view, setView] = useState<View>('landing');
  // ---- Compose flow: compose → generate → review → post ----
  const [step, setStep] = useState<Step>('compose');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set()); // chosen platform ids
  const [publishErr, setPublishErr] = useState(''); // a failed publish, shown on the review step
  // ---- Gallery: the user's generated media. Studio appends here on "Save"; empty
  // until then (and not yet persisted — real storage lands with generation). ----
  const [generated, setGenerated] = useState<GenItem[]>([]);
  const [galFilter, setGalFilter] = useState<'all' | 'video' | 'image'>('all');
  const [postSrc, setPostSrc] = useState(''); // the gallery item chosen to post (＋ flow)
  // ---- Studio: projects + the "new project" category picker ----
  const [projects, setProjects] = useState<Project[]>([]); // empty → Studio shows just a ＋
  const [pickerOpen, setPickerOpen] = useState(false); // the vertical category word-list
  // ---- Live Instagram reads (account header, Gallery, Insights) ----
  const igConnected = connApps.includes('instagram');
  const [account, setAccount] = useState<IgAccount | null>(null);
  const [media, setMedia] = useState<IgMedia[] | null>(null);
  const [mediaErr, setMediaErr] = useState('');
  const [insights, setInsights] = useState<IgInsight[] | null>(null);
  const [insightsErr, setInsightsErr] = useState('');

  const trapRef = useRef<HTMLDivElement>(null);

  // The user's connected social platforms, in CONNECTORS order, with name + logo.
  const socials = useMemo(
    () => CONNECTORS.filter((c) => SOCIAL_IDS.includes(c.id) && connApps.includes(c.id)),
    [connApps],
  );

  // Load the connected IG profile once (for the "Posting as @x" line). Silent on
  // failure — the header just omits the handle.
  useEffect(() => {
    if (!igConnected) return;
    let live = true;
    wingupAccount().then((a) => { if (live) setAccount(a); }).catch(() => {});
    return () => { live = false; };
  }, [igConnected]);

  // Lazy-load media + insights the first time a view that needs them is opened.
  // The home (landing) shows both (the reach hero + the recent-posts feed); the
  // Posts view reuses the media, Insights reuses the insights. (Gallery is the
  // generated-media shelf and doesn't read Instagram.)
  useEffect(() => {
    if (!igConnected) return;
    const needsMedia = view === 'posts' || view === 'landing';
    const needsInsights = view === 'insights' || view === 'landing';
    if (needsMedia && media === null) {
      wingupMedia()
        .then((m) => setMedia(m.data))
        .catch((e) => setMediaErr(e instanceof Error ? e.message : 'Couldn’t load your media.'));
    }
    if (needsInsights && insights === null) {
      wingupInsights()
        .then((r) => setInsights(r.data))
        .catch((e) => setInsightsErr(e instanceof Error ? e.message : 'Couldn’t load insights.'));
    }
  }, [view, igConnected, media, insights]);

  // Run the (stubbed) generator and advance to the result step.
  const runGenerate = async () => {
    if (!prompt.trim()) return;
    void tap();
    setStep('generating');
    const out = await generateContent(prompt, tone);
    setCaption(out.caption);
    setImageUrl(out.imageUrl);
    setStep('result');
  };

  // Back steps one level: a result step → its start, a flow → landing, a
  // placeholder → landing, and the landing → close the overlay.
  const back = () => {
    void tap();
    if (view === 'studio' && pickerOpen) { setPickerOpen(false); return; }
    if (view === 'generate' && step === 'result') { setStep('compose'); return; }
    if (view === 'generate') { setView('studio'); return; }
    if (view !== 'landing') { setView('landing'); return; }
    onClose();
  };
  useFocusTrap(true, trapRef, back);

  const togglePlatform = (id: string) => {
    void tap();
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Save the generated result into the Gallery. Session-only for now (real
  // storage lands with generation) — enough to feel the generate → Gallery loop.
  const saveToGallery = () => {
    void tap();
    const item: GenItem = {
      id: `gen-${generated.length + 1}-${imageUrl.slice(-8)}`,
      kind: 'image',
      url: imageUrl,
      caption: caption.split('\n')[0]?.slice(0, 40),
      posted: false,
    };
    setGenerated((g) => [item, ...g]);
    setPrompt(''); setTone(''); setCaption(''); setImageUrl('');
    setStep('compose');
    setView('gallery');
  };

  // Pick a gallery item to post (＋ flow), prefilling its caption + Instagram.
  const choosePostItem = (g: GenItem) => {
    void tap();
    setPostSrc(g.url);
    setCaption(g.caption || '');
    setSelected(new Set(socials.some((s) => s.id === 'instagram') ? ['instagram'] : []));
  };

  // Publish for real. Instagram is wired end-to-end (src/wingup.ts → the `wingup`
  // function → Composio); any other selected platform isn't connected here yet.
  const runPublish = async () => {
    if (!selected.size || !postSrc) return;
    if (!isPostableImage(postSrc)) {
      setPublishErr('That item isn’t real media yet — generated previews become postable once generation is wired.');
      return;
    }
    if (!selected.has('instagram')) {
      setPublishErr('Only Instagram is wired for posting right now.');
      return;
    }
    void tap();
    setPublishErr('');
    setStep('posting');
    try {
      await wingupPublish({ caption, image: postSrc });
      setGenerated((g) => g.map((it) => (it.url === postSrc ? { ...it, posted: true } : it)));
      setStep('done');
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : 'Posting failed. Please try again.');
      setStep('compose');
    }
  };

  // Reset both flows and return to a fresh landing.
  const startAnother = () => {
    void tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl(''); setSelected(new Set());
    setPostSrc(''); setPublishErr('');
    setStep('compose');
    setView('landing');
  };

  // The Studio tab — project-based.
  const openStudio = () => {
    void tap();
    setPickerOpen(false);
    setView('studio');
  };

  // Open the "new project" category picker (the ＋ on Studio).
  const openPicker = () => {
    void tap();
    setPickerOpen(true);
  };

  // Pick a category from the word list → create a project of that type.
  const pickProjectType = (type: string) => {
    void tap();
    setProjects((p) => [{ id: `p${p.length + 1}-${type}`, type }, ...p]);
    setPickerOpen(false);
  };

  // Open a project (or a Studio card) into a fresh generation flow.
  const openGenerate = () => {
    void tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl('');
    setStep('compose');
    setView('generate');
  };

  // The ＋ button — start a fresh post (publish to socials).
  const openPost = () => {
    void tap();
    setPostSrc(''); setCaption(''); setSelected(new Set()); setPublishErr('');
    setStep('compose');
    setView('post');
  };

  // Human-readable list of where we posted, for the success copy ("X, LinkedIn").
  const postedNames = CONNECTORS.filter((c) => selected.has(c.id)).map((c) => c.name).join(', ');

  // ---- Studio: project-based. Empty → just a ＋. With projects → their cards.
  // The ＋ opens a vertical word list of the categories to start a new project. ----
  const renderStudio = () => {
    if (pickerOpen) {
      return (
        <div className="wingup-pickhost">
          <StudioPicker categories={STUDIO_CATEGORIES} onPick={pickProjectType} />
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div className="wingup-scroll">
          <div className="wingup-studio-empty">
            <button type="button" className="wingup-studio-add" onClick={openPicker} aria-label="New project">
              <IconPlus size={32} />
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="wingup-scroll">
        <div className="wingup-proj">
          {projects.map((p) => (
            <button key={p.id} type="button" className="wingup-proj-card" onClick={openGenerate}>
              <span className="wingup-proj-type">{p.type}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ---- Generate: prompt → generate → save to Gallery (opened from a Studio card) ----
  const renderGenerate = () => {
    if (step === 'generating') {
      return (
        <div className="wingup-loading">
          <span className="route-spin" aria-hidden="true" />
          <p className="wingup-loading-msg">Generating…</p>
        </div>
      );
    }
    if (step === 'result') {
      return (
        <div className="wingup-form">
          <div className="wingup-preview"><img className="wingup-img" src={imageUrl} alt="Generated preview" /></div>
          <p className="wingup-note">Preview — real video/image generation is coming soon. Save it to your Gallery, then post it from there with ＋.</p>
          <label className="wingup-lbl" htmlFor="wingup-caption">Caption / idea</label>
          <textarea id="wingup-caption" className="wingup-field wingup-body" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Describe it…" />
          <button className="wingup-btn ghost" onClick={() => void runGenerate()}>↻ Regenerate</button>
          <button className="wingup-btn" onClick={saveToGallery}>🪽 Save to Gallery</button>
        </div>
      );
    }
    // compose
    return (
      <div className="wingup-form">
        <label className="wingup-lbl" htmlFor="wingup-prompt">What do you want to make?</label>
        <textarea
          id="wingup-prompt"
          className="wingup-field wingup-body"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A cinematic 360° spin of our new sneaker, soft studio light, slow motion."
        />
        <label className="wingup-lbl" htmlFor="wingup-tone">Style / brand voice <span className="wingup-opt">(optional)</span></label>
        <input
          id="wingup-tone"
          className="wingup-field"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="e.g. bright, premium, playful"
        />
        <button className="wingup-btn" disabled={!prompt.trim()} onClick={() => void runGenerate()}>✨ Generate</button>
        <p className="wingup-foot">Generate a video or image, save it to your Gallery, then post it to your socials with ＋.</p>
      </div>
    );
  };

  // ---- Post (＋): pick a gallery item → caption → platforms → publish ----
  const renderPost = () => {
    if (step === 'posting') {
      return (
        <div className="wingup-loading">
          <span className="route-spin" aria-hidden="true" />
          <p className="wingup-loading-msg">Posting your update…</p>
        </div>
      );
    }
    if (step === 'done') {
      return (
        <div className="wingup-sent">
          <span className="wingup-sent-ic"><IconCheck size={26} /></span>
          <div className="wingup-sent-title">Posted{postedNames ? ` to ${postedNames}` : ''} ✓</div>
          <div className="wingup-sent-sub">Your post is on its way to your followers.</div>
          <button className="wingup-btn" onClick={startAnother}>Done</button>
        </div>
      );
    }
    if (generated.length === 0) {
      return (
        <div className="wingup-empty">
          <span className="wingup-empty-ic" aria-hidden="true">🪽</span>
          <div className="wingup-empty-title">Nothing to post yet</div>
          <div className="wingup-empty-sub">Generate a video or image in Studio first — then come back here to post it.</div>
          <button className="wingup-btn" onClick={openStudio}>✨ Open Studio</button>
        </div>
      );
    }
    return (
      <div className="wingup-form">
        <span className="wingup-lbl">Choose what to post</span>
        <div className="wingup-postpick">
          {generated.map((g) => (
            <button key={g.id} type="button" className={`wingup-postpick-item${postSrc === g.url ? ' on' : ''}`} onClick={() => choosePostItem(g)}>
              <span className="wingup-postpick-img" style={{ backgroundImage: `url(${g.thumb || g.url})` }} aria-hidden="true" />
            </button>
          ))}
        </div>

        <label className="wingup-lbl" htmlFor="wingup-caption">Caption</label>
        <textarea id="wingup-caption" className="wingup-field wingup-body" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…" />

        <div className="wingup-targets">
          <span className="wingup-lbl">
            Post to{account?.username ? <span className="wingup-as"> · as @{account.username}</span> : null}
          </span>
          {socials.length === 0 ? (
            <p className="wingup-note">Connect a social account in Connectors to post.</p>
          ) : (
            <div className="wingup-targets-chips">
              {socials.map((c) => (
                <button
                  key={c.id}
                  className={`wingup-target${selected.has(c.id) ? ' on' : ''}`}
                  aria-pressed={selected.has(c.id)}
                  onClick={() => togglePlatform(c.id)}
                >
                  <img className="wingup-target-logo" src={c.logo} alt="" aria-hidden />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {publishErr && <p className="wingup-err" role="alert">{publishErr}</p>}
        <button className="wingup-btn" disabled={!selected.size || !postSrc} onClick={() => void runPublish()}>Post now</button>
      </div>
    );
  };

  // ---- The home dashboard (B3a): reach hero + chips + recent-posts feed. ----
  const renderHome = () => {
    if (!igConnected) {
      return (
        <div className="wingup-scroll">
          <div className="wingup-home">
            <div className="wingup-home-connect">
              <span className="wingup-empty-ic" aria-hidden="true">🪽</span>
              <div className="wingup-empty-title">Connect Instagram</div>
              <div className="wingup-empty-sub">Link your account in Connectors to see your reach, recent posts, and post straight from Wingup.</div>
            </div>
          </div>
        </div>
      );
    }

    const reach = reachMetric(insights);
    const series = insightSeries(reach);
    const reachVal = series.length ? series[series.length - 1] : null;
    const reachLabel = reach?.title || (reach?.name ? reach.name.replace(/_/g, ' ') : 'Reach');
    const trend = (series.length >= 2 && series[0] > 0)
      ? Math.round(((series[series.length - 1] - series[0]) / series[0]) * 100)
      : null;
    const max = series.length ? Math.max(...series) : 0;
    const num = (n?: number | null) => (n != null && Number.isFinite(n) ? n.toLocaleString() : '—');
    const feed = (media ?? []).slice(0, 5);

    return (
      <div className="wingup-scroll">
        <div className="wingup-home">
          {account?.username && (
            <div className="wingup-conn"><span className="wingup-conn-dot" aria-hidden="true" />Connected · <span className="wingup-conn-h">@{account.username}</span></div>
          )}

          {/* Reach hero — the headline metric, trend, and a sparkline of its series. */}
          <div className="wingup-hero-stat">
            <div className="wingup-hero-k">{reachLabel}{reach?.period ? ` · ${reach.period}` : ''}</div>
            <div className="wingup-hero-big">{insights === null ? '…' : num(reachVal)}</div>
            <div className="wingup-hero-sub">
              {trend != null
                ? <><span className={trend >= 0 ? 'wingup-up' : 'wingup-down'}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%</span> vs start of period</>
                : (insightsErr ? insightsErr : 'Your account at a glance')}
            </div>
            {series.length >= 2 && (
              <div className="wingup-spark" aria-hidden="true">
                {series.slice(-7).map((v, i) => (
                  <i key={i} style={{ height: `${Math.max(8, max ? (v / max) * 100 : 8)}%` }} />
                ))}
              </div>
            )}
            <div className="wingup-chips3">
              <div className="wingup-chip3"><div className="v">{num(account?.followers_count)}</div><div className="l">Followers</div></div>
              <div className="wingup-chip3"><div className="v">{num(account?.media_count)}</div><div className="l">Posts</div></div>
              <div className="wingup-chip3"><div className="v">{num(account?.follows_count)}</div><div className="l">Following</div></div>
            </div>
          </div>

          {/* Recent posts feed. */}
          <div className="wingup-sectionh">
            <span className="wingup-sectionh-t">Recent posts</span>
            <button type="button" className="wingup-sectionh-a" onClick={() => { void tap(); setView('posts'); }}>All →</button>
          </div>
          {media === null ? (
            <div className="wingup-loading"><span className="route-spin" aria-hidden="true" /><p className="wingup-loading-msg">Loading your posts…</p></div>
          ) : mediaErr ? (
            <p className="wingup-note">{mediaErr}</p>
          ) : feed.length === 0 ? (
            <p className="wingup-note">No posts yet — tap ＋ to make your first one.</p>
          ) : (
            <div className="wingup-feed">
              {feed.map((m) => (
                <a className="wingup-feed-row" key={m.id} href={m.permalink} target="_blank" rel="noreferrer">
                  <span className="wingup-feed-th" style={{ backgroundImage: (m.thumbnail_url || m.media_url) ? `url(${m.thumbnail_url || m.media_url})` : undefined }} aria-hidden="true" />
                  <span className="wingup-feed-meta">
                    <span className="wingup-feed-cap">{m.caption ? String(m.caption) : mediaTypeLabel(m.media_type)}</span>
                    <span className="wingup-feed-st">
                      {m.like_count != null && <span><b>{m.like_count.toLocaleString()}</b> likes</span>}
                      {m.comments_count != null && <span><b>{m.comments_count.toLocaleString()}</b> comments</span>}
                      {m.like_count == null && m.comments_count == null && <span>{mediaTypeLabel(m.media_type)}</span>}
                      {relTime(m.timestamp) && <span>· {relTime(m.timestamp)}</span>}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---- The "More" tab: secondary destinations. Insights (analytics) lives here
  // now that the 4th tab is Studio; the rest are still placeholders. ----
  const MORE_ITEMS: { id: Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'more' | 'posts' | 'gallery'>; title: string; sub: string; emoji: string }[] = [
    { id: 'insights', title: 'Insights', sub: 'Reach, followers & performance', emoji: '📊' },
    { id: 'calendar', title: 'Calendar', sub: 'Plan & schedule posts', emoji: '📅' },
    { id: 'campaigns', title: 'Campaigns', sub: 'Themed content pushes', emoji: '📣' },
    { id: 'metaads', title: 'Meta Ads', sub: 'Facebook & Instagram ads', emoji: '📢' },
  ];
  const renderMore = () => (
    <div className="wingup-scroll">
      <div className="wingup-home">
        <div className="wingup-more-list">
          {MORE_ITEMS.map((m) => (
            <button key={m.id} type="button" className="wingup-more-row" onClick={() => { void tap(); setView(m.id); }}>
              <span className="wingup-more-ic" aria-hidden="true">{m.emoji}</span>
              <span className="wingup-more-meta"><span className="wingup-more-t">{m.title}</span><span className="wingup-more-d">{m.sub}</span></span>
              <span className="wingup-more-chev" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ---- Gallery: the user's generated media (videos + images made in Wingup).
  // Empty until generation is wired; the grid + filters are ready for when it is. ----
  const FILTERS: { id: 'all' | 'video' | 'image'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'video', label: 'Videos' },
    { id: 'image', label: 'Images' },
  ];
  const renderGallery = () => {
    const items = generated.filter((g) => galFilter === 'all' || g.kind === galFilter);
    return (
      <div className="wingup-scroll">
        <div className="wingup-home">
          <div className="wingup-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`wingup-filt${galFilter === f.id ? ' on' : ''}`}
                onClick={() => { void tap(); setGalFilter(f.id); }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {generated.length === 0 ? (
            <div className="wingup-gal-empty">
              <span className="wingup-empty-ic" aria-hidden="true">🪽</span>
              <div className="wingup-empty-title">Nothing here yet</div>
              <div className="wingup-empty-sub">Videos and images you generate with Wingup land here — ready to post or download.</div>
              <button className="wingup-btn" onClick={openStudio}>✨ Generate your first</button>
            </div>
          ) : items.length === 0 ? (
            <p className="wingup-note">No {galFilter === 'video' ? 'videos' : 'images'} yet.</p>
          ) : (
            <div className="wingup-galgrid">
              {items.map((g) => (
                <button key={g.id} type="button" className="wingup-clip" onClick={() => void tap()}>
                  <span className="wingup-clip-img" style={{ backgroundImage: `url(${g.thumb || g.url})` }} aria-hidden="true" />
                  {g.kind === 'video' && <span className="wingup-clip-play" aria-hidden="true">▶</span>}
                  <span className={`wingup-clip-badge ${g.posted ? 'posted' : 'draft'}`}>{g.posted ? 'POSTED' : 'DRAFT'}</span>
                  {g.caption && <span className="wingup-clip-cap">{g.caption}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---- Posts: the connected account's full Instagram post history (drilled in
  // from the home feed's "All →"). ----
  const renderPosts = () => {
    if (!igConnected) return renderConnectPrompt('🖼️', 'Your posts', 'Connect Instagram to see your posts here.');
    if (mediaErr) return renderConnectPrompt('🖼️', 'Your posts', mediaErr);
    if (media === null) return <div className="wingup-loading"><span className="route-spin" aria-hidden="true" /><p className="wingup-loading-msg">Loading your posts…</p></div>;
    if (media.length === 0) return renderConnectPrompt('🖼️', 'No posts yet', 'Posts you publish with Wingup will show up here.');
    return (
      <div className="wingup-gallery">
        {media.map((m) => (
          <a className="wingup-gallery-item" key={m.id} href={m.permalink} target="_blank" rel="noreferrer">
            <img src={m.thumbnail_url || m.media_url} alt={m.caption ? String(m.caption).slice(0, 60) : 'Instagram post'} loading="lazy" />
          </a>
        ))}
      </div>
    );
  };

  // ---- Insights: real account metrics (reach, follower count, …) ----
  const renderInsights = () => {
    if (!igConnected) return renderConnectPrompt('📊', 'Insights', 'Connect Instagram to see your performance.');
    if (insightsErr) return renderConnectPrompt('📊', 'Insights', insightsErr);
    if (insights === null) return <div className="wingup-loading"><span className="route-spin" aria-hidden="true" /><p className="wingup-loading-msg">Loading insights…</p></div>;
    if (insights.length === 0) return renderConnectPrompt('📊', 'Insights', 'No insights available yet.');
    const latest = (it: IgInsight): string => {
      const vals = Array.isArray(it.values) ? it.values : [];
      const v = vals.length ? vals[vals.length - 1]?.value : null;
      return typeof v === 'number' ? v.toLocaleString() : (v != null ? String(v) : '—');
    };
    return (
      <div className="wingup-stats">
        {insights.map((it) => (
          <div className="wingup-stat" key={it.id || it.name}>
            <div className="wingup-stat-v">{latest(it)}</div>
            <div className="wingup-stat-l">{it.title || it.name}</div>
          </div>
        ))}
      </div>
    );
  };

  // A small "connect / empty" message reused by the read views.
  const renderConnectPrompt = (emoji: string, title: string, sub: string) => (
    <div className="wingup-empty">
      <span className="wingup-empty-ic" aria-hidden="true">{emoji}</span>
      <div className="wingup-empty-title">{title}</div>
      <div className="wingup-empty-sub">{sub}</div>
    </div>
  );

  // ---- A "coming soon" placeholder for a workspace view ----
  const renderPlaceholder = (id: Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'more' | 'posts'>) => {
    const p = PLACEHOLDERS[id];
    return (
      <div className="wingup-empty">
        <span className="wingup-empty-ic" aria-hidden="true">{p.emoji}</span>
        <div className="wingup-empty-title">{p.title}</div>
        <div className="wingup-empty-sub">Coming soon</div>
      </div>
    );
  };

  // The header title tracks the active view (the home keeps the bare wordmark).
  const headerTitle =
    view === 'landing' ? 'Wingup'
    : view === 'studio' ? 'Studio'
    : view === 'generate' ? 'Generate'
    : view === 'post' ? 'Post'
    : view === 'more' ? 'More'
    : view === 'gallery' ? 'Gallery'
    : view === 'posts' ? 'Your posts'
    : PLACEHOLDERS[view].title;

  // The bottom tab bar shows on the top-level destinations, not inside a task
  // (studio / post) or a view drilled in from More / the home feed.
  const showTabs = view === 'landing' || view === 'gallery' || view === 'studio' || view === 'more';

  return (
    <div className="memg wingup" ref={trapRef} tabIndex={-1}>
      {/* Ambient orbs — Wingup's own palette (see .wingup .live-bg). */}
      <div className="live-bg" aria-hidden="true">
        <span className="orb orb1" />
        <span className="orb orb2" />
        <span className="orb orb3" />
      </div>

      <div className="wingup-top">
        <button className="wingup-back" onClick={back} aria-label={view === 'landing' ? 'Close' : 'Back'}>
          <IconArrowLeft size={20} />
        </button>
        <div className="wingup-brand">
          <img className="wingup-brand-mark" src={WINGUP_LOGO} alt="" aria-hidden />
          <span className="wingup-brand-name">{headerTitle}</span>
        </div>
        {view === 'studio' && !pickerOpen && projects.length > 0 ? (
          <button className="wingup-back" onClick={openPicker} aria-label="New project">
            <IconPlus size={20} />
          </button>
        ) : (
          <span className="wingup-top-spacer" aria-hidden="true" />
        )}
      </div>

      {view === 'landing' && renderHome()}
      {view === 'gallery' && renderGallery()}
      {view === 'studio' && renderStudio()}
      {view === 'more' && renderMore()}
      {view === 'generate' && <div className="wingup-stage">{renderGenerate()}</div>}
      {view === 'post' && <div className="wingup-stage">{renderPost()}</div>}
      {view === 'posts' && <div className="wingup-stage">{renderPosts()}</div>}
      {view === 'insights' && <div className="wingup-stage">{renderInsights()}</div>}
      {(view === 'calendar' || view === 'campaigns' || view === 'metaads') && (
        <div className="wingup-stage">{renderPlaceholder(view)}</div>
      )}

      {showTabs && (
        <nav className="wingup-tabbar" aria-label="Wingup">
          <button type="button" className={`wingup-tb${view === 'landing' ? ' on' : ''}`} onClick={() => { void tap(); setView('landing'); }} aria-current={view === 'landing'}>
            <span className="wingup-tb-ic" aria-hidden="true">⌂</span><span className="wingup-tb-lab">Home</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'gallery' ? ' on' : ''}`} onClick={() => { void tap(); setView('gallery'); }} aria-current={view === 'gallery'}>
            <span className="wingup-tb-ic" aria-hidden="true">🪽</span><span className="wingup-tb-lab">Gallery</span>
          </button>
          <button type="button" className="wingup-fab" onClick={openPost} aria-label="Post to socials">
            <IconPlus size={26} />
          </button>
          <button type="button" className={`wingup-tb${view === 'studio' ? ' on' : ''}`} onClick={openStudio} aria-current={view === 'studio'}>
            <span className="wingup-tb-ic" aria-hidden="true">🎬</span><span className="wingup-tb-lab">Studio</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'more' ? ' on' : ''}`} onClick={() => { void tap(); setView('more'); }} aria-current={view === 'more'}>
            <span className="wingup-tb-ic" aria-hidden="true">☰</span><span className="wingup-tb-lab">More</span>
          </button>
        </nav>
      )}
    </div>
  );
}
