import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { C } from '../lib/theme';
import { analyzeImage } from '../lib/ai';

export default function ARScreen({ onClose }: { onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const pic = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      if (pic) {
        setPhoto(pic.uri);
        if (pic.base64) handleAnalyze(pic.base64);
      }
    } catch {}
  };

  const handleAnalyze = async (base64: string) => {
    setLoading(true);
    setAnalysis('');
    try {
      const result = await analyzeImage(base64, 'What is this? Identify everything you see. Be specific and helpful. If it\'s a product, include price estimates. If it\'s food, suggest recipes. If it\'s a place, give interesting facts.');
      setAnalysis(result);
    } catch (e: any) {
      setAnalysis('Error: ' + (e.message || 'Analysis failed'));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setPhoto(null); setAnalysis(''); };

  if (!permission) {
    return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={C.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.permBox}>
          <Text style={s.permTitle}>Camera Access</Text>
          <Text style={s.permSub}>GoFarther AI needs camera access to identify objects</Text>
          <TouchableOpacity style={s.permBtn} onPress={requestPermission}><Text style={s.permBtnText}>Allow Camera</Text></TouchableOpacity>
          <TouchableOpacity onPress={onClose}><Text style={s.closeText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show analysis result
  if (photo) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={reset}><Text style={s.backText}>Back</Text></TouchableOpacity>
          <Text style={s.headerTitle}>AR Identify</Text>
          <TouchableOpacity onPress={onClose}><Text style={s.closeX}>x</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.resultContent}>
          <Image source={{ uri: photo }} style={s.resultImage} resizeMode="cover" />
          {loading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={C.primary} />
              <Text style={s.loadingText}>Analyzing...</Text>
            </View>
          ) : (
            <Text style={s.analysisText} selectable>{analysis}</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // Camera view
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View />
        <Text style={s.headerTitle}>Point at anything</Text>
        <TouchableOpacity onPress={onClose}><Text style={s.closeX}>x</Text></TouchableOpacity>
      </View>
      <CameraView ref={cameraRef} style={s.camera} facing="back">
        <View style={s.cameraOverlay}>
          {/* Crosshair */}
          <View style={s.crosshair}>
            <View style={s.crossH} />
            <View style={s.crossV} />
          </View>
        </View>
      </CameraView>
      <View style={[s.captureBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={s.captureBtn} onPress={takePhoto} activeOpacity={0.8}>
          <View style={s.captureBtnInner} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  backText: { fontSize: 15, color: '#fff', fontWeight: '500' },
  closeX: { fontSize: 20, color: '#fff', fontWeight: '400' },
  closeText: { fontSize: 15, color: '#999', marginTop: 12 },

  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  permSub: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 24 },
  permBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#fff' },
  permBtnText: { fontSize: 15, fontWeight: '600', color: '#000' },

  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  crosshair: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 40, height: 1.5, backgroundColor: '#ffffff80' },
  crossV: { position: 'absolute', width: 1.5, height: 40, backgroundColor: '#ffffff80' },

  captureBar: { alignItems: 'center', paddingTop: 20, backgroundColor: '#000' },
  captureBtn: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  captureBtnInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },

  resultContent: { padding: 16 },
  resultImage: { width: '100%', height: 280, borderRadius: 12, marginBottom: 16 },
  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  loadingText: { fontSize: 15, color: '#999' },
  analysisText: { fontSize: 15, color: '#fff', lineHeight: 24 },
});
