import type { Attach } from './api';

// Shared file → Attach conversion with guardrails, used by both the chat composer
// and the Memory composer:
//  • hard cap on input size (clear error if exceeded)
//  • images are decoded (incl. iOS HEIC) and re-encoded to a downscaled JPEG so
//    they always fit under the model's ~5 MB vision limit
//  • PDFs are passed through (base64) up to the cap
export interface AttachResult { attach?: Attach; error?: string }

const MAX_BYTES = 20 * 1024 * 1024;        // reject anything bigger than 20 MB
const IMG_TARGET_BYTES = 4 * 1024 * 1024;  // keep encoded images under the ~5 MB read limit
const IMG_MAX_EDGE = 1568;                 // px on the longest side (Claude's vision sweet spot)

function stripPrefix(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}
function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(f);
  });
}
// Roughly the decoded byte size of a base64 string.
const b64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4);

// Decode + re-encode an image to a downscaled JPEG, shrinking further if the
// first pass is still over the target size.
function imageToJpeg(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      try {
        let scale = Math.min(1, IMG_MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        const render = (q: number) => {
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return '';
          ctx.drawImage(img, 0, 0, w, h);
          return stripPrefix(canvas.toDataURL('image/jpeg', q));
        };
        let q = 0.85;
        let out = render(q);
        // Bring it under the target by lowering quality, then dimensions.
        for (let i = 0; out && b64Bytes(out) > IMG_TARGET_BYTES && i < 6; i++) {
          if (q > 0.5) q -= 0.15;
          else scale *= 0.8;
          out = render(q);
        }
        URL.revokeObjectURL(url);
        out ? resolve(out) : reject(new Error('encode failed'));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error('image error'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

export async function fileToAttachment(f: File): Promise<AttachResult> {
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isImg = f.type.startsWith('image/');
  if (!isImg && !isPdf) return { error: "That file type isn't supported — try an image or PDF." };
  if (f.size > MAX_BYTES) {
    return { error: `That file is too big (${Math.round(f.size / 1024 / 1024)} MB). Max is 20 MB.` };
  }
  try {
    if (isImg) {
      const data = await imageToJpeg(f);
      return { attach: { kind: 'image', mediaType: 'image/jpeg', data, name: (f.name || 'image').replace(/\.[^.]+$/, '') + '.jpg' } };
    }
    const data = stripPrefix(await readAsDataUrl(f));
    return { attach: { kind: 'pdf', mediaType: 'application/pdf', data, name: f.name || 'document.pdf' } };
  } catch {
    return { error: "Couldn't read that file — try another." };
  }
}
