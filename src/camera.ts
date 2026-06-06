import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { Attach } from './api';

// Result of a capture attempt:
//   ok          -> we got a photo (attach it)
//   cancel      -> the user backed out / denied (do NOT fall back to a file picker)
//   unavailable -> web, or the native plugin isn't in this build (fall back)
export type CaptureResult =
  | { status: 'ok'; attach: Attach }
  | { status: 'cancel' }
  | { status: 'unavailable' };

// Capture from the native camera or pick from the photo library, returned as a
// chat Attach (downscaled JPEG, base64 without the data-URL prefix). Fails safe:
// anything other than a real photo resolves to cancel/unavailable so the caller
// can decide whether to fall back to the HTML file input.
export async function capturePhoto(source: 'camera' | 'photos'): Promise<CaptureResult> {
  if (Capacitor.getPlatform() === 'web') return { status: 'unavailable' };
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Base64,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      width: 1568, // keep payloads small + within Claude's vision limits
      correctOrientation: true,
      presentationStyle: 'fullscreen',
      promptLabelHeader: source === 'camera' ? 'Take a photo' : 'Choose a photo',
    });
    if (!photo.base64String) return { status: 'cancel' };
    const fmt = (photo.format || 'jpeg').toLowerCase();
    const mediaType = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    return { status: 'ok', attach: { kind: 'image', mediaType, data: photo.base64String, name: `photo.${ext}` } };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    // Plugin not bundled in this native build yet -> let the caller fall back.
    if (msg.includes('not implemented') || msg.includes('unimplemented')) return { status: 'unavailable' };
    // User cancelled, or denied permission -> don't pop a second picker.
    return { status: 'cancel' };
  }
}
