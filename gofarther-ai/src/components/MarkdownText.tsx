import React from 'react';
import { Text, View, StyleSheet, Platform, Linking, TouchableOpacity } from 'react-native';

interface Props {
  children: string;
  colors?: { text: string; textMid: string; textDim: string };
}

/** Simple markdown renderer — handles bold, italic, code, code blocks, lists, headings */
export default function MarkdownText({ children, colors }: Props) {
  const textColor = colors?.text === '#f2f2f2' ? '#f2f2f2' : '#1f2937';
  const dimColor = colors?.textDim || '#666';
  const isDark = textColor === '#f2f2f2';
  const lines = children.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <View key={key++} style={[ms.codeBlock, isDark && ms.codeBlockDark]}>
            {codeBlockLang ? <Text style={ms.codeBlockLang}>{codeBlockLang}</Text> : null}
            <Text style={[ms.codeBlockText, isDark && ms.codeBlockTextDark]}>{codeBlockLines.join('\n')}</Text>
          </View>
        );
        codeBlockLines = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Heading
    if (line.startsWith('### ')) {
      elements.push(<Text key={key++} style={[ms.h3, { color: textColor }]}>{parseLine(line.slice(4), isDark)}</Text>);
    } else if (line.startsWith('## ')) {
      elements.push(<Text key={key++} style={[ms.h2, { color: textColor }]}>{parseLine(line.slice(3), isDark)}</Text>);
    } else if (line.startsWith('# ')) {
      elements.push(<Text key={key++} style={[ms.h1, { color: textColor }]}>{parseLine(line.slice(2), isDark)}</Text>);
    }
    // Bullet list
    else if (/^[-*] /.test(line)) {
      elements.push(
        <View key={key++} style={ms.listItem}>
          <Text style={[ms.bullet, { color: dimColor }]}>{'\u2022  '}</Text>
          <Text style={[ms.listText, { color: textColor }]}>{parseLine(line.slice(2), isDark)}</Text>
        </View>
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <View key={key++} style={ms.listItem}>
            <Text style={[ms.numBullet, { color: dimColor }]}>{match[1]}.  </Text>
            <Text style={[ms.listText, { color: textColor }]}>{parseLine(match[2], isDark)}</Text>
          </View>
        );
      }
    }
    // Horizontal rule
    else if (/^---+$/.test(line.trim())) {
      elements.push(<View key={key++} style={ms.hr} />);
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<View key={key++} style={{ height: 10 }} />);
    }
    // Normal paragraph
    else {
      elements.push(<Text key={key++} style={[ms.body, { color: textColor }]}>{parseLine(line, isDark)}</Text>);
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockLines.length) {
    elements.push(
      <View key={key++} style={[ms.codeBlock, isDark && ms.codeBlockDark]}>
        <Text style={[ms.codeBlockText, isDark && ms.codeBlockTextDark]}>{codeBlockLines.join('\n')}</Text>
      </View>
    );
  }

  return <View>{elements}</View>;
}

/** Parse inline formatting: **bold**, *italic*, `code` */
function parseLine(text: string, isDark = false): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    // Link [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    // Bold **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Inline code `text`
    const codeMatch = remaining.match(/`(.+?)`/);
    // Find earliest match
    let earliest: { type: string; match: RegExpMatchArray; index: number } | null = null;

    if (linkMatch?.index !== undefined) {
      earliest = { type: 'link', match: linkMatch, index: linkMatch.index };
    }
    if (boldMatch?.index !== undefined && (!earliest || boldMatch.index < earliest.index)) {
      earliest = { type: 'bold', match: boldMatch, index: boldMatch.index };
    }
    if (codeMatch?.index !== undefined && (!earliest || codeMatch.index < earliest.index)) {
      earliest = { type: 'code', match: codeMatch, index: codeMatch.index };
    }
    // Simple italic — single * not part of **
    if (!earliest || earliest.type !== 'bold') {
      const italicMatch = remaining.match(/\*([^*]+)\*/);
      if (italicMatch?.index !== undefined && (!earliest || italicMatch.index < earliest.index)) {
        earliest = { type: 'italic', match: italicMatch, index: italicMatch.index };
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    // Text before match
    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }

    if (earliest.type === 'link') {
      const linkText = earliest.match[1];
      const linkUrl = earliest.match[2];
      parts.push(
        <Text key={k++} style={ms.link} onPress={() => Linking.openURL(linkUrl)}>{linkText}</Text>
      );
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else if (earliest.type === 'bold') {
      parts.push(<Text key={k++} style={ms.bold}>{earliest.match[1]}</Text>);
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else if (earliest.type === 'code') {
      parts.push(<Text key={k++} style={[ms.inlineCode, isDark && ms.inlineCodeDark]}>{earliest.match[1]}</Text>);
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else if (earliest.type === 'italic') {
      parts.push(<Text key={k++} style={ms.italic}>{earliest.match[1]}</Text>);
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <Text>{parts}</Text>;
}

const ms = StyleSheet.create({
  body: { fontSize: 17, color: '#1f2937', lineHeight: 27, letterSpacing: 0.1 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { color: '#0066cc', textDecorationLine: 'underline' as any },
  inlineCode: { backgroundColor: '#f0f0f0', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, color: '#1f2937', overflow: 'hidden' },
  inlineCodeDark: { backgroundColor: '#2a2a2a', color: '#e0e0e0' },
  h1: { fontSize: 24, fontWeight: '700', color: '#1f2937', marginTop: 8, marginBottom: 4 },
  h2: { fontSize: 20, fontWeight: '700', color: '#1f2937', marginTop: 6, marginBottom: 4 },
  h3: { fontSize: 17, fontWeight: '600', color: '#1f2937', marginTop: 4, marginBottom: 2 },
  listItem: { flexDirection: 'row', marginVertical: 3, paddingRight: 16 },
  bullet: { fontSize: 17, color: '#666', lineHeight: 27, width: 20 },
  numBullet: { fontSize: 17, color: '#666', lineHeight: 27, width: 24 },
  listText: { flex: 1, fontSize: 17, color: '#1f2937', lineHeight: 27 },
  codeBlock: { backgroundColor: '#1e1e1e', padding: 16, borderRadius: 12, marginVertical: 10 },
  codeBlockDark: { backgroundColor: '#111111' },
  codeBlockLang: { fontSize: 11, color: '#666', fontWeight: '500', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  codeBlockText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color: '#d4d4d4', lineHeight: 20 },
  codeBlockTextDark: { color: '#d4d4d4' },
  hr: { backgroundColor: '#e0e0e0', height: 1, marginVertical: 14 },
});
