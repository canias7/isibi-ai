/** GoFarther AI — Claude + OpenAI + ElevenLabs APIs */

const ANTHROPIC_KEY = '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';
const OPENAI_KEY = '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';
const ELEVEN_KEY = 'sk_66d8a0471797c1ab6cae2db1913df95f08749e1c9bef2489';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** Send a message to Claude and get a response */
export async function chat(messages: Message[], systemPrompt?: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt || 'You are GoFarther AI, a helpful mobile assistant. Be concise and friendly.',
      messages,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || 'No response';
}

/** Generate an image with DALL-E 3 */
export async function generateImage(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data?.[0]?.url || '';
}

/** Text-to-speech with ElevenLabs */
export async function textToSpeech(text: string, voiceId: string = 'JBFqnCBsd6RMkjVDRZzb'): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVEN_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  return res.arrayBuffer();
}

/** List ElevenLabs voices */
export async function listVoices(): Promise<any[]> {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': ELEVEN_KEY },
  });
  const data = await res.json();
  return data.voices || [];
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
