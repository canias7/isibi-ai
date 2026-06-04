/**
 * Device Security — jailbreak/root detection and device integrity checks.
 * Reports compromised devices to the backend for audit logging.
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { GHOST_BASE } from './config';

const JAILBREAK_PATHS_IOS = [
  '/Applications/Cydia.app',
  '/Library/MobileSubstrate/MobileSubstrate.dylib',
  '/bin/bash',
  '/usr/sbin/sshd',
  '/etc/apt',
  '/private/var/lib/apt/',
  '/usr/bin/ssh',
];

const ROOT_PATHS_ANDROID = [
  '/system/app/Superuser.apk',
  '/system/xbin/su',
  '/system/bin/su',
  '/sbin/su',
  '/data/local/xbin/su',
  '/data/local/bin/su',
  '/data/local/su',
];

async function checkSuspiciousPaths(): Promise<boolean> {
  const paths = Platform.OS === 'ios' ? JAILBREAK_PATHS_IOS : ROOT_PATHS_ANDROID;
  for (const path of paths) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) return true;
    } catch {
      // Can't access = not rooted (expected)
    }
  }
  return false;
}

export async function isDeviceCompromised(): Promise<boolean> {
  try {
    // Method 1: expo-device experimental API
    if (Device.isRootedExperimentalAsync) {
      const rooted = await Device.isRootedExperimentalAsync();
      if (rooted) return true;
    }
  } catch {}

  // Method 2: Check for suspicious file paths
  try {
    const suspiciousPaths = await checkSuspiciousPaths();
    if (suspiciousPaths) return true;
  } catch {}

  return false;
}

export function getDeviceInfo() {
  return {
    device_model: Device.modelName || 'Unknown',
    os_version: `${Platform.OS} ${Device.osVersion || 'unknown'}`,
  };
}

export async function reportDeviceStatus(token: string): Promise<{ allowed: boolean; warning: string | null }> {
  const compromised = await isDeviceCompromised();
  const info = getDeviceInfo();

  try {
    const res = await fetch(`${GHOST_BASE}/device-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        is_rooted: compromised,
        ...info,
      }),
    });
    if (res.ok) return await res.json();
  } catch {}

  return { allowed: true, warning: compromised ? 'Device may be compromised' : null };
}
