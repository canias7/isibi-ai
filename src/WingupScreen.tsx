import { useMemo, useRef, useState } from 'react';
import { IconArrowLeft, IconCheck, IconCompose, IconCalendar, IconWaveform, IconPhotos, IconChart, IconBolt } from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { CONNECTORS } from './connectorData';

// Wingup — the social media agent, built as a multi-section SHELL: a persistent
// bottom nav switches the main content between six sections. Only Home is live
// today (a Blaze-style compose → generate → review → publish flow); the rest are
// "coming soon" empty states so the roadmap is visible without faking capability.
// Sibling to AgentsScreen: it reuses the same .memg overlay shell, live-bg
// ambient and .ag-* form/button styles, with .wingup-* additions for the nav,
// image preview, platform chips and empty states.
//
// AI generation and social publishing are STUBBED for now — see generateContent
// and publishPost below for the // TODO hooks where the real wiring lands.

// The bottom-nav sections. 'home' is the live flow; the rest are placeholders.
type Section = 'home' | 'calendar' | 'campaigns' | 'gallery' | 'insights' | 'metaads';
type IconCmp = typeof IconCompose;
const NAV: { id: Section; label: string; title: string; Icon: IconCmp }[] = [
  { id: 'home', label: 'Home', title: 'Wingup', Icon: IconCompose },
  { id: 'calendar', label: 'Calendar', title: 'Content calendar', Icon: IconCalendar },
  { id: 'campaigns', label: 'Campaigns', title: 'Campaigns', Icon: IconWaveform },
  { id: 'gallery', label: 'Gallery', title: 'Your media', Icon: IconPhotos },
  { id: 'insights', label: 'Insights', title: 'Insights', Icon: IconChart },
  { id: 'metaads', label: 'Meta Ads', title: 'Meta Ads', Icon: IconBolt },
];

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
<stop offset="0" stop-color="#2a1c05"/><stop offset=".55" stop-color="#b4691a"/><stop offset="1" stop-color="#e0951f"/>
</linearGradient>
<radialGradient id="glow" cx="28%" cy="26%" r="70%">
<stop offset="0" stop-color="#ffd98a" stop-opacity=".85"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="640" height="640" fill="url(#bg)"/>
<rect width="640" height="640" fill="url(#glow)"/>
<text x="50" y="540" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="46" font-weight="800" fill="#fff8e8">${esc(headline)}</text>
<text x="50" y="588" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="600" fill="#fff8e8" opacity="0.78">Made with Wingup</text>
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

// A clean, centered empty state for the "coming soon" sections.
function EmptyState({ Icon, title, sub }: { Icon: IconCmp; title: string; sub: string }) {
  return (
    <div className="wingup-empty">
      <span className="wingup-empty-ic"><Icon size={30} /></span>
      <div className="wingup-empty-title">{title}</div>
      <div className="wingup-empty-sub">{sub}</div>
    </div>
  );
}

export default function WingupScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [section, setSection] = useState<Section>('home');
  // ---- Home tab: compose → generate → post flow ----
  const [step, setStep] = useState<Step>('compose');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set()); // chosen platform ids

  const trapRef = useRef<HTMLDivElement>(null);

  // The user's connected social platforms, in CONNECTORS order, with name + logo.
  const socials = useMemo(
    () => CONNECTORS.filter((c) => SOCIAL_IDS.includes(c.id) && connApps.includes(c.id)),
    [connApps],
  );

  // Back steps one level: a Home result → compose, otherwise close. (Generating/
  // posting are transient and just fall through to closing the overlay.)
  const back = () => {
    tap();
    if (section === 'home' && step === 'result') { setStep('compose'); return; }
    onClose();
  };
  useFocusTrap(true, trapRef, back);

  // Run the (stubbed) generator and advance to the result step.
  const runGenerate = async () => {
    if (!prompt.trim()) return;
    tap();
    setStep('generating');
    const out = await generateContent(prompt, tone);
    setCaption(out.caption);
    setImageUrl(out.imageUrl);
    setStep('result');
  };

  const togglePlatform = (id: string) => {
    tap();
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Publish to every selected platform (stubbed), then show the success state.
  const runPublish = async () => {
    if (!selected.size) return;
    tap();
    setStep('posting');
    await publishPost({ caption, image: imageUrl, platforms: [...selected] });
    setStep('done');
  };

  // Reset everything back to a fresh compose.
  const startAnother = () => {
    tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl(''); setSelected(new Set());
    setStep('compose');
  };

  // Human-readable list of where we posted, for the success copy ("X, LinkedIn").
  const postedNames = CONNECTORS.filter((c) => selected.has(c.id)).map((c) => c.name).join(', ');

  // The active section's title + a contextual subtitle (Home's tracks the flow).
  const meta = NAV.find((n) => n.id === section)!;
  const subtitle =
    section !== 'home' ? 'Coming soon'
    : step === 'done' ? 'Posted'
    : step === 'posting' ? 'Posting…'
    : step === 'result' ? 'Review & post'
    : step === 'generating' ? 'Generating…'
    : 'Social media agent';

  // ---- Home tab content: the full compose → generate → post flow ----
  const renderHome = () => {
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
        <div className="ag-sent">
          <span className="ag-sent-ic"><IconCheck size={26} /></span>
          <div className="ag-sent-title">Posted{postedNames ? ` to ${postedNames}` : ''} ✓</div>
          <div className="ag-sent-sub">Your post is on its way to your followers.</div>
          <div className="ag-sent-actions">
            <button className="ag-send-btn" onClick={startAnother}>Start another</button>
          </div>
        </div>
      );
    }
    if (step === 'result') {
      // ---- Review: image preview, editable caption, platforms, publish ----
      return (
        <div className="ag-compose">
          <div className="wingup-preview">
            <img className="wingup-img" src={imageUrl} alt="Generated post preview" />
          </div>

          <label className="wingup-lbl" htmlFor="wingup-caption">Caption</label>
          <textarea
            id="wingup-caption"
            className="ag-field ag-body"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Your caption…"
          />

          <button className="ag-send-btn ghost" onClick={() => void runGenerate()}>Regenerate</button>

          {/* Target platforms: chips for the user's connected social accounts. */}
          <div className="wingup-targets">
            <span className="wingup-lbl">Post to</span>
            {socials.length === 0 ? (
              <p className="wingup-note">Connect a social account in Connectors to post.</p>
            ) : (
              <div className="wingup-chips">
                {socials.map((c) => (
                  <button
                    key={c.id}
                    className={`wingup-chip${selected.has(c.id) ? ' on' : ''}`}
                    aria-pressed={selected.has(c.id)}
                    onClick={() => togglePlatform(c.id)}
                  >
                    <img className="wingup-chip-logo" src={c.logo} alt="" aria-hidden />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="ag-send-btn" disabled={!selected.size} onClick={() => void runPublish()}>Post now</button>
        </div>
      );
    }
    // ---- Compose: prompt + optional tone + Generate ----
    return (
      <div className="ag-compose">
        <label className="wingup-lbl" htmlFor="wingup-prompt">What should we post about?</label>
        <textarea
          id="wingup-prompt"
          className="ag-field ag-body"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. We just launched our summer collection — bright, breezy, limited run."
        />

        <label className="wingup-lbl" htmlFor="wingup-tone">Tone / brand voice <span className="wingup-opt">(optional)</span></label>
        <input
          id="wingup-tone"
          className="ag-field"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="e.g. playful, confident, a little cheeky"
        />

        <button className="ag-send-btn" disabled={!prompt.trim()} onClick={() => void runGenerate()}>✨ Generate</button>
        <p className="ag-foot">Wingup drafts the copy and a matching image, then posts to your connected social accounts.</p>
      </div>
    );
  };

  // The placeholder sections — clean centered empty states.
  const renderSection = () => {
    switch (section) {
      case 'home': return renderHome();
      case 'calendar': return <EmptyState Icon={IconCalendar} title="Content calendar" sub="Coming soon" />;
      case 'campaigns': return <EmptyState Icon={IconWaveform} title="Campaigns" sub="Coming soon" />;
      case 'gallery': return <EmptyState Icon={IconPhotos} title="Your media" sub="Coming soon" />;
      case 'insights': return <EmptyState Icon={IconChart} title="Insights" sub="Coming soon" />;
      case 'metaads': return <EmptyState Icon={IconBolt} title="Meta Ads" sub="Coming soon" />;
    }
  };

  return (
    <div className="memg wingup" ref={trapRef} tabIndex={-1}>
      {/* Warm ambient backdrop, same orbs as the home / Sendra screens. */}
      <div className="live-bg" aria-hidden="true">
        <span className="orb orb1" />
        <span className="orb orb2" />
        <span className="orb orb3" />
        <span className="orb orb4" />
      </div>

      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={section === 'home' && step === 'result' ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">{meta.title}</h1>
          <p className="memg-sub">{subtitle}</p>
        </div>
        <span style={{ width: 40 }} />
      </div>

      <div className="ag-stage wingup-stage">
        {renderSection()}
      </div>

      {/* Persistent bottom nav — switches the main content by section. */}
      <nav className="wingup-nav" aria-label="Wingup sections">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`wingup-nav-item${section === n.id ? ' on' : ''}`}
            aria-current={section === n.id ? 'page' : undefined}
            onClick={() => { void tap(); setSection(n.id); }}
          >
            <span className="wingup-nav-ic"><n.Icon size={22} /></span>
            <span className="wingup-nav-lbl">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
