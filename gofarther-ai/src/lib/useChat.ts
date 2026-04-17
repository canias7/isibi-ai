/** Shared chat hook — used by ChatScreen and AgentsScreen */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { ChatMsg, genId, parseAction, actionLabel } from './types';
import { chatStream, Message, generateImage, editImage, analyzeImage, createFile, modifyFile, uploadFile, webSearch, readURL, runCode, translateText, youtubeSearch, deepResearch, generateQR, cryptoPortfolio, createInvoice, createCalendarEvent, socialPost, compareURLs, createMeme, barcodeLookup, runConnectorAction, runConnectorPlan, processCallRecording } from './ai';
import { getToken } from './api';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { executeAction } from './actions';
import { getChatHistory, saveChatHistory, addMemoryFact, deleteMemoryFact, deleteMemoryByCategory, clearMemory, getMemory, getMemoryByCategory, getSavedContacts, addSavedContact, addEmailTemplate, addCallRecording, trackEvent, addToOfflineQueue, getFileRegistry, saveFileRegistry } from './storage';
import { pushSession } from './chatSync';
import { incrementReactionCount } from './storage';
import { runAnalysisIfNeeded } from './preferenceAnalysis';
import NetInfo from '@react-native-community/netinfo';
import { scheduleLocalNotification } from './notifications';

interface UseChatOptions {
  sessionId: string | null;
  systemPrompt: string;
  onSessionCreated?: (id: string, title: string) => void;
  /** Called after a new saved contact is persisted from a chat turn. The
   * parent screen should rebuild its system prompt so the contact shows
   * up in the very next message, not only after a screen refocus. */
  onContactsChanged?: () => void;
  /** Use fast model (Haiku) for quicker responses — used by voice mode. */
  fast?: boolean;
}

export function useChat({ sessionId, systemPrompt, onSessionCreated, onContactsChanged, fast }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const cancelRef = useRef(false);

  /** Wrap async action so isCreating stays true while it runs */
  const trackAsync = <T,>(promise: Promise<T>): Promise<T> => {
    setIsCreating(true);
    return promise.finally(() => setIsCreating(false));
  };
  const messagesRef = useRef<ChatMsg[]>([]);
  const currentSessionId = useRef<string | null>(sessionId);
  const systemPromptRef = useRef(systemPrompt);

  // ── File Registry — maps filenames to file_ids for multi-file operations ──
  const fileRegistryRef = useRef<Map<string, string>>(new Map());

  /** Register a file so future operations can reference it by name */
  const registerFile = (filename: string, fileId: string) => {
    fileRegistryRef.current.set(filename.toLowerCase(), fileId);
    // Also register without extension for fuzzy matching
    const base = filename.replace(/\.[^.]+$/, '').toLowerCase();
    if (base !== filename.toLowerCase()) {
      fileRegistryRef.current.set(base, fileId);
    }
    // Persist to AsyncStorage scoped by session (best-effort, don't await)
    const obj: Record<string, string> = {};
    fileRegistryRef.current.forEach((v, k) => { obj[k] = v; });
    saveFileRegistry(obj, currentSessionId.current || undefined).catch(() => {});
  };

  /** Resolve a filename (or partial name) to a file_id */
  const resolveFileId = (name: string): string | undefined => {
    const lower = name.toLowerCase().trim();
    // 1. Exact match
    if (fileRegistryRef.current.has(lower)) return fileRegistryRef.current.get(lower);
    // 2. Without extension
    const base = lower.replace(/\.[^.]+$/, '');
    if (fileRegistryRef.current.has(base)) return fileRegistryRef.current.get(base);
    // 3. Partial match — compare both full name and base name against keys
    //    This handles: model says "budget.xlsx", registry has "budget_edited_2026-04-16.xlsx"
    //    because base "budget" is contained in key "budget_edited_2026-04-16"
    for (const [key, id] of fileRegistryRef.current) {
      const keyBase = key.replace(/\.[^.]+$/, '');
      if (key.includes(lower) || lower.includes(key) ||
          key.includes(base) || base.includes(keyBase) ||
          keyBase.includes(base)) return id;
    }
    return undefined;
  };

  /** Resolve an array of filenames to file_ids */
  const resolveFileIds = (names: string[]): string[] => {
    const ids: string[] = [];
    for (const name of names) {
      const id = resolveFileId(name);
      if (id) ids.push(id);
    }
    return ids;
  };

  // Keep system prompt ref in sync
  useEffect(() => { systemPromptRef.current = systemPrompt; }, [systemPrompt]);

  // Keep ref in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Load history when session changes — also restore file registry
  useEffect(() => {
    currentSessionId.current = sessionId;
    fileRegistryRef.current.clear();
    if (sessionId) {
      // Restore persisted file registry scoped to this session
      getFileRegistry(sessionId).then(stored => {
        for (const [k, v] of Object.entries(stored)) {
          fileRegistryRef.current.set(k, v);
        }
      }).catch(() => {});
      getChatHistory(sessionId).then(h => {
        const msgs = h.map((m, i) => ({ ...m, id: `${sessionId}_${i}`, reaction: m.reaction }));
        setMessages(msgs);
        // Augment registry from message history (catches any files not yet persisted)
        for (const m of msgs) {
          if (m.fileUrl && m.content) {
            const nameMatch = m.content.match(/\*\*([^*]+\.\w+)\*\*/);
            const idMatch = m.fileUrl.match(/([a-f0-9-]{8})/);
            if (nameMatch && idMatch) {
              fileRegistryRef.current.set(nameMatch[1].toLowerCase(), idMatch[1]);
              const base = nameMatch[1].replace(/\.[^.]+$/, '').toLowerCase();
              fileRegistryRef.current.set(base, idMatch[1]);
            }
          }
        }
      });
    } else {
      setMessages([]);
    }
  }, [sessionId]);

  // Save history when messages change (only when not loading)
  useEffect(() => {
    if (messages.length > 0 && currentSessionId.current && !loading) {
      saveChatHistory(currentSessionId.current, messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now(),
        ...(m.reaction ? { reaction: m.reaction } : {}),
      })));
      // Sync to server in background (best-effort)
      pushSession(currentSessionId.current);
    }
  }, [messages, loading]);

  const send = useCallback(async (overrideText?: string, inputRef?: { current: string }, clearInput?: () => void, fileAttachment?: { base64: string; mimeType: string; name: string; uri?: string }) => {
    const text = (overrideText || inputRef?.current || '').trim();
    if (!text || loading) return;
    if (clearInput) clearInput();
    trackEvent('chat_send');

    // Create session if needed
    let sid = currentSessionId.current;
    if (!sid) {
      sid = genId();
      currentSessionId.current = sid;
      const title = text.length > 40 ? text.slice(0, 40) + '...' : text;
      onSessionCreated?.(sid, title);
    }

    const userMsg: ChatMsg = {
      id: genId(), role: 'user', content: text, timestamp: Date.now(),
      ...(fileAttachment ? {
        fileUrl: fileAttachment.uri || fileAttachment.name,
        fileMimeType: fileAttachment.mimeType,
        ...(fileAttachment.mimeType.startsWith('image/') ? { imageBase64: fileAttachment.base64 } : {}),
      } : {}),
    };
    setMessages(prev => [...prev, userMsg]);
    messagesRef.current = [...messagesRef.current, userMsg];
    setLoading(true);

    // Capture session ID for async operations that may outlive a chat switch
    const operationSessionId = sid;
    // Helper: schedule notification with session deep link
    const notify = (title: string, body: string, seconds: number = 1) =>
      scheduleLocalNotification(title, body, seconds, { sessionId: operationSessionId });

    // Check if offline — queue message for later
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, queued: true } : m));
        await addToOfflineQueue({ sessionId: operationSessionId, text, timestamp: Date.now() });
        setLoading(false);
        return;
      }
    } catch {} // If NetInfo fails, proceed anyway

    try {
      const currentMsgs = messagesRef.current;
      // Build history — re-include file content for messages that had attachments
      const recentMsgs = currentMsgs.slice(-20);
      const history: Message[] = [];
      let fileContextCount = 0;
      for (const m of recentMsgs) {
        const role = m.role === 'system' ? 'assistant' as const : m.role;
        // Re-include file content for recent file messages (max 2 to save tokens)
        if (m.fileMimeType && m.fileUrl && fileContextCount < 2 && !m.fileMimeType.startsWith('image/')) {
          try {
            const b64 = await FileSystem.readAsStringAsync(m.fileUrl, { encoding: FileSystem.EncodingType.Base64 });
            history.push({ role, content: [
              { type: 'document', source: { type: 'base64', media_type: m.fileMimeType, data: b64 }, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: m.content },
            ]});
            fileContextCount++;
            continue;
          } catch {} // File may have been cleared from cache
        }
        history.push({ role, content: m.content });
      }

      // Build user message — multimodal if file attached
      if (fileAttachment) {
        const isImage = fileAttachment.mimeType.startsWith('image/');
        if (isImage) {
          // Route images through vision endpoint
          history.push({ role: 'user', content: text });
        } else {
          // Send document as content block array for Claude to read
          history.push({
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: fileAttachment.mimeType, data: fileAttachment.base64 }, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: text || `Analyze this file: ${fileAttachment.name}` },
            ],
          });
        }
      } else {
        history.push({ role: 'user', content: text });
      }

      // Create placeholder message, then animate after response arrives
      const aiMsgIdStream = genId();
      setMessages(prev => [...prev, { id: aiMsgIdStream, role: 'assistant' as const, content: '', timestamp: Date.now() }]);

      // Helper: update message and persist — works even if user switched chats
      const updateAndPersist = (msgId: string, updates: Partial<ChatMsg>) => {
        setMessages(prev => {
          const updated = prev.map(m => m.id === msgId ? { ...m, ...updates } : m);
          // Save to storage so it persists across chat switches
          if (operationSessionId) {
            saveChatHistory(operationSessionId, updated.map(m => ({
              role: m.role, content: m.content, timestamp: m.timestamp || Date.now(),
            })));
          }
          return updated;
        });
      };

      // If image file attached, use vision endpoint instead of chat
      if (fileAttachment?.mimeType.startsWith('image/')) {
        updateAndPersist(aiMsgIdStream, { content: 'Analyzing image...' });
        try {
          const result = await analyzeImage(fileAttachment.base64, text || 'What do you see in this image?');
          setAnimatingIds(prev => new Set(prev).add(aiMsgIdStream));
          updateAndPersist(aiMsgIdStream, { content: result });
          setLoading(false);
        } catch (e: any) {
          updateAndPersist(aiMsgIdStream, { content: 'Image analysis failed: ' + e.message });
          setLoading(false);
        }
        return;
      }

      let streamedAction: any = null;
      const startTime = Date.now();
      const result = await chatStream(history, systemPromptRef.current, (chunk) => {
        // Hide any action JSON from the streaming display so the user
        // doesn't see raw `{"type":"connector",...}` characters scrolling
        // in while the model emits it. Only show the prose before the
        // first `{"type"` occurrence. The final parsed content is set
        // below once streaming finishes.
        const jsonStart = chunk.indexOf('{"type"');
        const displayText = jsonStart >= 0 ? chunk.slice(0, jsonStart).trimEnd() : chunk;
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: displayText } : m));
      }, (action) => {
        streamedAction = action;
      }, fast ? { fast: true } : undefined);
      const durationMs = Date.now() - startTime;
      const responseText = typeof result === 'string' ? result : result.text;
      const tokens = typeof result === 'string' ? 0 : (result.tokens || 0);

      // Use streamed action if available, otherwise parse from response text
      const { cleanText, action } = streamedAction ? { cleanText: responseText, action: streamedAction } : parseAction(responseText);
      let finalAction = action;
      let finalText = cleanText;

      // Store stats on all AI responses
      const msgStats = { tokens, durationMs };

      // Handle memory — supports "category:fact" format (e.g. "preferences:always use bullet points")
      if (finalAction?.type === 'remember') {
        const raw = finalAction.target || '';
        const colonIdx = raw.indexOf(':');
        const validCategories = ['facts', 'preferences', 'templates', 'instructions'];
        let category: 'facts' | 'preferences' | 'templates' | 'instructions' = 'facts';
        let fact = raw;
        if (colonIdx > 0) {
          const prefix = raw.slice(0, colonIdx).trim().toLowerCase();
          if (validCategories.includes(prefix)) {
            category = prefix as typeof category;
            fact = raw.slice(colonIdx + 1).trim();
          }
        }
        await addMemoryFact(fact, category);
        finalAction = null;
        if (!finalText) finalText = "Got it, I'll remember that!";
      }

      // Handle forget_memory — delete specific memory, a category, or everything
      if (finalAction?.type === 'forget_memory') {
        const target = (finalAction.target || '').trim();
        const validCats = ['facts', 'preferences', 'templates', 'instructions'];
        if (target === 'all') {
          await clearMemory();
          if (!finalText) finalText = "Done — all memory cleared.";
        } else if (target.endsWith(':all')) {
          const cat = target.split(':')[0].toLowerCase();
          if (validCats.includes(cat)) {
            await deleteMemoryByCategory(cat as any);
            if (!finalText) finalText = `Got it, I've cleared all ${cat}.`;
          } else if (cat === 'contacts') {
            // Contacts are stored separately — not in ai_memory
            if (!finalText) finalText = "Contact deletion isn't supported through this action yet. You can manage contacts in Settings.";
          }
        } else {
          // Find and delete by matching fact text
          const mem = await getMemory();
          const match = mem.find(m => m.fact.toLowerCase().includes(target.toLowerCase()));
          if (match) {
            await deleteMemoryFact(match.id);
            if (!finalText) finalText = "Got it, I've forgotten that.";
          } else {
            if (!finalText) finalText = "I couldn't find that in my memory. Want me to show you what I remember?";
          }
        }
        finalAction = null;
      }

      // Handle show_memory — display saved memory organized by category
      if (finalAction?.type === 'show_memory') {
        const target = (finalAction.target || 'all').trim().toLowerCase();
        const mem = await getMemory();
        const contacts = await getSavedContacts();
        const validCats = ['facts', 'preferences', 'templates', 'instructions'];
        let memoryDisplay = '';

        if (target === 'all' || !validCats.includes(target)) {
          // Show everything
          const grouped: Record<string, string[]> = {};
          for (const m of mem) {
            const cat = m.category || 'facts';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(m.fact + (m.version ? ` (v${m.version})` : ''));
          }
          const labels: Record<string, string> = { facts: '📋 Facts', preferences: '⚙️ Preferences', templates: '📝 Templates', instructions: '🎯 Instructions' };
          for (const [cat, items] of Object.entries(grouped)) {
            memoryDisplay += `\n**${labels[cat] || cat}:**\n${items.map(f => `- ${f}`).join('\n')}\n`;
          }
          if (contacts.length > 0) {
            memoryDisplay += `\n**👤 Contacts:**\n${contacts.map((c: any) => `- ${c.label} = ${c.name}${c.email ? ` (${c.email})` : ''}${c.phone ? ` (${c.phone})` : ''}`).join('\n')}\n`;
          }
          if (!memoryDisplay) memoryDisplay = "I don't have anything saved yet.";
          else memoryDisplay = "Here's everything I remember:\n" + memoryDisplay + "\nWant to update or delete anything?";
        } else if (target === 'contacts') {
          if (contacts.length > 0) {
            memoryDisplay = `**👤 Saved Contacts:**\n${contacts.map((c: any) => `- ${c.label} = ${c.name}${c.email ? ` (${c.email})` : ''}${c.phone ? ` (${c.phone})` : ''}`).join('\n')}`;
          } else {
            memoryDisplay = "No saved contacts yet.";
          }
        } else {
          const catMem = mem.filter(m => (m.category || 'facts') === target);
          const labels: Record<string, string> = { facts: 'Facts', preferences: 'Preferences', templates: 'Templates', instructions: 'Instructions' };
          if (catMem.length > 0) {
            memoryDisplay = `**${labels[target] || target}:**\n${catMem.map(m => `- ${m.fact}${m.version ? ` (v${m.version})` : ''}`).join('\n')}`;
          } else {
            memoryDisplay = `No saved ${target} yet.`;
          }
        }

        finalText = memoryDisplay;
        finalAction = null;
      }

      // Sidecar: any action can carry a save_contact hint so the LLM can
      // both save a new contact AND run a plan/connector in the same turn.
      // Example: {type:'plan', steps:[...], save_contact:{label:'my boss', name:'John', email:'john@x.com'}}
      const sidecar = (finalAction as any)?.save_contact;
      if (sidecar && typeof sidecar === 'object' && sidecar.label) {
        try {
          await addSavedContact({
            label: String(sidecar.label),
            name: String(sidecar.name || sidecar.label),
            email: sidecar.email ? String(sidecar.email) : undefined,
            phone: sidecar.phone ? String(sidecar.phone) : undefined,
          });
          // Ask the parent screen to rebuild the system prompt so the
          // newly saved contact appears in the NEXT message, not only
          // after the screen refocuses.
          onContactsChanged?.();
        } catch {}
      }

      // Sidecar: same pattern as save_contact, but for email templates.
      // Lets the user say "save this as my welcome email template" and
      // the LLM attaches a save_template blob to whatever action it's
      // emitting. The next message automatically sees the new template.
      const tplSidecar = (finalAction as any)?.save_template;
      if (tplSidecar && typeof tplSidecar === 'object' && tplSidecar.name) {
        try {
          await addEmailTemplate({
            name: String(tplSidecar.name),
            subject: String(tplSidecar.subject || ''),
            body: String(tplSidecar.body || ''),
            description: tplSidecar.description ? String(tplSidecar.description) : undefined,
          });
          onContactsChanged?.();
        } catch {}
      }

      // Handle save contact from chat
      if (finalAction?.type === 'save_contact') {
        const label = finalAction.target || 'Contact';
        const name = finalAction.text || label;
        // Trigger prompt rebuild on the parent after the save below
        setTimeout(() => onContactsChanged?.(), 0);
        const info = finalAction.key || '';
        const email = info.includes('@') ? info : undefined;
        const phone = !info.includes('@') && info ? info : undefined;
        await addSavedContact({ label, name, email, phone });
        finalAction = null;
        if (!finalText) finalText = `Saved ${name} as "${label}" in your contacts!`;
      }

      // Handle call summary (transcribe + AI analysis)
      if (finalAction?.type === 'call_summary') {
        updateAndPersist(aiMsgIdStream, { content: finalText || 'Processing call recording... Transcribing and analyzing.' });
        setLoading(false);
        // Look for audio attachment in recent messages
        let audioBase64 = '';
        for (let i = messagesRef.current.length - 1; i >= 0; i--) {
          const m = messagesRef.current[i];
          if (m.role === 'user' && m.content && typeof m.content === 'object') {
            const blocks = Array.isArray(m.content) ? m.content : [];
            for (const b of blocks) {
              if (b.type === 'audio' || (b.source?.media_type || '').startsWith('audio/')) {
                audioBase64 = b.source?.data || '';
                break;
              }
            }
          }
          if (audioBase64) break;
        }
        if (!audioBase64) {
          updateAndPersist(aiMsgIdStream, { content: 'No audio recording found. Please attach a call recording first, then ask me to summarize it.' });
          return;
        }
        processCallRecording(audioBase64, finalAction.target, finalAction.text).then(async (result) => {
          const formatted = `**Call Summary — ${result.contact_name || 'Unknown Contact'}**\n\n${result.summary}\n\n**Key Points:**\n${(result.key_points || []).map((p: string) => `- ${p}`).join('\n')}\n\n**Action Items:**\n${(result.action_items || []).map((a: string) => `- [ ] ${a}`).join('\n')}\n\n**Follow-up Email Draft:**\n${result.follow_up_email || 'N/A'}\n\n**Lead Status:** ${result.lead_status || 'warm'}`;
          updateAndPersist(aiMsgIdStream, { content: formatted });
          // Save to call recordings
          await addCallRecording({
            contactName: result.contact_name || finalAction!.target || 'Unknown',
            phone: finalAction!.text,
            duration: 0,
            transcript: result.transcript,
            summary: result.summary,
            keyPoints: result.key_points,
            actionItems: result.action_items,
            followUpDraft: result.follow_up_email,
            createdAt: Date.now(),
          });
          notify('Call Summary Ready', `Summary for ${result.contact_name || 'call'} is ready`, 1);
        }).catch(e => {
          updateAndPersist(aiMsgIdStream, { content: `Call processing failed: ${e.message}` });
        });
        return;
      }

      // Handle image generation
      if (finalAction?.type === 'generate_image') {
        updateAndPersist(aiMsgIdStream, { content: 'Generating image...' });
        setLoading(false);
        trackAsync(generateImage(finalAction.target || '', finalAction.key || '1024x1024')).then(async (remoteUrl) => {
          if (!remoteUrl) {
            updateAndPersist(aiMsgIdStream, { content: 'Image generation returned empty URL.' });
            return;
          }
          // Download to local file first — React Native Image loads local files more reliably
          try {
            const localPath = FileSystem.cacheDirectory + `gen_${Date.now()}.png`;
            const dl = await FileSystem.downloadAsync(remoteUrl, localPath);
            updateAndPersist(aiMsgIdStream, { content: 'Here\'s your image:', imageUrl: dl.uri });
          } catch {
            // Fallback to remote URL if download fails
            updateAndPersist(aiMsgIdStream, { content: 'Here\'s your image:', imageUrl: remoteUrl });
          }
          notify('Image Ready', 'Your AI-generated image is ready', 1);
        }).catch((e: any) => {
          updateAndPersist(aiMsgIdStream, { content: 'Image generation failed: ' + e.message });
        });
        return;
      }

      // Handle image editing — find the last image the user sent and edit it
      if (finalAction?.type === 'edit_image') {
        updateAndPersist(aiMsgIdStream, { content: 'Editing image...' });
        setLoading(false);
        // Find the most recent user message with an image (base64 attachment)
        const lastImageMsg = [...messages].reverse().find(m => m.role === 'user' && m.imageBase64);
        if (!lastImageMsg?.imageBase64) {
          updateAndPersist(aiMsgIdStream, { content: 'No image found to edit. Please send a photo first, then tell me what to change.' });
          return;
        }
        trackAsync(editImage(lastImageMsg.imageBase64, finalAction.target || '')).then(imageUrl => {
          updateAndPersist(aiMsgIdStream, { content: 'Here\'s your edited image:', imageUrl: imageUrl || undefined });
          if (imageUrl) notify('Image Edited', 'Your edited image is ready', 1);
        }).catch((e: any) => {
          updateAndPersist(aiMsgIdStream, { content: 'Image editing failed: ' + e.message });
        });
        return;
      }

      // Handle file creation — download and open natively
      if (finalAction?.type === 'create_file') {
        updateAndPersist(aiMsgIdStream, { content: finalText || '', isCreatingFile: true });
        setLoading(false);
        setIsCreating(true);
        cancelRef.current = false;
        createFile(finalAction.target || '', finalAction.text || 'pdf', finalAction.key || 'standard').then(async (result) => {
          if (cancelRef.current) { setIsCreating(false); return; }
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          // Download file locally — must include auth header
          const filePath = `${FileSystem.cacheDirectory}${result.filename}`;
          const token = await getToken();
          const dlResult = await FileSystem.downloadAsync(downloadUrl, filePath, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (dlResult.status !== 200) throw new Error(`Download failed (HTTP ${dlResult.status})`);

          // Register in file registry for future multi-file operations
          registerFile(result.filename, result.file_id);

          updateAndPersist(aiMsgIdStream, {
            content: `${finalText || 'Your file is ready!'}\n\n**${result.filename}**`,
            fileUrl: filePath,
            fileId: result.file_id,
            isCreatingFile: false,
          });
          setIsCreating(false);
          notify('File Ready', `${result.filename} has been created`, 1);
        }).catch(e => {
          setIsCreating(false);
          if (cancelRef.current) return;
          const errorMsg = 'File creation failed: ' + (e.message || 'Unknown error');
          updateAndPersist(aiMsgIdStream, { content: errorMsg, isCreatingFile: false });
          notify('GoFarther AI', errorMsg, 1);
        });
        return;
      }

      // Handle file modification (edit, chart, convert, merge, filter, clean, split, rename, ocr, batch, chain) and reading (summarize, analyze, find, extract, answer)
      if (finalAction?.type === 'modify_file') {
        const operation = finalAction.target || 'edit';
        const readOps = ['summarize', 'analyze', 'find', 'extract', 'answer', 'ocr', 'validate'];
        const isReadOp = readOps.includes(operation);
        const opLabels: Record<string, string> = {
          edit: 'Editing file', chart: 'Creating chart', convert: 'Converting file',
          merge: 'Merging files', filter: 'Filtering data', clean: 'Cleaning data',
          split: 'Splitting file', rename: 'Renaming columns', ocr: 'Reading image',
          append: 'Adding rows', pivot: 'Creating pivot table', translate: 'Translating file',
          highlight: 'Highlighting data', validate: 'Validating data',
          summarize: 'Reading file', analyze: 'Analyzing file',
          find: 'Searching file', extract: 'Extracting data', answer: 'Reading file',
          batch: 'Processing files', chain: 'Running operations',
        };
        const loadingLabel = isReadOp ? (opLabels[operation] || 'Reading file') + '...' : (opLabels[operation] || 'Processing file') + '...';
        updateAndPersist(aiMsgIdStream, { content: finalText || loadingLabel, isCreatingFile: !isReadOp, isProcessing: isReadOp });
        setLoading(false);
        setIsCreating(true);
        cancelRef.current = false;
        // ── File ID Resolution via registry ──
        // Multi-file ops: resolve file_ids from the action (model provides filenames, we resolve to IDs)
        const multiFileOps = ['merge', 'compare', 'reconcile', 'batch'];
        let resolvedFileId: string | undefined;
        let resolvedFileIds: string[] | undefined;

        if (multiFileOps.includes(operation) && finalAction.file_ids && finalAction.file_ids.length > 0) {
          // Model provided file references — resolve names to IDs via registry
          resolvedFileIds = [];
          const unresolvedNames: string[] = [];
          for (const ref of finalAction.file_ids) {
            const id = resolveFileId(ref);
            if (id) {
              resolvedFileIds.push(id);
            } else {
              unresolvedNames.push(ref);
            }
          }
          // If any filenames couldn't be resolved, tell the user
          if (unresolvedNames.length > 0) {
            const knownFiles = Array.from(fileRegistryRef.current.keys()).filter(k => k.includes('.')).slice(0, 10);
            updateAndPersist(aiMsgIdStream, {
              content: `Could not find: ${unresolvedNames.join(', ')}${knownFiles.length > 0 ? `\n\nFiles I know about:\n${knownFiles.map(f => `- ${f}`).join('\n')}` : '\n\nNo files in this session yet. Create or upload files first.'}`,
              isCreatingFile: false,
            });
            setIsCreating(false);
            return;
          }
        } else if (multiFileOps.includes(operation) && finalAction.text) {
          // Fallback: try to extract filenames from the instructions text
          const nameMatches = finalAction.text.match(/[\w\-. ]+\.\w{2,5}/g);
          if (nameMatches && nameMatches.length >= 2) {
            resolvedFileIds = resolveFileIds(nameMatches);
          }
        }
        // Multi-file ops with no resolved file_ids — tell user
        if (multiFileOps.includes(operation) && (!resolvedFileIds || resolvedFileIds.length < 2)) {
          const minFiles = operation === 'batch' ? 2 : 2;
          updateAndPersist(aiMsgIdStream, {
            content: `${operation} requires at least ${minFiles} files. Please specify which files to use.`,
            isCreatingFile: false,
          });
          setIsCreating(false);
          return;
        }

        // Single-file ops: resolve from registry first, fall back to message history scan
        if (!multiFileOps.includes(operation)) {
          // Try to find a specific file reference in the action
          if (finalAction.file_ids?.[0]) {
            resolvedFileId = resolveFileId(finalAction.file_ids[0]);
          }
          // Fall back to most recent file in chat — resolve filename from message content via registry
          if (!resolvedFileId) {
            for (let i = messagesRef.current.length - 1; i >= 0; i--) {
              const m = messagesRef.current[i];
              if (!m.fileUrl || !m.content) continue;
              const nameMatch = m.content.match(/\*\*([^*]+\.\w+)\*\*/);
              if (nameMatch) {
                const regId = resolveFileId(nameMatch[1]);
                if (regId) { resolvedFileId = regId; break; }
              }
            }
          }
          // If still no server file_id, check for user-uploaded local attachment and upload it
          if (!resolvedFileId) {
            for (let i = messagesRef.current.length - 1; i >= 0; i--) {
              const m = messagesRef.current[i];
              if (m.fileUrl && m.fileMimeType && !m.fileUrl.includes('/api/ghost/')) {
                // This is a local file attachment — upload to backend first
                try {
                  updateAndPersist(aiMsgIdStream, { content: `${finalText || loadingLabel}\n\n_Uploading file..._` });
                  const name = m.fileUrl.split('/').pop() || 'upload';
                  const uploaded = await uploadFile(m.fileUrl, name, m.fileMimeType);
                  resolvedFileId = uploaded.file_id;
                  registerFile(uploaded.filename, uploaded.file_id);
                } catch (uploadErr: any) {
                  console.warn('Auto-upload failed:', uploadErr.message);
                  updateAndPersist(aiMsgIdStream, {
                    content: `File upload failed: ${uploadErr.message || 'Unknown error'}. Try again or attach the file again.`,
                    isCreatingFile: false, isProcessing: false,
                  });
                  setIsCreating(false);
                  return;
                }
                break;
              }
            }
          }
        }

        // Validate chain_ops if present
        let chainOps = finalAction.chain_ops;
        if (operation === 'chain' && chainOps) {
          // Ensure every step has an operation field
          chainOps = chainOps.filter((step: any) => step && typeof step.operation === 'string' && step.operation.trim());
          if (chainOps.length < 2) {
            updateAndPersist(aiMsgIdStream, { content: 'Chain requires at least 2 valid steps.', isCreatingFile: false });
            setIsCreating(false);
            return;
          }
        }
        const targetFormat = operation === 'convert' || operation === 'batch' ? (finalAction.key || undefined) : undefined;
        const progressCallback = (progress: string) => {
          updateAndPersist(aiMsgIdStream, { content: `${finalText || loadingLabel}\n\n_${progress}_` });
        };
        modifyFile(operation, finalAction.text || '', resolvedFileId, targetFormat, resolvedFileIds, chainOps, progressCallback).then(async (result) => {
          if (cancelRef.current) { setIsCreating(false); return; }
          // Read operations return text instead of a file
          if (isReadOp && result.result_text) {
            updateAndPersist(aiMsgIdStream, {
              content: `${finalText ? finalText + '\n\n' : ''}${result.result_text}`,
              isCreatingFile: false,
              isProcessing: false,
            });
            setIsCreating(false);
            return;
          }
          // Batch operations — download zip of all files
          if (result.batch_results) {
            const successful = result.batch_results.filter((r: any) => r.filename && r.download_url);
            const failed = result.batch_results.filter((r: any) => r.error);
            // Register all successful files in the registry
            for (const r of successful) {
              if (r.file_id && r.filename) registerFile(r.filename, r.file_id);
            }
            // Download the zip file if available, otherwise first individual file
            let downloadFilePath: string | undefined;
            if (result.download_url && result.filename) {
              // Zip of all files
              try {
                const zipUrl = `https://isibi-backend.onrender.com${result.download_url}`;
                downloadFilePath = `${FileSystem.cacheDirectory}${result.filename}`;
                await FileSystem.downloadAsync(zipUrl, downloadFilePath);
                registerFile(result.filename, result.file_id);
              } catch { downloadFilePath = undefined; }
            } else if (successful.length > 0) {
              // Fallback: download first file
              try {
                const dlUrl = `https://isibi-backend.onrender.com${successful[0].download_url}`;
                downloadFilePath = `${FileSystem.cacheDirectory}${successful[0].filename}`;
                await FileSystem.downloadAsync(dlUrl, downloadFilePath);
              } catch { downloadFilePath = undefined; }
            }
            let batchMsg = `${finalText || 'Batch complete!'}\n\n`;
            batchMsg += `**${successful.length} files processed**${failed.length > 0 ? `, ${failed.length} failed` : ''}:\n`;
            for (const r of successful) batchMsg += `- **${r.filename}**\n`;
            for (const r of failed) batchMsg += `- ❌ ${r.error}\n`;
            if (result.filename?.endsWith('.zip')) batchMsg += `\n📦 **${result.filename}** — all files zipped for download.`;
            updateAndPersist(aiMsgIdStream, {
              content: batchMsg,
              fileUrl: downloadFilePath,
              isCreatingFile: false,
            });
            setIsCreating(false);
            notify('Batch Complete', `${successful.length} files processed`, 1);
            return;
          }
          // File operations — download the result
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          // Ensure filename has an extension so FileViewer can identify the type
          let fname = result.filename;
          if (fname && !fname.includes('.')) fname += '.pdf';
          const filePath = `${FileSystem.cacheDirectory}${fname}`;
          const dlToken = await getToken();
          const dlResult = await FileSystem.downloadAsync(downloadUrl, filePath, {
            headers: { Authorization: `Bearer ${dlToken}` },
          });
          if (dlResult.status !== 200) throw new Error(`Download failed (HTTP ${dlResult.status})`);
          // Register in file registry for future multi-file operations
          if (result.file_id && result.filename) registerFile(result.filename, result.file_id);
          // Include chain step info if available
          let successMsg = `${finalText || 'Your modified file is ready!'}\n\n**${result.filename}**`;
          if ((result as any).completed_steps) {
            successMsg += `\n_Steps completed: ${(result as any).completed_steps.join(' → ')}_`;
            if ((result as any).failed_step) successMsg += `\n_⚠️ Failed at: ${(result as any).failed_step}_`;
          }
          updateAndPersist(aiMsgIdStream, {
            content: successMsg,
            fileUrl: filePath,
            fileId: result.file_id,
            isCreatingFile: false,
          });
          setIsCreating(false);
          notify('File Ready', `${fname} is ready`, 1);
        }).catch(e => {
          setIsCreating(false);
          if (cancelRef.current) return;
          updateAndPersist(aiMsgIdStream, { content: 'File operation failed: ' + (e.message || 'Unknown error'), isCreatingFile: false, isProcessing: false });
        });
        return;
      }

      // Handle web search — fetch results then synthesize with AI
      if (finalAction?.type === 'web_search') {
        const searchQuery = finalAction.target || '';
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `🔍 Searching: "${searchQuery}"...` } : m));
        setLoading(true);
        trackAsync(webSearch(searchQuery)).then(async result => {
          if (!result.results?.length) {
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'No results found.' } : m));
            setLoading(false);
            return;
          }
          // Build context from search results
          const context = result.results.map((r: any, i: number) =>
            `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}${r.age ? ` (${r.age})` : ''}`
          ).join('\n\n');
          const sources = result.results.filter((r: any) => r.url).map((r: any) => r.url);

          // Ask Claude to synthesize
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: '🔍 Reading results...' } : m));
          try {
            const synthesis = await chatStream(
              [{ role: 'user', content: `The user asked: "${searchQuery}"\n\nHere are live web search results:\n\n${context}\n\nSynthesize a clear, helpful answer based on these search results. Be concise and factual. Include relevant details. At the end, list 2-3 key sources as markdown links.` }],
              'You are a search assistant. Answer based ONLY on the provided search results. Be concise, accurate, and cite sources.',
              (chunk) => {
                setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: chunk } : m));
              },
              undefined,
              { fast: true },
            );
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: synthesis.text } : m));
          } catch {
            // Fallback to raw results if synthesis fails
            const formatted = result.results.map((r: any) => `**${r.title}**\n${r.snippet}${r.url ? `\n[Link](${r.url})` : ''}`).join('\n\n');
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: formatted } : m));
          }
          setLoading(false);
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Search failed: ' + e.message } : m));
          setLoading(false);
        });
        return;
      }

      // Handle URL reading
      if (finalAction?.type === 'read_url') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `📄 Reading: ${finalAction.target}...` } : m));
        setLoading(true);
        trackAsync(readURL(finalAction.target || '', finalAction.text)).then(result => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: result.summary } : m));
          setLoading(false);
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Could not read URL: ' + e.message } : m));
          setLoading(false);
        });
        return;
      }

      // Handle translation
      if (finalAction?.type === 'translate') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `🌐 Translating to ${finalAction.text || 'Spanish'}...` } : m));
        setLoading(true);
        trackAsync(translateText(finalAction.target || '', finalAction.text || 'Spanish')).then(result => {
          const header = result.detected_language ? `*Detected: ${result.detected_language}*\n\n` : '';
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `${header}${result.translation}` } : m));
          setLoading(false);
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Translation failed: ' + e.message } : m));
          setLoading(false);
        });
        return;
      }

      // Handle YouTube summary
      if (finalAction?.type === 'youtube_summary') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(youtubeSearch(finalAction.target || '')).then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**${r.title}**\n\n${r.summary}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Video summary failed: ' + e.message } : m)); });
        return;
      }

      // Handle research
      if (finalAction?.type === 'research') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(deepResearch(finalAction.target || '', finalAction.text || 'general')).then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: r.research } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Research failed: ' + e.message } : m)); });
        return;
      }

      // Handle QR code
      if (finalAction?.type === 'generate_qr') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(generateQR(finalAction.target || '')).then(r => {
          const url = `https://isibi-backend.onrender.com${r.download_url}`;
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'QR code generated!', imageUrl: `data:image/png;base64,${r.image_base64}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'QR generation failed: ' + e.message } : m)); });
        return;
      }

      // Handle calendar event
      if (finalAction?.type === 'create_event') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(createCalendarEvent(finalAction.target || '', finalAction.text || new Date().toISOString().split('T')[0])).then(r => {
          const url = `https://isibi-backend.onrender.com${r.download_url}`;
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `Event created: ${finalAction!.target}\n\n[Download .ics file](${url})` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Event creation failed: ' + e.message } : m)); });
        return;
      }

      // Handle crypto portfolio
      if (finalAction?.type === 'crypto_portfolio') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(cryptoPortfolio(finalAction.target || 'BTC,ETH')).then(r => {
          const formatted = r.portfolio.map((c: any) => `**${c.symbol}**: $${c.price}`).join('\n');
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: formatted } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Crypto fetch failed: ' + e.message } : m)); });
        return;
      }

      // Handle URL comparison
      if (finalAction?.type === 'compare_urls') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(compareURLs(finalAction.target || '', finalAction.text)).then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: r.comparison } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Comparison failed: ' + e.message } : m)); });
        return;
      }

      // Handle meme
      if (finalAction?.type === 'create_meme') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(createMeme(finalAction.target || '', finalAction.text || '')).then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Here\'s your meme!', imageUrl: `data:image/png;base64,${r.image_base64}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Meme failed: ' + e.message } : m)); });
        return;
      }

      // Handle barcode lookup
      if (finalAction?.type === 'barcode_lookup') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(barcodeLookup(finalAction.target || '')).then(r => {
          if (r.found) {
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**${r.name}**\nBrand: ${r.brand}\nCategory: ${r.category}${r.nutrition_grade ? `\nNutrition: ${r.nutrition_grade}` : ''}` } : m));
          } else {
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Product not found in database.' } : m));
          }
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Barcode lookup failed: ' + e.message } : m)); });
        return;
      }

      // Handle company/LinkedIn lookup, market research, competitor analysis
      if (finalAction?.type === 'company_lookup' || finalAction?.type === 'linkedin_lookup' || finalAction?.type === 'competitor_analysis' || finalAction?.type === 'market_research') {
        const labels: Record<string, string> = { company_lookup: 'Looking up company...', linkedin_lookup: 'Looking up profile...', competitor_analysis: 'Analyzing competitors...', market_research: 'Researching market...' };
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(deepResearch(finalAction.target || '', 'general')).then(r => {
          updateAndPersist(aiMsgIdStream, { content: r.research });
        }).catch(e => { updateAndPersist(aiMsgIdStream, { content: 'Research failed: ' + e.message }); });
        return;
      }

      // Handle reminders and timers (local notifications)
      if (finalAction?.type === 'set_reminder') {
        const reminder = finalAction.target || 'Reminder';
        // Parse time — simple heuristic for "in X minutes" or specific times
        let delayMinutes = 5; // default
        const timeStr = (finalAction.text || '').toLowerCase();
        const minuteMatch = timeStr.match(/(\d+)\s*min/);
        const hourMatch = timeStr.match(/(\d+)\s*hour/);
        if (minuteMatch) delayMinutes = parseInt(minuteMatch[1]);
        else if (hourMatch) delayMinutes = parseInt(hourMatch[1]) * 60;
        notify('Reminder', reminder, delayMinutes * 60);
        updateAndPersist(aiMsgIdStream, { content: finalText || `Got it! I'll remind you "${reminder}" in ${delayMinutes} minutes.` });
        setLoading(false);
        return;
      }

      if (finalAction?.type === 'set_timer') {
        const minutes = parseInt(finalAction.target || '5') || 5;
        notify('Timer Done', `Your ${minutes}-minute timer is up!`, minutes * 60);
        updateAndPersist(aiMsgIdStream, { content: finalText || `Timer set for ${minutes} minutes.` });
        setLoading(false);
        return;
      }

      // Handle daily briefing
      if (finalAction?.type === 'daily_briefing') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        // Combine weather + news
        trackAsync(Promise.all([
          webSearch('today news headlines').catch(() => ({ results: [] })),
        ])).then(([news]) => {
          const newsStr = news.results.slice(0, 5).map((r: any) => `- **${r.title}**\n  ${r.snippet}`).join('\n');
          updateAndPersist(aiMsgIdStream, { content: `**Your Morning Briefing**\n\n**Top News:**\n${newsStr || 'No news available.'}` });
        });
        return;
      }

      // Handle proposals, contracts, presentations (route to create_file)
      if (finalAction?.type === 'create_proposal' || finalAction?.type === 'create_contract' || finalAction?.type === 'create_presentation') {
        const fileType = finalAction.type === 'create_presentation' ? 'xlsx' : 'pdf';
        const desc = `${finalAction.type.replace('create_', '')} for: ${finalAction.target}`;
        updateAndPersist(aiMsgIdStream, { content: finalText || '', isCreatingFile: true });
        setLoading(false);
        setIsCreating(true);
        cancelRef.current = false;
        createFile(desc, fileType, 'premium').then(async (result) => {
          if (cancelRef.current) { setIsCreating(false); return; }
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          const filePath = `${FileSystem.cacheDirectory}${result.filename}`;
          const dlToken = await getToken();
          const dlResult = await FileSystem.downloadAsync(downloadUrl, filePath, {
            headers: { Authorization: `Bearer ${dlToken}` },
          });
          if (dlResult.status !== 200) throw new Error(`Download failed (HTTP ${dlResult.status})`);
          updateAndPersist(aiMsgIdStream, { content: `${finalText || 'Your document is ready!'}\n\n**${result.filename}**`, fileUrl: filePath, fileId: result.file_id, isCreatingFile: false });
          setIsCreating(false);
          notify('Document Ready', `${result.filename} has been created`, 1);
        }).catch(e => {
          setIsCreating(false);
          if (cancelRef.current) return;
          updateAndPersist(aiMsgIdStream, { content: 'Document creation failed: ' + (e.message || 'Unknown error'), isCreatingFile: false });
        });
        return;
      }

      // Handle connector action (universal app integration)
      if (finalAction?.type === 'connector') {
        const appId = finalAction.target || '';
        const actionName = finalAction.text || '';
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || '' } : m));
        setLoading(false);
        trackAsync(runConnectorAction(appId, actionName, finalAction.key)).then(result => {
          // Format the result nicely
          const data = result.result || result;
          let formatted = '';
          if (data.message) formatted = data.message;
          if (data.contacts) formatted += '\n\n' + data.contacts.map((c: any) => `**${c.firstname || ''} ${c.lastname || c.name || ''}** ${c.email ? `· ${c.email}` : ''} ${c.phone ? `· ${c.phone}` : ''}`).join('\n');
          // Mail messages from any mail connector (gmail, outlook_mail, neo,
          // titan, imap, yahoo, zoho, fastmail, etc.). All adapters return
          // {messages: [{id, subject, from, received, snippet, unread}]}.
          if (data.messages && Array.isArray(data.messages)) {
            // Parse RFC 2822 "Name" <addr@domain> into just the display
            // name, falling back to the addr part when there's no name.
            const cleanFrom = (raw: any): string => {
              const s = (raw || '').toString().trim();
              // Strip outer quotes + angle brackets
              const nameAddr = s.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+)\s*>\s*$/);
              if (nameAddr) {
                const name = (nameAddr[1] || '').trim().replace(/^"|"$/g, '');
                const addr = (nameAddr[2] || '').trim();
                return name || addr;
              }
              return s;
            };
            // Escape markdown-significant characters so things like
            // "**Microsoft account team" don't get eaten by the renderer.
            const escapeMd = (raw: any): string =>
              (raw || '').toString()
                .replace(/[\*_`\[\]<>]/g, (c: string) => '\\' + c)
                .replace(/\s+/g, ' ');
            formatted += '\n\n' + data.messages.map((m: any) => {
              const unread = m.unread ? '● ' : '○ ';
              const from = escapeMd(cleanFrom(m.from_name || m.from)).slice(0, 40);
              const subj = escapeMd(m.subject || '(no subject)').slice(0, 70);
              const snip = m.snippet ? `\n   ${escapeMd(m.snippet).slice(0, 120)}` : '';
              const when = m.received ? ` · ${new Date(m.received).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
              return `${unread}**${from}**${when}\n   ${subj}${snip}`;
            }).join('\n\n');
          }
          if (data.deals) formatted += '\n\n' + data.deals.map((d: any) => `**${d.dealname || d.title || d.name || 'Deal'}** ${d.amount ? `· $${d.amount}` : ''} ${d.dealstage || d.stage || ''}`).join('\n');
          if (data.leads) formatted += '\n\n' + data.leads.map((l: any) => `**${l.Name || l.name || 'Lead'}** ${l.Email ? `· ${l.Email}` : ''} ${l.Status || ''}`).join('\n');
          if (data.tasks) formatted += '\n\n' + data.tasks.map((t: any) => `${t.completed ? '✅' : '⬜'} **${t.content || t.name || 'Task'}** ${t.due || t.due_on || ''}`).join('\n');
          if (data.invoices) formatted += '\n\n' + data.invoices.map((i: any) => `**${i.customer || 'Invoice'}** · $${i.amount_due || i.amount || 0} · ${i.status || ''}`).join('\n');
          if (data.orders) formatted += '\n\n' + data.orders.map((o: any) => `**${o.name || 'Order'}** · $${o.total || 0} · ${o.status || ''}`).join('\n');
          if (data.products) formatted += '\n\n' + data.products.map((p: any) => `**${p.title || p.name || 'Product'}** ${p.price ? `· $${p.price}` : ''}`).join('\n');
          if (data.channels) formatted += '\n\n' + data.channels.map((c: any) => `#${c.name}`).join(', ');
          if (data.issues) formatted += '\n\n' + data.issues.map((i: any) => `**${i.key || i.identifier || ''}** ${i.title || i.summary || ''} · ${i.status || ''}`).join('\n');
          if (data.results && Array.isArray(data.results)) formatted += '\n\n' + data.results.map((r: any) => `- ${r.title || r.name || r.summary || r.key || JSON.stringify(r).slice(0, 100)}`).join('\n');
          if (data.payments) formatted += '\n\n' + data.payments.map((p: any) => `**$${p.amount}** ${p.currency?.toUpperCase() || ''} · ${p.status} ${p.description ? `· ${p.description}` : ''}`).join('\n');
          if (data.available !== undefined) formatted += `\n\nAvailable: $${data.available}\nPending: $${data.pending}`;
          if (data.payment_link) formatted += `\n\n[Payment Link](${data.payment_link})`;
          if (data.sum !== undefined) formatted += `\n\n**Sum of column ${data.column || ''}:** ${typeof data.sum === 'number' ? data.sum.toLocaleString() : data.sum}${data.count !== undefined ? ` _(${data.count} values)_` : ''}`;
          // Don't add "_N results_" when we've already rendered the
          // messages inline — the count is obvious from the list.
          else if (data.count !== undefined && !formatted.includes('count') && !data.messages) formatted += `\n\n_${data.count} results_`;
          if (!formatted.trim()) formatted = JSON.stringify(data, null, 2).slice(0, 2000);

          // If the connector returned a file — either as a URL
          // (pdf_url, download_url, share_url, webUrl) or inline as
          // content_base64 — write it into local cache so it shows up in
          // the chat as a tappable attachment instead of just text.
          const fileUrlFromResult: string | undefined =
            data.download_url || data.pdf_url || data.file_url || data.share_url || data.webUrl;
          const fileNameFromResult: string = data.filename || data.name || (data.pdf_url ? 'file.pdf' : 'file');
          const fileMimeFromResult: string = data.mime_type || (data.pdf_url ? 'application/pdf' : 'application/octet-stream');
          if (data.content_base64 && typeof data.content_base64 === 'string') {
            (async () => {
              try {
                const localPath = `${FileSystem.cacheDirectory}${Date.now()}-${fileNameFromResult}`;
                await FileSystem.writeAsStringAsync(localPath, data.content_base64, { encoding: FileSystem.EncodingType.Base64 });
                updateAndPersist(aiMsgIdStream, {
                  content: (finalText ? finalText + '\n\n' : '') + formatted.trim() + `\n\n**${fileNameFromResult}**`,
                  fileUrl: localPath,
                  fileMimeType: fileMimeFromResult,
                });
              } catch (e: any) {
                updateAndPersist(aiMsgIdStream, { content: (finalText ? finalText + '\n\n' : '') + formatted.trim() + `\n\n⚠️ Could not save file: ${e?.message || 'unknown error'}` });
              }
            })();
          } else if (fileUrlFromResult && /^https?:\/\//.test(fileUrlFromResult)) {
            (async () => {
              try {
                const localPath = `${FileSystem.cacheDirectory}${Date.now()}-${fileNameFromResult}`;
                const dlToken = await getToken();
                const dlHeaders: Record<string, string> = {};
                if (fileUrlFromResult.includes('isibi-backend')) dlHeaders.Authorization = `Bearer ${dlToken}`;
                const dl = await FileSystem.downloadAsync(fileUrlFromResult, localPath, { headers: dlHeaders });
                if (dl.status === 200) {
                  updateAndPersist(aiMsgIdStream, {
                    content: (finalText ? finalText + '\n\n' : '') + formatted.trim() + `\n\n**${fileNameFromResult}**`,
                    fileUrl: localPath,
                    fileMimeType: fileMimeFromResult,
                  });
                  return;
                }
              } catch {}
              // Fall back to inline link if we couldn't download
              updateAndPersist(aiMsgIdStream, { content: (finalText ? finalText + '\n\n' : '') + formatted.trim() + `\n\n[${fileNameFromResult}](${fileUrlFromResult})` });
            })();
          } else {
            updateAndPersist(aiMsgIdStream, { content: (finalText ? finalText + '\n\n' : '') + formatted.trim() });
          }
        }).catch(e => {
          updateAndPersist(aiMsgIdStream, { content: `${finalText || ''}\n\n⚠️ ${e.message || 'Connection failed'}` });
        });
        return;
      }

      // Handle multi-step plan (e.g. build Excel report → export PDF → email)
      if (finalAction?.type === 'plan') {
        // The LLM puts the steps JSON array in the `key` field as a string, or
        // directly on the action as `steps`. Accept both.
        let steps: any[] = [];
        const rawSteps = (finalAction as any).steps || finalAction.key;
        try {
          steps = Array.isArray(rawSteps) ? rawSteps : JSON.parse(rawSteps || '[]');
        } catch {
          steps = [];
        }
        if (!steps.length) {
          updateAndPersist(aiMsgIdStream, { content: `${finalText || ''}\n\n⚠️ Plan had no steps` });
          return;
        }
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: (finalText || 'Working on it...') } : m));
        setLoading(false);
        trackAsync(runConnectorPlan(steps)).then(result => {
          // Friendly step label — hides the technical action names
          // (excel_online · list_workbooks) in favor of a natural
          // description like "Read your budget spreadsheet".
          const friendlyLabel = (s: any): string => {
            if (s.type === 'email') {
              const to = s.result?.to || '';
              const att = s.result?.attachment_count ? ` with ${s.result.attachment_count} attachment${s.result.attachment_count > 1 ? 's' : ''}` : '';
              return `Sent email to ${to}${att}`;
            }
            if (s.type === 'excel_pdf') {
              const name = s.result?.filename || 'workbook';
              return `Exported ${name} as PDF`;
            }
            if (s.type === 'convert_file') {
              const to = s.result?.to || 'file';
              const name = s.result?.filename || '';
              return `Converted to ${to}${name ? ` (${name})` : ''}`;
            }
            if (s.type === 'connector') {
              const app = s.app || '';
              const action = s.action || '';
              // Map common (app, action) pairs to natural phrases.
              const map: Record<string, string> = {
                'excel_online.list_workbooks': 'Looked through your Excel files',
                'excel_online.get_worksheets': 'Checked the worksheets',
                'excel_online.read_range': 'Read your spreadsheet',
                'excel_online.write_range': 'Updated your spreadsheet',
                'excel_online.add_row': 'Added a row to your spreadsheet',
                'excel_online.create_workbook': 'Created a new workbook',
                'excel_online.sum_column': 'Summed the column',
                'excel_online.find_cell': 'Searched the spreadsheet',
                'excel_online.download_workbook': 'Downloaded your spreadsheet',
                'excel_online.download_as_pdf': 'Exported your spreadsheet as PDF',
                'gmail.list_inbox': 'Opened your Gmail inbox',
                'gmail.search_emails': 'Searched your Gmail',
                'gmail.read_email': 'Read the email',
                'outlook_mail.list_inbox': 'Opened your Outlook inbox',
                'outlook_mail.search_emails': 'Searched your Outlook',
                'outlook_mail.read_email': 'Read the email',
                'neo_mail.list_inbox': 'Opened your inbox',
                'titan_mail.list_inbox': 'Opened your inbox',
                'imap_mail.list_inbox': 'Opened your inbox',
              };
              return map[`${app}.${action}`] || action.replace(/_/g, ' ');
            }
            return s.type.replace(/_/g, ' ');
          };

          const lines: string[] = [];
          const allOk = (result.steps || []).every((s: any) => s.ok);
          if (result.status === 'error' || !allOk) {
            lines.push('**Something went wrong**');
          } else {
            lines.push('**Done!**');
          }
          for (const s of (result.steps || [])) {
            const icon = s.ok ? '✓' : '✗';
            const label = friendlyLabel(s);
            lines.push(`  ${icon}  ${label}${s.error ? `\n      ${s.error}` : ''}`);
          }
          updateAndPersist(aiMsgIdStream, { content: (finalText ? finalText + '\n\n' : '') + lines.join('\n') });
          // Fire a local iOS notification when the plan finishes so the
          // user gets a ping even if they backgrounded the app while the
          // plan was running (common on slow Excel reads or email sends).
          // Builds a short summary by picking the most user-relevant step.
          try {
            const stepsArr = result.steps || [];
            const emailStep = stepsArr.find((x: any) => x.type === 'email' && x.ok);
            const pdfStep = stepsArr.find((x: any) => x.type === 'excel_pdf' && x.ok);
            const convertStep = stepsArr.find((x: any) => x.type === 'convert_file' && x.ok);
            let title = allOk ? 'Done!' : 'Something went wrong';
            let body = '';
            if (allOk && emailStep) body = `Sent email to ${emailStep.result?.to || 'recipient'}${emailStep.result?.attachment_count ? ` with ${emailStep.result.attachment_count} attachment${emailStep.result.attachment_count > 1 ? 's' : ''}` : ''}`;
            else if (allOk && pdfStep) body = `Exported ${pdfStep.result?.filename || 'workbook'} as PDF`;
            else if (allOk && convertStep) body = `Converted file to ${convertStep.result?.to || 'new format'}`;
            else if (allOk) body = `Completed ${stepsArr.length} step${stepsArr.length > 1 ? 's' : ''}`;
            else {
              const firstFail = stepsArr.find((x: any) => !x.ok);
              body = firstFail?.error || 'Check the chat for details';
            }
            scheduleLocalNotification(title, body, 1, { sessionId: currentSessionId.current || '' });
          } catch {}
        }).catch(e => {
          updateAndPersist(aiMsgIdStream, { content: `${finalText || ''}\n\n⚠️ ${e.message || 'Something went wrong'}` });
          try { scheduleLocalNotification('Something went wrong', e?.message || 'Plan failed', 1, { sessionId: currentSessionId.current || '' }); } catch {}
        });
        return;
      }

      // Update the streaming message with final parsed content
      setMessages(prev => {
        const cleared = prev.map(m => m.actionStatus === 'confirm' ? { ...m, actionStatus: 'cancelled' as const } : m);
        return cleared.map(m => m.id === aiMsgIdStream ? {
          ...m,
          content: finalText || (finalAction ? actionLabel(finalAction) : responseText),
          action: finalAction || undefined,
          actionStatus: finalAction ? 'confirm' : undefined,
          stats: msgStats,
        } : m);
      });
    } catch (e: any) {
      const msg = e?.code === 'rate_limit_exceeded'
        ? `⚠️ ${e.message} Open Settings → Subscription to upgrade.`
        : (e.message || 'Something went wrong');
      setMessages(prev => [...prev, { id: genId(), role: 'system' as const, content: msg, timestamp: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }, [loading, systemPrompt, onSessionCreated]);

  const confirmAction = useCallback(async (msgId: string) => {
    const msg = messagesRef.current.find(m => m.id === msgId);
    if (!msg?.action) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'running' } : m));
    try {
      await executeAction(msg.action);
      trackEvent('action_' + msg.action.type);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'done' } : m));
      // Notify on email sent
      if (msg.action.type === 'email') {
        scheduleLocalNotification('Email Sent', `Email to ${msg.action.target} was sent successfully`, 1, { sessionId: currentSessionId.current || '' });
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'failed' } : m));
      if (msg.action.type === 'email') {
        scheduleLocalNotification('Email Failed', e.message || 'Could not send email', 1, { sessionId: currentSessionId.current || '' });
      }
    }
  }, []);

  const cancelAction = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'cancelled' } : m));
  }, []);

  const regenerate = useCallback(() => {
    let lastUserText = '';
    for (let i = messagesRef.current.length - 1; i >= 0; i--) {
      if (messagesRef.current[i].role === 'user') {
        lastUserText = messagesRef.current[i].content;
        const sliced = messagesRef.current.slice(0, i + 1);
        setMessages(sliced);
        messagesRef.current = sliced;
        break;
      }
    }
    if (lastUserText) send(lastUserText);
    trackEvent('regenerate');
  }, [send]);

  const editMessage = useCallback((msgId: string) => {
    const msg = messagesRef.current.find(m => m.id === msgId);
    if (!msg || msg.role !== 'user') return;
    setEditingMsgId(msgId);
    return msg.content;
  }, []);

  const submitEdit = useCallback((editText: string) => {
    if (!editingMsgId || !editText.trim()) return;
    const idx = messagesRef.current.findIndex(m => m.id === editingMsgId);
    if (idx === -1) return;
    const sliced = messagesRef.current.slice(0, idx);
    setMessages(sliced);
    messagesRef.current = sliced;
    setEditingMsgId(null);
    send(editText);
    trackEvent('edit_message');
  }, [editingMsgId, send]);

  const retryAction = useCallback(async (msgId: string) => {
    const msg = messagesRef.current.find(m => m.id === msgId);
    if (!msg?.action) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'running' } : m));
    try {
      await executeAction(msg.action);
      trackEvent('action_retry_' + msg.action.type);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'done' } : m));
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'failed' } : m));
    }
  }, []);

  const setReaction = useCallback((msgId: string, reaction: 'up' | 'down' | undefined) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction: reaction } : m));
    if (reaction) {
      incrementReactionCount().then(() => runAnalysisIfNeeded()).catch(() => {});
    }
  }, []);

  const cancelCreation = useCallback(() => {
    cancelRef.current = true;
    setIsCreating(false);
    // Update any creating message to show cancelled
    setMessages(prev => prev.map(m => m.isCreatingFile ? { ...m, content: 'File creation cancelled.', isCreatingFile: false } : m));
  }, []);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    editingMsgId,
    setEditingMsgId,
    animatingIds,
    isCreating,
    addAnimatingId: (id: string) => setAnimatingIds(prev => new Set(prev).add(id)),
    removeAnimatingId: (id: string) => setAnimatingIds(prev => { const next = new Set(prev); next.delete(id); return next; }),
    messagesRef,
    currentSessionId,
    send,
    confirmAction,
    cancelAction,
    retryAction,
    setReaction,
    cancelCreation,
    regenerate,
    editMessage,
    submitEdit,
  };
}
