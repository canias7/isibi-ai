/** Memoized chat message bubble — prevents unnecessary re-renders in FlatList */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Image, StyleSheet, Platform, ActionSheetIOS, Alert, Animated, Modal, Dimensions, ActivityIndicator, TextInput } from 'react-native';
import FileViewer from 'react-native-file-viewer';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
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
  onRetry?: (id: string) => void;
  onReaction?: (id: string, reaction: 'up' | 'down' | undefined) => void;
  onOpenCanvas?: (content: string, language?: string) => void;
  onReviseFile?: (originalDescription: string) => void;
  colors: { text: string; textMid: string; textDim: string; bubbleAI: string; bubbleBorder: string };
}

/** Pulsing shimmer text for loading states */
function PulsingText({ text }: { text: string }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.Text style={[s.pulsingText, { opacity: pulse, color: '#999' }]}>{text}</Animated.Text>
  );
}

/** Generated-image thumbnail with tap-to-fullscreen viewer + Save/Share. */
function ChatImage({ uri }: { uri: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);

  const toLocalFile = async (): Promise<string> => {
    if (uri.startsWith('file://')) return uri;
    const path = FileSystem.cacheDirectory + `img_${Date.now()}.png`;
    const dl = await FileSystem.downloadAsync(uri, path);
    return dl.uri;
  };

  const onSave = async () => {
    setBusy('save');
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access to save.'); return; }
      const localUri = await toLocalFile();
      await MediaLibrary.saveToLibraryAsync(localUri);
      successHaptic();
      Alert.alert('Saved', 'Image saved to your photo library.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const onShare = async () => {
    setBusy('share');
    try {
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Not available', 'Sharing is not available on this device.'); return; }
      const localUri = await toLocalFile();
      await Sharing.shareAsync(localUri);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not share');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={0}>
        <Image
          source={{ uri }}
          style={{ width: 240, height: 240, borderRadius: 16, marginTop: 8, backgroundColor: '#eee' }}
          resizeMode="cover"
          onError={(e) => Alert.alert('Image Error', e.nativeEvent?.error || 'Failed to load')}
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={s.viewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <TouchableOpacity onPress={() => setOpen(false)} style={s.viewerClose} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }} accessibilityLabel="Close image" accessibilityRole="button">
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          <Image source={{ uri }} style={s.viewerImage} resizeMode="contain" />
          <View style={s.viewerBtns} pointerEvents="box-none">
            <TouchableOpacity style={s.viewerBtn} activeOpacity={0.7} onPress={onSave} disabled={busy !== null} accessibilityLabel="Save image" accessibilityRole="button">
              {busy === 'save' ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={20} color="#fff" />}
              <Text style={s.viewerBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.viewerBtn} activeOpacity={0.7} onPress={onShare} disabled={busy !== null} accessibilityLabel="Share image" accessibilityRole="button">
              {busy === 'share' ? <ActivityIndicator color="#fff" /> : <Ionicons name="share-outline" size={20} color="#fff" />}
              <Text style={s.viewerBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Format timestamp as "2:30 PM" */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ChatBubble({ item, aiName, isAnimating, onStopAnimating, onConfirm, onCancel, onRegenerate, onEdit, onCopy, onRetry, onReaction, onOpenCanvas, onReviseFile, colors }: Props) {
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
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
        {actionStatus === 'failed' && onRetry && (
          <TouchableOpacity onPress={() => onRetry(item.id)} style={s.retryBtn} activeOpacity={0.7} accessibilityLabel="Retry action" accessibilityRole="button">
            <Ionicons name="refresh-outline" size={13} color={C.red} />
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const isUser = item.role === 'user';

  return (<>
    <TouchableOpacity activeOpacity={0.8} onLongPress={onLongPress} delayLongPress={400} accessibilityLabel={`${isUser ? 'You' : aiName}: ${item.content.slice(0, 50)}`} accessibilityRole="text">
      <View style={[s.msgRow, isUser && s.msgRowUser]}>
        <View style={isUser ? { maxWidth: '82%' } : { flex: 1 }}>
          {item.role === 'assistant' ? (
            <View>
              {item.isCreatingFile && !item.content ? (
                null
              ) : isAnimating ? (
                <TypewriterText text={item.content} speed={25} style={{ fontSize: 17, color: colors.text, lineHeight: 27, letterSpacing: 0.1 }} onDone={onStopAnimating} />
              ) : (
                <MarkdownText colors={colors}>{item.content}</MarkdownText>
              )}
            </View>
          ) : (
            <View style={item.role === 'system' ? s.bubbleSystem : undefined}>
              <Text style={[s.msgText, { color: colors.text }, isUser && s.msgTextUser]} selectable>{item.content}</Text>
            </View>
          )}
          {!isUser && onOpenCanvas && item.content.includes('```') && (
            <TouchableOpacity style={s.canvasBtn} activeOpacity={0.7} onPress={() => {
              const match = item.content.match(/```(\w*)\n([\s\S]*?)```/);
              if (match) onOpenCanvas(match[2].trim(), match[1] || undefined);
              else onOpenCanvas(item.content);
            }}>
              <Ionicons name="code-slash-outline" size={14} color={colors.textMid} />
              <Text style={[s.canvasBtnText, { color: colors.textMid }]}>Open in Canvas</Text>
            </TouchableOpacity>
          )}
          {item.fileUrl && (
            <View style={s.fileBtns}>
              <TouchableOpacity style={s.fileBtn} activeOpacity={0.7} onPress={async () => {
                try {
                  // Strip file:// prefix — FileViewer needs a plain path
                  const path = item.fileUrl!.startsWith('file://') ? item.fileUrl!.replace('file://', '') : item.fileUrl!;
                  await FileViewer.open(path, { showOpenWithDialog: false });
                } catch (e: any) {
                  Alert.alert('Error', e.message || 'Could not open file');
                }
              }}>
                <Ionicons name="eye-outline" size={18} color={colors.text} />
                <Text style={[s.fileBtnText, { color: colors.text }]}>View</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fileBtn} activeOpacity={0.7} onPress={async () => {
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(item.fileUrl!);
                }
              }}>
                <Ionicons name="share-outline" size={18} color={colors.text} />
                <Text style={[s.fileBtnText, { color: colors.text }]}>Share</Text>
              </TouchableOpacity>
              {onReviseFile && (
                <TouchableOpacity style={s.fileBtn} activeOpacity={0.7} onPress={() => {
                  if (Platform.OS === 'ios' && Alert.prompt) {
                    Alert.prompt('Revise File', 'What changes do you want?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Revise', onPress: (text?: string) => { if (text?.trim()) onReviseFile(text.trim()); } },
                    ], 'plain-text');
                  } else {
                    Alert.alert('Revise', 'Type your revision in chat, e.g. "revise the file to add a table"');
                  }
                }}>
                  <Ionicons name="create-outline" size={18} color={colors.text} />
                  <Text style={[s.fileBtnText, { color: colors.text }]}>Revise</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {item.imageUrl ? <ChatImage uri={item.imageUrl} /> : null}
          {renderAction()}
          {item.stats && (
            <Text style={[s.statsText, { color: colors.textDim }]}>
              {item.stats.durationMs >= 1000 ? `${(item.stats.durationMs / 1000).toFixed(1)}s` : `${item.stats.durationMs}ms`}
              {item.stats.tokens > 0 ? ` · \u2193 ${item.stats.tokens >= 1000 ? `${(item.stats.tokens / 1000).toFixed(1)}k` : item.stats.tokens} tokens` : ''}
            </Text>
          )}
          {!isUser && item.content && !isAnimating && onReaction && (
            <View style={s.reactionRow}>
              <TouchableOpacity onPress={() => onReaction(item.id, item.reaction === 'up' ? undefined : 'up')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name={item.reaction === 'up' ? 'thumbs-up' : 'thumbs-up-outline'} size={14} color={item.reaction === 'up' ? '#22c55e' : colors.textDim} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onReaction(item.id, item.reaction === 'down' ? undefined : 'down')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name={item.reaction === 'down' ? 'thumbs-down' : 'thumbs-down-outline'} size={14} color={item.reaction === 'down' ? C.red : colors.textDim} />
              </TouchableOpacity>
            </View>
          )}
          {item.timestamp && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
              {item.queued && <Ionicons name="time-outline" size={10} color={colors.textDim} />}
              <Text style={[s.timestampText, { color: colors.textDim }]}>{item.queued ? 'Queued' : formatTime(item.timestamp)}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  </>);
}

export default React.memo(ChatBubble);

const s = StyleSheet.create({
  msgRow: { marginBottom: 20, flexDirection: 'row', alignItems: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  bubbleSystem: { backgroundColor: '#fef2f2', borderRadius: 14, borderWidth: 1, borderColor: '#fecaca', paddingHorizontal: 14, paddingVertical: 10 },
  msgText: { fontSize: 17, lineHeight: 27, letterSpacing: 0.1 },
  msgTextUser: {},
  pulsingText: { fontSize: 17, fontWeight: '500', lineHeight: 27 },
  statsText: { fontSize: 11, marginTop: 6 },
  canvasBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#f0f0f0', alignSelf: 'flex-start' },
  canvasBtnText: { fontSize: 12, fontWeight: '500' },
  fileBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  fileBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f0f0f0' },
  fileBtnText: { fontSize: 14, fontWeight: '600' },
  fileViewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0' },
  fileViewerTitle: { fontSize: 16, fontWeight: '600', flex: 1 },
  fileViewerClose: { fontSize: 17, fontWeight: '600', color: '#007AFF', marginLeft: 16 },
  chatImage: { width: 240, height: 240, borderRadius: 16, marginTop: 8 },
  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 28, left: 18, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.75 },
  viewerBtns: { position: 'absolute', bottom: Platform.OS === 'ios' ? 54 : 36, flexDirection: 'row', gap: 14 },
  viewerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)' },
  viewerBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  imageBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  imageBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f0f0f0' },
  imageBtnText: { fontSize: 13, fontWeight: '600' },
  imgvOverlay: { flex: 1, backgroundColor: '#000' },
  imgvTopBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 12 },
  imgvTopBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  imgvPillBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)' },
  imgvPillWhite: { backgroundColor: '#fff' },
  imgvPillText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  imgvCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  imgvImage: { width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.65 },
  imgvBottomBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24, paddingTop: 12 },
  imgvEditIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  imgvEditInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 12, color: '#fff', fontSize: 15 },
  imgvMicBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
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
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#fef2f2' },
  retryText: { fontSize: 11, fontWeight: '600', color: '#ef4444' },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  timestampText: { fontSize: 10 },
});
