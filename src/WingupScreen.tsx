import { useMemo, useRef, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import {
  IconArrowLeft, IconArrowUp, IconCheck, IconCompose, IconCalendar,
  IconWaveform, IconPhotos, IconChart, IconBolt, IconPlus, IconX,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { CONNECTORS } from './connectorData';
import { WINGUP_LOGO } from './wingupLogo';

// Wingup — the social media agent. The landing is a warm, light "what should we
// post?" screen (an approved mockup): a chatbox hero pushed into the lower third
// over soft amber/coral orbs, with a 2-column "Your workspace" grid revealed on
// scroll. Tapping into the chatbox (or a chip) and sending drops into the live
// compose → generate → review → publish flow; the other workspace cards open
// clean "coming soon" placeholders. Home == the landing/chatbox.
//
// Sibling to AgentsScreen: it reuses the .memg overlay shell (fixed full-screen,
// focus trap, animated close) but paints its OWN warm light theme via .wingup-*
// in agents.css, since the rest of the app is dark.
//
// AI generation and social publishing are STUBBED for now — see generateContent
// and publishPost below for the // TODO hooks where the real wiring lands.

// The screen's views. 'landing' is the chatbox home; 'compose' is the live flow;
// the rest are "coming soon" placeholders that mirror the workspace cards.
type View = 'landing' | 'compose' | 'calendar' | 'campaigns' | 'gallery' | 'insights' | 'metaads';
type IconCmp = typeof IconCompose;

// The "Your workspace" cards. Home returns to the landing/chatbox; the rest open
// their placeholder view. `tone` keys the soft icon-tile color (see agents.css).
type Tone = 'home' | 'cal' | 'camp' | 'gal' | 'ins' | 'meta';
const CARDS: { id: View; title: string; sub: string; emoji: string; tone: Tone; Icon: IconCmp }[] = [
  { id: 'landing', title: 'Home', sub: 'Compose & post', emoji: '🏠', tone: 'home', Icon: IconCompose },
  { id: 'calendar', title: 'Calendar', sub: 'Plan & schedule', emoji: '📅', tone: 'cal', Icon: IconCalendar },
  { id: 'campaigns', title: 'Campaigns', sub: 'Themed pushes', emoji: '📣', tone: 'camp', Icon: IconWaveform },
  { id: 'gallery', title: 'Gallery', sub: 'Your media', emoji: '🖼️', tone: 'gal', Icon: IconPhotos },
  { id: 'insights', title: 'Insights', sub: 'Performance', emoji: '📊', tone: 'ins', Icon: IconChart },
  { id: 'metaads', title: 'Meta Ads', sub: 'FB & IG ads', emoji: '📢', tone: 'meta', Icon: IconBolt },
];

// The hero carousel above the chatbox — a swipeable strip of recent posts/media.
// TODO: placeholder sample media — swap for the user's generated/uploaded content once generation is wired.
const SAMPLE_MEDIA: { url: string; caption: string }[] = [
  { url: 'https://picsum.photos/seed/wingup01/520/620', caption: 'Summer sale — reel' },
  { url: 'https://picsum.photos/seed/wingup02/520/620', caption: 'Product drop' },
  { url: 'https://picsum.photos/seed/wingup03/520/620', caption: 'Behind the scenes' },
  { url: 'https://picsum.photos/seed/wingup04/520/620', caption: 'Customer spotlight' },
  { url: 'https://picsum.photos/seed/wingup05/520/620', caption: 'New arrivals' },
  { url: 'https://picsum.photos/seed/wingup06/520/620', caption: 'Weekend vibes' },
  { url: 'https://picsum.photos/seed/wingup07/520/620', caption: 'Limited edition' },
  { url: 'https://picsum.photos/seed/wingup08/520/620', caption: 'Team picks' },
  { url: 'https://picsum.photos/seed/wingup09/520/620', caption: 'How it’s made' },
  { url: 'https://picsum.photos/seed/wingup10/520/620', caption: 'Coming soon' },
];

// The placeholder views, by id, for the "coming soon" empty states.
const PLACEHOLDERS: Record<Exclude<View, 'landing' | 'compose'>, { title: string; emoji: string; Icon: IconCmp }> = {
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

// Publish the post to each selected platform. STUBBED: simulates a network call.
// TODO: wire Composio per-platform create-post. Stubbed for now.
async function publishPost(_post: { caption: string; image: string; platforms: string[] }): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000)); // simulate per-platform publish
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
  // ---- Chatbox attach: the + menu (camera / library) + the picked image ----
  const [attachOpen, setAttachOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false); // the Wingup Library picker sheet
  const [attachment, setAttachment] = useState<string | null>(null); // data URL of the picked image

  const trapRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null); // the landing scroll container — moved only by the arrows, not free scroll
  // ---- Hero carousel: the swipeable media strip + its active card / dots ----
  const caroRef = useRef<HTMLDivElement>(null);
  const [activeShot, setActiveShot] = useState(0);

  // The user's connected social platforms, in CONNECTORS order, with name + logo.
  const socials = useMemo(
    () => CONNECTORS.filter((c) => SOCIAL_IDS.includes(c.id) && connApps.includes(c.id)),
    [connApps],
  );

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

  // Enter the compose flow from the landing chatbox and kick off generation.
  const launchCompose = () => {
    if (!prompt.trim()) { chatRef.current?.focus(); return; }
    setView('compose');
    void runGenerate();
  };

  // ---- Chatbox attach menu ----
  // Take a photo with the device camera, or pick one from the library, and stash
  // it as the pending attachment. The user cancelling rejects the promise — we
  // swallow that (and any plugin error) so a cancel is a no-op.
  // TODO: pass `attachment` into the compose/generation flow once generation is wired.
  const pickFrom = async (source: CameraSource) => {
    void tap();
    setAttachOpen(false);
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source,
      });
      if (photo.dataUrl) setAttachment(photo.dataUrl);
    } catch {
      /* user cancelled or the camera/photos plugin isn't available — no-op */
    }
  };

  // Wingup Library — the user's own generated media. Open the picker sheet (and
  // close the attach menu behind it).
  const pickFromLibrary = () => {
    void tap();
    setAttachOpen(false);
    setLibraryOpen(true);
  };

  // Choose an item from the Wingup Library → it becomes the pending attachment
  // (the same state Camera/Photos set), then the picker closes.
  const pickLibraryItem = (url: string) => {
    void tap();
    setAttachment(url);
    setLibraryOpen(false);
  };

  // Carousel: on swipe, mark the card whose centre is nearest the strip's centre
  // as active so the dots follow the user's scroll.
  const onCaroScroll = () => {
    const el = caroRef.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    const cards = el.children;
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i] as HTMLElement;
      const cardMid = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardMid - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setActiveShot((cur) => (cur === best ? cur : best));
  };

  // Carousel: centre the i-th card (tap a dot). A 'smooth' jump unless the user
  // prefers reduced motion, in which case we snap instantly (no scroll jank).
  const goShot = (i: number) => {
    void tap();
    const el = caroRef.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2,
      behavior: reduce ? 'auto' : 'smooth',
    });
    setActiveShot(i);
  };

  // Back steps one level: review → compose, compose → landing, a placeholder →
  // landing, and the landing → close the overlay (back to the agent picker).
  // The library picker and the attach menu are levels of their own — Escape/back
  // dismisses them (picker first, then menu) before navigating views.
  const back = () => {
    void tap();
    if (libraryOpen) { setLibraryOpen(false); return; }
    if (attachOpen) { setAttachOpen(false); return; }
    if (view === 'compose') {
      if (step === 'result') { setStep('compose'); return; }
      setView('landing');
      return;
    }
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

  // Publish to every selected platform (stubbed), then show the success state.
  const runPublish = async () => {
    if (!selected.size) return;
    void tap();
    setStep('posting');
    await publishPost({ caption, image: imageUrl, platforms: [...selected] });
    setStep('done');
  };

  // Reset everything and return to a fresh landing chatbox.
  const startAnother = () => {
    void tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl(''); setSelected(new Set());
    setAttachment(null); setAttachOpen(false); setLibraryOpen(false);
    setStep('compose');
    setView('landing');
  };

  // Human-readable list of where we posted, for the success copy ("X, LinkedIn").
  const postedNames = CONNECTORS.filter((c) => selected.has(c.id)).map((c) => c.name).join(', ');

  // ---- The compose → generate → review → publish flow ----
  const renderCompose = () => {
    if (step === 'generating' || step === 'posting') {
      return (
        <div className="wingup-loading">
          <span className="route-spin" aria-hidden="true" />
          <p className="wingup-loading-msg">{step === 'posting' ? 'Posting your update…' : 'Generating your post…'}</p>
        </div>
      );
    }
    if (step === 'done') {
      return (
        <div className="wingup-sent">
          <span className="wingup-sent-ic"><IconCheck size={26} /></span>
          <div className="wingup-sent-title">Posted{postedNames ? ` to ${postedNames}` : ''} ✓</div>
          <div className="wingup-sent-sub">Your post is on its way to your followers.</div>
          <button className="wingup-btn" onClick={startAnother}>Start another</button>
        </div>
      );
    }
    if (step === 'result') {
      // ---- Review: image preview, editable caption, platforms, publish ----
      return (
        <div className="wingup-form">
          <div className="wingup-preview">
            <img className="wingup-img" src={imageUrl} alt="Generated post preview" />
          </div>

          <label className="wingup-lbl" htmlFor="wingup-caption">Caption</label>
          <textarea
            id="wingup-caption"
            className="wingup-field wingup-body"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Your caption…"
          />

          <button className="wingup-btn ghost" onClick={() => void runGenerate()}>Regenerate</button>

          {/* Target platforms: chips for the user's connected social accounts. */}
          <div className="wingup-targets">
            <span className="wingup-lbl">Post to</span>
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

          <button className="wingup-btn" disabled={!selected.size} onClick={() => void runPublish()}>Post now</button>
        </div>
      );
    }
    // ---- Compose: prompt + optional tone + Generate ----
    return (
      <div className="wingup-form">
        <label className="wingup-lbl" htmlFor="wingup-prompt">What should we post about?</label>
        <textarea
          id="wingup-prompt"
          className="wingup-field wingup-body"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. We just launched our summer collection — bright, breezy, limited run."
        />

        <label className="wingup-lbl" htmlFor="wingup-tone">Tone / brand voice <span className="wingup-opt">(optional)</span></label>
        <input
          id="wingup-tone"
          className="wingup-field"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="e.g. playful, confident, a little cheeky"
        />

        <button className="wingup-btn" disabled={!prompt.trim()} onClick={() => void runGenerate()}>✨ Generate</button>
        <p className="wingup-foot">Wingup drafts the copy and a matching image, then posts to your connected social accounts.</p>
      </div>
    );
  };

  // ---- The landing: heading + media carousel, then the hero chatbox in the
  // lower third, then the workspace grid below the fold ----
  const renderLanding = () => (
    <div className="wingup-scroll" ref={scrollRef}>
      <section className="wingup-hero">
        <div className="wingup-hero-top">
          <h2 className="wingup-h1">What should we post?</h2>
          <p className="wingup-hero-sub">Your social media agent</p>
        </div>

        {/* Media carousel — a swipeable strip of recent/sample posts. The active
            card is centred with a peek of its neighbors; the dots track it. */}
        <div
          className="wingup-caro"
          ref={caroRef}
          onScroll={onCaroScroll}
          role="group"
          aria-label="Recent media"
        >
          {SAMPLE_MEDIA.map((m, i) => (
            <div className="wingup-shot" key={m.url}>
              <img src={m.url} alt="" aria-hidden loading="lazy" />
              <span className="wingup-shot-badge">{i + 1} / {SAMPLE_MEDIA.length}</span>
              <span className="wingup-shot-play" aria-hidden="true">▶</span>
              <span className="wingup-shot-cap">{m.caption}</span>
            </div>
          ))}
        </div>

        {/* Dots — the centred card's dot is active; tap to centre that card. */}
        <div className="wingup-dots" role="tablist" aria-label="Media pages">
          {SAMPLE_MEDIA.map((m, i) => (
            <button
              type="button"
              key={m.url}
              className={`wingup-dot${i === activeShot ? ' on' : ''}`}
              onClick={() => goShot(i)}
              role="tab"
              aria-selected={i === activeShot}
              aria-label={`Show ${m.caption}`}
            />
          ))}
        </div>

        <div className="wingup-hero-spacer" aria-hidden="true" />

        <div className="wingup-hero-bottom">
          {/* The composer wraps the chatbox so the attach menu can float above it.
              The chatbox is a single glass-dark row: [+ attach] [input] [send]. */}
          <div className="wingup-composer">
            {/* Transparent full-screen backdrop — a tap anywhere outside closes the
                attach menu. Rendered first so it sits under the popover. */}
            {attachOpen && (
              <button
                type="button"
                className="wingup-attach-backdrop"
                aria-label="Close attach menu"
                onClick={() => { void tap(); setAttachOpen(false); }}
              />
            )}

            {/* Attach menu — a light popover above the chatbox with 3 rows. */}
            {attachOpen && (
              <div className="wingup-attach-menu" role="menu" aria-label="Attach">
                <button type="button" className="wingup-attach-row" role="menuitem" onClick={() => void pickFrom(CameraSource.Camera)}>
                  <span className="wingup-attach-ic ar-cam" aria-hidden="true">📷</span>
                  <span className="wingup-attach-txt"><span className="wingup-attach-t">Camera</span></span>
                </button>
                <button type="button" className="wingup-attach-row" role="menuitem" onClick={() => void pickFrom(CameraSource.Photos)}>
                  <span className="wingup-attach-ic ar-pho" aria-hidden="true">🖼️</span>
                  <span className="wingup-attach-txt"><span className="wingup-attach-t">Photo Library</span></span>
                </button>
                <button type="button" className="wingup-attach-row" role="menuitem" onClick={pickFromLibrary}>
                  <span className="wingup-attach-ic ar-wing" aria-hidden="true">🪽</span>
                  <span className="wingup-attach-txt">
                    <span className="wingup-attach-t">Wingup Library</span>
                    <span className="wingup-attach-s">Your generated media</span>
                  </span>
                </button>
              </div>
            )}

            {/* Picked-image preview — a small thumbnail with a × to clear it. */}
            {attachment && (
              <div className="wingup-attachment">
                <img className="wingup-attachment-img" src={attachment} alt="Attached" />
                <button
                  type="button"
                  className="wingup-attachment-x"
                  onClick={() => { void tap(); setAttachment(null); }}
                  aria-label="Remove attachment"
                >
                  <IconX size={13} />
                </button>
              </div>
            )}

            <div className="wingup-chatbox">
              <button
                type="button"
                className="wingup-attach"
                onClick={() => { void tap(); setAttachOpen((o) => !o); }}
                aria-label="Attach a photo"
                aria-expanded={attachOpen}
                aria-haspopup="menu"
              >
                <IconPlus size={22} />
              </button>
              <textarea
                ref={chatRef}
                className="wingup-chat-input"
                rows={1}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); launchCompose(); }
                }}
                placeholder="Describe a post, a campaign, or a vibe…"
                aria-label="Describe a post, a campaign, or a vibe"
              />
              <button
                type="button"
                className="wingup-send"
                onClick={launchCompose}
                disabled={!prompt.trim()}
                aria-label="Start composing"
              >
                <IconArrowUp size={20} />
              </button>
            </div>
          </div>

          {/* Static, tappable cue — a tap smooth-scrolls down to the workspace. */}
          <button
            type="button"
            className="wingup-scrollcue"
            onClick={() => { void tap(); workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            aria-label="Scroll to your workspace"
          >
            <span className="wingup-chev" aria-hidden="true">⌄</span>
            <span className="wingup-scrollcue-lbl">scroll</span>
          </button>
        </div>
      </section>

      <section className="wingup-workspace" ref={workspaceRef}>
        {/* The only way back up — free scroll is off; the arrows drive it. */}
        <button
          type="button"
          className="wingup-upcue"
          onClick={() => { void tap(); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Back to the top"
        >
          <span className="wingup-chev" aria-hidden="true">⌄</span>
        </button>
        <h3 className="wingup-sec-h">Your workspace</h3>
        <div className="wingup-grid">
          {CARDS.map((c) => (
            <button
              key={c.title}
              type="button"
              className="wingup-card"
              onClick={() => { void tap(); if (c.id === 'landing') chatRef.current?.focus(); else setView(c.id); }}
            >
              <span className={`wingup-card-ic tone-${c.tone}`} aria-hidden="true">{c.emoji}</span>
              <span className="wingup-card-t">{c.title}</span>
              <span className="wingup-card-d">{c.sub}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  // ---- Wingup Library picker — a warm bottom sheet of the user's generated media,
  // rendered at the overlay root so it covers the full screen. Tapping a thumbnail
  // sets it as the chatbox attachment. ----
  const renderLibrary = () => (
    <div className="wingup-lib" role="dialog" aria-modal="true" aria-label="Wingup Library">
      <button
        type="button"
        className="wingup-lib-backdrop"
        aria-label="Close library"
        onClick={() => { void tap(); setLibraryOpen(false); }}
      />
      <div className="wingup-lib-sheet">
        <div className="wingup-lib-head">
          <div className="wingup-lib-titles">
            <div className="wingup-lib-title">Wingup Library</div>
            <div className="wingup-lib-sub">Your generated media</div>
          </div>
          <button
            type="button"
            className="wingup-lib-x"
            onClick={() => { void tap(); setLibraryOpen(false); }}
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>
        {/* TODO: this is the user's real generated/uploaded library once generation is wired. */}
        <div className="wingup-lib-grid">
          {SAMPLE_MEDIA.map((m) => (
            <button
              type="button"
              key={m.url}
              className="wingup-lib-item"
              onClick={() => pickLibraryItem(m.url)}
              aria-label={`Attach ${m.caption}`}
            >
              <img src={m.url} alt="" aria-hidden loading="lazy" />
              <span className="wingup-lib-cap">{m.caption}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ---- A "coming soon" placeholder for a workspace view ----
  const renderPlaceholder = (id: Exclude<View, 'landing' | 'compose'>) => {
    const p = PLACEHOLDERS[id];
    return (
      <div className="wingup-empty">
        <span className="wingup-empty-ic" aria-hidden="true">{p.emoji}</span>
        <div className="wingup-empty-title">{p.title}</div>
        <div className="wingup-empty-sub">Coming soon</div>
      </div>
    );
  };

  // The header title tracks the active view (the landing keeps the bare wordmark).
  const headerTitle =
    view === 'landing' ? 'Wingup'
    : view === 'compose' ? 'Wingup'
    : PLACEHOLDERS[view].title;

  return (
    <div className="memg wingup" ref={trapRef} tabIndex={-1}>
      {/* Warm ambient orbs — Wingup's own light palette (see .wingup .live-bg). */}
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
        <span className="wingup-top-spacer" aria-hidden="true" />
      </div>

      {view === 'landing' && renderLanding()}
      {view === 'compose' && <div className="wingup-stage">{renderCompose()}</div>}
      {view !== 'landing' && view !== 'compose' && <div className="wingup-stage">{renderPlaceholder(view)}</div>}

      {libraryOpen && renderLibrary()}
    </div>
  );
}
