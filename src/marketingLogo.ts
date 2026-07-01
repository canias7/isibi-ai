// The Marketing agent's mark, inlined as an SVG data URI so it renders on the
// native webview offline (same approach as sendraLogo / wingupLogo). Amber
// rounded square — the brand accent — with a bold white "M" whose middle peak
// doubles as an upward arrow (growth).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#FFD98A"/><stop offset=".55" stop-color="#E8A93A"/><stop offset="1" stop-color="#C9871F"/>
</linearGradient></defs>
<rect width="100" height="100" rx="23" fill="url(#mg)"/>
<path d="M28 72 V34 L50 58 L72 34 V72" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const MARKETING_LOGO = `data:image/svg+xml,${encodeURIComponent(svg)}`;
