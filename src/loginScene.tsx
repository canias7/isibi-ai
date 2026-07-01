import { useMemo } from 'react';

// The login page's living scene — shared by the desktop login (brand panel)
// and the Marketing hub, which wraps the same atmosphere around its one word.
// Assets (videos, wall sprite, email preview) stream from Supabase storage so
// the app bundle stays small.

export const ASSETS = 'https://lkpfeqrelvziltfwpuxi.supabase.co/storage/v1/object/public/email-assets/login';

// The five showcase generations: placement/motion personality lives in CSS
// (.lp-f1..5 on the login, .hub-f1..5 on the hub).
export const FILMS = [
  { src: `${ASSETS}/v-headset.mp4`, cls: 'lp-f1', depth: 1.4, prompt: 'Ultra high-end commercial product shot, VR headset against deep navy, magenta and cyan accents, immaculate reflections.' },
  { src: `${ASSETS}/v-architect.mp4`, cls: 'lp-f2', depth: 0.8, prompt: 'Editorial photography, 8K — architect in a cream blazer, brutalist concrete stairwell, soft skylight, magazine cover quality.' },
  { src: `${ASSETS}/v-perfume.mp4`, cls: 'lp-f3', depth: 1.8, prompt: 'Crystal-cut perfume bottle catching prismatic light, slow orbit, hard sun through venetian blinds, warm sandstone wall.' },
  { src: `${ASSETS}/v-temple.mp4`, cls: 'lp-f4', depth: 1.0, prompt: 'Slow cinematic push-in through an ancient temple, fog in the valley, golden light catching dust between stone pillars.' },
  { src: `${ASSETS}/v-dragon.mp4`, cls: 'lp-f5', depth: 1.5, prompt: 'Torch-lit forest at dusk — a shaman with glowing markings, then an iridescent dragon descends, trees trembling.' },
];

const WALL_LABELS: [string, string][] = [
  ['Product Key Shots', 'Generating'], ['Brand Campaign Hero', 'Judging'],
  ['Studio Shots', 'Researching'], ['Social Posts', 'Drafting'],
  ['Billboard Mockups', 'Thinking'], ['Packaging Mockups', 'Rendering'],
  ['In-Store Visuals', 'Researching'], ['Print Posters', 'Judging'],
  ['Product Showcase Loop', 'Generating'], ['Email Hero Images', 'Compositing'],
  ['Storyboards', 'Generating'], ['Imagery Style', 'Thinking'],
  ['Product Pages', 'Writing'], ['Campaign Themes', 'Exploring'],
];
const WALL_SIZES = [4, 5, 3, 6, 4, 3, 5, 4, 6, 3, 5, 4, 3, 5, 4, 6, 3, 4];
const SPRITE_COLS = 10;
const SPRITE_TILES = 50;

// The drifting "wall of work" behind the cards: clusters of tiny generations
// sliced from one sprite sheet, each with a working label.
export function Wall() {
  const clusters = useMemo(() => {
    let t = 0;
    return WALL_SIZES.map((n, ci) => {
      const [name, verb] = WALL_LABELS[ci % WALL_LABELS.length];
      const tiles = Array.from({ length: n }, (_, k) => {
        const idx = t % SPRITE_TILES;
        t += 7; // stride so neighbouring tiles come from different videos
        return { idx, big: (ci + k) % 5 === 0, fresh: (ci * 3 + k) % 6 === 0, delay: (ci * 1.7 + k * 2.3) % 6 };
      });
      return { name, verb, dotDelay: (ci * 0.7) % 2.4, tiles };
    });
  }, []);
  return (
    <div className="lp-wall" aria-hidden="true">
      {clusters.map((c, i) => (
        <div className="lp-cluster" key={i}>
          <span className="lp-clabel"><b>{c.name}</b> · {c.verb} <span className="lp-cdot" style={{ animationDelay: `${c.dotDelay}s` }} /></span>
          <div className="lp-crow">
            {c.tiles.map((tl, k) => (
              <span
                key={k}
                className={`lp-tile${tl.big ? ' big' : ''}${tl.fresh ? ' fresh' : ''}`}
                style={{
                  backgroundPosition: `${-(tl.idx % SPRITE_COLS) * 100}% ${-Math.floor(tl.idx / SPRITE_COLS) * 100}%`,
                  animationDelay: tl.fresh ? `${tl.delay}s` : undefined,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Mouse parallax for a scene container: cards shift by depth so the cluster
// feels 3D. Returns a cleanup function; no-ops under prefers-reduced-motion.
export function attachParallax(panel: HTMLElement): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const flies = [...panel.querySelectorAll<HTMLElement>('.lp-fly')];
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const onMove = (ev: MouseEvent) => {
    const r = panel.getBoundingClientRect();
    tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => { tx = 0; ty = 0; };
  const tick = () => {
    cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
    for (const f of flies) {
      const d = parseFloat(f.dataset.depth || '1');
      f.style.marginLeft = `${-cx * 14 * d}px`;
      f.style.marginTop = `${-cy * 10 * d}px`;
    }
    raf = requestAnimationFrame(tick);
  };
  panel.addEventListener('mousemove', onMove);
  panel.addEventListener('mouseleave', onLeave);
  raf = requestAnimationFrame(tick);
  return () => {
    panel.removeEventListener('mousemove', onMove);
    panel.removeEventListener('mouseleave', onLeave);
    cancelAnimationFrame(raf);
  };
}
