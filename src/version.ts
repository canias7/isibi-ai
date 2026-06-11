// App version shown in Settings. APP_VERSION mirrors package.json; BUILD is the
// CI-set monotonic build number (the commit timestamp), or '0' in a dev/web build.
declare const __APP_VERSION__: string;

export const APP_VERSION = '0.1.0';
export const BUILD: string = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '0';
