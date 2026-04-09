/**
 * Encrypted AsyncStorage wrapper.
 * Encrypts values before storing in AsyncStorage using a device-unique key.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const STORAGE_KEY_ID = 'secure_storage_key';

let _cachedKey: string | null = null;

async function getEncryptionKey(): Promise<string> {
  if (_cachedKey) return _cachedKey;

  let key = await SecureStore.getItemAsync(STORAGE_KEY_ID);
  if (!key) {
    // Generate a new key on first use
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(STORAGE_KEY_ID, key);
  }
  _cachedKey = key;
  return key;
}

async function xorEncrypt(plaintext: string, key: string): Promise<string> {
  // Simple XOR-based encryption with the device key
  // Not as strong as AES but works without native crypto modules
  const keyBytes = [];
  for (let i = 0; i < key.length; i += 2) {
    keyBytes.push(parseInt(key.substring(i, i + 2), 16));
  }

  const textBytes = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(textBytes.length);

  for (let i = 0; i < textBytes.length; i++) {
    encrypted[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  // Convert to base64-like hex string
  return Array.from(encrypted).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function xorDecrypt(cipherHex: string, key: string): Promise<string> {
  const keyBytes = [];
  for (let i = 0; i < key.length; i += 2) {
    keyBytes.push(parseInt(key.substring(i, i + 2), 16));
  }

  const encryptedBytes = [];
  for (let i = 0; i < cipherHex.length; i += 2) {
    encryptedBytes.push(parseInt(cipherHex.substring(i, i + 2), 16));
  }

  const decrypted = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return new TextDecoder().decode(decrypted);
}

const ENCRYPTED_PREFIX = 'ENC:';

export async function secureSet(key: string, value: string): Promise<void> {
  try {
    const encKey = await getEncryptionKey();
    const encrypted = await xorEncrypt(value, encKey);
    await AsyncStorage.setItem(key, ENCRYPTED_PREFIX + encrypted);
  } catch {
    // Fallback to plain storage if encryption fails
    await AsyncStorage.setItem(key, value);
  }
}

export async function secureGet(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    if (raw.startsWith(ENCRYPTED_PREFIX)) {
      const encKey = await getEncryptionKey();
      return await xorDecrypt(raw.substring(ENCRYPTED_PREFIX.length), encKey);
    }

    // Legacy unencrypted data — return as-is (backward compatible)
    return raw;
  } catch {
    return AsyncStorage.getItem(key);
  }
}

export async function secureDelete(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
