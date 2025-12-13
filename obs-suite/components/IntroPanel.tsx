'use client';

import type { CharacterVisualizationData } from '@/lib/fcpxmlTypes';

interface IntroPanelProps {
  visualizationData: CharacterVisualizationData;
  videoName: string;
}

interface CharacterInfo {
  name: string;
  color: string;
  firstAppearanceMs: number;
  speakingOrder: number;
}

export default function IntroPanel({
  visualizationData,
  videoName,
}: IntroPanelProps) {
  // Calculate first appearance and speaking order for each character
  const characterInfos: CharacterInfo[] = visualizationData.tracks.map((track, index) => {
    // Find the first segment for this track
    const firstSegment = visualizationData.segments
      .filter(seg => seg.trackName === track.name)
      .sort((a, b) => a.t0 - b.t0)[0];

    return {
      name: track.name,
      color: track.color,
      firstAppearanceMs: firstSegment?.t0 ?? Infinity,
      speakingOrder: 0, // Will be calculated next
    };
  });

  // Sort by first appearance and assign speaking order
  characterInfos.sort((a, b) => a.firstAppearanceMs - b.firstAppearanceMs);
  characterInfos.forEach((char, index) => {
    char.speakingOrder = index + 1;
  });

  // Format time from milliseconds to MM:SS
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-90 z-50">
      <div className="bg-gray-900 rounded-lg p-8 max-w-2xl w-full mx-4 shadow-2xl">
        {/* Video Title */}
        <h1 className="text-3xl font-bold text-white mb-6 text-center">
          {videoName}
        </h1>

        {/* Characters Section */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-300 mb-4">Personnages</h2>
          <div className="space-y-3">
            {characterInfos.map((char) => (
              <div
                key={char.name}
                className="flex items-center justify-between bg-gray-800 rounded-lg p-4"
              >
                <div className="flex items-center space-x-4">
                  {/* Color indicator */}
                  <div
                    className="w-8 h-8 rounded-full border-2 border-white"
                    style={{ backgroundColor: char.color }}
                  />

                  {/* Character name */}
                  <span className="text-white font-medium text-lg">
                    {char.name}
                  </span>
                </div>

                {/* Speaking order */}
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400 text-sm">Ordre de parole :</span>
                  <span className="text-white font-bold text-lg">
                    #{char.speakingOrder}
                  </span>
                  {char.firstAppearanceMs !== Infinity && (
                    <span className="text-gray-500 text-sm ml-2">
                      ({formatTime(char.firstAppearanceMs)})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
