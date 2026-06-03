/**
 * iOS Widget Support
 *
 * iOS widgets require a native Widget Extension target built with SwiftUI.
 * This can't be done purely in JS — it needs:
 *
 * 1. A native iOS Widget Extension target in Xcode
 * 2. SwiftUI views for the widget UI
 * 3. App Groups to share data between main app and widget
 * 4. An EAS config plugin or custom native module
 *
 * What this module does:
 * - Stores data that the widget can read via shared App Group storage
 * - When the native widget is built, it reads from the same App Group
 *
 * To implement:
 * 1. Add expo-apple-targets or react-native-widget-extension
 * 2. Create widget target with SwiftUI
 * 3. Share UserDefaults via App Group "group.com.gofarther.ai"
 * 4. Widget shows: quick chat input, last AI response, or shortcut buttons
 *
 * For now, this module prepares the data layer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Data the widget would display
export interface WidgetData {
  lastMessage: string;
  lastResponse: string;
  aiName: string;
  timestamp: number;
}

export async function updateWidgetData(data: WidgetData) {
  // Store locally — in production, write to shared App Group UserDefaults
  await AsyncStorage.setItem('widget_data', JSON.stringify(data));
}

export async function getWidgetData(): Promise<WidgetData | null> {
  const raw = await AsyncStorage.getItem('widget_data');
  return raw ? JSON.parse(raw) : null;
}

// When a native widget extension is added, this would use:
// import SharedGroupPreferences from 'react-native-shared-group-preferences'
// SharedGroupPreferences.setItem('widgetData', data, 'group.com.gofarther.ai')
