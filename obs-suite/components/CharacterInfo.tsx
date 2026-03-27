'use client';

/**
 * CharacterInfo Component
 *
 * Displays character/speaker information from the loaded video:
 * - Character names (editable)
 * - Colors (visual swatches)
 * - Lane order
 * - Total speaking time
 */

import { useState, useRef, useEffect } from 'react';
import type { CharacterTracksData, CharacterTrack } from '../lib/fcpxmlTypes';

export interface CharacterInfoProps {
  tracks: CharacterTracksData | CharacterTrack[] | null;
  characterNames?: Record<string, string>;
  onNameChange?: (speakerId: string, newName: string) => void;
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculate total speaking time for a character
 */
function calculateSpeakingTime(track: CharacterTrack): number {
  return track.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
}

/**
 * Get the earliest start time for a character (first appearance)
 */
function getFirstAppearance(track: CharacterTrack): number {
  if (track.segments.length === 0) return Infinity;
  return Math.min(...track.segments.map((seg) => seg.start));
}

function EditableName({
  trackName,
  displayName,
  onNameChange,
}: {
  trackName: string;
  displayName: string;
  onNameChange?: (speakerId: string, newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleSave = () => {
    setEditing(false);
    const trimmed = value.trim();
    // If empty or same as original track name, clear the custom name
    if (!trimmed || trimmed === trackName) {
      setValue(trackName);
      onNameChange?.(trackName, '');
    } else if (trimmed !== displayName) {
      onNameChange?.(trackName, trimmed);
    }
  };

  if (!onNameChange) {
    return <span className="flex-1 font-medium text-gray-200">{displayName}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="flex-1 rounded bg-gray-800 px-2 py-0.5 text-sm font-medium text-gray-200 outline-none ring-1 ring-blue-500"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setValue(displayName);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      className="flex-1 cursor-pointer rounded px-2 py-0.5 text-left text-sm font-medium text-gray-200 hover:bg-gray-800"
      onClick={() => setEditing(true)}
      title="Cliquez pour renommer"
    >
      {displayName}
      {displayName !== trackName && (
        <span className="ml-2 text-xs text-gray-500">({trackName})</span>
      )}
    </button>
  );
}

export function CharacterInfo({ tracks, characterNames, onNameChange }: CharacterInfoProps) {
  // Normalize input to array
  const tracksArray = tracks === null
    ? []
    : Array.isArray(tracks)
      ? tracks
      : tracks.tracks;

  if (tracksArray.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">Personnages</h3>
        <p className="text-sm text-gray-500">Aucune vidéo chargée</p>
      </div>
    );
  }

  // Sort by first appearance (earliest start time)
  const sortedTracks = [...tracksArray].sort((a, b) => {
    return getFirstAppearance(a) - getFirstAppearance(b);
  });

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-400">
        Personnages ({tracksArray.length})
      </h3>
      <div className="space-y-2">
        {sortedTracks.map((track, index) => {
          const speakingTime = calculateSpeakingTime(track);
          const displayName = characterNames?.[track.name] || track.name;
          return (
            <div
              key={track.name}
              className="flex items-center gap-3 text-sm"
            >
              {/* Color swatch */}
              <div
                className="h-4 w-4 flex-shrink-0 rounded"
                style={{ backgroundColor: track.color }}
                title={track.color}
              />

              {/* Lane number */}
              <span className="w-4 flex-shrink-0 text-gray-500">
                {index + 1}.
              </span>

              {/* Character name (editable) */}
              <EditableName
                trackName={track.name}
                displayName={displayName}
                onNameChange={onNameChange}
              />

              {/* Speaking time */}
              <span className="text-gray-400">
                {formatTime(speakingTime)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
