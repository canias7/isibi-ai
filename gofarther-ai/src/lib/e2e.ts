/**
 * End-to-End Encryption — client-side encryption for chat messages.
 * Uses AES-256-CBC via SubtleCrypto for strong symmetric encryption.
 * Key stored in SecureStore (iOS Keychain / Android Keystore).
 * Only a SHA-256 hash of the key is synced to the server for verification.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const E2E_KEY = 'e2e_encryption_key';
const E2E_ENABLED_KEY = 'e2e_enabled';

// ── Helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Key Management ─────────────────────────────────────────────────

export async function generateE2EKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(E2E_KEY, key);
  return key;
}

export async function getE2EKey(): Promise<string | null> {
  return SecureStore.getItemAsync(E2E_KEY);
}

export async function hasE2EKey(): Promise<boolean> {
  const key = await SecureStore.getItemAsync(E2E_KEY);
  return !!key;
}

export async function isE2EEnabled(): Promise<boolean> {
  const enabled = await SecureStore.getItemAsync(E2E_ENABLED_KEY);
  return enabled === 'true';
}

export async function setE2EEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(E2E_ENABLED_KEY, enabled ? 'true' : 'false');
}

// ── AES-256-CBC Encryption ─────────────────────────────────────────

/**
 * Encrypt a message using AES-256-GCM (authenticated encryption).
 * Output format: E2E:<iv_hex>:<ciphertext_hex>
 * GCM provides both confidentiality and integrity (prevents tampering).
 */
export async function encryptMessage(plaintext: string): Promise<string> {
  const keyHex = await getE2EKey();
  if (!keyHex) throw new Error('E2E encryption key not available');

  const keyBytes = hexToBytes(keyHex);
  const iv = await Crypto.getRandomBytesAsync(12); // 12 bytes for GCM
  const data = new TextEncoder().encode(plaintext);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, cryptoKey, data
  );

  return `E2E:${bytesToHex(new Uint8Array(iv))}:${bytesToHex(new Uint8Array(encrypted))}`;
}

/**
 * Decrypt a message encrypted with AES-256-GCM.
 * Also supports legacy AES-CBC messages (iv length 32 hex = 16 bytes).
 */
export async function decryptMessage(ciphertext: string): Promise<string> {
  if (!ciphertext.startsWith('E2E:')) return ciphertext;

  const keyHex = await getE2EKey();
  if (!keyHex) return ciphertext;

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext;

    const iv = hexToBytes(parts[1]);
    const ct = hexToBytes(parts[2]);
    const keyBytes = hexToBytes(keyHex);

    // Detect GCM (12-byte IV) vs legacy CBC (16-byte IV)
    const algo = iv.length === 12 ? 'AES-GCM' : 'AES-CBC';
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: algo }, false, ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: algo, iv }, cryptoKey, ct
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return ciphertext; // Return as-is if decryption fails (wrong key, corrupted)
  }
}

// ── Key Recovery ───────────────────────────────────────────────────

/** Export the E2E key for backup. User should store this securely. */
export async function exportRecoveryKey(): Promise<string | null> {
  return getE2EKey();
}

/** Import a recovery key to restore E2E on a new device. */
export async function importRecoveryKey(key: string): Promise<boolean> {
  if (key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) return false;
  await SecureStore.setItemAsync(E2E_KEY, key.toLowerCase());
  await setE2EEnabled(true);
  return true;
}

/** Sync key hash to server for verification (server never sees actual key). */
export async function syncKeyToServer(token: string): Promise<boolean> {
  const key = await getE2EKey();
  if (!key) return false;

  const keyHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    key
  );

  try {
    const res = await fetch('https://isibi-backend.onrender.com/api/ghost/e2e/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ public_key: keyHash }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
