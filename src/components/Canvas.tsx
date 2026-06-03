/** Canvas — editable code/document viewer modal */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, SafeAreaView, TextInput, ScrollView, Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

interface CanvasProps {
  visible: boolean;
  content: string;
  title?: string;
  language?: string;
  onClose: () => void;
  onSendToAI?: (instruction: string, content: string) => void;
}

export default function Canvas({ visible, content, title, language, onClose, onSendToAI }: CanvasProps) {
  const [editedContent, setEditedContent] = useState(content);
  const [showRevise, setShowRevise] = useState(false);
  const [reviseText, setReviseText] = useState('');

  // Reset content when new content comes in
  React.useEffect(() => { setEditedContent(content); }, [content]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(editedContent);
    Alert.alert('Copied', 'Content copied to clipboard');
  };

  const handleShare = async () => {
    await Share.share({ message: editedContent, title: title || 'Canvas' });
  };

  const handleRevise = () => {
    if (!reviseText.trim() || !onSendToAI) return;
    onSendToAI(reviseText.trim(), editedContent);
    setReviseText('');
    setShowRevise(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{title || 'Canvas'}</Text>
            {language && <Text style={s.lang}>{language}</Text>}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={handleCopy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="copy-outline" size={20} color="#666" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="share-outline" size={20} color="#666" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <Text style={s.closeBtn}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <TextInput
            style={s.editor}
            value={editedContent}
            onChangeText={setEditedContent}
            multiline
            textAlignVertical="top"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
          />
        </ScrollView>

        {/* Revise bar */}
        <View style={s.footer}>
          {showRevise ? (
            <View style={s.reviseRow}>
              <TextInput
                style={s.reviseInput}
                value={reviseText}
                onChangeText={setReviseText}
                placeholder="e.g. Add error handling..."
                placeholderTextColor="#bbb"
                autoFocus
                returnKeyType="send"
                onSubmitEditing={handleRevise}
              />
              <TouchableOpacity onPress={handleRevise} style={s.reviseBtn}>
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setShowRevise(true)} style={s.reviseToggle}>
              <Ionicons name="create-outline" size={16} color="#666" />
              <Text style={s.reviseToggleText}>Ask AI to revise</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1e1e1e' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333', backgroundColor: '#252525' },
  title: { fontSize: 16, fontWeight: '600', color: '#fff' },
  lang: { fontSize: 11, color: '#888', marginTop: 2 },
  closeBtn: { fontSize: 16, fontWeight: '600', color: '#007AFF' },
  editor: { fontFamily: 'Courier', fontSize: 14, color: '#d4d4d4', padding: 16, lineHeight: 22, minHeight: 300 },
  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333', backgroundColor: '#252525' },
  reviseToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  reviseToggleText: { fontSize: 14, color: '#888' },
  reviseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviseInput: { flex: 1, backgroundColor: '#333', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#fff' },
  reviseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
});
