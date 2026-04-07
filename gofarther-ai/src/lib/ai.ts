/** GoFarther AI — API calls through backend proxy (no keys in client) */

import { getToken } from './api';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

const BASE = 'https://isibi-backend.onrender.com/api/ghost/ai';
const TIMEOUT_MS = 120000;

/** Check network before requests */
async function checkNetwork() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) throw new Error('No internet connection. Check your network and try again.');
}

/** Wait for app to return to foreground */
function waitForForeground(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise(resolve => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { sub.remove(); resolve(); }
    });
  });
}

/** Fetch with timeout — retries once if killed by iOS background suspension */
async function fetchWithTimeout(url: string, options: RequestInit, timeout = TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error('Request timed out. The server may be starting up — try again in a moment.');
      // Network error likely caused by iOS suspending the app — wait for foreground and retry once
      if (attempt === 0) {
        clearTimeout(timer);
        await waitForForeground();
        await checkNetwork();
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Request failed');
}

/** Get auth headers */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | any[];
}

/** Send a message to Claude via backend proxy */
export async function chat(messages: Message[], systemPrompt?: string): Promise<string> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${BASE}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages,
      system: systemPrompt || 'You are GoFarther AI, a helpful mobile assistant. Be concise and friendly.',
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || `API error (${res.status})`);
  }
  const data = await res.json();
  return data.text || 'No response';
}

/** chatStream — real-time SSE streaming from backend */
export async function chatStream(
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onAction?: (action: any) => void,
): Promise<string> {
  await checkNetwork();
  const headers = await authHeaders();

  const res = await fetchWithTimeout(`${BASE}/chat-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages,
      system: systemPrompt || 'You are GoFarther AI, a helpful mobile assistant.',
      max_tokens: 1024,
    }),
  }, 120000);

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || `API error (${res.status})`);
  }

  // Read SSE stream
  let fullText = '';
  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback: no streaming support, read as JSON
    const data = await res.json();
    fullText = data.text || 'No response';
    onChunk(fullText);
    return fullText;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'text') {
          fullText += event.text;
          onChunk(fullText);
        } else if (event.type === 'action' && onAction) {
          onAction(event.action);
        } else if (event.type === 'error') {
          throw new Error(event.text);
        } else if (event.type === 'done') {
          fullText = event.text || fullText;
        }
      } catch (e: any) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }

  if (!fullText) fullText = 'No response';
  return fullText;
}

/** Send image to Claude Vision via backend proxy */
export async function analyzeImage(base64: string, prompt: string = 'What do you see?'): Promise<string> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${BASE}/vision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_base64: base64, prompt }),
  }, 60000);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || `Vision error (${res.status})`);
  }
  const data = await res.json();
  return data.text || 'Could not analyze image';
}

/** Generate an image with DALL-E via backend proxy */
export async function generateImage(prompt: string): Promise<string> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${BASE}/image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, size: '1024x1024' }),
  }, 120000);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || `Image error (${res.status})`);
  }
  const data = await res.json();
  return data.url || '';
}

/** Text-to-speech via backend proxy — returns base64 audio */
export async function textToSpeech(text: string, voiceId: string = 'JBFqnCBsd6RMkjVDRZzb'): Promise<string> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${BASE}/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!res.ok) throw new Error('TTS failed');
  const data = await res.json();
  return data.audio_base64 || '';
}

/** Speak text using device TTS (fallback) */
export function speakText(text: string) {
  const Speech = require('expo-speech');
  Speech.speak(text, { rate: 0.95, pitch: 1.0 });
}


// ─── TOOLS API ───────────────────────────────────────────────────────────

const TOOLS_BASE = 'https://isibi-backend.onrender.com/api/ghost/tools';

/** Create a file (PDF, XLSX, DOCX, CSV, TXT) */
export async function createFile(description: string, fileType: string = 'pdf', quality: string = 'standard'): Promise<{ file_id: string; filename: string; download_url: string }> {
  await checkNetwork();
  const headers = await authHeaders();

  // Start async job (fast — returns immediately)
  const startRes = await fetchWithTimeout(`${TOOLS_BASE}/create-file-async`, {
    method: 'POST', headers,
    body: JSON.stringify({ description, file_type: fileType, quality }),
  }, 30000);
  if (!startRes.ok) throw new Error('File creation failed to start');
  const { job_id } = await startRes.json();

  // Poll for result — works even if app was backgrounded
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000)); // Wait 3 seconds between polls
    try {
      const pollRes = await fetchWithTimeout(`${TOOLS_BASE}/job-status/${job_id}`, {
        method: 'GET', headers,
      }, 10000);
      if (!pollRes.ok) continue;
      const job = await pollRes.json();
      if (job.status === 'done') {
        return { file_id: job.file_id, filename: job.filename, download_url: job.download_url };
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'File creation failed');
      }
      // Still processing — continue polling
    } catch (e: any) {
      if (e.message?.includes('File creation failed')) throw e;
      // Network error during poll — keep trying
      continue;
    }
  }
  throw new Error('File creation timed out');
}

/** Modify an existing file (edit, chart, convert, merge, filter) */
export async function modifyFile(operation: string, instructions: string, fileId?: string, targetFormat?: string): Promise<{ file_id: string; filename: string; download_url: string }> {
  await checkNetwork();
  const headers = await authHeaders();

  const startRes = await fetchWithTimeout(`${TOOLS_BASE}/modify-file-async`, {
    method: 'POST', headers,
    body: JSON.stringify({ operation, instructions, file_id: fileId, target_format: targetFormat }),
  }, 30000);
  if (!startRes.ok) throw new Error('File modification failed to start');
  const { job_id } = await startRes.json();

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await fetchWithTimeout(`${TOOLS_BASE}/job-status/${job_id}`, {
        method: 'GET', headers,
      }, 10000);
      if (!pollRes.ok) continue;
      const job = await pollRes.json();
      if (job.status === 'done') return { file_id: job.file_id, filename: job.filename, download_url: job.download_url };
      if (job.status === 'failed') throw new Error(job.error || 'File modification failed');
    } catch (e: any) {
      if (e.message?.includes('failed')) throw e;
      continue;
    }
  }
  throw new Error('File modification timed out');
}

/** Search the web */
export async function webSearch(query: string): Promise<{ query: string; results: any[] }> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/web-search`, {
    method: 'POST', headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

/** Read and summarize a URL */
export async function readURL(url: string, question?: string): Promise<{ summary: string }> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/read-url`, {
    method: 'POST', headers,
    body: JSON.stringify({ url, question }),
  }, 30000);
  if (!res.ok) throw new Error('Could not read URL');
  return res.json();
}

/** Get stock report */
export async function stockReport(symbol: string): Promise<any> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/stock-report`, {
    method: 'POST', headers,
    body: JSON.stringify({ symbol }),
  });
  if (!res.ok) throw new Error('Stock report failed');
  return res.json();
}

/** Get weather report */
export async function weatherReport(location: string): Promise<any> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/weather-report`, {
    method: 'POST', headers,
    body: JSON.stringify({ location }),
  });
  if (!res.ok) throw new Error('Weather report failed');
  return res.json();
}

/** Get news */
export async function getNews(topic: string): Promise<{ summary: string }> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/news`, {
    method: 'POST', headers,
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) throw new Error('News fetch failed');
  return res.json();
}

/** Run code (Python) */
export async function runCode(description: string): Promise<{ code: string; output: string }> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/run-code`, {
    method: 'POST', headers,
    body: JSON.stringify({ description }),
  }, 30000);
  if (!res.ok) throw new Error('Code execution failed');
  return res.json();
}

/** Translate text */
export async function translateText(text: string, targetLanguage: string): Promise<{ translation: string }> {
  await checkNetwork();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_BASE}/translate-doc`, {
    method: 'POST', headers,
    body: JSON.stringify({ text, target_language: targetLanguage }),
  });
  if (!res.ok) throw new Error('Translation failed');
  return res.json();
}

// ─── TOOLS V2 API ────────────────────────────────────────────────────────

const TOOLS_V2 = 'https://isibi-backend.onrender.com/api/ghost/tools/v2';

/** Send SMS silently via Twilio */
export async function sendSMSSilent(to: string, body: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/send-sms`, { method: 'POST', headers, body: JSON.stringify({ to, body }) });
  if (!res.ok) throw new Error('SMS failed');
  return res.json();
}

/** Send email silently via SendGrid */
export async function sendEmailSilent(to: string, subject: string, body: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/send-email`, { method: 'POST', headers, body: JSON.stringify({ to, subject, body }) });
  if (!res.ok) throw new Error('Email failed');
  return res.json();
}

/** YouTube video summary */
export async function youtubeSearch(url: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/youtube-summary`, { method: 'POST', headers, body: JSON.stringify({ url }) }, 30000);
  if (!res.ok) throw new Error('YouTube summary failed');
  return res.json();
}

/** Deep research */
export async function deepResearch(topic: string, type: string = 'general'): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/research`, { method: 'POST', headers, body: JSON.stringify({ topic, type }) }, 60000);
  if (!res.ok) throw new Error('Research failed');
  return res.json();
}

/** Generate QR code */
export async function generateQR(data: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/generate-qr`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  if (!res.ok) throw new Error('QR generation failed');
  return res.json();
}

/** Crypto portfolio */
export async function cryptoPortfolio(symbols: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/crypto-portfolio`, { method: 'POST', headers, body: JSON.stringify({ symbols }) });
  if (!res.ok) throw new Error('Crypto fetch failed');
  return res.json();
}

/** Create invoice */
export async function createInvoice(clientName: string, items: string, total?: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/create-invoice`, { method: 'POST', headers, body: JSON.stringify({ client_name: clientName, items, total }) }, 30000);
  if (!res.ok) throw new Error('Invoice creation failed');
  return res.json();
}

/** Trigger webhook */
export async function triggerWebhook(url: string, method: string = 'POST', body?: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/trigger-webhook`, { method: 'POST', headers, body: JSON.stringify({ url, method, body }) });
  if (!res.ok) throw new Error('Webhook failed');
  return res.json();
}

/** Create calendar event */
export async function createCalendarEvent(title: string, date: string, time?: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/create-event`, { method: 'POST', headers, body: JSON.stringify({ title, date, time }) });
  if (!res.ok) throw new Error('Event creation failed');
  return res.json();
}

/** Scan receipt */
export async function scanReceipt(imageBase64: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/scan-receipt`, { method: 'POST', headers, body: JSON.stringify({ image_base64: imageBase64 }) }, 30000);
  if (!res.ok) throw new Error('Receipt scan failed');
  return res.json();
}

/** Compare URLs/products */
export async function compareURLs(urls: string, question?: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/compare`, { method: 'POST', headers, body: JSON.stringify({ urls, question }) }, 30000);
  if (!res.ok) throw new Error('Comparison failed');
  return res.json();
}

/** Social media post generator */
export async function socialPost(platform: string, content: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/social-post`, { method: 'POST', headers, body: JSON.stringify({ platform, content }) });
  if (!res.ok) throw new Error('Post generation failed');
  return res.json();
}

/** Parse resume */
export async function parseResume(text: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/parse-resume`, { method: 'POST', headers, body: JSON.stringify({ resume_text: text }) });
  if (!res.ok) throw new Error('Resume parsing failed');
  return res.json();
}

/** Audio transcription */
export async function transcribeAudio(audioBase64: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V2}/transcribe`, { method: 'POST', headers, body: JSON.stringify({ audio_base64: audioBase64 }) }, 60000);
  if (!res.ok) throw new Error('Transcription failed');
  return res.json();
}

// ─── TOOLS V3 API ────────────────────────────────────────────────────────

const TOOLS_V3 = 'https://isibi-backend.onrender.com/api/ghost/tools/v3';

/** OCR — extract text from image */
export async function ocrImage(imageBase64: string): Promise<{ text: string }> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V3}/ocr`, { method: 'POST', headers, body: JSON.stringify({ image_base64: imageBase64 }) }, 30000);
  if (!res.ok) throw new Error('OCR failed');
  return res.json();
}

/** Create meme */
export async function createMeme(topText: string, bottomText?: string, style?: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V3}/create-meme`, { method: 'POST', headers, body: JSON.stringify({ top_text: topText, bottom_text: bottomText || '', style: style || 'classic' }) });
  if (!res.ok) throw new Error('Meme creation failed');
  return res.json();
}

/** Barcode lookup */
export async function barcodeLookup(barcode: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V3}/barcode-lookup`, { method: 'POST', headers, body: JSON.stringify({ barcode }) });
  if (!res.ok) throw new Error('Barcode lookup failed');
  return res.json();
}

/** Barcode scan from image */
export async function barcodeScan(imageBase64: string): Promise<any> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${TOOLS_V3}/barcode-scan`, { method: 'POST', headers, body: JSON.stringify({ image_base64: imageBase64 }) }, 30000);
  if (!res.ok) throw new Error('Barcode scan failed');
  return res.json();
}

/** Get weather */
export async function getWeather(location: string): Promise<string> {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=3`);
  return res.text();
}

/** Get stock price */
export async function getStockPrice(symbol: string): Promise<string> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1d`);
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price ? `${symbol.toUpperCase()}: $${price}` : 'Price unavailable';
  } catch { return 'Price unavailable'; }
}

/** Get crypto price */
export async function getCryptoPrice(symbol: string): Promise<string> {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol.toUpperCase()}-USD/spot`);
    const data = await res.json();
    return `${symbol.toUpperCase()}: $${data?.data?.amount || 'N/A'}`;
  } catch { return 'Price unavailable'; }
}
