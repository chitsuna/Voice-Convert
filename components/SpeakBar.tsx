/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Volume2, Square, Loader2, ChevronDown, AlertCircle, X, Zap, Download } from 'lucide-react';
import { Voice } from '../types';
import { fetchTtsAudio, decodeTtsAudioBuffer, downloadWavFile, buildWavFilename } from '../utils/ttsAudio';
import AudioVisualizer from './AudioVisualizer';

export interface TonePreset {
  id: string;
  label: string;
  style: string;
}

export const TONE_PRESETS: TonePreset[] = [
  { id: 'excited', label: 'Excited', style: 'Very excited, energetic, enthusiastic, upbeat delivery' },
  { id: 'hyped', label: 'Hyped', style: 'Hyped, thrilling, high-energy, bursting with excitement' },
  { id: 'cheerful', label: 'Cheerful', style: 'Cheerful, bright, warm, and smiling' },
  { id: 'dramatic', label: 'Dramatic', style: 'Dramatic, bold, intense theatrical delivery' },
  { id: 'calm', label: 'Calm', style: 'Calm, relaxed, soothing, steady pace' },
  { id: 'neutral', label: 'Neutral', style: '' },
];

interface SpeakBarProps {
  text: string;
  onTextChange: (text: string) => void;
  toneId: string;
  onToneChange: (toneId: string) => void;
  customTone: string;
  onCustomToneChange: (tone: string) => void;
  voices: Voice[];
  selectedVoiceName: string;
  onVoiceChange: (voiceName: string) => void;
  onStartSpeaking: () => void;
  stopSignal: number;
  disabled?: boolean;
}

const SpeakBar: React.FC<SpeakBarProps> = ({
  text,
  onTextChange,
  toneId,
  onToneChange,
  customTone,
  onCustomToneChange,
  voices,
  selectedVoiceName,
  onVoiceChange,
  onStartSpeaking,
  stopSignal,
  disabled = false,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cachedAudioRef = useRef<{ key: string; audio: string; mimeType: string } | null>(null);
  const isMountedRef = useRef(true);

  const stopAudio = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPlaying(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    if (stopSignal > 0) {
      stopAudio();
    }
  }, [stopSignal]);

  const resolvedStyle =
    toneId === 'custom'
      ? customTone.trim()
      : TONE_PRESETS.find((t) => t.id === toneId)?.style ?? '';

  const handleSpeak = async () => {
    if (disabled) return;

    if (isPlaying || isLoading) {
      stopAudio();
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setError('Enter a phrase to speak.');
      return;
    }

    onStartSpeaking();
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const voiceToUse = selectedVoiceName || voices[0]?.name || 'Zephyr';
    const cacheKey = `${voiceToUse}::${resolvedStyle}::${trimmed}`;

    try {
      let audio: string;
      let mimeType: string;

      if (cachedAudioRef.current?.key === cacheKey) {
        audio = cachedAudioRef.current.audio;
        mimeType = cachedAudioRef.current.mimeType;
      } else {
        const result = await fetchTtsAudio(
          trimmed,
          voiceToUse,
          resolvedStyle || undefined,
          controller.signal
        );
        audio = result.audio;
        mimeType = result.mimeType;
        cachedAudioRef.current = { key: cacheKey, audio, mimeType };
      }

      if (!isMountedRef.current || controller.signal.aborted) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const audioBuffer = await decodeTtsAudioBuffer(audio, mimeType, audioContextRef.current);
      if (!isMountedRef.current || controller.signal.aborted) return;

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => {
        if (isMountedRef.current) {
          setIsPlaying(false);
        }
      };

      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('SpeakBar TTS Error:', err);
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to generate speech. Please try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleDownloadWav = async () => {
    if (disabled || isDownloading) return;

    const trimmed = text.trim();
    if (!trimmed) {
      setError('Enter a phrase to download.');
      return;
    }

    const voiceToUse = selectedVoiceName || voices[0]?.name || 'Zephyr';
    const cacheKey = `${voiceToUse}::${resolvedStyle}::${trimmed}`;
    const filename = buildWavFilename(voiceToUse, trimmed);

    setError(null);

    if (cachedAudioRef.current?.key === cacheKey) {
      downloadWavFile(cachedAudioRef.current.audio, cachedAudioRef.current.mimeType, filename);
      return;
    }

    setIsDownloading(true);
    try {
      const { audio, mimeType } = await fetchTtsAudio(
        trimmed,
        voiceToUse,
        resolvedStyle || undefined
      );
      if (!isMountedRef.current) return;
      cachedAudioRef.current = { key: cacheKey, audio, mimeType };
      downloadWavFile(audio, mimeType, filename);
    } catch (err: any) {
      console.error('SpeakBar WAV Download Error:', err);
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to download WAV file.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsDownloading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSpeak();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-4 pt-1 relative z-40 shrink-0">
      {error && (
        <div className="mb-2 mx-auto max-w-xl flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-xs font-medium shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors shrink-0"
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200/90 dark:border-zinc-700/80 shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] rounded-2xl p-2 sm:p-2.5 flex flex-col gap-2 transition-colors">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
          {/* Phrase Input */}
          <div className="relative flex-1 flex items-center min-w-0">
            <input
              type="text"
              value={text}
              onChange={(e) => {
                onTextChange(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type text to speak..."
              disabled={disabled || isLoading}
              aria-label="Text to speak"
              className="w-full bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200/70 dark:border-zinc-700 rounded-xl pl-3.5 pr-9 py-2 text-sm sm:text-base text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:bg-white dark:focus:bg-zinc-800 transition-all"
            />
            {text && !isLoading && !isPlaying && (
              <button
                type="button"
                onClick={() => onTextChange('')}
                className="absolute right-2.5 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full transition-colors"
                aria-label="Clear text"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
            {/* Tone Selector */}
            <div className="relative flex-1 sm:flex-initial">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-amber-500 dark:text-amber-400">
                <Zap size={13} />
              </div>
              <select
                value={toneId}
                onChange={(e) => onToneChange(e.target.value)}
                disabled={disabled || isLoading || isPlaying}
                aria-label="Select tone"
                className="appearance-none w-full sm:w-32 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 py-2 pl-7 pr-7 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-60"
              >
                {TONE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom...</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
                <ChevronDown size={13} />
              </div>
            </div>

            {/* Voice Selector */}
            <div className="relative flex-1 sm:flex-initial">
              <select
                value={selectedVoiceName}
                onChange={(e) => onVoiceChange(e.target.value)}
                disabled={disabled || isLoading || isPlaying}
                aria-label="Select voice"
                className="appearance-none w-full sm:w-40 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 py-2 pl-3 pr-8 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-60"
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} ({voice.analysis.gender})
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-400">
                <ChevronDown size={14} />
              </div>
            </div>

            {/* Live mini visualizer when speaking */}
            {isPlaying && (
              <div className="hidden lg:block w-14 h-8 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-1">
                <AudioVisualizer
                  isPlaying={true}
                  color={document.documentElement.classList.contains('dark') ? '#a5b4fc' : '#18181b'}
                />
              </div>
            )}

            {/* Speak / Stop Button */}
            <button
              type="button"
              onClick={handleSpeak}
              disabled={disabled || (!text.trim() && !isPlaying && !isLoading)}
              className={`flex items-center justify-center gap-2 px-4 sm:px-5 py-2 rounded-xl text-sm font-medium transition-all duration-200 active:scale-95 shrink-0 ${
                isPlaying
                  ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  : 'bg-zinc-900 dark:bg-indigo-600 text-white hover:bg-zinc-800 dark:hover:bg-indigo-500 shadow-md disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isPlaying ? (
                <Square size={15} className="fill-current" />
              ) : (
                <Volume2 size={16} />
              )}
              <span>{isLoading ? 'Speaking...' : isPlaying ? 'Stop' : 'Speak'}</span>
            </button>

            {/* Download WAV Button */}
            <button
              type="button"
              onClick={handleDownloadWav}
              disabled={disabled || isDownloading || !text.trim()}
              title="Download WAV file"
              aria-label="Download WAV file"
              className="flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all duration-200 active:scale-95 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              <span>WAV</span>
            </button>
          </div>
        </div>

        {/* Optional Custom Tone Input */}
        {toneId === 'custom' && (
          <input
            type="text"
            value={customTone}
            onChange={(e) => onCustomToneChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe delivery tone (e.g. Thrilled sports announcer, breathless excitement)..."
            disabled={disabled || isLoading}
            aria-label="Custom delivery tone"
            className="w-full bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200/70 dark:border-zinc-700 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 transition-all"
          />
        )}
      </div>
    </div>
  );
};

export default SpeakBar;
