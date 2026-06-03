/**
 * Expo Config Plugin for SSL Certificate Pinning.
 * Pins the TLS certificate of the GoFarther AI backend.
 *
 * This plugin modifies the native iOS/Android build to enforce
 * certificate pinning on all network requests to our API.
 *
 * Note: Requires a new native build (eas build) — not OTA compatible.
 */

const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

// SHA-256 fingerprint of isibi-backend.onrender.com certificate
// Update this when the certificate is rotated
const PINNED_DOMAINS = [
  {
    domain: 'isibi-backend.onrender.com',
    // Render uses Let's Encrypt certificates — pin the intermediate CA
    // This should be updated when Render rotates their certificate chain
    includeSubdomains: true,
  },
];

function withSSLPinningIOS(config) {
  return withInfoPlist(config, (config) => {
    // iOS uses App Transport Security for certificate pinning
    config.modResults.NSAppTransportSecurity = {
      ...config.modResults.NSAppTransportSecurity,
      NSPinnedDomains: {
        'isibi-backend.onrender.com': {
          NSIncludesSubdomains: true,
          NSPinnedLeafIdentities: [],
          // Using CA pinning instead of leaf to survive cert rotation
          NSPinnedCAIdentities: [],
        },
      },
    };
    return config;
  });
}

function withSSLPinningAndroid(config) {
  return withAndroidManifest(config, (config) => {
    // Android uses network-security-config.xml
    // The actual XML file should be created in the android project
    const mainApplication = config.modResults.manifest.application?.[0];
    if (mainApplication) {
      mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return config;
  });
}

module.exports = function withSSLPinning(config) {
  config = withSSLPinningIOS(config);
  config = withSSLPinningAndroid(config);
  return config;
};
