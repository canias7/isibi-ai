/** Memoized chat message bubble — prevents unnecessary re-renders in FlatList */

import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Platform, ActionSheetIOS, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { ChatMsg } from '../lib/types';
import { successHaptic } from '../lib/haptics';
import { C } from '../lib/theme';
import MarkdownText from './MarkdownText';
import TypewriterText from './TypewriterText';

interface Props {
  item: ChatMsg;
  aiName: string;
  isAnimating: boolean;
  onStopAnimating: () => void;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onRegenerate: () => void;
  onEdit: (id: string) => void;
  onCopy: (text: string) => void;
  colors: { text: string; textMid: string; textDim: string; bubbleAI: string; bubbleBorder: string };
}

function ChatBubble({ item, aiName, isAnimating, onStopAnimating, onConfirm, onCancel, onRegenerate, onEdit, onCopy, colors }: Props) {
  const onLongPress = () => {
    if (Platform.OS === 'ios') {
      const options = ['Copy', item.role === 'user' ? 'Edit' : 'Regenerate', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2 }, (idx) => {
        if (idx === 0) onCopy(item.content);
        if (idx === 1) item.role === 'user' ? onEdit(item.id) : onRegenerate();
      });
    } else {
      Alert.alert('Message', '', [
        { text: 'Copy', onPress: () => onCopy(item.content) },
        { text: item.role === 'user' ? 'Edit' : 'Regenerate', onPress: () => item.role === 'user' ? onEdit(item.id) : onRegenerate() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const renderAction = () => {
    if (!item.action) return null;
    const { action, actionStatus } = item;
    if (actionStatus === 'confirm') {
      return (
        <View style={s.actionConfirm}>
          <Text style={[s.actionConfirmText, { color: colors.text }]}>{action.type} {action.target || ''}</Text>
          <View style={s.actionConfirmBtns}>
            <TouchableOpacity style={s.confirmYes} onPress={() => onConfirm(item.id)} accessibilityLabel="Proceed" accessibilityRole="button"><Text style={s.confirmYesText}>Proceed</Text></TouchableOpacity>
            <TouchableOpacity style={s.confirmNo} onPress={() => onCancel(item.id)} accessibilityLabel="Cancel action" accessibilityRole="button"><Text style={[s.confirmNoText, { color: colors.textMid }]}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      );
    }
    const color = actionStatus === 'done' ? C.green : actionStatus === 'failed' ? C.red : actionStatus === 'cancelled' ? colors.textDim : C.amber;
    const label = actionStatus === 'done' ? 'Done' : actionStatus === 'failed' ? 'Failed' : actionStatus === 'cancelled' ? 'Cancelled' : 'Pending';
    const icon = actionStatus === 'done' ? 'checkmark-circle' : actionStatus === 'failed' ? 'close-circle' : actionStatus === 'cancelled' ? 'ban' : 'time';
    return (
      <View style={[s.actionCard, { backgroundColor: color + '10', borderColor: color + '25' }]}>
        <Ionicons name={icon as any} size={16} color={color} />
        <Text style={[s.actionLabel, { color: colors.text }]} numberOfLines={1}>{action.type} {action.target || ''}</Text>
        <Text style={[s.actionStatus, { color }]}>{label}</Text>
      </View>
    );
  };

  const isUser = item.role === 'user';

  return (
    <TouchableOpacity activeOpacity={0.8} onLongPress={onLongPress} delayLongPress={400} accessibilityLabel={`${isUser ? 'You' : aiName}: ${item.content.slice(0, 50)}`} accessibilityRole="text">
      <View style={[s.msgRow, isUser && s.msgRowUser]}>
        <View style={isUser ? { maxWidth: '82%' } : { flex: 1 }}>
          {item.role === 'assistant' ? (
            <View>
              {isAnimating ? (
                <TypewriterText text={item.content} speed={25} style={{ fontSize: 17, color: '#1f2937', lineHeight: 27, letterSpacing: 0.1 }} onDone={onStopAnimating} />
              ) : (
                <MarkdownText colors={colors}>{item.content}</MarkdownText>
              )}
            </View>
          ) : (
            <View style={item.role === 'system' ? s.bubbleSystem : undefined}>
              <Text style={[s.msgText, isUser && s.msgTextUser]} selectable>{item.content}</Text>
            </View>
          )}
          {item.imageUrl && <Image source={{ uri: item.imageUrl }} style={[s.chatImage, isUser && { alignSelf: 'flex-end' }]} resizeMode="cover" />}
          {renderAction()}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(ChatBubble);

const s = StyleSheet.create({
  msgRow: { marginBottom: 20, flexDirection: 'row', alignItems: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  bubbleSystem: { backgroundColor: '#fef2f2', borderRadius: 14, borderWidth: 1, borderColor: '#fecaca', paddingHorizontal: 14, paddingVertical: 10 },
  msgText: { fontSize: 17, lineHeight: 27, color: '#1f2937', letterSpacing: 0.1 },
  msgTextUser: { color: '#111827' },
  chatImage: { width: 240, height: 240, borderRadius: 16, marginTop: 8 },
  actionConfirm: { marginTop: 10, padding: 14, borderRadius: 16, backgroundColor: '#f5f5f5' },
  actionConfirmText: { fontSize: 14, fontWeight: '500', marginBottom: 10 },
  actionConfirmBtns: { flexDirection: 'row', gap: 10 },
  confirmYes: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: '#1a1a1a' },
  confirmYesText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  confirmNo: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: '#ddd' },
  confirmNoText: { fontSize: 14, fontWeight: '500' },
  actionCard: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionLabel: { flex: 1, fontSize: 13, fontWeight: '500' },
  actionStatus: { fontSize: 12, fontWeight: '600' },
});
