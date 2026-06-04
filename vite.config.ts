import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// __APP_VERSION__ is a monotonic version (the commit timestamp, set by CI as
// APP_VERSION) baked into the bundle. ota.ts compares it against the published
// manifest so OTA only ever moves *forward*. Defaults to 0 for local dev.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? '0'),
  },
  server: { host: true, port: 5173 },
});
