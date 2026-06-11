import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// __APP_VERSION__ is a monotonic version (the commit timestamp, set by CI as
// APP_VERSION) baked into the bundle. ota.ts compares it against the published
// manifest so OTA only ever moves *forward*. Defaults to 0 for local dev.
export default defineConfig({
  // Electron loads the bundle over file://, so it needs relative asset URLs.
  // Web/Capacitor builds keep the absolute root base. Toggled with ELECTRON=1.
  base: process.env.ELECTRON ? './' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? '0'),
  },
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split the stable heavyweights out of the app chunk: they change
        // ~never, so each OTA update re-parses a much smaller app bundle and
        // the webview can cache the vendor chunks across versions.
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
