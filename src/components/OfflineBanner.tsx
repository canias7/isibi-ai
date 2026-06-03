import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });
    return () => unsub();
  }, []);

  if (!isOffline) return null;

  return (
    <View style={s.banner}>
      <Text style={s.text}>No internet connection</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
