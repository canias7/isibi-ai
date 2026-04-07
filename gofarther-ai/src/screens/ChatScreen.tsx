import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Animated,
  TouchableWithoutFeedback, Dimensions, Alert, Share, ScrollView,
  ActionSheetIOS, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { C } from '../lib/theme';
import { tapHaptic, successHaptic } from '../lib/haptics';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentLocation } from '../lib/location';
import { pickCamera, pickPhotos, pickFile, Attachment } from '../lib/attachments';
import ChatBubble from '../components/ChatBubble';
import { analyzeImage } from '../lib/ai';
import { exportChatAsPDF, copyAllChat, exportChatAsMarkdown } from '../lib/chatExport';
import * as FileSystem from 'expo-file-system/legacy';
import { ChatMsg, genId } from '../lib/types';
import { useChat } from '../lib/useChat';
import {
  getAgents, Agent, getAIName, getUserNickname,
  getChatSessions, saveChatSessions, ChatSession,
  getMemory, getCustomInstructions, getLanguage, getSavedContacts, trackEvent,
} from '../lib/storage';
import { HamburgerButton } from '../components/Drawer';
import VoicePicker, { VoiceOption, VOICES } from '../components/VoicePicker';
import VoiceChat from '../components/VoiceChat';
import ARScreen from './ARScreen';

const { height: SH } = Dimensions.get('window');

const DEFAULT_SYSTEM_PROMPT = `You are GoFarther AI. Talk like a real person — casual, warm, natural. Keep it short.
If someone says hey, just say hey back. Don't list capabilities unless asked.`;

const MENU_ACTIONS: { key: string; label: string; sub: string; prompt: string; icon: string }[] = [
  { key: 'call', label: 'Make a call', sub: 'Call any number', prompt: 'Call ', icon: 'call-outline' },
  { key: 'sms', label: 'Send a text', sub: 'Message someone', prompt: 'Text ', icon: 'chatbubble-outline' },
  { key: 'email', label: 'Send email', sub: 'Compose and send', prompt: 'Send an email to ', icon: 'mail-outline' },
  { key: 'directions', label: 'Get directions', sub: 'Navigate anywhere', prompt: 'Get directions to ', icon: 'navigate-outline' },
  { key: 'search', label: 'Web search', sub: 'Search the web in-app', prompt: 'Search the web for ', icon: 'search-outline' },
  { key: 'readurl', label: 'Read a webpage', sub: 'Summarize any URL', prompt: 'Read and summarize this URL: ', icon: 'globe-outline' },
  { key: 'image', label: 'Create image', sub: 'Generate with DALL-E', prompt: 'Create an image of ', icon: 'image-outline' },
  { key: 'file', label: 'Create file', sub: 'PDF, Excel, Word, CSV', prompt: 'Create a PDF file about ', icon: 'document-outline' },
  { key: 'code', label: 'Run code', sub: 'Execute Python', prompt: 'Write and run Python code to ', icon: 'code-slash-outline' },
  { key: 'translate', label: 'Translate', sub: 'Any language', prompt: 'Translate to Spanish: ', icon: 'language-outline' },
  { key: 'weather', label: 'Weather', sub: 'Full forecast', prompt: 'What\'s the weather in ', icon: 'cloud-outline' },
  { key: 'nearby', label: 'What\'s near me', sub: 'Uses your GPS', prompt: '__LOCATION__', icon: 'location-outline' },
  { key: 'ar', label: 'AR Identify', sub: 'Point camera at anything', prompt: '__AR__', icon: 'scan-outline' },
];

interface ChatScreenProps {
  onOpenDrawer: () => void;
  sessionId: string | null;
  onSessionCreated: (session: ChatSession) => void;
}

export default function ChatScreen({ onOpenDrawer, sessionId, onSessionCreated }: ChatScreenProps) {
  const { colors: tc } = useTheme();
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [voiceMode, setVoiceMode] = useState<'off' | 'picker' | 'active'>('off');
  const [showAR, setShowAR] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>(VOICES[0]);
  const [aiName] = useState('GoFarther');
  const [userNickname, setUserNickname] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const flatList = useRef<FlatList>(null);

  // Use shared chat hook
  const [pendingAttachment, setPendingAttachment] = useState<{ base64: string; mimeType: string; name: string; uri: string; previewUri?: string } | null>(null);

  const {
    messages, setMessages, loading, setLoading, editingMsgId, setEditingMsgId, animatingIds, isCreating, removeAnimatingId,
    messagesRef, currentSessionId, send: chatSend, confirmAction, cancelAction, cancelCreation, regenerate, editMessage, submitEdit,
  } = useChat({
    sessionId,
    systemPrompt,
    onSessionCreated: (id, title) => {
      const session: ChatSession = { id, title, createdAt: Date.now(), agentId: null };
      getChatSessions().then(existing => saveChatSessions([session, ...existing]));
      onSessionCreated(session);
    },
  });
  const insets = useSafeAreaInsets();
  const menuSlide = useRef(new Animated.Value(SH)).current;
  const menuBackdrop = useRef(new Animated.Value(0)).current;

  // Typing indicator dots
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      const anim = Animated.loop(Animated.stagger(200, [
        Animated.sequence([Animated.timing(dot1, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.timing(dot1, { toValue: 0, duration: 300, useNativeDriver: true })]),
        Animated.sequence([Animated.timing(dot2, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.timing(dot2, { toValue: 0, duration: 300, useNativeDriver: true })]),
        Animated.sequence([Animated.timing(dot3, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.timing(dot3, { toValue: 0, duration: 300, useNativeDriver: true })]),
      ]));
      anim.start();
      return () => anim.stop();
    }
  }, [loading]);

  // Load agents and AI name, build system prompt
  useEffect(() => {
    getAgents().then(a => {
      setAgents(a);
      if (a.length > 0) setActiveAgent(a.find(x => x.isActive) || a[0]);
    });
    getUserNickname().then(n => setUserNickname(n || ''));
    // Build system prompt with memory, instructions, language
    Promise.all([getMemory(), getCustomInstructions(), getLanguage(), getUserNickname(), getSavedContacts()]).then(([memory, custom, lang, nick, savedContacts]) => {
      setUserNickname(nick || '');
      const langMap: Record<string, string> = { en: '', es: '\n\nIMPORTANT: Always respond in Spanish.', fr: '\n\nIMPORTANT: Always respond in French.', pt: '\n\nIMPORTANT: Always respond in Portuguese.', de: '\n\nIMPORTANT: Always respond in German.' };
      const memoryStr = memory.length > 0 ? '\n\nYou remember these facts about the user:\n' + memory.map((m: any) => '- ' + m.fact).join('\n') : '';
      const customStr = custom ? '\n\nCustom instructions from user: ' + custom : '';
      const base = `You are GoFarther AI, a mobile AI assistant with personality. Talk like a real person — casual, warm, witty, and natural.

PERSONALITY:
- You're clever and a little funny. Drop in humor naturally — a witty one-liner, a playful comment, light sarcasm. Never forced, never cringe.
- You have opinions. If someone asks "what should I eat?" don't just list options — pick one and sell it.
- You're like that smart friend who always has a good answer AND makes you laugh.
- Throw in the occasional emoji but don't overdo it. One per message max, and only when it fits.
- If the user is venting or stressed, be supportive first, funny second.
- Reference pop culture, memes, or relatable stuff when it fits naturally.

CONVERSATION STYLE:
- Be conversational. If someone says "hey" or "hi", just say hey back casually. Do NOT list your capabilities unless asked.
- Keep responses SHORT. 1-3 sentences for casual chat. Only go longer when the user asks a real question.
- Never start with "I'm GoFarther AI" or introduce yourself unless the user asks who you are.
- Don't be robotic. No bullet-point lists of what you can do. Just chat naturally.
- Match the user's energy — if they're casual, be casual. If they're formal, be professional.
- Use contractions (I'm, don't, can't). Sound human.
- When the user needs something done, just do it. Don't over-explain.
- NEVER say you cannot do something if a tool exists for it.

IMPORTANT: The personality is ONLY for casual conversation. When creating files, running code, searching, or using any tool — be professional and accurate. Don't joke around in documents or tool outputs.`;
      const actions = `\n\nYou HAVE the following tools. When the user asks you to do something, ALWAYS use the appropriate tool by including its JSON in your response. NEVER say "I can't do that" if a matching tool exists.

DEVICE ACTIONS:
{"type":"call","target":"contact name or number"}
{"type":"sms","target":"contact name or number","text":"message"}
{"type":"email","target":"email","key":"subject","text":"body"}
{"type":"open_url","target":"url"}
{"type":"maps","target":"query"}

FILE CREATION (you CAN create files — the server generates them):
{"type":"create_file","target":"brief description of content","text":"pdf"}
The "text" field is the file type: pdf, xlsx, docx, csv, or txt.
Do NOT put actual file content in the JSON. Just describe what the file should contain. The server creates it.
Example: User says "create a PDF about marketing" → {"type":"create_file","target":"comprehensive marketing strategies guide","text":"pdf"}

ACCOUNTING TEMPLATES (use create_file with xlsx):
- P&L / Income Statement: {"type":"create_file","target":"profit and loss statement for Q1 2024 with revenue, COGS, expenses","text":"xlsx"}
- Balance Sheet: {"type":"create_file","target":"balance sheet with assets, liabilities, equity","text":"xlsx"}
- Expense Report: {"type":"create_file","target":"monthly expense report with categories","text":"xlsx"}
- Tax Summary: {"type":"create_file","target":"tax deductible expenses summary","text":"xlsx"}
All Excel files include real formulas (SUM, AVERAGE, etc.), not static values.

OTHER TOOLS:
{"type":"remember","target":"fact to remember"}
{"type":"generate_image","target":"image description"}
{"type":"web_search","target":"search query"}
{"type":"read_url","target":"https://url","text":"question about the page"}
{"type":"run_code","target":"what to compute/calculate"}
{"type":"translate","target":"text to translate","text":"target language"}
{"type":"youtube_summary","target":"youtube URL"}
{"type":"research","target":"topic","text":"general/academic/patent/legal"}
{"type":"generate_qr","target":"URL or text for QR code"}
{"type":"create_event","target":"event title","text":"YYYY-MM-DD"}
{"type":"create_invoice","target":"client name","text":"items and amounts"}
{"type":"crypto_portfolio","target":"BTC,ETH,SOL"}
{"type":"social_post","target":"post content","text":"twitter/instagram/linkedin"}
{"type":"compare_urls","target":"url1,url2","text":"comparison question"}
{"type":"create_meme","target":"top text","text":"bottom text"}
{"type":"barcode_lookup","target":"barcode number"}
{"type":"save_contact","target":"label (e.g. My boss)","text":"name","key":"email or phone"}
{"type":"modify_file","target":"edit|chart|convert|merge|filter","text":"instructions","key":"target_format (for convert)"}

FILE MODIFICATION (when user has uploaded a file and wants changes):
- "edit": modify content (add rows, change text, update data, ADD FORMULAS like =SUM, =AVERAGE)
- "chart": create a visualization from data (bar chart, pie chart, line chart, etc.)
- "convert": change format (Excel to PDF, CSV to Excel, etc.)
- "merge": combine multiple files into one
- "filter": extract specific rows/data matching criteria
- "compare": compare two spreadsheets and generate a diff report
- "reconcile": bank reconciliation — match bank statement vs book records, flag unmatched transactions. Returns styled Excel with Summary, Matched (green), Bank Only (red), Books Only (orange) sheets

RULES:
- Include ONE action JSON per response.
- Before device actions (call, sms, email), confirm with user first.
- For file creation (PDF, resume, report), ask 2-3 quick questions first to get details. Don't create blindly.
- For file modification, just do it — the user already uploaded the file and told you what to change.
- For web search, code, translate, weather: just do it immediately, no need to ask.
- NEVER say you cannot do something. Use your tools.
- When user says a person's name, use it directly as target.
- Be conversational. Short responses. No essays unless asked.`;
      const contactsStr = savedContacts.length > 0 ? '\n\nThe user has saved these contacts. When they refer to someone by label (e.g. "my boss"), use the matching contact info:\n' + savedContacts.map((c: any) => `- ${c.label} = ${c.name}${c.email ? ` (${c.email})` : ''}${c.phone ? ` (${c.phone})` : ''}`).join('\n') : '';
      const nicknameStr = nick ? `\n\nIMPORTANT: The user's name/nickname is "${nick}". Use it naturally — greet them by name, refer to them by name occasionally. For example: "Hey ${nick}!", "Sure thing ${nick}", etc.` : '';
      setSystemPrompt(base + actions + contactsStr + memoryStr + customStr + nicknameStr + (langMap[lang] || ''));
    });
  }, []);

  const openMenu = () => {
    Keyboard.dismiss();
    setShowMenu(true);
    Animated.parallel([
      Animated.spring(menuSlide, { toValue: 0, useNativeDriver: true, tension: 60, friction: 12 }),
      Animated.timing(menuBackdrop, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(menuSlide, { toValue: SH, duration: 200, useNativeDriver: true }),
      Animated.timing(menuBackdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowMenu(false));
  };

  const selectAction = async (prompt: string) => {
    closeMenu(); tapHaptic();
    if (prompt === '__AR__') { setShowAR(true); return; }
    if (prompt === '__LOCATION__') {
      const loc = await getCurrentLocation();
      if (loc) { chatSend('What\'s near me? My location is: ' + loc.address); }
      else { Alert.alert('Location', 'Could not get your location. Check permissions.'); }
      return;
    }
    setTimeout(() => setInput(prompt), 250);
  };

  // Wrapper to send from input — includes pending attachment if any
  const send = (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text && !pendingAttachment) return;
    if (!overrideText) setInput('');
    if (pendingAttachment) {
      if (pendingAttachment.mimeType.startsWith('image/')) {
        handleImageAttach(pendingAttachment.uri);
      } else {
        chatSend(text || `Analyze this file: ${pendingAttachment.name}`, undefined, undefined, pendingAttachment);
      }
      setPendingAttachment(null);
    } else {
      chatSend(text);
    }
  };

  // Edit message — set input to old text
  const handleEditMessage = (msgId: string) => {
    const oldText = editMessage(msgId);
    if (oldText) setInput(oldText);
  };

  // Submit edit — send the edited text
  const handleSubmitEdit = () => {
    if (!editingMsgId || !input.trim()) return;
    submitEdit(input.trim());
    setInput('');
  };

  // Copy message
  const copyMessage = (content: string) => {
    Clipboard.setStringAsync(content);
    successHaptic();
    trackEvent('copy_message');
  };

  // Handle image attachment(s) — show preview first, then send to Claude Vision
  const handleImageAttach = async (uris: string | string[]) => {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const label = uriList.length === 1 ? '' : `${uriList.length} images`;
    const userMsg: ChatMsg = { id: genId(), role: 'user', content: label, imageUrl: uriList[0] };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    const aiMsgId = genId();
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '' }]);

    try {
      // For single image, use vision endpoint; for multiple, combine base64s
      if (uriList.length === 1) {
        const base64 = await FileSystem.readAsStringAsync(uriList[0], { encoding: FileSystem.EncodingType.Base64 });
        const analysis = await analyzeImage(base64, 'What do you see in this image? Be specific and helpful.');
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: analysis } : m));
      } else {
        // Multiple images — build content array and send through chat
        const contentBlocks: any[] = [];
        for (const uri of uriList) {
          const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
        }
        contentBlocks.push({ type: 'text', text: 'Analyze all of these images. Describe what you see in each one.' });
        const { chat: chatDirect } = await import('../lib/ai');
        const history = messagesRef.current.slice(-10).map(m => ({ role: m.role === 'system' ? 'assistant' as const : m.role, content: m.content }));
        history.push({ role: 'user', content: contentBlocks });
        const result = await chatDirect(history, systemPrompt);
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: result } : m));
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: 'Could not analyze image: ' + (e.message || 'Error') } : m));
    } finally {
      setLoading(false);
    }
  };

  // Share chat
  const shareChat = () => {
    if (!currentSessionId.current || messages.length === 0) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Share as Text', 'Export as PDF', 'Copy All', 'Export as Markdown', 'Cancel'], cancelButtonIndex: 4 }, async (idx) => {
        if (idx === 0) {
          const text = messages.map(m => `${m.role === 'user' ? 'You' : aiName}: ${m.content}`).join('\n\n');
          Share.share({ message: text, title: 'GoFarther AI Chat' });
        }
        if (idx === 1) await exportChatAsPDF(currentSessionId.current!, aiName);
        if (idx === 2) { await copyAllChat(currentSessionId.current!, aiName); Alert.alert('Copied', 'Chat copied to clipboard'); }
        if (idx === 3) { const md = await exportChatAsMarkdown(currentSessionId.current!, aiName); Share.share({ message: md, title: 'GoFarther AI Chat' }); }
        trackEvent('share_chat');
      });
    } else {
      const text = messages.map(m => `${m.role === 'user' ? 'You' : aiName}: ${m.content}`).join('\n\n');
      Share.share({ message: text, title: 'GoFarther AI Chat' });
      trackEvent('share_chat');
    }
  };

  // Suggestions based on context
  const getSuggestions = () => {
    if (messages.length === 0) return [
      { label: 'Send a text', icon: 'chatbubble-outline' },
      { label: 'Call someone', icon: 'call-outline' },
      { label: 'Check weather', icon: 'cloud-outline' },
      { label: 'Get directions', icon: 'navigate-outline' },
    ];
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.actionStatus === 'done') {
      return [
        { label: 'What else?', icon: 'add-outline' },
        { label: 'Thanks!', icon: 'thumbs-up-outline' },
      ];
    }
    return [];
  };

  const bubbleColors = useMemo(() => ({
    text: tc.text, textMid: tc.textMid, textDim: tc.textDim, bubbleAI: tc.bubbleAI, bubbleBorder: tc.bubbleBorder,
  }), [tc.text, tc.textMid, tc.textDim, tc.bubbleAI, tc.bubbleBorder]);

  const renderMessage = React.useCallback(({ item }: { item: ChatMsg }) => (
    <ChatBubble
      item={item}
      aiName={aiName}
      isAnimating={animatingIds.has(item.id)}
      onStopAnimating={() => removeAnimatingId(item.id)}
      onConfirm={confirmAction}
      onCancel={cancelAction}
      onRegenerate={regenerate}
      onEdit={handleEditMessage}
      onCopy={copyMessage}
      colors={bubbleColors}
    />
  ), [aiName, animatingIds, bubbleColors, confirmAction, cancelAction, regenerate, handleEditMessage, copyMessage, removeAnimatingId]);

  // Voice mode
  if (showAR) return <ARScreen onClose={() => setShowAR(false)} />;
  if (voiceMode !== 'off') return <VoiceChat voice={selectedVoice} onClose={() => setVoiceMode('off')} agentName={aiName} />;

  const suggestions = getSuggestions();

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: insets.top, backgroundColor: tc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={s.topBar}>
        <HamburgerButton onPress={onOpenDrawer} color={tc.text} />
        <Text style={[s.headerTitle, { color: tc.text }]}>{aiName}</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={shareChat} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Share chat" accessibilityRole="button" style={s.headerBtn}>
            <Ionicons name="share-outline" size={20} color={tc.textMid} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages or empty */}
      {messages.length === 0 ? (
        <View style={s.empty} />
      ) : (
        <>
          <FlatList
            ref={flatList}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={item => item.id}
            contentContainerStyle={s.list}
            onContentSizeChange={() => flatList.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />
          {/* Typing indicator */}
          {loading && (
            <View style={s.typingRow}>
              <View style={s.typingBubble}>
                {[dot1, dot2, dot3].map((d, i) => (
                  <Animated.View key={i} style={[s.typingDot, { opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]} />
                ))}
              </View>
            </View>
          )}
          {/* Smart suggestions after response */}
          {suggestions.length > 0 && !loading && (
            <View style={s.suggestRow}>
              {suggestions.map(s2 => (
                <TouchableOpacity key={s2.label} style={[s.suggestChip, { borderColor: tc.border }]} onPress={() => send(s2.label)} activeOpacity={0.7}>
                  <Text style={[s.suggestText, { color: tc.text }]}>{s2.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {/* Input bar */}
      <View style={[s.inputBarOuter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {/* Pending attachment preview */}
        {pendingAttachment && (
          <View style={s.attachPreview}>
            {pendingAttachment.previewUri ? (
              <Image source={{ uri: pendingAttachment.previewUri }} style={s.attachThumb} />
            ) : (
              <View style={s.attachFileIcon}>
                <Ionicons name="document-outline" size={18} color="#666" />
              </View>
            )}
            <Text style={s.attachName} numberOfLines={1}>{pendingAttachment.name}</Text>
            <TouchableOpacity onPress={() => setPendingAttachment(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          </View>
        )}
        <View style={s.inputRow}>
          <TouchableOpacity onPress={openMenu} activeOpacity={0.6} accessibilityLabel="Actions menu" accessibilityRole="button">
            <View style={s.plusCircle}>
              <Ionicons name="add" size={20} color="#1a1a1a" />
            </View>
          </TouchableOpacity>
          <View style={[s.inputBar, { backgroundColor: tc.inputBg || '#efefef' }]}>
            <TextInput style={[s.input, { color: tc.text }]} value={input} onChangeText={setInput}
              placeholder={editingMsgId ? 'Edit your message...' : messages.length === 0 ? 'How can I help you today?' : 'Reply...'}
              placeholderTextColor={tc.textDim} multiline maxLength={2000}
              onSubmitEditing={() => editingMsgId ? handleSubmitEdit() : send()} blurOnSubmit={false} />
            {isCreating && !input.trim() ? (
              <TouchableOpacity style={s.inputIconBtn} onPress={cancelCreation} activeOpacity={0.7}>
                <View style={s.stopBtn}>
                  <View style={s.stopSquare} />
                </View>
              </TouchableOpacity>
            ) : input.trim() ? (
              <TouchableOpacity style={s.inputIconBtn}
                onPress={() => editingMsgId ? handleSubmitEdit() : send()} disabled={loading} activeOpacity={0.7}>
                <View style={[s.sendBtn, loading && s.sendBtnOff]}>
                  {loading ? <ActivityIndicator color="white" size="small" /> : (
                    <Ionicons name="arrow-up" size={18} color="#ffffff" />
                  )}
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.micInsideBtn} activeOpacity={0.6}>
                <Ionicons name="mic-outline" size={20} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={() => setVoiceMode('picker')} activeOpacity={0.6} accessibilityLabel="Voice mode" accessibilityRole="button">
            <View style={s.voiceBtn}>
              <View style={s.waveformContainer}>
                <View style={[s.waveBar, { height: 8 }]} />
                <View style={[s.waveBar, { height: 14 }]} />
                <View style={[s.waveBar, { height: 10 }]} />
                <View style={[s.waveBar, { height: 16 }]} />
                <View style={[s.waveBar, { height: 6 }]} />
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action menu */}
      {showMenu && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableWithoutFeedback onPress={closeMenu}>
            <Animated.View style={[s.menuBackdrop, { opacity: menuBackdrop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[s.menuSheet, { transform: [{ translateY: menuSlide }], paddingBottom: insets.bottom + 20, backgroundColor: tc.bg }]}>
            <View style={s.menuHandle} />
            <Text style={[s.menuTitle, { color: tc.text }]}>Actions</Text>
            <View style={[s.attachRow, { borderColor: tc.border }]}>
              {[
                { label: 'Camera', icon: 'camera-outline', onPress: async () => {
                  closeMenu(); tapHaptic();
                  const a = await pickCamera();
                  if (!a) return;
                  const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
                  setPendingAttachment({ base64, mimeType: a.mimeType || 'image/jpeg', name: a.name, uri: a.uri, previewUri: a.uri });
                } },
                { label: 'Photos', icon: 'images-outline', onPress: async () => {
                  closeMenu(); tapHaptic();
                  const a = await pickPhotos();
                  if (!a.length) return;
                  const first = a[0];
                  const base64 = await FileSystem.readAsStringAsync(first.uri, { encoding: FileSystem.EncodingType.Base64 });
                  setPendingAttachment({ base64, mimeType: first.mimeType || 'image/jpeg', name: first.name, uri: first.uri, previewUri: first.uri });
                } },
                { label: 'Files', icon: 'folder-outline', onPress: async () => {
                  closeMenu(); tapHaptic();
                  const a = await pickFile();
                  if (!a) return;
                  try {
                    const ext = a.name.split('.').pop()?.toLowerCase() || '';
                    const mimeMap: Record<string, string> = {
                      pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      doc: 'application/msword', csv: 'text/csv', txt: 'text/plain',
                      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
                      mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
                      json: 'application/json', xml: 'application/xml', html: 'text/html', js: 'text/plain',
                      ts: 'text/plain', py: 'text/plain', md: 'text/plain', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    };
                    const mimeType = a.mimeType || mimeMap[ext] || 'text/plain';
                    const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
                    setPendingAttachment({ base64, mimeType, name: a.name, uri: a.uri, previewUri: mimeType.startsWith('image/') ? a.uri : undefined });
                  } catch (e: any) {
                    Alert.alert('Error', 'Could not read file: ' + (e.message || 'Unknown error'));
                  }
                } },
              ].map(att => (
                <TouchableOpacity key={att.label} style={[s.attachPill, { backgroundColor: tc.surface || tc.card }]} activeOpacity={0.7} onPress={att.onPress}>
                  <Ionicons name={att.icon as any} size={22} color={tc.text} />
                  <Text style={[s.attachLabel, { color: tc.textMid }]}>{att.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: SH * 0.4 }}>
              {MENU_ACTIONS.map(item => (
                <TouchableOpacity key={item.key} style={s.menuItem} onPress={() => selectAction(item.prompt)} activeOpacity={0.6}>
                  <View style={[s.menuItemIcon, { backgroundColor: (tc.surface || tc.card) }]}>
                    <Ionicons name={item.icon as any} size={18} color={tc.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.menuItemLabel, { color: tc.text }]}>{item.label}</Text>
                    <Text style={[s.menuItemSub, { color: tc.textDim }]}>{item.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={tc.textDim} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  // Header
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', gap: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  // Messages
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },

  // Empty state
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyInner: { alignItems: 'center', width: '100%' },
  emptyTitle: { fontSize: 26, fontWeight: '700', marginBottom: 32, letterSpacing: -0.5 },
  suggestionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', width: '100%' },
  suggestionCard: { width: '47%', paddingVertical: 20, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1 },
  suggestionLabel: { fontSize: 14, fontWeight: '500' },

  // Typing indicator
  typingRow: { paddingHorizontal: 16, paddingBottom: 8 },
  typingBubble: { flexDirection: 'row', gap: 5, paddingVertical: 8 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#aaa' },

  // Smart suggestions
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  suggestChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  suggestText: { fontSize: 14, fontWeight: '500' },

  // Input bar
  attachPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, marginBottom: 4, backgroundColor: '#f0f0f0', borderRadius: 10 },
  attachThumb: { width: 36, height: 36, borderRadius: 6 },
  attachFileIcon: { width: 36, height: 36, borderRadius: 6, backgroundColor: '#e0e0e0', alignItems: 'center', justifyContent: 'center' },
  attachName: { flex: 1, fontSize: 13, color: '#444' },
  inputBarOuter: { paddingHorizontal: 12, paddingTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputBar: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 24, paddingLeft: 16, paddingRight: 6, minHeight: 44 },
  plusCircle: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#b0b0b0', alignItems: 'center', justifyContent: 'center' },
  micInsideBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inputIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, paddingHorizontal: 6, paddingVertical: 10, fontSize: 16, maxHeight: 120, lineHeight: 22 },
  voiceBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  waveformContainer: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { width: 2.5, borderRadius: 2, backgroundColor: '#ffffff' },
  sendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  sendBtnOff: { opacity: 0.3 },
  stopBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  stopSquare: { width: 12, height: 12, borderRadius: 2, backgroundColor: '#ffffff' },

  // Menu
  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  menuSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, maxHeight: SH * 0.75 },
  menuHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#d0d0d0', alignSelf: 'center', marginBottom: 16 },
  menuTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  attachRow: { flexDirection: 'row', gap: 10, marginBottom: 20, paddingBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  attachPill: { flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', gap: 6 },
  attachLabel: { fontSize: 12, fontWeight: '500' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 14 },
  menuItemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuItemLabel: { fontSize: 15, fontWeight: '500' },
  menuItemSub: { fontSize: 12, marginTop: 1 },

  // Unused but kept for compatibility
  dropdown: { position: 'absolute', top: 90, left: 16, right: 16, backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: '#ebebeb', zIndex: 100, elevation: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16 },
  dropItem: { flexDirection: 'row', alignItems: 'center', padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  dropItemActive: { backgroundColor: '#fdf2f8' },
  dropName: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
});
