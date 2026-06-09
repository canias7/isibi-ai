import { Geolocation } from '@capacitor/geolocation';

// Device location for "here / near me" questions. Captured only when a message
// looks location-relevant (see App.tsx), so permission is asked in context and
// we never send the user's whereabouts unprompted. Cached briefly so a flurry of
// follow-ups doesn't re-hit GPS. Returns null if denied/unavailable.
export interface GeoLoc { lat: number; lon: number; label?: string }

let cached: { at: number; loc: GeoLoc } | null = null;
const TTL = 10 * 60 * 1000; // 10 minutes

export async function getLocation(): Promise<GeoLoc | null> {
  if (cached && Date.now() - cached.at < TTL) return cached.loc;
  try {
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      perm = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
    }
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    // Trim precision to ~11 m — plenty for weather/nearby, and not pinpoint.
    const lat = Math.round(pos.coords.latitude * 1e4) / 1e4;
    const lon = Math.round(pos.coords.longitude * 1e4) / 1e4;
    const label = await reverseLabel(lat, lon);
    const loc: GeoLoc = label ? { lat, lon, label } : { lat, lon };
    cached = { at: Date.now(), loc };
    return loc;
  } catch {
    return null;
  }
}

// Keyless reverse-geocode to a "City, Region, Country" label (BigDataCloud's
// free client endpoint — no key, CORS-open). Best-effort; '' if it fails.
async function reverseLabel(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (!r.ok) return '';
    const j = await r.json();
    const city = j.city || j.locality || '';
    const region = j.principalSubdivision && j.principalSubdivision !== city ? j.principalSubdivision : '';
    const country = j.countryName || '';
    return [city, region, country].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}
