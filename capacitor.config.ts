import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gofarther.app',
  appName: 'Go Farther',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      // We check for updates ourselves on launch (see src/ota.ts).
      autoUpdate: false,
    },
  },
};

export default config;
