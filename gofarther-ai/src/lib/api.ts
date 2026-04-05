/** GoFarther AI — API Client */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const BASE = 'https://isibi-backend.onrender.com/api/ghost';
const TOKEN_KEY = 'gofurther_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const headers: any = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers, signal: controller.signal });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) {
      // Handle expired token
      if (res.status === 401) {
        await clearToken();
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    return data;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function signup(email: string, name: string, password: string) {
  const data = await apiFetch('/signup', {
    method: 'POST',
    body: JSON.stringify({ email, name, password }),
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function socialLogin(email: string, name: string, provider: 'apple' | 'google', token: string) {
  // Try the social-login endpoint first
  try {
    const data = await apiFetch('/social-login', {
      method: 'POST',
      body: JSON.stringify({ email, name, provider, social_token: token }),
    });
    if (data.token) await setToken(data.token);
    return data;
  } catch (e: any) {
    // If social-login fails (endpoint missing or user doesn't exist), try signup
    // Generate a secure random password for social users (they'll never need it)
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const securePw = Array.from(new Uint8Array(randomBytes)).map(b => b.toString(16).padStart(2, '0')).join('');

    try {
      const data = await apiFetch('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, name, password: securePw }),
      });
      if (data.token) await setToken(data.token);
      return data;
    } catch (signupErr: any) {
      // Account exists but social-login failed — user needs to try email login
      if (signupErr.message?.includes('already')) {
        throw new Error('An account with this email already exists. Try logging in with your email and password.');
      }
      throw signupErr;
    }
  }
}

export async function forgotPassword(email: string) {
  return apiFetch('/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  return apiFetch('/reset', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
}

export async function logout() {
  await clearToken();
}

export async function getMe() {
  return apiFetch('/me');
}
