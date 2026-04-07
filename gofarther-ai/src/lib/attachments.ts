/** Photo and file attachment helpers */
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface Attachment {
  uri: string;
  type: 'image' | 'file';
  name: string;
  mimeType?: string;
}

export async function pickCamera(): Promise<Attachment | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') return null;

  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    allowsEditing: true,
    aspect: [4, 3],
  });

  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, type: 'image', name: asset.fileName || 'photo.jpg', mimeType: asset.mimeType };
}

export async function pickPhotos(): Promise<Attachment[]> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    quality: 0.8,
    allowsEditing: false,
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 5,
  });

  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map(asset => ({
    uri: asset.uri, type: 'image' as const, name: asset.fileName || 'photo.jpg', mimeType: asset.mimeType,
  }));
}

export async function pickFile(): Promise<Attachment | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, type: 'file', name: asset.name, mimeType: asset.mimeType };
  } catch { return null; }
}
