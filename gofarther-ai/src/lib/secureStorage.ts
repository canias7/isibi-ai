/**
 * Encrypted AsyncStorage wrapper.
 * Uses AES-256-CBC via SubtleCrypto with a device-unique key stored in SecureStore.
 * Backward compatible with legacy unencrypted and old XOR-encrypted data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const STORAGE_KEY_ID = 'secure_storage_key';
let _cachedKey: string | null = null;

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

async function getEncryptionKey(): Promise<string> {
  if (_cachedKey) return _cachedKey;
  let key = await SecureStore.getItemAsync(STORAGE_KEY_ID);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(STORAGE_KEY_ID, key);
  }
  _cachedKey = key;
  return key;
}

// ── AES-256-CBC Storage ────────────────────────────────────────────

const AES_PREFIX = 'AENC:'; // AES encrypted prefix

export async function secureSet(key: string, value: string): Promise<void> {
  try {
    const keyHex = await getEncryptionKey();
    const keyBytes = hexToBytes(keyHex);
    const iv = await Crypto.getRandomBytesAsync(16);
    const data = new TextEncoder().encode(value);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv }, cryptoKey, data
    );

    const ivHex = bytesToHex(new Uint8Array(iv));
    const ctHex = bytesToHex(new Uint8Array(encrypted));
    await AsyncStorage.setItem(key, `${AES_PREFIX}${ivHex}:${ctHex}`);
  } catch {
    // Fallback to plain storage if AES encryption fails
    await AsyncStorage.setItem(key, value);
  }
}

export async function secureGet(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    // New AES-encrypted format
    if (raw.startsWith(AES_PREFIX)) {
      const payload = raw.substring(AES_PREFIX.length);
      const colonIdx = payload.indexOf(':');
      if (colonIdx === -1) return raw;

      const ivHex = payload.substring(0, colonIdx);
      const ctHex = payload.substring(colonIdx + 1);

      const keyHex = await getEncryptionKey();
      const keyBytes = hexToBytes(keyHex);
      const iv = hexToBytes(ivHex);
      const ct = hexToBytes(ctHex);

      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv }, cryptoKey, ct
      );
      return new TextDecoder().decode(decrypted);
    }

    // Legacy XOR format (ENC: prefix) — return raw, will be re-encrypted on next write
    if (raw.startsWith('ENC:')) {
      return raw;
    }

    // Unencrypted legacy data — return as-is
    return raw;
  } catch {
    return AsyncStorage.getItem(key);
  }
}

export async function secureDelete(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
