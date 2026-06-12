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
    PushNotifications: {
      // Show the banner/sound even when the app is in the foreground — otherwise
      // iOS delivers foreground pushes silently (why the in-app test showed
      // nothing). Doesn't affect background delivery, which always banners.
      // 'banner' + 'list' are the iOS 14+ replacements for the deprecated 'alert'.
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
};

export default config;
