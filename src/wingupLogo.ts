// Wingup's brand mark, inlined as an SVG data URI so it renders on the native
// webview offline (same approach as SENDRA_LOGO / the bundled BRANDS SVGs).
//
// NOTE: this is a PLACEHOLDER the owner can swap — a simple stylized wing (🪽)
// on the warm amber tile, with a light-blue wing. To use the exact asset, drop the PNG/SVG in
// and replace WINGUP_LOGO with it (everything that renders the logo reads this
// one constant).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#FFD98A"/><stop offset=".5" stop-color="#FFB347"/><stop offset="1" stop-color="#E0951F"/>
</linearGradient></defs>
<rect width="100" height="100" rx="23" fill="url(#wg)"/>
<g fill="none" stroke="#7DD3FC" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
<path d="M22 70 C40 70 58 64 74 44"/>
<path d="M30 64 C44 63 56 57 66 44"/>
<path d="M40 58 C50 57 57 52 62 44"/>
</g>
<path d="M74 44 C82 33 80 26 74 24 C71 35 67 40 60 45 Z" fill="#7DD3FC"/>
</svg>`;

export const WINGUP_LOGO = `data:image/svg+xml,${encodeURIComponent(svg)}`;
