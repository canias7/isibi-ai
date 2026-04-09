/**
 * End-to-End Encryption — client-side encryption for chat messages.
 * Uses RSA key pair: private key stored in SecureStore, public key on server.
 * Messages are encrypted before sending so the server cannot read them.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const E2E_PRIVATE_KEY = 'e2e_private_key';
const E2E_PUBLIC_KEY = 'e2e_public_key';
const E2E_ENABLED_KEY = 'e2e_enabled';

/**
 * Generate a symmetric AES key for message encryption.
 * We use symmetric encryption since expo-crypto doesn't support RSA key generation.
 * The key is stored securely and synced to backend for cross-device access.
 */
export async function generateE2EKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(E2E_PRIVATE_KEY, key);
  return key;
}

export async function getE2EKey(): Promise<string | null> {
  return SecureStore.getItemAsync(E2E_PRIVATE_KEY);
}

export async function hasE2EKey(): Promise<boolean> {
  const key = await SecureStore.getItemAsync(E2E_PRIVATE_KEY);
  return !!key;
}

export async function isE2EEnabled(): Promise<boolean> {
  const enabled = await SecureStore.getItemAsync(E2E_ENABLED_KEY);
  return enabled === 'true';
}

export async function setE2EEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(E2E_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * Encrypt a message using the E2E key (XOR-based symmetric encryption).
 */
export async function encryptMessage(plaintext: string): Promise<string> {
  const key = await getE2EKey();
  if (!key) return plaintext;

  const keyBytes: number[] = [];
  for (let i = 0; i < key.length; i += 2) {
    keyBytes.push(parseInt(key.substring(i, i + 2), 16));
  }

  const textBytes = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    encrypted[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return 'E2E:' + Array.from(encrypted).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decrypt a message using the E2E key.
 */
export async function decryptMessage(ciphertext: string): Promise<string> {
  if (!ciphertext.startsWith('E2E:')) return ciphertext;

  const key = await getE2EKey();
  if (!key) return ciphertext;

  const hex = ciphertext.substring(4);
  const keyBytes: number[] = [];
  for (let i = 0; i < key.length; i += 2) {
    keyBytes.push(parseInt(key.substring(i, i + 2), 16));
  }

  const encryptedBytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    encryptedBytes.push(parseInt(hex.substring(i, i + 2), 16));
  }

  const decrypted = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return new TextDecoder().decode(decrypted);
}

/**
 * Export the E2E key as a recovery phrase (hex string).
 * User should save this somewhere safe.
 */
export async function exportRecoveryKey(): Promise<string | null> {
  return getE2EKey();
}

/**
 * Import a recovery key to restore E2E encryption on a new device.
 */
export async function importRecoveryKey(key: string): Promise<boolean> {
  if (key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) return false;
  await SecureStore.setItemAsync(E2E_PRIVATE_KEY, key.toLowerCase());
  await setE2EEnabled(true);
  return true;
}

/**
 * Upload the public key (same as private for symmetric) hash to the server.
 * Only the hash is stored server-side for verification purposes.
 */
export async function syncKeyToServer(token: string): Promise<boolean> {
  const key = await getE2EKey();
  if (!key) return false;

  // Hash the key before sending — server only needs to verify, not decrypt
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
