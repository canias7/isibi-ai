/** Shared chat hook — used by ChatScreen and AgentsScreen */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { ChatMsg, genId, parseAction, actionLabel } from './types';
import { chatStream, Message, generateImage, analyzeImage, createFile, webSearch, readURL, runCode, translateText, youtubeSearch, deepResearch, generateQR, cryptoPortfolio, createInvoice, createCalendarEvent, socialPost, compareURLs, createMeme, barcodeLookup } from './ai';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { executeAction } from './actions';
import { getChatHistory, saveChatHistory, addMemoryFact, trackEvent } from './storage';

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

  const send = useCallback(async (overrideText?: string, inputRef?: { current: string }, clearInput?: () => void) => {
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

    const userMsg: ChatMsg = { id: genId(), role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    messagesRef.current = [...messagesRef.current, userMsg];
    setLoading(true);

    try {
      const currentMsgs = messagesRef.current;
      const history: Message[] = currentMsgs.slice(-20).map(m => ({
        role: m.role === 'system' ? 'assistant' as const : m.role,
        content: m.content,
      }));
      history.push({ role: 'user', content: text });

      // Create placeholder message, then animate after response arrives
      const aiMsgIdStream = genId();
      setMessages(prev => [...prev, { id: aiMsgIdStream, role: 'assistant' as const, content: '', timestamp: Date.now() }]);

      const response = await chatStream(history, systemPromptRef.current, (chunk) => {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: chunk } : m));
      });

      const { cleanText, action } = parseAction(response);
      let finalAction = action;
      let finalText = cleanText;

      // Start typewriter animation NOW that we have the final text
      setAnimatingIds(prev => new Set(prev).add(aiMsgIdStream));

      // Handle memory
      if (finalAction?.type === 'remember') {
        await addMemoryFact(finalAction.target || '');
        finalAction = null;
      }

      // Handle image generation
      if (finalAction?.type === 'generate_image') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Generating image...' } : m));
        setLoading(false);
        generateImage(finalAction.target || '').then(imageUrl => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Here\'s your image:', imageUrl } : m));
        }).catch((e: any) => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: (finalText || '') + '\n\n(Image generation failed: ' + e.message + ')' } : m));
        });
        return;
      }

      // Handle file creation — download and open natively
      if (finalAction?.type === 'create_file') {
        setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: finalText || 'Creating file', isCreatingFile: true } : m));
        setLoading(false);
        createFile(finalAction.target || '', finalAction.text || 'pdf', finalAction.key || 'standard').then(async (result) => {
          const downloadUrl = `https://isibi-backend.onrender.com${result.download_url}`;
          // Download file locally
          const filePath = `${FileSystem.cacheDirectory}${result.filename}`;
          await FileSystem.downloadAsync(downloadUrl, filePath);

          // Show in chat with file path for tap-to-open
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? {
            ...m,
            content: `${finalText || 'Your file is ready!'}\n\n**${result.filename}**`,
            fileUrl: filePath,
            isCreatingFile: false,
          } : m));
        }).catch(e => {
          setMessages(prev => prev.map(m => m.id === aiMsgIdStream ? { ...m, content: (finalText || '') + '\n\n(File creation failed: ' + e.message + ')' } : m));
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
          content: finalText || (finalAction ? actionLabel(finalAction) : response),
          action: finalAction || undefined,
          actionStatus: finalAction ? 'confirm' : undefined,
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

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    editingMsgId,
    setEditingMsgId,
    animatingIds,
    addAnimatingId: (id: string) => setAnimatingIds(prev => new Set(prev).add(id)),
    removeAnimatingId: (id: string) => setAnimatingIds(prev => { const next = new Set(prev); next.delete(id); return next; }),
    messagesRef,
    currentSessionId,
    send,
    confirmAction,
    cancelAction,
    regenerate,
    editMessage,
    submitEdit,
  };
}
