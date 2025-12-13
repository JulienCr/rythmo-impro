'use client';

/**
 * RemoteControls Component
 *
 * Player controls that send WebSocket commands (no video element)
 * - Play/Pause button
 * - Seek bar
 * - Current time / Duration display
 * - Sync with display state updates
 */

import { useCallback, useState, useEffect } from 'react';
import type { VideoState } from '../lib/websocket/types';

export interface RemoteControlsProps {
  videoState: VideoState | null;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
}

/**
 * Format time in seconds to MM:SS
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function RemoteControls({
  videoState,
  onPlay,
  onPause,
  onSeek,
}: RemoteControlsProps) {
  const [seekValue, setSeekValue] = useState(0);

  // Sync seek bar with video state
  useEffect(() => {
    if (videoState) {
      setSeekValue(videoState.currentTime);
    }
  }, [videoState?.currentTime]);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setSeekValue(newTime);
  }, []);

  const handleSeekCommit = useCallback(() => {
    onSeek(seekValue);
  }, [seekValue, onSeek]);

  const { playing, currentTime, duration } = videoState || {
    playing: false,
    currentTime: 0,
    duration: 0,
  };
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasState = videoState !== null;

  return (
    <div className="flex items-center gap-4">
      {/* Play/Pause Button */}
      <button
        onClick={playing ? onPause : onPlay}
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-700"
      >
        {playing ? (
          // Pause icon
          <svg
            className="h-5 w-5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          // Play icon
          <svg
            className="h-5 w-5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time Display */}
      <div className="flex-shrink-0 text-sm text-gray-400" style={{ width: '100px' }}>
        <span>{formatTime(currentTime)}</span>
        <span className="text-gray-600"> / </span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Seek Bar */}
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={seekValue}
          onChange={handleSeekChange}
          onMouseUp={handleSeekCommit}
          onTouchEnd={handleSeekCommit}
          className="w-full cursor-pointer"
          style={{
            height: '6px',
            background: `linear-gradient(to right, rgb(37, 99, 235) 0%, rgb(37, 99, 235) ${progress}%, rgb(55, 65, 81) ${progress}%, rgb(55, 65, 81) 100%)`,
            borderRadius: '9999px',
            outline: 'none',
            WebkitAppearance: 'none',
          }}
        />
      </div>

      {/* Status Indicator */}
      <div className="flex flex-shrink-0 items-center gap-2 text-xs text-gray-500" style={{ width: '100px' }}>
        <div className={`h-2 w-2 rounded-full ${hasState ? (playing ? 'bg-green-500' : 'bg-gray-500') : 'bg-yellow-500'}`} />
        <span>{hasState ? (playing ? 'Lecture' : 'Pause') : 'En attente...'}</span>
      </div>
    </div>
  );
}
