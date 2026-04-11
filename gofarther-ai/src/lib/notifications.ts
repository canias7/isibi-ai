/** Push notifications setup + backend registration */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerDevicePushToken, unregisterDevicePushToken } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// In-memory cache of the last-registered token so repeat calls to
// registerForPushNotifications() on a single session are cheap and
// idempotent.
let _lastRegisteredToken: string | null = null;

/**
 * Ask iOS/Android for push permission, grab an Expo push token, and
 * upload it to the backend so the server can fan out notifications
 * to this device.
 *
 * Returns the token string on success (null on simulator, denied
 * permission, or error). Safe to call repeatedly — if the token
 * hasn't changed, the backend upsert is still cheap.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  let token: string | null = null;
  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: 'de7252a0-40c1-4cb5-b6f3-eac7cc1f3b5e',
    });
    token = result.data;
  } catch (e) {
    // On simulators or misconfigured builds this will throw. Swallow
    // and return null so the caller treats it as "push unavailable".
    return null;
  }

  if (!token) return null;

  // Upload to backend — best effort. We don't block or retry here
  // because the token is stable; the next app launch will try again.
  try {
    await registerDevicePushToken(token, {
      platform: Platform.OS,
      device_name: Device.deviceName || `${Device.manufacturer || ''} ${Device.modelName || ''}`.trim(),
      app_version: (Constants as any).expoConfig?.version || (Constants as any).manifest?.version,
    });
    _lastRegisteredToken = token;
  } catch (e) {
    // Not fatal — the token is valid and the client will retry on
    // next launch. Log to auth log for debugging if needed.
  }

  return token;
}

/** Tell the backend to stop pushing to this device (on logout). */
export async function unregisterFromPushNotifications(): Promise<void> {
  if (!_lastRegisteredToken) {
    // Try to fetch the current token so logout still cleans up the
    // backend row if the user never called register() in this session.
    try {
      const result = await Notifications.getExpoPushTokenAsync({
        projectId: 'de7252a0-40c1-4cb5-b6f3-eac7cc1f3b5e',
      });
      _lastRegisteredToken = result.data;
    } catch {
      return;
    }
  }
  if (!_lastRegisteredToken) return;
  try {
    await unregisterDevicePushToken(_lastRegisteredToken);
    _lastRegisteredToken = null;
  } catch {
    // Not fatal — the old token will just get marked inactive next
    // time a push to it returns DeviceNotRegistered from Expo.
  }
}

export async function scheduleLocalNotification(title: string, body: string, seconds: number = 5, data?: Record<string, string>) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: data || {} },
    trigger: { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
  });
}

/** Listen for notification taps — returns cleanup function */
export function addNotificationResponseListener(handler: (sessionId: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data;
    if (data?.sessionId) {
      handler(data.sessionId as string);
    }
  });
  return () => sub.remove();
}
