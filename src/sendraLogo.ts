// Sendra's brand mark, inlined as an SVG data URI so it renders on the native
// webview offline (same approach as plaidLogo / the bundled BRANDS SVGs).
//
// NOTE: this is a faithful REBUILD of the logo (orange->coral rounded square with
// a bold white "S"), made because the original file wasn't available on disk to
// embed. To use the exact asset, drop the PNG/SVG in and replace SENDRA_LOGO with
// it (everything that renders the logo reads this one constant).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#FF9A4D"/><stop offset=".55" stop-color="#FF6F47"/><stop offset="1" stop-color="#F8514E"/>
</linearGradient></defs>
<rect width="100" height="100" rx="23" fill="url(#sg)"/>
<path d="M68 35C68 24 45 22 35 30C25 38 30 47 50 52C70 57 75 66 65 74C55 82 38 80 30 71" fill="none" stroke="#fff" stroke-width="12.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const SENDRA_LOGO = `data:image/svg+xml,${encodeURIComponent(svg)}`;
