// The Go Farther identity motif: a warm amber core with satellites — the same
// "core" that powers the memory constellation and the call orb. Used as the
// signature illustration on empty states, so every screen speaks one language.
export function BrandConstellation({ width = 150 }: { width?: number }) {
  return (
    <svg
      className="gf-empty-art"
      width={width}
      height={width * 0.6}
      viewBox="0 0 150 90"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="gfbrandcore" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="var(--brand-soft)" />
          <stop offset="58%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--brand-strong)" />
        </radialGradient>
      </defs>
      {/* hairline links, drawn beneath the nodes */}
      <g stroke="rgba(224, 161, 58, 0.32)" strokeWidth="1">
        <line x1="75" y1="45" x2="30" y2="24" />
        <line x1="75" y1="45" x2="116" y2="20" />
        <line x1="75" y1="45" x2="124" y2="62" />
        <line x1="75" y1="45" x2="40" y2="66" />
      </g>
      {/* faint far stars */}
      <circle cx="14" cy="48" r="1.2" fill="rgba(255, 255, 255, 0.28)" />
      <circle cx="96" cy="8" r="1.2" fill="rgba(255, 255, 255, 0.22)" />
      <circle cx="138" cy="38" r="1.2" fill="rgba(255, 255, 255, 0.25)" />
      {/* satellites */}
      <circle cx="30" cy="24" r="4" fill="rgba(224, 161, 58, 0.4)" />
      <circle cx="116" cy="20" r="3.2" fill="rgba(224, 161, 58, 0.34)" />
      <circle cx="124" cy="62" r="4.6" fill="rgba(224, 161, 58, 0.45)" />
      <circle cx="40" cy="66" r="2.8" fill="rgba(224, 161, 58, 0.3)" />
      {/* the core, with its glow */}
      <circle cx="75" cy="45" r="17" fill="rgba(224, 161, 58, 0.14)" />
      <circle cx="75" cy="45" r="11" fill="url(#gfbrandcore)" />
    </svg>
  );
}
