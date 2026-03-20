'use client';

import type { VideoMetadata } from './VideoGrid';

interface VideoFiltersProps {
  videos: VideoMetadata[];
  characterCountFilter: Set<number>;
  searchQuery: string;
  onCharacterCountFilterChange: (counts: Set<number>) => void;
  onSearchQueryChange: (query: string) => void;
  filteredCount: number;
}

export function VideoFilters({
  videos,
  characterCountFilter,
  searchQuery,
  onCharacterCountFilterChange,
  onSearchQueryChange,
  filteredCount,
}: VideoFiltersProps) {
  // Get sorted distinct character counts from all videos
  const availableCounts = [
    ...new Set(
      videos
        .map((v) => v.characterCount)
        .filter((c): c is number => c !== undefined)
    ),
  ].sort((a, b) => a - b);

  const toggleCount = (count: number) => {
    const next = new Set(characterCountFilter);
    if (next.has(count)) {
      next.delete(count);
    } else {
      next.add(count);
    }
    onCharacterCountFilterChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Character count buttons */}
      <div className="flex items-center gap-1.5">
        {availableCounts.map((count) => {
          const active = characterCountFilter.has(count);
          return (
            <button
              key={count}
              onClick={() => toggleCount(count)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              {count} pers.
            </button>
          );
        })}
      </div>

      {/* Search input */}
      <div className="relative flex-1" style={{ minWidth: '200px' }}>
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Rechercher par titre ou personnage..."
          className="w-full rounded-md border border-gray-700 bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Filtered count */}
      <span className="flex-shrink-0 text-sm text-gray-500">
        {filteredCount} vidéo{filteredCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
