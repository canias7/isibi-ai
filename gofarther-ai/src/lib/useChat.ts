/** Shared chat hook — used by ChatScreen and AgentsScreen */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { ChatMsg, genId, parseAction, actionLabel } from './types';
import { chatStream, Message, generateImage, analyzeImage, createFile, modifyFile, webSearch, readURL, runCode, translateText, youtubeSearch, deepResearch, generateQR, cryptoPortfolio, createInvoice, createCalendarEvent, socialPost, compareURLs, createMeme, barcodeLookup } from './ai';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { executeAction } from './actions';
import { getChatHistory, saveChatHistory, addMemoryFact, addSavedContact, trackEvent } from './storage';
import { scheduleLocalNotification } from './notifications';

interface UseChatOptions {
  sessionId: string | null;
  systemPrompt: string;
  onSessionCreated?: (id: string, title: string) => void;
}

export function useChat({ sessionId, systemPrompt, onSessionCreated }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const cancelRef = useRef(false);
  const messagesRef = useRef<ChatMsg[]>([]);
  const currentSessionId = useRef<string | null>(sessionId);
  const systemPromptRef = useRef(systemPrompt);

  // Keep system prompt ref in sync
  useEffect(() => { systemPromptRef.current = systemPrompt; }, [systemPrompt]);

  // Keep ref in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Load history when session changes
  useEffect(() => {
    currentSessionId.current = sessionId;
    if (sessionId) {
      getChatHistory(sessionId).then(h => setMessages(h.map((m, i) => ({ ...m, id: `${sessionId}_${i}` }))));
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
      })));
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
      ...(fileAttachment ? { fileUrl: fileAttachment.uri || fileAttachment.name, fileMimeType: fileAttachment.mimeType } : {}),
    };
    setMessages(prev => [...prev, userMsg]);
    messagesRef.current = [...messagesRef.current, userMsg];
    setLoading(true);

    // Capture session ID for async operations that may outlive a chat switch
    const operationSessionId = sid;

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
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: chunk } : m));
      }, (action) => {
        streamedAction = action;
      });
      const durationMs = Date.now() - startTime;
      const responseText = typeof result === 'string' ? result : result.text;
      const tokens = typeof result === 'string' ? 0 : (result.tokens || 0);

      // Use streamed action if available, otherwise parse from response text
      const { cleanText, action } = streamedAction ? { cleanText: responseText, action: streamedAction } : parseAction(responseText);
      let finalAction = action;
      let finalText = cleanText;

      // Store stats for tool actions (not casual chat)
      const hasAction = !!finalAction;
      const msgStats = (hasAction || tokens > 500) ? { tokens, durationMs } : undefined;

      // Handle memory
      if (finalAction?.type === 'remember') {
        await addMemoryFact(finalAction.target || '');
        finalAction = null;
        if (!finalText) finalText = "Got it, I'll remember that!";
      }

      // Handle save contact from chat
      if (finalAction?.type === 'save_contact') {
        const label = finalAction.target || 'Contact';
        const name = finalAction.text || label;
        const info = finalAction.key || '';
        const email = info.includes('@') ? info : undefined;
        const phone = !info.includes('@') && info ? info : undefined;
        await addSavedContact({ label, name, email, phone });
        finalAction = null;
        if (!finalText) finalText = `Saved ${name} as "${label}" in your contacts!`;
      }

      // Handle image generation
      if (finalAction?.type === 'generate_image') {
        updateAndPersist(aiMsgIdStream, { content: finalText || 'Generating image...' });
        setLoading(false);
        generateImage(finalAction.target || '').then(imageUrl => {
          updateAndPersist(aiMsgIdStream, { content: finalText || 'Here\'s your image:', imageUrl });
          scheduleLocalNotification('Image Ready', 'Your AI-generated image is ready', 1);
        }).catch((e: any) => {
          updateAndPersist(aiMsgIdStream, { content: (finalText || '') + '\n\n(Image generation failed: ' + e.message + ')' });
        });
        return;
      }

      // Handle file creation — download and open natively
      if (finalAction?.type === 'create_file') {
        updateAndPersist(aiMsgIdStream, { content: finalText || 'Creating file', isCreatingFile: true });
        setLoading(false);
        setIsCreating(true);
        cancelRef.current = false;
        createFile(finalAction.target || '', finalAction.text || 'pdf', finalAction.key || 'standard').then(async (result) => {
          if (cancelRef.current) { setIsCreating(false); return; }
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          // Download file locally
          const filePath = `${FileSystem.cacheDirectory}${result.filename}`;
          const dlResult = await FileSystem.downloadAsync(downloadUrl, filePath);
          if (dlResult.status !== 200) throw new Error(`Download failed (HTTP ${dlResult.status})`);

          updateAndPersist(aiMsgIdStream, {
            content: `${finalText || 'Your file is ready!'}\n\n**${result.filename}**`,
            fileUrl: filePath,
            isCreatingFile: false,
          });
          setIsCreating(false);
          scheduleLocalNotification('File Ready', `${result.filename} has been created`, 1);
        }).catch(e => {
          setIsCreating(false);
          if (cancelRef.current) return;
          const errorMsg = 'File creation failed: ' + (e.message || 'Unknown error');
          updateAndPersist(aiMsgIdStream, { content: errorMsg, isCreatingFile: false });
          scheduleLocalNotification('GoFarther AI', errorMsg, 1);
        });
        return;
      }

      // Handle file modification (edit, chart, convert, merge, filter)
      if (finalAction?.type === 'modify_file') {
        const operation = finalAction.target || 'edit';
        const opLabels: Record<string, string> = { edit: 'Editing file', chart: 'Creating chart', convert: 'Converting file', merge: 'Merging files', filter: 'Filtering data' };
        updateAndPersist(aiMsgIdStream, { content: finalText || opLabels[operation] || 'Modifying file', isCreatingFile: true });
        setLoading(false);
        setIsCreating(true);
        cancelRef.current = false;
        // Find the most recent file_id from messages
        let lastFileId: string | undefined;
        for (let i = messagesRef.current.length - 1; i >= 0; i--) {
          const m = messagesRef.current[i];
          if (m.fileUrl && m.content.includes('**')) {
            // Extract file_id from the download URL pattern
            const match = m.fileUrl.match(/([a-f0-9-]{8})/);
            if (match) { lastFileId = match[1]; break; }
          }
        }
        modifyFile(operation, finalAction.text || '', lastFileId, finalAction.key || undefined).then(async (result) => {
          if (cancelRef.current) { setIsCreating(false); return; }
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          const filePath = `${FileSystem.cacheDirectory}${result.filename}`;
          const dlResult = await FileSystem.downloadAsync(downloadUrl, filePath);
          if (dlResult.status !== 200) throw new Error(`Download failed (HTTP ${dlResult.status})`);
          updateAndPersist(aiMsgIdStream, {
            content: `${finalText || 'Your modified file is ready!'}\n\n**${result.filename}**`,
            fileUrl: filePath,
            isCreatingFile: false,
          });
          setIsCreating(false);
          scheduleLocalNotification('File Ready', `${result.filename} is ready`, 1);
        }).catch(e => {
          setIsCreating(false);
          if (cancelRef.current) return;
          updateAndPersist(aiMsgIdStream, { content: 'File modification failed: ' + (e.message || 'Unknown error'), isCreatingFile: false });
        });
        return;
      }

      // Handle web search
      if (finalAction?.type === 'web_search') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Searching...' } : m));
        setLoading(false);
        webSearch(finalAction.target || '').then(result => {
          const formatted = result.results.map((r: any) => `**${r.title}**\n${r.snippet}${r.url ? `\n[Link](${r.url})` : ''}`).join('\n\n');
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: formatted || 'No results found.' } : m));
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Search failed: ' + e.message } : m));
        });
        return;
      }

      // Handle URL reading
      if (finalAction?.type === 'read_url') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Reading page...' } : m));
        setLoading(false);
        readURL(finalAction.target || '', finalAction.text).then(result => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: result.summary } : m));
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Could not read URL: ' + e.message } : m));
        });
        return;
      }

      // Handle code execution
      if (finalAction?.type === 'run_code') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Running code...' } : m));
        setLoading(false);
        runCode(finalAction.target || '').then(result => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**Code:**\n\`\`\`python\n${result.code}\n\`\`\`\n\n**Output:**\n\`\`\`\n${result.output}\n\`\`\`` } : m));
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Code execution failed: ' + e.message } : m));
        });
        return;
      }

      // Handle translation
      if (finalAction?.type === 'translate') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Translating...' } : m));
        setLoading(false);
        translateText(finalAction.target || '', finalAction.text || 'Spanish').then(result => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: result.translation } : m));
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Translation failed: ' + e.message } : m));
        });
        return;
      }

      // Handle YouTube summary
      if (finalAction?.type === 'youtube_summary') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Summarizing video...' } : m));
        setLoading(false);
        youtubeSearch(finalAction.target || '').then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**${r.title}**\n\n${r.summary}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Video summary failed: ' + e.message } : m)); });
        return;
      }

      // Handle research
      if (finalAction?.type === 'research') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Researching...' } : m));
        setLoading(false);
        deepResearch(finalAction.target || '', finalAction.text || 'general').then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: r.research } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Research failed: ' + e.message } : m)); });
        return;
      }

      // Handle QR code
      if (finalAction?.type === 'generate_qr') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Generating QR code...' } : m));
        setLoading(false);
        generateQR(finalAction.target || '').then(r => {
          const url = `https://isibi-backend.onrender.com${r.download_url}`;
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'QR code generated!', imageUrl: `data:image/png;base64,${r.image_base64}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'QR generation failed: ' + e.message } : m)); });
        return;
      }

      // Handle calendar event
      if (finalAction?.type === 'create_event') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Creating event...' } : m));
        setLoading(false);
        createCalendarEvent(finalAction.target || '', finalAction.text || new Date().toISOString().split('T')[0]).then(r => {
          const url = `https://isibi-backend.onrender.com${r.download_url}`;
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `Event created: ${finalAction!.target}\n\n[Download .ics file](${url})` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Event creation failed: ' + e.message } : m)); });
        return;
      }

      // Handle invoice
      if (finalAction?.type === 'create_invoice') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Creating invoice...' } : m));
        setLoading(false);
        createInvoice(finalAction.target || '', finalAction.text || '').then(r => {
          const url = `https://isibi-backend.onrender.com${r.download_url}`;
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `${r.content}\n\n[Download Invoice](${url})` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Invoice failed: ' + e.message } : m)); });
        return;
      }

      // Handle crypto portfolio
      if (finalAction?.type === 'crypto_portfolio') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Checking prices...' } : m));
        setLoading(false);
        cryptoPortfolio(finalAction.target || 'BTC,ETH').then(r => {
          const formatted = r.portfolio.map((c: any) => `**${c.symbol}**: $${c.price}`).join('\n');
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: formatted } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Crypto fetch failed: ' + e.message } : m)); });
        return;
      }

      // Handle social post
      if (finalAction?.type === 'social_post') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Creating post...' } : m));
        setLoading(false);
        socialPost(finalAction.text || 'twitter', finalAction.target || '').then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**${r.platform} post:**\n\n${r.post}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Post failed: ' + e.message } : m)); });
        return;
      }

      // Handle URL comparison
      if (finalAction?.type === 'compare_urls') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Comparing...' } : m));
        setLoading(false);
        compareURLs(finalAction.target || '', finalAction.text).then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: r.comparison } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Comparison failed: ' + e.message } : m)); });
        return;
      }

      // Handle meme
      if (finalAction?.type === 'create_meme') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Creating meme...' } : m));
        setLoading(false);
        createMeme(finalAction.target || '', finalAction.text || '').then(r => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Here\'s your meme!', imageUrl: `data:image/png;base64,${r.image_base64}` } : m));
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Meme failed: ' + e.message } : m)); });
        return;
      }

      // Handle barcode lookup
      if (finalAction?.type === 'barcode_lookup') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Looking up barcode...' } : m));
        setLoading(false);
        barcodeLookup(finalAction.target || '').then(r => {
          if (r.found) {
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: `**${r.name}**\nBrand: ${r.brand}\nCategory: ${r.category}${r.nutrition_grade ? `\nNutrition: ${r.nutrition_grade}` : ''}` } : m));
          } else {
            setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Product not found in database.' } : m));
          }
        }).catch(e => { setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: 'Barcode lookup failed: ' + e.message } : m)); });
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
      setMessages(prev => [...prev, { id: genId(), role: 'system' as const, content: e.message || 'Something went wrong', timestamp: Date.now() }]);
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
    } catch {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, actionStatus: 'failed' } : m));
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
    cancelCreation,
    regenerate,
    editMessage,
    submitEdit,
  };
}
