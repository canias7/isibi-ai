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
  wingupAccount, wingupMedia, wingupInsights, wingupPublish, wingupPublishCarousel,
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

// The screen's views. 'landing' is the home dashboard; 'compose' is the post
// flow; 'more' is the secondary menu; the rest are the read/placeholder views.
type View = 'landing' | 'compose' | 'more' | 'calendar' | 'campaigns' | 'gallery' | 'insights' | 'metaads';
type IconCmp = typeof IconCompose;

// The placeholder views, by id, for the "coming soon" empty states.
const PLACEHOLDERS: Record<Exclude<View, 'landing' | 'compose' | 'more'>, { title: string; emoji: string; Icon: IconCmp }> = {
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

export default function WingupScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [view, setView] = useState<View>('landing');
  // ---- Compose flow: compose → generate → review → post ----
  const [step, setStep] = useState<Step>('compose');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set()); // chosen platform ids
  const [attachments, setAttachments] = useState<string[]>([]); // picked photos: 1 = single post, 2–10 = carousel
  const [publishErr, setPublishErr] = useState(''); // a failed publish, shown on the review step
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
  // The home (landing) shows both (the reach hero + the recent-posts feed), so it
  // pulls them too — Gallery/Insights then reuse the already-loaded data.
  useEffect(() => {
    if (!igConnected) return;
    const needsMedia = view === 'gallery' || view === 'landing';
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

  // Back steps one level: review → compose, compose → landing, a placeholder →
  // landing, and the landing → close the overlay (back to the agent picker).
  const back = () => {
    void tap();
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

  // The image we'd actually post: the first attached/library photo if any,
  // otherwise the generated preview. (The stubbed generator returns an SVG,
  // which Instagram can't ingest — isPostableImage gates on that.)
  const postImage = attachments[0] || imageUrl;
  const isCarousel = attachments.length >= 2; // 2–10 photos post as a carousel

  // Publish for real. Instagram is wired end-to-end (src/wingup.ts → the `wingup`
  // function → Composio); any other selected platform isn't connected here yet.
  const runPublish = async () => {
    if (!selected.size) return;
    if (!isPostableImage(postImage)) {
      setPublishErr('Add a photo to post — AI image generation is coming soon.');
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
      if (isCarousel) await wingupPublishCarousel({ caption, images: attachments });
      else await wingupPublish({ caption, image: postImage });
      setStep('done');
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : 'Posting failed. Please try again.');
      setStep('result');
    }
  };

  // Reset everything and return to a fresh landing.
  const startAnother = () => {
    void tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl(''); setSelected(new Set());
    setAttachments([]); setPublishErr('');
    setStep('compose');
    setView('landing');
  };

  // The ＋ Create button (bottom-nav FAB): start a fresh compose flow.
  const openCompose = () => {
    void tap();
    setPrompt(''); setTone(''); setCaption(''); setImageUrl(''); setSelected(new Set());
    setAttachments([]); setPublishErr('');
    setStep('compose');
    setView('compose');
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
            {isCarousel ? (
              <div className="wingup-preview-strip">
                {attachments.map((src, i) => (
                  <img className="wingup-img" key={`${src}-${i}`} src={src} alt={`Slide ${i + 1}`} />
                ))}
              </div>
            ) : (
              <img className="wingup-img" src={postImage} alt="Post preview" />
            )}
          </div>
          {isCarousel && <p className="wingup-note">Carousel · {attachments.length} photos</p>}
          {!isPostableImage(postImage) && (
            <p className="wingup-note">Preview only — attach a photo (the + in the chatbox) to publish. AI image generation is coming soon.</p>
          )}

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
            <button type="button" className="wingup-sectionh-a" onClick={() => { void tap(); setView('gallery'); }}>All →</button>
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

  // ---- The "More" tab: secondary destinations (still placeholders for now). ----
  const MORE_ITEMS: { id: Exclude<View, 'landing' | 'compose' | 'more'>; title: string; sub: string; emoji: string }[] = [
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

  // ---- Gallery: the connected account's real recent posts ----
  const renderGallery = () => {
    if (!igConnected) return renderConnectPrompt('🖼️', 'Your media', 'Connect Instagram to see your posts here.');
    if (mediaErr) return renderConnectPrompt('🖼️', 'Your media', mediaErr);
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
  const renderPlaceholder = (id: Exclude<View, 'landing' | 'compose' | 'more'>) => {
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
    view === 'landing' || view === 'compose' ? 'Wingup'
    : view === 'more' ? 'More'
    : PLACEHOLDERS[view].title;

  // The bottom tab bar shows on the top-level destinations, not inside a task
  // (compose) or a placeholder drilled in from More.
  const showTabs = view === 'landing' || view === 'gallery' || view === 'insights' || view === 'more';

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
        <span className="wingup-top-spacer" aria-hidden="true" />
      </div>

      {view === 'landing' && renderHome()}
      {view === 'more' && renderMore()}
      {view === 'compose' && <div className="wingup-stage">{renderCompose()}</div>}
      {(view === 'gallery' || view === 'insights' || view === 'calendar' || view === 'campaigns' || view === 'metaads') && (
        <div className="wingup-stage">
          {view === 'gallery' ? renderGallery()
            : view === 'insights' ? renderInsights()
            : renderPlaceholder(view)}
        </div>
      )}

      {showTabs && (
        <nav className="wingup-tabbar" aria-label="Wingup">
          <button type="button" className={`wingup-tb${view === 'landing' ? ' on' : ''}`} onClick={() => { void tap(); setView('landing'); }} aria-current={view === 'landing'}>
            <span className="wingup-tb-ic" aria-hidden="true">⌂</span><span className="wingup-tb-lab">Home</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'gallery' ? ' on' : ''}`} onClick={() => { void tap(); setView('gallery'); }} aria-current={view === 'gallery'}>
            <span className="wingup-tb-ic" aria-hidden="true">🪽</span><span className="wingup-tb-lab">Library</span>
          </button>
          <button type="button" className="wingup-fab" onClick={openCompose} aria-label="Create">
            <IconPlus size={26} />
          </button>
          <button type="button" className={`wingup-tb${view === 'insights' ? ' on' : ''}`} onClick={() => { void tap(); setView('insights'); }} aria-current={view === 'insights'}>
            <span className="wingup-tb-ic" aria-hidden="true">📊</span><span className="wingup-tb-lab">Insights</span>
          </button>
          <button type="button" className={`wingup-tb${view === 'more' ? ' on' : ''}`} onClick={() => { void tap(); setView('more'); }} aria-current={view === 'more'}>
            <span className="wingup-tb-ic" aria-hidden="true">☰</span><span className="wingup-tb-lab">More</span>
          </button>
        </nav>
      )}
    </div>
  );
}
