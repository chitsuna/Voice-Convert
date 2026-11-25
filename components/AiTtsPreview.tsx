/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Loader2, Volume2, AlertCircle, ChevronDown, Download } from 'lucide-react';
import { Voice } from '../types';
import AudioVisualizer from './AudioVisualizer';
import { fetchTtsAudio, decodeTtsAudioBuffer, downloadWavFile, buildWavFilename } from '../utils/ttsAudio';

interface AiTtsPreviewProps {
  text: string;
  voices: Voice[];
}

const AiTtsPreview: React.FC<AiTtsPreviewProps> = ({ text, voices }) => {
  const [selectedVoiceName, setSelectedVoiceName] = useState(voices[0]?.name || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const cachedAudioRef = useRef<{ key: string; audio: string; mimeType: string } | null>(null);
  const isMountedRef = useRef(true);

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
    if (voices.length > 0 && !voices.find(v => v.name === selectedVoiceName)) {
        setSelectedVoiceName(voices[0].name);
    }
  }, [voices, selectedVoiceName]);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPlaying(false);
    }
  };

  const handlePlay = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    if (isLoading) return;

    if (isPlaying) {
      stopAudio();
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    const voiceToUse = selectedVoiceName || voices[0]?.name || 'Zephyr';
    const cacheKey = `${voiceToUse}::${text}`;

    try {
      let audio: string;
      let mimeType: string;

      if (cachedAudioRef.current?.key === cacheKey) {
        audio = cachedAudioRef.current.audio;
        mimeType = cachedAudioRef.current.mimeType;
      } else {
        const result = await fetchTtsAudio(text, voiceToUse);
        audio = result.audio;
        mimeType = result.mimeType;
        cachedAudioRef.current = { key: cacheKey, audio, mimeType };
      }
      
      if (!isMountedRef.current) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const audioBuffer = await decodeTtsAudioBuffer(audio, mimeType, audioContextRef.current);
      
      if (!isMountedRef.current) return;

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => {
        if (isMountedRef.current) setIsPlaying(false);
      };
      
      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);

    } catch (err: any) {
      console.error("TTS Error:", err);
      if (isMountedRef.current) setError(err?.message || "Failed to generate speech. Please try again.");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  const handleDownloadWav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;

    const voiceToUse = selectedVoiceName || voices[0]?.name || 'Zephyr';
    const cacheKey = `${voiceToUse}::${text}`;
    const filename = buildWavFilename(voiceToUse, text);

    setError(null);

    if (cachedAudioRef.current?.key === cacheKey) {
      downloadWavFile(cachedAudioRef.current.audio, cachedAudioRef.current.mimeType, filename);
      return;
    }

    setIsDownloading(true);
    try {
      const { audio, mimeType } = await fetchTtsAudio(text, voiceToUse);
      if (!isMountedRef.current) return;
      cachedAudioRef.current = { key: cacheKey, audio, mimeType };
      downloadWavFile(audio, mimeType, filename);
    } catch (err: any) {
      console.error("TTS Download Error:", err);
      if (isMountedRef.current) setError(err?.message || "Failed to download WAV file.");
    } finally {
      if (isMountedRef.current) setIsDownloading(false);
    }
  };

  return (
    <div className="w-full bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {/* Header / Controls */}
        <div className="p-4 flex flex-col sm:flex-row gap-4 items-center justify-between bg-white dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
            
            {/* Voice Selector */}
            <div className="relative group w-full sm:w-auto">
                <select
                    value={selectedVoiceName}
                    onChange={(e) => setSelectedVoiceName(e.target.value)}
                    className="appearance-none w-full sm:w-48 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 py-2 pl-3 pr-10 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-600 cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    disabled={isLoading || isPlaying}
                >
                    {voices.map(voice => (
                        <option key={voice.name} value={voice.name}>
                            {voice.name} ({voice.analysis.gender})
                        </option>
                    ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
                    <ChevronDown size={14} />
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                  onClick={handlePlay}
                  disabled={isLoading}
                  className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 transform active:scale-95 ${
                      isPlaying 
                      ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600' 
                      : 'bg-zinc-900 dark:bg-indigo-600 text-white hover:bg-zinc-800 dark:hover:bg-indigo-500 shadow-md'
                  } ${isLoading ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                  {isLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                  ) : isPlaying ? (
                      <Square size={16} className="fill-current" />
                  ) : (
                      <Play size={16} className="fill-current" />
                  )}
                  <span>{isLoading ? 'Generating...' : isPlaying ? 'Stop Preview' : 'Listen'}</span>
              </button>

              <button
                  onClick={handleDownloadWav}
                  disabled={isDownloading}
                  title="Download WAV file"
                  aria-label="Download WAV file"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Visualizer Area */}
        <div 
            className={`h-24 relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 overflow-hidden group ${isLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`} 
            onClick={handlePlay}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') handlePlay(); }}
            aria-label={isPlaying ? "Stop audio preview" : "Play audio preview"}
        >
             {/* Grid Background */}
             <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.1]" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '8px 8px' }}></div>
            
             {/* Icon or Visualizer */}
             <div className="w-full h-full absolute inset-0 flex items-center justify-center pointer-events-none">
                 {isPlaying ? (
                     <div className="w-full h-full opacity-80">
                         <AudioVisualizer isPlaying={true} color={document.documentElement.classList.contains('dark') ? '#a5b4fc' : '#18181b'} />
                     </div>
                 ) : (
                     <div className="flex flex-col items-center gap-2 text-zinc-300 dark:text-zinc-600">
                         <Volume2 size={24} />
                         <span className="text-xs font-medium">Click to preview audio</span>
                     </div>
                 )}
             </div>

             {/* Error Message */}
             {error && (
                 <div className="absolute inset-0 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-red-500 dark:text-red-400 gap-2 text-sm z-20">
                     <AlertCircle size={16} />
                     <span>{error}</span>
                 </div>
             )}
        </div>
    </div>
  );
};

export default AiTtsPreview;