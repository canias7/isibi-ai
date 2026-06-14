import { BRANDS } from './brandLogos';
import { BRAND_SVGS } from './brandSvgs';

// Non-component helpers split out of brandLogos.tsx (which keeps only the
// BrandLogo component, so React Fast Refresh works for it).

// Connector ids that have a bundled logo (single-path BRANDS or a full inline SVG).
export const BRAND_IDS: string[] = [...Object.keys(BRANDS), ...Object.keys(BRAND_SVGS)];
export function hasBrand(app: string): boolean { return app in BRANDS || app in BRAND_SVGS; }

