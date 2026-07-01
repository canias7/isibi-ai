import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCheck, IconCompose, IconCalendar,
  IconWaveform, IconPhotos, IconChart, IconBolt, IconPlus,
  IconHome, IconFilm, IconUser,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { CONNECTORS } from './connectorData';
import { WINGUP_LOGO } from './wingupLogo';
import {
  wingupAccount, wingupMedia, wingupInsights, wingupPublish, wingupYtVideos, wingupYtChannel,
  isPostableImage, type IgAccount, type IgMedia, type IgInsight, type YtVideo, type YtChannel,
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
type View = 'landing' | 'studio' | 'generate' | 'post' | 'avatar' | 'more' | 'posts' | 'calendar' | 'campaigns' | 'gallery' | 'insights' | 'metaads';
type IconCmp = typeof IconCompose;

// Studio is project-based: empty shows just a ＋; with projects it shows their
// cards. Tapping ＋ opens a vertical word list of these categories to start one.
const STUDIO_CATEGORIES = [
  '3D', 'Cartoon', 'Commercial', 'Documentary', 'Fitness',
  'Marketing', 'Music video', 'Quiz / trivia', 'Transitions', 'Weather report',
];
interface Project { id: string; type: string }

// ---- Avatar builder (Higgsfield-style "design a person from scratch") ----
// A saved avatar: its attribute selections + a skin-tone colour for the card.
interface Avatar { id: string; name: string; attrs: Record<string, string>; color: string }
type AttrType = 'chip' | 'face' | 'swatch';
// Each option can carry a real thumbnail `img` (shown when present); otherwise it
// falls back to a portrait tile (skin-tone `grad` + a person silhouette).
interface AvatarSection { key: string; label: string; emoji: string; type: AttrType; options: { label: string; color?: string; grad?: string; img?: string }[] }
const faceGrad = (a: string, b: string) => `radial-gradient(ellipse at 50% 28%, ${a}, ${b})`;
// The builder's sections, in order. `face` = portrait tiles, `swatch` = colour
// dots, `chip` = text pills. Trim/extend freely as the real generator lands.
const AVATAR_SECTIONS: AvatarSection[] = [
  { key: 'character', label: 'Character', emoji: '🧑', type: 'face', options: [
    { label: 'Human', grad: faceGrad('#caa17a', '#241b12') },
    { label: 'Realistic', grad: faceGrad('#b98e6a', '#1e160f') },
    { label: 'Anime', grad: faceGrad('#7dd3fc', '#10243b') },
    { label: '3D', grad: faceGrad('#a78bfa', '#160c20') },
    { label: 'Elf', grad: faceGrad('#9ae6b4', '#0c1a14') },
    { label: 'Robot', grad: faceGrad('#94a3b8', '#11151d') },
  ] },
  { key: 'gender', label: 'Gender', emoji: '👤', type: 'chip', options: [
    { label: 'Female' }, { label: 'Male' }, { label: 'Non-binary' }, { label: 'Trans woman' }, { label: 'Trans man' },
  ] },
  { key: 'ethnicity', label: 'Ethnicity / origin', emoji: '🌍', type: 'face', options: [
    { label: 'African', grad: faceGrad('#6b4a32', '#1a1210') },
    { label: 'Asian', grad: faceGrad('#caa17a', '#241b12') },
    { label: 'European', grad: faceGrad('#e3c4a3', '#2a2018') },
    { label: 'Indian', grad: faceGrad('#8a5a44', '#1d130e') },
    { label: 'Middle Eastern', grad: faceGrad('#c79b78', '#241a12') },
    { label: 'Latino', grad: faceGrad('#b07a52', '#1f1510') },
    { label: 'Mixed', grad: faceGrad('#9a6f55', '#1f1510') },
  ] },
  { key: 'skin', label: 'Skin tone', emoji: '🎨', type: 'swatch', options: [
    { label: 'Deep', color: '#3a2a1e' }, { label: 'Brown', color: '#6b4a32' }, { label: 'Tan', color: '#a9794f' },
    { label: 'Medium', color: '#c79b78' }, { label: 'Light', color: '#e3c4a3' }, { label: 'Fair', color: '#f2dcc4' },
  ] },
  { key: 'hairStyle', label: 'Hair', emoji: '💇', type: 'chip', options: [
    { label: 'Short' }, { label: 'Medium' }, { label: 'Long' }, { label: 'Curly' }, { label: 'Buzz' }, { label: 'Bald' },
  ] },
  { key: 'hairColor', label: 'Hair colour', emoji: '🌈', type: 'swatch', options: [
    { label: 'Black', color: '#1a1a1a' }, { label: 'Brown', color: '#5b3a1e' }, { label: 'Blonde', color: '#d9b06a' },
    { label: 'Red', color: '#a33a1e' }, { label: 'Gray', color: '#9aa0a6' }, { label: 'Dyed', color: '#3b6fd6' },
  ] },
  { key: 'eyes', label: 'Eye colour', emoji: '👁️', type: 'swatch', options: [
    { label: 'Brown', color: '#6b4a2a' }, { label: 'Blue', color: '#3b6fd6' }, { label: 'Green', color: '#3a8a5a' },
    { label: 'Hazel', color: '#8a6a3a' }, { label: 'Gray', color: '#8a98a6' }, { label: 'Amber', color: '#c08a3a' },
  ] },
  { key: 'age', label: 'Age', emoji: '🎂', type: 'chip', options: [
    { label: 'Teen' }, { label: 'Adult' }, { label: 'Mature' }, { label: 'Senior' },
  ] },
  { key: 'body', label: 'Build', emoji: '🏋️', type: 'chip', options: [
    { label: 'Slim' }, { label: 'Average' }, { label: 'Athletic' }, { label: 'Curvy' }, { label: 'Plus' },
  ] },
  { key: 'vibe', label: 'Style / vibe', emoji: '✨', type: 'chip', options: [
    { label: 'Casual' }, { label: 'Professional' }, { label: 'Streetwear' }, { label: 'Glam' }, { label: 'Sporty' },
  ] },
  { key: 'details', label: 'Skin details', emoji: '🔬', type: 'chip', options: [
    { label: 'None' }, { label: 'Freckles' }, { label: 'Vitiligo' }, { label: 'Birthmarks' }, { label: 'Wrinkles' },
  ] },
];
const AVATAR_DEFAULTS: Record<string, string> = {
  character: 'Human', gender: 'Female', ethnicity: 'Asian', skin: 'Tan', hairStyle: 'Medium',
  hairColor: 'Black', eyes: 'Brown', age: 'Adult', body: 'Average', vibe: 'Casual', details: 'None',
};
// Look up the hex for the currently-chosen skin tone (drives the preview/card).
const skinColorOf = (attrs: Record<string, string>) =>
  AVATAR_SECTIONS.find((s) => s.key === 'skin')?.options.find((o) => o.label === attrs.skin)?.color || '#a9794f';

// A head-and-shoulders bust used as a portrait placeholder inside avatar tiles,
// the preview, and Profile cards — until real generated thumbnails replace it.
const PersonSilhouette = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <circle cx="32" cy="21" r="12.5" />
    <path d="M32 37C18.7 37 8 45.7 8 56.4V64h48v-7.6C56 45.7 45.3 37 32 37Z" />
  </svg>
);

// A piece of media the user has generated with Wingup — the Gallery's contents.
// (Backed by a store once generation is wired; empty until then.)
type GenKind = 'video' | 'image';
interface GenItem { id: string; kind: GenKind; url: string; thumb?: string; caption?: string; posted?: boolean }

// The placeholder views, by id, for the "coming soon" empty states.
const PLACEHOLDERS: Record<Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'avatar' | 'more' | 'posts'>, { title: string; emoji: string; Icon: IconCmp }> = {
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
  // ---- Profile: saved avatars + the avatar builder's current draft ----
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [avatarDraft, setAvatarDraft] = useState<Record<string, string>>(AVATAR_DEFAULTS);
  // ---- Live Instagram reads (account header, Gallery, Insights) ----
  const igConnected = connApps.includes('instagram');
  const [account, setAccount] = useState<IgAccount | null>(null);
  const [media, setMedia] = useState<IgMedia[] | null>(null);
  const [mediaErr, setMediaErr] = useState('');
  const [insights, setInsights] = useState<IgInsight[] | null>(null);
  const [insightsErr, setInsightsErr] = useState('');

  // ---- Live YouTube reads (channel stats card + recent uploads) ----
  const ytConnected = connApps.includes('youtube');
  const [ytChannel, setYtChannel] = useState<YtChannel | null>(null);
  const [ytVideos, setYtVideos] = useState<YtVideo[] | null>(null);
  const [ytVideosErr, setYtVideosErr] = useState('');

  // Which platform's stat card sits on top of the home deck (chosen via the dots).
  const [activeCard, setActiveCard] = useState<'instagram' | 'youtube'>('instagram');

  const trapRef = useRef<HTMLDivElement>(null);

  // Bottom-bar indicator dot: measure the active tab's centre so the dot slides
  // to it (px-precise regardless of bar padding). `armed` gates the transition
  // so the dot doesn't slide in from the edge on first paint.
  const navRef = useRef<HTMLElement>(null);
  const [dotX, setDotX] = useState(0);
  const [dotArmed, setDotArmed] = useState(false);
  const measureDot = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>('.wingup-tb.on');
    if (active) setDotX(active.offsetLeft + active.offsetWidth / 2);
  }, []);

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


  // Reposition the indicator dot on every tab change; arm its slide after the
  // first placement; keep it aligned on resize/rotation.
  useLayoutEffect(measureDot, [measureDot, view]);
  useEffect(() => {
    if (dotArmed) return;
    const id = requestAnimationFrame(() => setDotArmed(true));
    return () => cancelAnimationFrame(id);
  }, [dotArmed]);
  useEffect(() => {
    window.addEventListener('resize', measureDot);
    return () => window.removeEventListener('resize', measureDot);
  }, [measureDot]);

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

  // Lazy-load the YouTube channel card + recent uploads for the home (and Posts)
  // when connected. The channel fetch is guarded by a ref so a channel-less
  // account doesn't re-request every render.
  const ytChannelFetched = useRef(false);
  useEffect(() => {
    if (!ytConnected) return;
    if (!(view === 'landing' || view === 'posts')) return;
    if (ytVideos === null) {
      wingupYtVideos()
        .then((r) => setYtVideos(r.data))
        .catch((e) => setYtVideosErr(e instanceof Error ? e.message : 'Couldn’t load your YouTube videos.'));
    }
    if (!ytChannelFetched.current) {
      ytChannelFetched.current = true;
      wingupYtChannel().then((r) => setYtChannel(r.channel)).catch(() => {});
    }
  }, [view, ytConnected, ytVideos]);

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
    if (view === 'avatar') { setView('more'); return; }
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

  // ---- Avatar builder ----
  const openAvatarBuilder = () => {
    void tap();
    setAvatarDraft(AVATAR_DEFAULTS);
    setView('avatar');
  };
  const setAvatarAttr = (key: string, value: string) => {
    void tap();
    setAvatarDraft((d) => ({ ...d, [key]: value }));
  };
  // Generate (stubbed) → save the avatar to the Profile library, return there.
  const generateAvatar = () => {
    void tap();
    setAvatars((a) => [{ id: `av${a.length + 1}`, name: `Avatar ${a.length + 1}`, attrs: { ...avatarDraft }, color: skinColorOf(avatarDraft) }, ...a]);
    setView('more');
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
    if (!igConnected && !ytConnected) {
      return (
        <div className="wingup-scroll">
          <div className="wingup-home">
            <div className="wingup-home-connect">
              <span className="wingup-empty-ic" aria-hidden="true">🪽</span>
              <div className="wingup-empty-title">Connect an account</div>
              <div className="wingup-empty-sub">Link Instagram or YouTube in Connectors to see your reach, recent posts, and post straight from Wingup.</div>
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

    // The stat cards stack into one deck slot; the dots pick which sits on top.
    const platforms: ('instagram' | 'youtube')[] = [];
    if (igConnected) platforms.push('instagram');
    if (ytConnected) platforms.push('youtube');
    const active = platforms.includes(activeCard) ? activeCard : (platforms[0] ?? 'instagram');
    const deckCls = (p: 'instagram' | 'youtube') => `wingup-deck-card${active === p ? ' front' : ' back'}`;

    return (
      <div className="wingup-scroll">
        <div className="wingup-home">
          {active === 'instagram' && account?.username && (
            <div className="wingup-conn"><span className="wingup-conn-dot" aria-hidden="true" />Connected · <span className="wingup-conn-h">@{account.username}</span></div>
          )}
          {active === 'youtube' && ytChannel?.handle && (
            <div className="wingup-conn"><span className="wingup-conn-dot yt" aria-hidden="true" />YouTube · <span className="wingup-conn-h">{ytChannel.handle}</span></div>
          )}

          {/* Stat-card deck — one slot; the inactive platform's card peeks behind. */}
          <div className="wingup-deck">
            {igConnected && (
              <div className={deckCls('instagram')} aria-hidden={active !== 'instagram'}>
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
              </div>
            )}
            {ytConnected && (
              <div className={deckCls('youtube')} aria-hidden={active !== 'youtube'}>
                <div className="wingup-hero-stat yt">
                  <div className="wingup-hero-k"><span className="wingup-yt-dot" aria-hidden="true" />YouTube</div>
                  <div className="wingup-hero-big">{ytChannel === null ? '…' : num(ytChannel.subscribers)}</div>
                  <div className="wingup-hero-sub">
                    subscribers{ytChannel?.handle ? ` · ${ytChannel.handle}` : (ytChannel?.title ? ` · ${ytChannel.title}` : '')}
                  </div>
                  <div className="wingup-chips3">
                    <div className="wingup-chip3"><div className="v">{num(ytChannel?.views)}</div><div className="l">Views</div></div>
                    <div className="wingup-chip3"><div className="v">{num(ytChannel?.videos)}</div><div className="l">Videos</div></div>
                    <div className="wingup-chip3"><div className="v">{ytChannel?.since ?? '—'}</div><div className="l">Since</div></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dots — pick which card is on top (only when both are connected). */}
          {platforms.length > 1 && (
            <div className="wingup-deck-dots" role="tablist">
              {platforms.map((p) => (
                <button key={p} type="button" role="tab" aria-selected={active === p}
                  className={`wingup-ddot${active === p ? ' on' : ''}${p === 'youtube' ? ' yt' : ''}`}
                  aria-label={p === 'instagram' ? 'Instagram' : 'YouTube'}
                  onClick={() => { void tap(); setActiveCard(p); }} />
              ))}
            </div>
          )}

          {/* Recent Instagram posts — always on the page; only the deck card changes. */}
          {igConnected && (<>
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
              <div className="wingup-grid3">
                {feed.slice(0, 3).map((m) => (
                  <a className="wingup-tile" key={m.id} href={m.permalink} target="_blank" rel="noreferrer"
                    style={{ backgroundImage: (m.thumbnail_url || m.media_url) ? `url(${m.thumbnail_url || m.media_url})` : undefined }}
                    title={m.caption ? String(m.caption) : mediaTypeLabel(m.media_type)}>
                    <span className="wingup-tile-cap">{m.caption ? String(m.caption) : mediaTypeLabel(m.media_type)}</span>
                  </a>
                ))}
                {Array.from({ length: Math.max(0, 3 - Math.min(feed.length, 3)) }).map((_, i) => (
                  <span className="wingup-tile empty" key={`ige${i}`} aria-hidden="true" />
                ))}
              </div>
            )}
          </>)}

          {/* Recent YouTube uploads — always on the page; only the deck card changes. */}
          {ytConnected && (<>
            <div className="wingup-sectionh">
              <span className="wingup-sectionh-t">YouTube videos</span>
            </div>
            {ytVideos === null ? (
              <div className="wingup-loading"><span className="route-spin" aria-hidden="true" /><p className="wingup-loading-msg">Loading your videos…</p></div>
            ) : ytVideosErr ? (
              <p className="wingup-note">{ytVideosErr}</p>
            ) : ytVideos.length === 0 ? (
              <p className="wingup-note">No videos on your channel yet.</p>
            ) : (
              <div className="wingup-grid3">
                {ytVideos.slice(0, 3).map((v) => (
                  <a className="wingup-tile yt" key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"
                    style={{ backgroundImage: v.thumbnail ? `url(${v.thumbnail})` : undefined }} title={v.title}>
                    <span className="wingup-tile-play" aria-hidden="true">▶</span>
                    <span className="wingup-tile-cap">{v.title}</span>
                  </a>
                ))}
                {Array.from({ length: Math.max(0, 3 - Math.min(ytVideos.length, 3)) }).map((_, i) => (
                  <span className="wingup-tile empty" key={`yte${i}`} aria-hidden="true" />
                ))}
              </div>
            )}
          </>)}
        </div>
      </div>
    );
  };

  // ---- The "More" tab: secondary destinations. Insights (analytics) lives here
  // now that the 4th tab is Studio; the rest are still placeholders. ----
  const MORE_ITEMS: { id: Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'avatar' | 'more' | 'posts' | 'gallery'>; title: string; sub: string; emoji: string }[] = [
    { id: 'insights', title: 'Insights', sub: 'Reach, followers & performance', emoji: '📊' },
    { id: 'calendar', title: 'Calendar', sub: 'Plan & schedule posts', emoji: '📅' },
    { id: 'campaigns', title: 'Campaigns', sub: 'Themed content pushes', emoji: '📣' },
    { id: 'metaads', title: 'Meta Ads', sub: 'Facebook & Instagram ads', emoji: '📢' },
  ];
  // ---- Profile (the 'more' view): account + Avatars + Products + tools ----
  const renderMore = () => (
    <div className="wingup-scroll">
      <div className="wingup-home">
        <div className="wingup-acct">
          <div className="wingup-acct-av" aria-hidden="true"><img src={WINGUP_LOGO} alt="" /></div>
          <div className="wingup-acct-meta">
            <div className="n">{account?.username ? `@${account.username}` : 'Your account'}</div>
            <div className="h">{igConnected ? <><span className="wingup-conn-dot" aria-hidden="true" />Instagram connected</> : 'No account connected'}</div>
          </div>
        </div>

        <div className="wingup-sectionh"><span className="wingup-sectionh-t">Avatars</span></div>
        <div className="wingup-prow">
          <button type="button" className="wingup-pcreate av" onClick={openAvatarBuilder}>
            <span className="wingup-pplus">＋</span>Create
          </button>
          {avatars.map((a) => (
            <button key={a.id} type="button" className="wingup-pcard av" style={{ background: `radial-gradient(ellipse at 50% 30%, ${a.color}, #101012)` }} onClick={openAvatarBuilder}>
              <PersonSilhouette className="wingup-pcard-fig" />
              <span className="wingup-pcard-nm">{a.name}</span>
            </button>
          ))}
        </div>

        <div className="wingup-sectionh"><span className="wingup-sectionh-t">Products</span></div>
        <div className="wingup-prow">
          <div className="wingup-pcard pr wingup-pcard-soon">Coming soon</div>
        </div>

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

  // ---- Avatar builder: design a person from scratch → Generate → saved to Profile ----
  const renderAvatar = () => (
    <div className="wingup-abuild">
      <div className="wingup-ab-scroll">
        <div className="wingup-ab-preview" style={{ background: `radial-gradient(ellipse at 50% 32%, ${skinColorOf(avatarDraft)}, #0a0a0b)` }}>
          <PersonSilhouette className="wingup-ab-preview-fig" />
          <span className="wingup-ab-preview-cap">{avatarDraft.gender} · {avatarDraft.ethnicity} · {avatarDraft.age}</span>
        </div>
        <div className="wingup-ab-chips">
          <span className="wingup-ab-chip">{avatarDraft.gender}</span>
          <span className="wingup-ab-chip">{avatarDraft.ethnicity}</span>
          <span className="wingup-ab-chip">{avatarDraft.age}</span>
          <span className="wingup-ab-chip">{avatarDraft.vibe}</span>
        </div>

        {AVATAR_SECTIONS.map((sec) => (
          <div className="wingup-ab-sec" key={sec.key}>
            <div className="wingup-ab-h">{sec.emoji} {sec.label}</div>
            {sec.type === 'chip' && (
              <div className="wingup-ab-chiprow">
                {sec.options.map((o) => (
                  <button key={o.label} type="button" className={`wingup-ab-copt${avatarDraft[sec.key] === o.label ? ' on' : ''}`} onClick={() => setAvatarAttr(sec.key, o.label)}>{o.label}</button>
                ))}
              </div>
            )}
            {sec.type === 'face' && (
              <div className="wingup-ab-faces">
                {sec.options.map((o) => (
                  <button key={o.label} type="button" className={`wingup-ab-face${avatarDraft[sec.key] === o.label ? ' on' : ''}`} style={{ background: o.grad }} onClick={() => setAvatarAttr(sec.key, o.label)}>
                    {o.img
                      ? <img className="wingup-ab-face-img" src={o.img} alt="" aria-hidden="true" />
                      : <PersonSilhouette className="wingup-ab-face-fig" />}
                    {avatarDraft[sec.key] === o.label && <span className="wingup-ab-tick" aria-hidden="true">✓</span>}
                    <span className="wingup-ab-face-l">{o.label}</span>
                  </button>
                ))}
              </div>
            )}
            {sec.type === 'swatch' && (
              <div className="wingup-ab-swrow">
                {sec.options.map((o) => (
                  <button key={o.label} type="button" className={`wingup-ab-sw${avatarDraft[sec.key] === o.label ? ' on' : ''}`} style={{ background: o.color }} aria-label={o.label} title={o.label} onClick={() => setAvatarAttr(sec.key, o.label)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="wingup-ab-genbar">
        <button className="wingup-btn" onClick={generateAvatar}>✨ Generate avatar</button>
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
  const renderPlaceholder = (id: Exclude<View, 'landing' | 'studio' | 'generate' | 'post' | 'avatar' | 'more' | 'posts'>) => {
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
    : view === 'avatar' ? 'Create avatar'
    : view === 'more' ? 'Profile'
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

      {/* Desktop-only left sidebar (≥1024px). Hidden on mobile, where the bottom
          tab bar is used instead. Same destinations + handlers. */}
      <aside className="wingup-side" aria-label="Wingup">
        <div className="wingup-side-brand"><img src={WINGUP_LOGO} alt="" aria-hidden />Wingup</div>
        <nav className="wingup-side-nav">
          <button type="button" className={`wingup-side-link${view === 'landing' ? ' on' : ''}`} onClick={() => { void tap(); setView('landing'); }} aria-current={view === 'landing'}><IconHome size={20} />Home</button>
          <button type="button" className={`wingup-side-link${view === 'gallery' ? ' on' : ''}`} onClick={() => { void tap(); setView('gallery'); }} aria-current={view === 'gallery'}><IconPhotos size={20} />Gallery</button>
          <button type="button" className={`wingup-side-link${view === 'studio' ? ' on' : ''}`} onClick={openStudio} aria-current={view === 'studio'}><IconFilm size={20} />Studio</button>
          <button type="button" className={`wingup-side-link${view === 'more' ? ' on' : ''}`} onClick={() => { void tap(); setView('more'); }} aria-current={view === 'more'}><IconUser size={20} />Profile</button>
        </nav>
        <button type="button" className="wingup-side-new" onClick={openPost}><IconPlus size={19} />New post</button>
        <div className="wingup-side-sp" />
        <div className="wingup-side-acct">
          <span className="wingup-side-av"><img src={WINGUP_LOGO} alt="" aria-hidden /></span>
          <span className="wingup-side-acct-meta">
            <span className="n">{account?.username ? `@${account.username}` : 'Your account'}</span>
            <span className="h">{igConnected ? 'Connected' : 'Not connected'}</span>
          </span>
        </div>
      </aside>

      <div className="wingup-main">
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
      {view === 'avatar' && renderAvatar()}
      {view === 'generate' && <div className="wingup-stage">{renderGenerate()}</div>}
      {view === 'post' && <div className="wingup-stage">{renderPost()}</div>}
      {view === 'posts' && <div className="wingup-stage">{renderPosts()}</div>}
      {view === 'insights' && <div className="wingup-stage">{renderInsights()}</div>}
      {(view === 'calendar' || view === 'campaigns' || view === 'metaads') && (
        <div className="wingup-stage">{renderPlaceholder(view)}</div>
      )}

      {showTabs && (
        <nav ref={navRef} className="wingup-tabbar" aria-label="Wingup">
          <span className={`wingup-tb-dot${dotArmed ? ' is-armed' : ''}`} style={{ left: dotX }} aria-hidden="true" />
          <button type="button" className={`wingup-tb${view === 'landing' ? ' on' : ''}`} onClick={() => { void tap(); setView('landing'); }} aria-current={view === 'landing'}>
            <span className="wingup-tb-ic"><IconHome size={23} /></span><span className="wingup-tb-lab">Home</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'gallery' ? ' on' : ''}`} onClick={() => { void tap(); setView('gallery'); }} aria-current={view === 'gallery'}>
            <span className="wingup-tb-ic"><IconPhotos size={23} /></span><span className="wingup-tb-lab">Gallery</span>
          </button>
          <button type="button" className="wingup-fab" onClick={openPost} aria-label="Post to socials">
            <IconPlus size={26} />
          </button>
          <button type="button" className={`wingup-tb${view === 'studio' ? ' on' : ''}`} onClick={openStudio} aria-current={view === 'studio'}>
            <span className="wingup-tb-ic"><IconFilm size={23} /></span><span className="wingup-tb-lab">Studio</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'more' ? ' on' : ''}`} onClick={() => { void tap(); setView('more'); }} aria-current={view === 'more'}>
            <span className="wingup-tb-ic"><IconUser size={23} /></span><span className="wingup-tb-lab">Profile</span>
          </button>
        </nav>
      )}
      </div>
    </div>
  );
}
