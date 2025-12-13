'use client';

/**
 * VideoThumbnail Component
 *
 * Displays a single video thumbnail with metadata:
 * - Thumbnail image
 * - Character count
 * - Video duration
 * - Click to load video
 */

export interface VideoThumbnailProps {
  basename: string;
  characterCount?: number;
  duration?: number;  // in seconds
  onClick?: () => void;
  selected?: boolean;
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function VideoThumbnail({
  basename,
  characterCount,
  duration,
  onClick,
  selected = false,
}: VideoThumbnailProps) {
  const thumbnailUrl = `/api/out/thumbs/${basename}.jpg`;

  return (
    <button
      onClick={onClick}
      className={`
        group relative overflow-hidden rounded-lg border-2 transition-all
        ${selected
          ? 'border-blue-500 shadow-lg shadow-blue-500/50'
          : 'border-gray-700 hover:border-gray-500'
        }
      `}
    >
      {/* Thumbnail image */}
      <div className="aspect-video w-full overflow-hidden bg-gray-800">
        <img
          src={thumbnailUrl}
          alt={basename}
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          onError={(e) => {
            // Fallback if thumbnail doesn't exist
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>

      {/* Metadata overlay */}
      <div className="bg-gray-900 p-2">
        {/* Filename */}
        <div className="mb-1 truncate text-sm font-medium text-gray-200">
          {basename}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {characterCount !== undefined && (
            <div className="flex items-center gap-1">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span>{characterCount} pers</span>
            </div>
          )}

          {duration !== undefined && (
            <div className="flex items-center gap-1">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{formatDuration(duration)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="absolute right-2 top-2 rounded-full bg-blue-500 p-1">
          <svg
            className="h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      )}
    </button>
  );
}
