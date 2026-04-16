import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image,
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
  getMemory, getCustomInstructions, getLanguage, getSavedContacts, getConnectedApps, saveConnectedApps, trackEvent,
  getLearnedPreferences,
} from '../lib/storage';
import { getConnectors } from '../lib/api';
import { runAnalysisIfNeeded } from '../lib/preferenceAnalysis';
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
  // Bumped whenever a saved contact is added/updated mid-session so the
  // system-prompt effect re-runs and the newly learned contact ("my boss",
  // etc.) lands in the VERY NEXT message — not only after a screen refocus.
  const [contactsVersion, setContactsVersion] = useState(0);
  const flatList = useRef<FlatList>(null);

  // Use shared chat hook
  const [pendingAttachments, setPendingAttachments] = useState<{ base64: string; mimeType: string; name: string; uri: string; previewUri?: string }[]>([]);

  const {
    messages, setMessages, loading, setLoading, editingMsgId, setEditingMsgId, animatingIds, isCreating, removeAnimatingId,
    messagesRef, currentSessionId, send: chatSend, confirmAction, cancelAction, retryAction, setReaction, cancelCreation, regenerate, editMessage, submitEdit,
  } = useChat({
    sessionId,
    systemPrompt,
    onSessionCreated: (id, title) => {
      const session: ChatSession = { id, title, createdAt: Date.now(), agentId: null };
      getChatSessions().then(existing => saveChatSessions([session, ...existing]));
      onSessionCreated(session);
    },
    onContactsChanged: () => setContactsVersion(v => v + 1),
  });
  const insets = useSafeAreaInsets();
  const menuSlide = useRef(new Animated.Value(SH)).current;
  const menuBackdrop = useRef(new Animated.Value(0)).current;

  // Fun thinking status words
  const thinkingWords = [
    'Thinking', 'Pondering', 'Reasoning', 'Yakking', 'Combobulating',
    'Ruminating', 'Cogitating', 'Noodling', 'Percolating', 'Brainstorming',
    'Conjuring', 'Musing', 'Synthesizing', 'Crunching', 'Deciphering',
    'Untangling', 'Scheming', 'Mulling', 'Contemplating', 'Churning',
  ];
  const [thinkingWord, setThinkingWord] = useState(thinkingWords[0]);
  const [elapsed, setElapsed] = useState(0);
  const dotOpacity = useRef(new Animated.Value(1)).current;

  const isBusy = loading || isCreating;
  useEffect(() => {
    if (isBusy) {
      setElapsed(0);
      setThinkingWord(thinkingWords[Math.floor(Math.random() * thinkingWords.length)]);
      const wordInterval = setInterval(() => {
        setThinkingWord(thinkingWords[Math.floor(Math.random() * thinkingWords.length)]);
      }, 2500);
      const timerInterval = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
      const pulse = Animated.loop(Animated.sequence([
        Animated.timing(dotOpacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(dotOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]));
      pulse.start();
      return () => { clearInterval(wordInterval); clearInterval(timerInterval); pulse.stop(); };
    }
  }, [isBusy]);

  // Load agents and AI name, build system prompt
  const rebuildSystemPrompt = useCallback(async () => {
    // Refresh connected apps from the server so newly-added connectors
    // (e.g. Ringy reconnected with a new API key) show up in the prompt
    // without requiring a full app restart. Fall back to local cache on
    // network failure.
    try {
      const data = await getConnectors();
      const freshConnected = (data?.connectors || [])
        .filter((a: any) => a.connected)
        .map((a: any) => ({ id: a.id, name: a.name, category: a.category, icon: a.icon, actions: a.actions, action_hints: a.action_hints || {} }));
      await saveConnectedApps(freshConnected);
    } catch {
      // Offline or server hiccup — fall through to local cache below
    }

    const [memory, custom, lang, nick, savedContacts, connectedApps, learnedPrefs] = await Promise.all([
      getMemory(), getCustomInstructions(), getLanguage(), getUserNickname(), getSavedContacts(), getConnectedApps(), getLearnedPreferences(),
    ]);
    // Debug: log what connected apps we found so we can diagnose via the auth debug log
    const { authLog } = await import('../lib/api');
    await authLog(`rebuildPrompt: ${connectedApps?.length || 0} connected apps: ${(connectedApps || []).map((a: any) => `${a.name}[${(a.actions||[]).join(',')}]`).join(', ') || 'none'}`);
      setUserNickname(nick || '');
      const langMap: Record<string, string> = { en: '', es: '\n\nIMPORTANT: Always respond in Spanish.', fr: '\n\nIMPORTANT: Always respond in French.', pt: '\n\nIMPORTANT: Always respond in Portuguese.', de: '\n\nIMPORTANT: Always respond in German.' };
      const memoryStr = memory.length > 0 ? '\n\nYou remember these facts about the user:\n' + memory.map((m: any) => '- ' + m.fact).join('\n') : '';
      const prefsStr = learnedPrefs.length > 0 ? '\n\nLEARNED PREFERENCES (from user feedback — follow these):\n' + learnedPrefs.map((p: any) => '- ' + p.rule).join('\n') : '';
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

BULK SEND (send to multiple people at once — use when user says "email all my contacts", "text everyone", etc.):
{"type":"bulk_email","target":"[{\\"to\\":\\"email\\",\\"subject\\":\\"..\\",\\"body\\":\\"..\\"}]"}
{"type":"bulk_sms","target":"[{\\"to\\":\\"phone\\",\\"body\\":\\"..\\"}]"}
The target is a JSON array of recipients. Build it from the user's saved contacts.

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
{"type":"run_code","target":"what to compute/calculate"} — ONLY for pure math or algorithm snippets on data the user literally pastes into the chat. NEVER use run_code to touch external data: files on OneDrive/Google Drive, Excel workbooks, emails, CRM records, calendars, contacts, or anything that lives inside a connected app. The Python sandbox has NO network access, NO filesystem access to your OneDrive, and cannot import "os", "glob", "pathlib.Path.cwd()", "requests", etc. If the user says "grab info from my excel", "read my sheet", "pull my contacts", "check my emails", etc — that is ALWAYS a connector action or plan, NEVER run_code. If a connected app has an action for it, use the connector JSON instead.
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

FILE MODIFICATION (when user wants changes to ANY file — uploaded OR just created):
- "edit": modify content (add rows, change text, update data, ADD FORMULAS like =SUM, =AVERAGE)
- "chart": create a visualization from data (bar chart, pie chart, line chart, etc.)
- "convert": change format (Excel to PDF, CSV to Excel, etc.)
- "merge": combine multiple files into one
- "filter": extract specific rows/data matching criteria
- "compare": compare two spreadsheets and generate a diff report
- "reconcile": bank reconciliation — match bank statement vs book records, flag unmatched transactions. Returns styled Excel with Summary, Matched (green), Bank Only (red), Books Only (orange) sheets

IMPORTANT: When you just created a file using create_file, that file is ALREADY stored on the server. If the user says "modify it", "edit that", "delete a page", "add a row", "change the title", etc. — emit a modify_file action immediately. Do NOT ask them to upload or re-attach the file. The app automatically links modify_file to the most recent file.

SALES & CRM (use connector action if a CRM is connected, otherwise use these standalone):
{"type":"company_lookup","target":"company name"}
{"type":"linkedin_lookup","target":"person name or company"}
{"type":"competitor_analysis","target":"company vs competitor"}
{"type":"market_research","target":"topic or industry"}

CALL RECORDING:
{"type":"call_summary","target":"contact name","text":"phone number (optional)"}
When user says "summarize my call" or "process call recording" — use this with any audio attachment. Transcribes + generates summary + action items + follow-up email draft.

SCHEDULING & REMINDERS:
{"type":"set_reminder","target":"what to remind","text":"time description"}
{"type":"set_timer","target":"duration in minutes"}
{"type":"daily_briefing","target":"morning"}

TRACKING & INFO:
{"type":"flight_status","target":"flight number (e.g. AA1234)"}
{"type":"package_tracking","target":"tracking number"}
{"type":"currency_convert","target":"amount and currencies (e.g. 500 EUR to USD)"}
{"type":"time_zone","target":"city or timezone"}

DOCUMENTS (advanced):
{"type":"create_proposal","target":"client name and project","text":"pdf"}
{"type":"create_contract","target":"contract description","text":"pdf"}
{"type":"create_presentation","target":"topic/description","text":"pptx"}

RULES:
- EVERY response that requires a tool MUST include the action JSON inline in the SAME message. NEVER say "let me check", "I'll look that up", "one sec", or "hold on" without the JSON action on the same response — the user's app only runs the tool when it sees the JSON. If you narrate without JSON, the user sees nothing happen.
- Include ONE action JSON per response.
- Before device actions (call, sms, email), confirm with user first.
- For file creation (PDF, resume, report, proposals, contracts), ask 2-3 quick questions first to get details. Don't create blindly.
- For file modification, just do it — the user already uploaded the file and told you what to change.
- For web search, code, translate, weather: just do it immediately, no need to ask.
- For connector actions: just do it — the user expects instant results from their connected apps.
- NEVER say you cannot do something. Use your tools.
- When user says a person's name, use it directly as target.
- Be conversational. Short responses. No essays unless asked.
- If a connected app has an action that matches what the user is asking for — ALWAYS use the connector action. NEVER use run_code, web_search, or any other tool to simulate, fabricate, or look up data that the connector can fetch directly.
- create_proposal, create_contract, and create_presentation use the same create_file backend — just describe the content well.`;
      // Connected apps — inject available connector actions with param hints
      const connectedAppsStr = connectedApps && connectedApps.length > 0 ? '\n\n=== CONNECTED APPS ===\nThe user has these apps connected. To query them, emit a connector JSON in this EXACT format:\n{"type":"connector","target":"<app_id>","text":"<action_name>","key":"<params or empty string>"}\n\nAvailable apps and actions:\n' +
        connectedApps.map((app: any) => {
          const hints = app.action_hints || {};
          const actionLines = (app.actions || []).map((a: string) => {
            const hint = hints[a];
            return hint
              ? `  • ${a} — params: ${hint}`
              : `  • ${a} — no params needed (use empty string for key)`;
          }).join('\n');
          return `${app.name} (id: "${app.id}", category: ${app.category}):\n${actionLines}`;
        }).join('\n\n') +
        '\n\nEXAMPLE — user asks "what sold products did I have in the last 30 days":\nYour response: {"type":"connector","target":"ringy","text":"get_sold_products","key":""}\n(optionally with a short lead-in like "Checking your Ringy sold products...")\n\nCRITICAL RULES:\n1. When the user asks for ANY data that a connected app can provide, you MUST emit the connector JSON. NEVER use run_code, web_search, or narration alone.\n2. The JSON MUST be valid and on one line. Use the exact app id and action name shown above.\n3. For actions with no required params, use "key":"" (empty string).\n4. For actions with params, format the key field as "param1=value1|param2=value2" (pipe-separated).\n5. NEVER make up data. NEVER write Python/JS to simulate the response. The connector hits the real API.\n6. If you emit narration without the JSON action, the user sees nothing — ALWAYS include the JSON.\n\n=== ABSOLUTE RULE: SENDING EMAIL ===\nEvery time you need to send an email, you MUST emit a plan action with an email step. NEVER emit a direct connector action like {"type":"connector","target":"gmail","text":"send_email"} or {"type":"connector","target":"imap_mail","text":"send_email"} or any other <mail_app>.send_email variant. Direct connector sends bypass the outbound router and fail on custom domains. The plan email step routes through send_email_for_user on the backend, which picks the right connected mailbox (Gmail, Outlook, Neo, Titan, IMAP, Yahoo, etc.) automatically. This rule is absolute — even for a simple one-line email with no attachments, the action type MUST be "plan" with a single email step, not a bare connector action.\n\nWRONG (never do this): {"type":"connector","target":"imap_mail","text":"send_email","key":"to=a@b.com|subject=hi|body=hello"}\nRIGHT: {"type":"plan","steps":[{"id":"send","type":"email","params":{"to":"a@b.com","subject":"hi","html":"<p>hello</p>"}}]}\n\n=== MULTI-STEP PLANS ===\nWhen the user asks for a workflow that chains several things together (e.g. "build a report in Excel and email it to me", "sum column B and send the PDF to john@x.com"), emit a PLAN action instead of a single connector action. Format:\n{"type":"plan","steps":[<step1>,<step2>,...]}\n\nStep types:\n• Connector action: {"id":"<short_id>","type":"connector","app":"<app_id>","action":"<action_name>","params":{<key>:<value>, ...}}\n• Export an Excel workbook as a PDF (no connector needed, server-internal): {"id":"pdf","type":"excel_pdf","params":{"workbook":"<filename or partial name>"}}\n• Convert ANY file between formats — server-internal, handles xlsx↔csv, docx→pdf/txt, pdf→txt, pptx→pdf/txt, txt/md→pdf/docx, html→pdf, and any image↔image/png/jpg/webp/gif→pdf. Input can come from a prior step or a URL: {"id":"conv","type":"convert_file","params":{"attach_from":"<prior stepId>","to":"<target ext>"}} or {"id":"conv","type":"convert_file","params":{"url":"https://...","to":"pdf"}}. The `to` field is just the target extension (pdf, xlsx, csv, txt, docx, png, etc.).\n• Send an email (server-internal — routes through the user\'s connected email app: Gmail, Outlook, Neo, Titan, or IMAP, so the message lands in their real Sent folder and replies come back to them): {"id":"send","type":"email","params":{"to":"<email>","subject":"<subject>","html":"<html body>","attachments":[{"attach_from":"pdf"}]}}. Use the plan email step — NEVER emit a gmail.send_email / outlook_mail.send_email / imap_mail.send_email connector action directly; the server picks the right mailbox automatically. If the user has NO mail connector connected, tell them to connect one in Settings → Connect Apps first.\n\nRules:\n- Give each step a short "id" so later steps can reference it.\n- Reference prior step outputs in params as "$stepId.field". Example: "html":"<p>The sum is $build.sum</p>".\n- attachments can reference a prior excel_pdf step with {"attach_from":"<stepId>"} — the server wires the bytes in for you.\n- Use params as REAL JSON objects in plans (not pipe-separated strings). Example: "params":{"workbook_id":"budget","column":"B"}.\n- Still include a brief lead-in like "Building the report and emailing it..." before the JSON.\n\nEXAMPLE — user: "sum column B in my budget, export as PDF, and email it to me@example.com":\n{"type":"plan","steps":[{"id":"sum","type":"connector","app":"excel_online","action":"sum_column","params":{"workbook_id":"budget","column":"B"}},{"id":"pdf","type":"excel_pdf","params":{"workbook":"budget"}},{"id":"send","type":"email","params":{"to":"me@example.com","subject":"Budget report","html":"<p>Sum of column B: $sum.sum across $sum.count values.</p>","attachments":[{"attach_from":"pdf"}]}}]}\n\nCRITICAL — "grab info / data / values / contents from excel" ALWAYS means read_range. NEVER list_workbooks.\n\nWhen the user says ANY of:\n  - "grab all the info from the excel file"\n  - "send me the data from my sheet"\n  - "what\'s in my budget"\n  - "show me / send me / email me / pull my spreadsheet contents"\n  - "everything in the excel" / "all the values"\nYou MUST use excel_online.read_range to fetch the actual cell values. You MUST then interpolate those values into the email body using $read.values so the recipient actually sees the data. A "Here\'s the excel sheet you requested" email with NO data is useless and wrong. The $read.values reference is replaced by the server with an HTML table of the cell contents.\n\nlist_workbooks ONLY returns filenames (like "budget.xlsx", "sales.xlsx"). It does NOT return the data inside a workbook. Use list_workbooks ONLY when the user literally asks "what excel files do I have" or "list my workbooks". Never use it as a step toward reading data.\n\nIf the user doesn\'t name a specific workbook, leave workbook_id empty — the Excel adapter auto-picks when there\'s only one file, or returns a list of candidates for you to ask about. If they named a workbook (even partially, like "budget"), pass that name as workbook_id.\n\nEXAMPLE — user: "Grab all the info from the excel file and send it to my boss":\n{"type":"plan","steps":[{"id":"read","type":"connector","app":"excel_online","action":"read_range","params":{"workbook_id":"","range":"A1:Z200"}},{"id":"send","type":"email","params":{"to":"<boss email from saved contacts>","subject":"Data from your spreadsheet","html":"<p>Hi <boss name>, here\'s the data from the workbook:</p>$read.values<p>Let me know if you\'d like any of it broken out differently.</p>"}}]}\nNote: $read.values is INSIDE the html field and gets replaced with a real HTML table by the plan executor. Do NOT wrap $read.values in <pre> tags — the server already outputs a styled <table>.\n\nEXAMPLE — user: "send me the Q2 numbers from my sales sheet":\n{"type":"plan","steps":[{"id":"read","type":"connector","app":"excel_online","action":"read_range","params":{"workbook_id":"sales","range":"A1:Z200"}},{"id":"send","type":"email","params":{"to":"<user\'s own email from saved contacts>","subject":"Q2 numbers from your sales sheet","html":"<p>Here are the values from your sales sheet:</p>$read.values"}}]}\n\nNEGATIVE EXAMPLE — do NOT do this:\n{"type":"plan","steps":[{"id":"list","type":"connector","app":"excel_online","action":"list_workbooks","params":{}},{"id":"send","type":"email","params":{"to":"boss@x.com","subject":"Excel sheet","html":"<p>Here\'s the excel sheet you requested.</p>"}}]}\nReasons this is wrong: (a) list_workbooks returns filenames, not data, (b) the email body has NO reference to any step output so the recipient gets a meaningless greeting, (c) the user asked for the data, not a listing.\n\n=== SENDING THE ACTUAL FILE AS AN ATTACHMENT ===\nWhen the user says "send the file itself", "attach the spreadsheet", "send the actual xlsx", "attach the budget", "forward the file", etc — they want the binary file attached to the email, NOT the contents inlined. Use excel_online.download_workbook to get a download URL, then reference it in the email step\'s attachments array.\n\nEXAMPLE — user: "send the actual excel file to my boss":\n{"type":"plan","steps":[{"id":"dl","type":"connector","app":"excel_online","action":"download_workbook","params":{"workbook_id":""}},{"id":"send","type":"email","params":{"to":"<boss email from saved contacts>","subject":"<workbook name> for your review","html":"<p>Hi <boss name>, please find <filename> attached.</p>","attachments":[{"attach_from":"dl"}]}}]}\nThe {"attach_from":"dl"} reference tells the plan executor to pull the download URL from the dl step\'s output and fetch the actual xlsx bytes at send time. It gets attached to the email as a real file the recipient can open or download.\n\nEXAMPLE — user: "attach the budget and email it to me as pdf":\n{"type":"plan","steps":[{"id":"dl","type":"connector","app":"excel_online","action":"download_workbook","params":{"workbook_id":"budget","format":"pdf"}},{"id":"send","type":"email","params":{"to":"<user email>","subject":"Budget PDF","html":"<p>Here\'s the budget as a PDF.</p>","attachments":[{"attach_from":"dl"}]}}]}\nThe download_workbook action accepts a format param (xlsx, pdf, csv, docx, html, etc.) so the same pattern works for any output format.\n\nPICKING BETWEEN THE TWO PATTERNS:\n- "send me the data / info / values / numbers from my excel" → read_range + inline $read.values in the email body\n- "send me the actual file / the spreadsheet / attach the excel" → download_workbook + attachments:[{attach_from:"dl"}]\nIf the user\'s intent is ambiguous, prefer attaching the file — it\'s the more faithful representation of "send my spreadsheet" and the recipient can still open it to see the data.' : '';

      const contactsHeader = savedContacts.length > 0
        ? '\n\nThe user has saved these contacts. When they refer to someone by label (e.g. "my boss", "my mom", "my assistant"), use the matching contact info from this list — do NOT ask them for it again:\n' + savedContacts.map((c: any) => `- ${c.label} = ${c.name}${c.email ? ` (${c.email})` : ''}${c.phone ? ` (${c.phone})` : ''}`).join('\n')
        : '\n\nThe user has no saved contacts yet.';
      const contactsStr = contactsHeader + '\n\nCRITICAL CONTACT-LEARNING RULE:\nWhenever the user refers to someone by a *relationship label* ("my boss", "my mom", "my wife", "my assistant", "my lawyer", "my accountant", "my landlord", "my CPA", "my partner", etc.) AND they give you the email or phone for the FIRST time, you MUST remember it so you never ask again. You do this by attaching a `save_contact` sidecar field to whatever action you\'re already emitting. ANY action type can carry this sidecar — the client saves the contact first, then runs the main action.\n\nSidecar format: "save_contact":{"label":"<relationship lowercased>","name":"<person name if known, else same as label>","email":"<email>","phone":"<phone>"}\n\nExample — user: "send the budget pdf to my boss at john@acme.com":\n{"type":"plan","save_contact":{"label":"my boss","name":"John","email":"john@acme.com"},"steps":[{"id":"pdf","type":"excel_pdf","params":{"workbook":"budget"}},{"id":"send","type":"email","params":{"to":"john@acme.com","subject":"Budget report","html":"<p>...</p>","attachments":[{"attach_from":"pdf"}]}}]}\n\nContact Rules:\n1. If the relationship label is ALREADY in the saved contacts list above, do NOT re-save and do NOT ask for the email — use the stored email/phone silently.\n2. Only attach the sidecar the FIRST time you learn the info. After that, the list above will have it.\n3. The label MUST be the relationship phrase as the user said it, lowercased ("my boss", not "John" or "Boss").\n4. When the user says "send this to my boss" and "my boss" is already in the list, ALWAYS substitute the stored email directly into the action — never ask "what is their email?" again.\n\n=== EMAIL SUBJECT LINES ===\nNEVER ask the user for a subject line when sending an email. You ALWAYS generate a reasonable subject yourself based on the content and context. Only use the user\'s exact phrasing if they explicitly told you what the subject should be. Examples of good auto-generated subjects:\n- Sending a budget file → "Budget report" or "Q2 budget"\n- Forwarding a document → "<Document name> for your review"\n- Summary email → "Summary: <topic>"\n- Follow-up → "Following up on <topic>"\nIf you don\'t know the file name or topic yet, use a short, professional generic like "FYI" or "Quick update". NEVER stop a workflow to ask "what subject would you like?" — just pick one and send.\n\n=== EMAIL BODY RULE — DRAFT AND SEND IN ONE TURN ===\nWhen the user says "send an email to <person>" (or "email <person>", "shoot <person> an email", etc.) — EVEN WITHOUT specifying what to write — you MUST both draft AND send the email in the SAME response. No confirmation step. No "reply send to send it". The user already said "send", so send.\n\nYour response looks like this:\n\n  Sending a quick note to <name> now:\n\n  **To:** <email>\n  **Subject:** <subject you made up>\n\n  <the body you made up>\n\n  {"type":"plan","steps":[{"id":"send","type":"email","params":{"to":"<email>","subject":"<subject>","html":"<body wrapped in <p> tags>"}}]}\n\nThe JSON plan at the end is what actually sends it. Without the JSON, the email does NOT go out — narration alone is not a send. ALWAYS emit the JSON on the same turn.\n\nRules:\n  1. The "To:" and email in the plan MUST match a saved contact from the SAVED CONTACTS section if the user referenced a relationship label ("my boss", "my mom", etc.). Never ask for the email if it\'s in the saved list.\n  2. The subject and body are yours to write — pick a short, polite, professional one based on the relationship. Never ask "what would you like to say".\n  3. If the user has a saved EMAIL TEMPLATE that matches the intent (e.g. they said "send my welcome email" and a "welcome email" template exists), use the template\'s subject and body verbatim.\n  4. Only ask for clarification if the instruction is genuinely ambiguous (e.g. the person has two possible emails in saved contacts). Otherwise just send.\n\nGood draft examples:\n- "send email to my boss" → Subject "Quick check-in" · Body "Hi <name>, just wanted to touch base — let me know if there\'s anything you need from me this week. Thanks!"\n- "email my accountant" → Subject "Question" · Body "Hi <name>, do you have a few minutes this week to chat? Thanks."\n- "email my mom" → Subject "Hey" · Body "Hi mom, thinking of you. Hope your day is going well."\n\nIf the user wants to change the message AFTER the fact, they can say "send another one with <changes>" or similar — handle that as a new send. Do NOT try to unsend the first one (there\'s no unsend).';
      const nicknameStr = nick ? `\n\nIMPORTANT: The user's name/nickname is "${nick}". Use it naturally — greet them by name, refer to them by name occasionally. For example: "Hey ${nick}!", "Sure thing ${nick}", etc.` : '';
      setSystemPrompt(base + actions + connectedAppsStr + contactsStr + memoryStr + prefsStr + customStr + nicknameStr + (langMap[lang] || ''));
      // Run preference analysis on launch if enough reactions accumulated
      runAnalysisIfNeeded().catch(() => {});
  }, []);

  // Mount-once: load agents (they rarely change during a session)
  useEffect(() => {
    getAgents().then(a => {
      setAgents(a);
      if (a.length > 0) setActiveAgent(a.find(x => x.isActive) || a[0]);
    });
    getUserNickname().then(n => setUserNickname(n || ''));
  }, []);

  // Rebuild the system prompt every time this screen becomes focused. This is
  // what makes a newly-connected app (e.g. Ringy reconnected with a new API
  // key from Settings) show up in the chat's available tool list without
  // needing a full app restart. Also re-reads memory/prefs/contacts so any
  // edits the user just made land immediately.
  useFocusEffect(
    useCallback(() => {
      rebuildSystemPrompt();
    }, [rebuildSystemPrompt])
  );

  // Also rebuild the system prompt whenever the chat hook tells us a
  // contact was just saved. Without this, the newly-learned "my boss"
  // contact wouldn't show up in the prompt until the next screen refocus,
  // so the very next "send that to my boss" turn would still not know
  // the email. Runs on every bump of contactsVersion.
  useEffect(() => {
    if (contactsVersion > 0) rebuildSystemPrompt();
  }, [contactsVersion, rebuildSystemPrompt]);

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

  // Wrapper to send from input — includes pending attachments if any
  const send = (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text && !pendingAttachments.length) return;
    if (!overrideText) setInput('');
    if (pendingAttachments.length) {
      const images = pendingAttachments.filter(a => a.mimeType.startsWith('image/'));
      const files = pendingAttachments.filter(a => !a.mimeType.startsWith('image/'));
      // Send images through vision — pass base64 directly (URIs may expire)
      if (images.length) handleImageAttachB64(images.map(a => a.base64), text, images.map(a => a.previewUri || a.uri));
      // Send each file for analysis
      for (const file of files) {
        chatSend(text || `Analyze this file: ${file.name}`, undefined, undefined, file);
      }
      // If only images and user typed text, send text too
      if (images.length && !files.length && text) chatSend(text);
      setPendingAttachments([]);
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

  // Handle image from base64 (used by attachment system)
  const handleImageAttachB64 = async (base64s: string[], prompt?: string, imageUris?: string[]) => {
    const userMsg: ChatMsg = { id: genId(), role: 'user', content: prompt || '', timestamp: Date.now(), imageUrl: imageUris?.[0] };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    const aiMsgId = genId();
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '' }]);
    try {
      const analysis = await analyzeImage(base64s[0], prompt || 'What do you see in this image? Be specific and helpful.');
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: analysis } : m));
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: 'Could not analyze image: ' + (e.message || 'Error') } : m));
    } finally {
      setLoading(false);
    }
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

  /** Date separator helper */
  const formatDateLabel = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = today.getTime() - msgDate.getTime();
    if (diff === 0) return 'Today';
    if (diff === 86400000) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const renderMessage = React.useCallback(({ item, index }: { item: ChatMsg; index: number }) => {
    // Date separator: show if first message or different day from previous
    let showDateSep = false;
    if (item.timestamp) {
      if (index === 0) {
        showDateSep = true;
      } else {
        const prev = messages[index - 1];
        if (prev?.timestamp) {
          const d1 = new Date(prev.timestamp).toDateString();
          const d2 = new Date(item.timestamp).toDateString();
          showDateSep = d1 !== d2;
        }
      }
    }
    return (
      <>
        {showDateSep && item.timestamp && (
          <View style={s.dateSep}>
            <Text style={[s.dateSepText, { color: tc.textDim }]}>{formatDateLabel(item.timestamp)}</Text>
          </View>
        )}
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
          onRetry={retryAction}
          onReaction={setReaction}
          colors={bubbleColors}
        />
      </>
    );
  }, [aiName, animatingIds, bubbleColors, confirmAction, cancelAction, retryAction, setReaction, regenerate, handleEditMessage, copyMessage, removeAnimatingId, messages, tc.textDim]);

  // Voice mode
  if (showAR) return <ARScreen onClose={() => setShowAR(false)} />;
  if (voiceMode === 'picker') return <VoicePicker onSelect={(v) => { setSelectedVoice(v); setVoiceMode('active'); }} onCancel={() => setVoiceMode('off')} />;
  if (voiceMode === 'active') return <VoiceChat voice={selectedVoice} onClose={() => setVoiceMode('off')} agentName={aiName} chatSessionId={currentSessionId.current} />;

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
            ListFooterComponent={isBusy ? (
              <View style={s.typingRow}>
                <Animated.View style={{ opacity: dotOpacity }}>
                  <Text style={[s.thinkingText, { color: '#ec4899' }]}>{thinkingWord}...</Text>
                </Animated.View>
                <Animated.View style={{ opacity: dotOpacity }}>
                  <Text style={[s.thinkingStats, { color: tc.text, fontWeight: '600' }]}>{Math.floor(elapsed)}s · ↓ {Math.round(elapsed * 8)} tokens</Text>
                </Animated.View>
              </View>
            ) : null}
          />
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
        <View style={s.inputRow}>
          <TouchableOpacity onPress={openMenu} activeOpacity={0.6} accessibilityLabel="Actions menu" accessibilityRole="button">
            <View style={s.plusCircle}>
              <Ionicons name="add" size={20} color={tc.text} />
            </View>
          </TouchableOpacity>
          <View style={[s.inputBar, { backgroundColor: tc.inputBg || '#efefef' }]}>
            {/* Attachment previews inside input bar */}
            {pendingAttachments.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.attachPreviewScroll} contentContainerStyle={{ gap: 6, paddingTop: 8, paddingHorizontal: 4 }}>
                {pendingAttachments.map((att, idx) => (
                  <View key={idx} style={s.attachChip}>
                    {att.previewUri ? (
                      <Image source={{ uri: att.previewUri }} style={s.attachThumb} />
                    ) : (
                      <View style={s.attachFileIcon}>
                        <Ionicons name="document-outline" size={14} color="#666" />
                      </View>
                    )}
                    <Text style={[s.attachName, { color: tc.textMid }]} numberOfLines={1}>{att.name}</Text>
                    <TouchableOpacity onPress={() => setPendingAttachments(prev => prev.filter((_, i) => i !== idx))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name="close-circle" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={s.inputInnerRow}>
              <TextInput style={[s.input, { color: tc.text }]} value={input} onChangeText={setInput}
                placeholder={editingMsgId ? 'Edit your message...' : pendingAttachments.length ? 'Add a message...' : messages.length === 0 ? 'How can I help you today?' : 'Reply...'}
                placeholderTextColor={tc.textDim} multiline maxLength={2000}
                onSubmitEditing={() => editingMsgId ? handleSubmitEdit() : send()} blurOnSubmit={false} />
              {isCreating && !input.trim() && !pendingAttachments.length ? (
                <TouchableOpacity style={s.inputIconBtn} onPress={cancelCreation} activeOpacity={0.7}>
                  <View style={s.stopBtn}>
                    <View style={s.stopSquare} />
                  </View>
                </TouchableOpacity>
              ) : (input.trim() || pendingAttachments.length > 0) ? (
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
                  setPendingAttachments(prev => [...prev, { base64, mimeType: a.mimeType || 'image/jpeg', name: a.name, uri: a.uri, previewUri: a.uri }]);
                } },
                { label: 'Photos', icon: 'images-outline', onPress: async () => {
                  closeMenu(); tapHaptic();
                  const picked = await pickPhotos();
                  if (!picked.length) return;
                  const newAttachments = await Promise.all(picked.map(async (img) => {
                    const base64 = await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 });
                    return { base64, mimeType: img.mimeType || 'image/jpeg', name: img.name, uri: img.uri, previewUri: img.uri };
                  }));
                  setPendingAttachments(prev => [...prev, ...newAttachments]);
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
                    setPendingAttachments(prev => [...prev, { base64, mimeType, name: a.name, uri: a.uri, previewUri: mimeType.startsWith('image/') ? a.uri : undefined }]);
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

  // Date separators
  dateSep: { alignItems: 'center' as const, paddingVertical: 8, marginBottom: 4 },
  dateSepText: { fontSize: 11, fontWeight: '500' as const },

  // Thinking status
  typingRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingHorizontal: 16, paddingVertical: 8 },
  thinkingText: { fontSize: 13, fontStyle: 'italic' as const, fontWeight: '500' as const },
  thinkingStats: { fontSize: 12, fontWeight: '400' as const },

  // Smart suggestions
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  suggestChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  suggestText: { fontSize: 14, fontWeight: '500' },

  // Input bar
  inputInnerRow: { flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 10 },
  attachPreviewScroll: { marginTop: 8, marginHorizontal: 6 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 4, paddingRight: 8, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  attachThumb: { width: 40, height: 40, borderRadius: 8 },
  attachFileIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' },
  attachName: { fontSize: 13, fontWeight: '500', maxWidth: 140 },
  inputBarOuter: { paddingHorizontal: 12, paddingTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputBar: { flex: 1, borderRadius: 24, paddingHorizontal: 6, minHeight: 44 },
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
