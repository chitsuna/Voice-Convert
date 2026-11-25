/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TtsResponse {
  audio: string;
  mimeType: string;
}

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function isWavBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46    // F
  );
}

export async function decodeTtsAudioBuffer(
  base64Audio: string,
  mimeType: string | undefined,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const rawBytes = decodeBase64(base64Audio);

  if (isWavBytes(rawBytes) || mimeType?.toLowerCase().includes('wav')) {
    const arrayBuffer = rawBytes.buffer.slice(
      rawBytes.byteOffset,
      rawBytes.byteOffset + rawBytes.byteLength
    );
    return await ctx.decodeAudioData(arrayBuffer as ArrayBuffer);
  }

  // Fallback for headerless raw PCM (24kHz, mono, 16-bit LE)
  const sampleRate = 24000;
  const numChannels = 1;
  const dataInt16 = new Int16Array(
    rawBytes.buffer,
    rawBytes.byteOffset,
    Math.floor(rawBytes.byteLength / 2)
  );
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export async function fetchTtsAudio(
  text: string,
  voiceName: string,
  style?: string,
  signal?: AbortSignal
): Promise<TtsResponse> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceName,
      ...(style ? { style } : {}),
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  if (!data.audio) {
    throw new Error('No audio data received from API');
  }
  return {
    audio: data.audio,
    mimeType: data.mimeType || 'audio/wav',
  };
}

function buildWavHeader(pcmByteLength: number, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Uint8Array {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, pcmByteLength, true);

  return new Uint8Array(buffer);
}

export function createWavBlob(base64Audio: string, mimeType?: string): Blob {
  const rawBytes = decodeBase64(base64Audio);
  const copy = new Uint8Array(rawBytes.byteLength);
  copy.set(rawBytes);

  if (isWavBytes(copy) || mimeType?.toLowerCase().includes('wav')) {
    return new Blob([copy.buffer], { type: 'audio/wav' });
  }

  const header = buildWavHeader(copy.byteLength);
  const wavBytes = new Uint8Array(header.byteLength + copy.byteLength);
  wavBytes.set(header, 0);
  wavBytes.set(copy, header.byteLength);
  return new Blob([wavBytes.buffer], { type: 'audio/wav' });
}

export function buildWavFilename(voiceName: string, text: string): string {
  const slug = (text || 'speech')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const safeVoice = (voiceName || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${safeVoice}-${slug || 'audio'}.wav`;
}

export function downloadWavFile(
  base64Audio: string,
  mimeType: string | undefined,
  filename: string
): void {
  const blob = createWavBlob(base64Audio, mimeType);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.wav') ? filename : `${filename}.wav`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

