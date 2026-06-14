import { BRANDS } from './brandLogos';
import { BRAND_SVG_IDS } from './brandSvgKeys';

// Non-component helpers split out of brandLogos.tsx (which keeps only the
// BrandLogo component, so React Fast Refresh works for it).

// Connector ids that have a bundled logo (single-path BRANDS or a lazily-loaded
// inline SVG). Uses the tiny id list, not the big SVG payload.
export const BRAND_IDS: string[] = [...Object.keys(BRANDS), ...BRAND_SVG_IDS];
export function hasBrand(app: string): boolean { return app in BRANDS || BRAND_SVG_IDS.has(app); }

