/** Speech-to-Text — currently not available, voice mode uses text input */
// Recording with expo-audio requires testing on device after native build
// For now, voice mode will use text input + TTS output

export async function startRecording(): Promise<void> {
  throw new Error('Voice input coming soon — type your message instead');
}

export async function stopRecording(): Promise<string> {
  throw new Error('Voice input coming soon');
}

export function cancelRecording() {
  // no-op
}
