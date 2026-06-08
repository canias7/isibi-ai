import { BRANDS } from './brandLogos';

// Non-component helpers split out of brandLogos.tsx (which keeps only the
// BrandLogo component, so React Fast Refresh works for it).

// Connector ids that have a bundled logo.
export const BRAND_IDS: string[] = Object.keys(BRANDS);
export function hasBrand(app: string): boolean { return app in BRANDS; }
