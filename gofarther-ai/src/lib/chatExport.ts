/** Chat export — text + PDF */
import { Share } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getChatHistory, ChatMessage } from './storage';

export async function exportChatAsText(sessionId: string, aiName: string = 'GoFarther AI'): Promise<string> {
  const messages = await getChatHistory(sessionId);
  if (!messages.length) return 'No messages in this chat.';

  const header = `GoFarther AI Chat Export\n${new Date().toLocaleDateString()}\n${'='.repeat(40)}\n\n`;
  const body = messages.map(m => {
    const sender = m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : aiName;
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${sender}:\n${m.content}`;
  }).join('\n\n');

  return header + body;
}

export async function shareChatText(sessionId: string, aiName?: string) {
  const text = await exportChatAsText(sessionId, aiName);
  await Share.share({ message: text, title: 'GoFarther AI Chat' });
}

export async function exportChatAsPDF(sessionId: string, aiName: string = 'GoFarther AI'): Promise<void> {
  const messages = await getChatHistory(sessionId);
  if (!messages.length) return;

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

  const messagesHtml = messages.map(m => {
    const sender = m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : aiName;
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isUser = m.role === 'user';
    const bgColor = isUser ? '#ec4899' : '#f2f2f2';
    const textColor = isUser ? '#ffffff' : '#1a1a1a';
    const align = isUser ? 'right' : 'left';

    return `
      <div style="margin-bottom: 16px; text-align: ${align};">
        <div style="font-size: 10px; color: #999; margin-bottom: 4px;">${sender} · ${time}</div>
        <div style="display: inline-block; max-width: 80%; padding: 12px 16px; border-radius: 16px; background: ${bgColor}; color: ${textColor}; font-size: 14px; line-height: 1.5; text-align: left;">
          ${escapeHtml(m.content)}
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>
      body { font-family: -apple-system, sans-serif; padding: 32px; max-width: 600px; margin: 0 auto; }
      h1 { font-size: 20px; color: #1a1a1a; margin-bottom: 4px; }
      .date { font-size: 12px; color: #999; margin-bottom: 24px; }
      hr { border: none; border-top: 1px solid #eee; margin: 16px 0; }
    </style></head>
    <body>
      <h1>GoFarther AI</h1>
      <div class="date">${new Date().toLocaleDateString()} · ${messages.length} messages</div>
      <hr/>
      ${messagesHtml}
      <hr/>
      <div style="font-size: 10px; color: #ccc; text-align: center; margin-top: 16px;">Exported from GoFarther AI</div>
    </body>
    </html>
  `;

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Chat PDF' });
    }
  } catch {}
}
