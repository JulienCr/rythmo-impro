'use client';

/**
 * VideoGrid Component
 *
 * Displays a responsive grid of video thumbnails
 */

import { VideoThumbnail } from './VideoThumbnail';

export interface VideoMetadata {
  basename: string;
  characterCount?: number;
  duration?: number;
}

export interface VideoGridProps {
  videos: VideoMetadata[];
  selectedVideo?: string;
  onVideoSelect: (basename: string) => void;
}

export function VideoGrid({ videos, selectedVideo, onVideoSelect }: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-gray-700 bg-gray-900">
        <div className="text-center">
          <p className="text-gray-400">Aucune vidéo trouvée</p>
          <p className="mt-1 text-sm text-gray-500">
            Ajoutez des vidéos dans le répertoire /in et exécutez process-video
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {videos.map((video) => (
        <VideoThumbnail
          key={video.basename}
          basename={video.basename}
          characterCount={video.characterCount}
          duration={video.duration}
          onClick={() => onVideoSelect(video.basename)}
          selected={selectedVideo === video.basename}
        />
      ))}
    </div>
  );
}
