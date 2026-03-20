'use client';

/**
 * Controller Page
 *
 * Main interface for browsing videos and remotely controlling playback
 *
 * Features:
 * - Video grid with thumbnails (editable titles)
 * - Video selection
 * - Remote controls (play/pause/seek)
 * - Character info display
 * - WebSocket communication with display clients
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { VideoGrid } from '../../components/VideoGrid';
import type { VideoMetadata } from '../../components/VideoGrid';
import { VideoFilters } from '../../components/VideoFilters';
import { RemoteControls } from '../../components/RemoteControls';
import { CharacterInfo } from '../../components/CharacterInfo';
import { useWebSocket } from '../../hooks/useWebSocket';
import type {
  LoadVideoCommand,
  PlayCommand,
  PauseCommand,
  SeekCommand,
  VideoState,
} from '../../lib/websocket/types';
import { isStateUpdate } from '../../lib/websocket/types';
import type { CharacterTracksData } from '../../lib/fcpxmlTypes';

export default function ControllerPage() {
  // State
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [characterTracks, setCharacterTracks] = useState<CharacterTracksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [characterCountFilter, setCharacterCountFilter] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // WebSocket connection
  const { connected, send } = useWebSocket({
    clientType: 'controller',
    onMessage: (message) => {
      // Handle state updates from display clients
      if (isStateUpdate(message)) {
        console.log('[Controller] Received state update:', message.state);
        setVideoState(message.state);
      }
    },
  });

  // Fetch video list on mount
  useEffect(() => {
    fetchVideos();
  }, []);

  /**
   * Fetch list of videos from API
   */
  const fetchVideos = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/out/list-videos');
      if (!res.ok) throw new Error('Failed to fetch videos');

      const data = await res.json();

      // Fetch metadata for each video and check both video and JSON exist
      const videosWithMetadata: VideoMetadata[] = [];
      const ignoredVideos: { basename: string; reason: string }[] = [];

      await Promise.all(
        data.videos.map(async (video: { basename: string }) => {
          try {
            const metadata = await fetchVideoMetadata(video.basename);

            // Only include videos where we successfully got metadata (both video and JSON exist)
            if (metadata.characterCount !== undefined && metadata.duration !== undefined) {
              videosWithMetadata.push(metadata);
            } else {
              ignoredVideos.push({
                basename: video.basename,
                reason: 'Fichier JSON manquant',
              });
            }
          } catch (err) {
            console.error(`Failed to fetch metadata for ${video.basename}:`, err);
            ignoredVideos.push({
              basename: video.basename,
              reason: 'Échec du chargement des métadonnées',
            });
          }
        })
      );

      // Log ignored videos to console
      if (ignoredVideos.length > 0) {
        console.group('⚠️  Vidéos ignorées (fichier JSON ou vidéo manquant):');
        ignoredVideos.forEach(({ basename, reason }) => {
          console.log(`  - ${basename}: ${reason}`);
        });
        console.groupEnd();
      }

      setVideos(videosWithMetadata);
      setError(null);
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError(err instanceof Error ? err.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Fetch metadata for a video (character count, duration, custom title)
   */
  const fetchVideoMetadata = async (basename: string): Promise<VideoMetadata> => {
    try {
      // Fetch tracks JSON and meta JSON in parallel
      const [tracksRes, metaRes] = await Promise.all([
        fetch(`/api/out/final-json/${basename}.json`),
        fetch(`/api/out/final-json/${basename}/meta`).catch(() => null),
      ]);

      if (!tracksRes.ok) {
        // No tracks data available
        return { basename };
      }

      const tracks: CharacterTracksData = await tracksRes.json();

      // Calculate duration (max end time across all segments)
      const duration = Math.max(
        ...tracks.tracks.flatMap((t) => t.segments.map((s) => s.end)),
        0
      );

      // Get custom title from meta if available
      let videoTitle: string | undefined;
      if (metaRes?.ok) {
        const meta = await metaRes.json();
        videoTitle = meta.videoTitle || undefined;
      }

      return {
        basename,
        characterCount: tracks.tracks.length,
        characterNames: tracks.tracks.map((t) => t.name),
        duration,
        videoTitle,
      };
    } catch (err) {
      console.error(`Error fetching metadata for ${basename}:`, err);
      return { basename };
    }
  };

  /**
   * Handle video selection
   */
  const handleVideoSelect = useCallback(
    (basename: string) => {
      setSelectedVideo(basename);

      // Load character tracks
      loadCharacterTracks(basename);

      // Send load_video command via WebSocket
      const loadCommand: Omit<LoadVideoCommand, 'timestamp'> = {
        type: 'load_video',
        videoPath: `/api/out/final-vids/${basename}.mp4`,
        tracksPath: `/api/out/final-json/${basename}.json`,
        autoplay: false,
      };

      send(loadCommand);
    },
    [send]
  );

  /**
   * Load character tracks for selected video
   */
  const loadCharacterTracks = async (basename: string) => {
    try {
      const res = await fetch(`/api/out/final-json/${basename}.json`);
      if (!res.ok) {
        setCharacterTracks(null);
        return;
      }

      const tracks: CharacterTracksData = await res.json();
      setCharacterTracks(tracks);
    } catch (err) {
      console.error(`Error loading tracks for ${basename}:`, err);
      setCharacterTracks(null);
    }
  };

  /**
   * Handle title change from thumbnail
   */
  const handleTitleChange = useCallback(async (basename: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/out/final-json/${basename}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: newTitle }),
      });

      if (!res.ok) {
        throw new Error('Failed to save title');
      }

      // Update videos array
      setVideos((prev) =>
        prev.map((v) => (v.basename === basename ? { ...v, videoTitle: newTitle } : v))
      );
    } catch (err) {
      console.error(`Error saving title for ${basename}:`, err);
    }
  }, []);

  /**
   * Get display title for selected video
   */
  const selectedVideoInfo = (() => {
    if (!selectedVideo) return null;
    const video = videos.find((v) => v.basename === selectedVideo);
    const hasCustomTitle = !!video?.videoTitle;
    return {
      title: video?.videoTitle || selectedVideo,
      hasCustomTitle,
    };
  })();

  /**
   * Send play command
   */
  const handlePlay = useCallback(() => {
    send({ type: 'play' } as Omit<PlayCommand, 'timestamp'>);
  }, [send]);

  /**
   * Send pause command
   */
  const handlePause = useCallback(() => {
    send({ type: 'pause' } as Omit<PauseCommand, 'timestamp'>);
  }, [send]);

  /**
   * Send seek command
   */
  const handleSeek = useCallback(
    (time: number) => {
      send({ type: 'seek', time } as Omit<SeekCommand, 'timestamp'>);
    },
    [send]
  );

  /**
   * Keyboard shortcuts
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in an input
      if (document.activeElement?.tagName === 'INPUT') return;

      // Space bar: toggle play/pause
      if (e.code === 'Space' || e.key === ' ') {
        // Prevent scrolling
        e.preventDefault();

        // Toggle play/pause based on current state
        if (videoState?.playing) {
          handlePause();
        } else {
          handlePlay();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoState?.playing, handlePlay, handlePause]);

  const filteredVideos = useMemo(() => {
    return videos.filter((v) => {
      if (characterCountFilter.size > 0 && v.characterCount !== undefined) {
        if (!characterCountFilter.has(v.characterCount)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = (v.videoTitle || v.basename).toLowerCase().includes(q);
        const nameMatch = v.characterNames?.some((n) => n.toLowerCase().includes(q)) ?? false;
        if (!titleMatch && !nameMatch) return false;
      }
      return true;
    });
  }, [videos, characterCountFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-gray-950 pb-32">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Contrôleur vidéo</h1>
            <p className="mt-1 text-sm text-gray-400">
              Parcourez et contrôlez la lecture vidéo à distance
            </p>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm">
            <div
              className={`h-2 w-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-gray-300">
              {connected ? 'Connecté' : 'Déconnecté'}
            </span>
          </div>
        </div>

        {/* Video Library */}
        <div>
          <h2 className="mb-4 text-xl font-semibold text-white">Bibliothèque vidéo</h2>

          {!loading && !error && videos.length > 0 && (
            <div className="mb-4">
              <VideoFilters
                videos={videos}
                characterCountFilter={characterCountFilter}
                searchQuery={searchQuery}
                onCharacterCountFilterChange={setCharacterCountFilter}
                onSearchQueryChange={setSearchQuery}
                filteredCount={filteredVideos.length}
              />
            </div>
          )}

          {loading && (
            <div className="flex h-64 items-center justify-center rounded-lg border border-gray-700 bg-gray-900">
              <p className="text-gray-400">Chargement des vidéos...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950 p-4">
              <p className="text-red-400">Erreur : {error}</p>
            </div>
          )}

          {!loading && !error && (
            <VideoGrid
              videos={filteredVideos}
              selectedVideo={selectedVideo || undefined}
              onVideoSelect={handleVideoSelect}
              onTitleChange={handleTitleChange}
            />
          )}
        </div>

        {/* Character Info (shown when video selected) */}
        {selectedVideo && characterTracks && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Personnages</h2>
            <CharacterInfo tracks={characterTracks} />
          </div>
        )}

        {/* Help Text */}
        {!selectedVideo && !loading && videos.length > 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center">
            <p className="text-gray-400">
              Cliquez sur une vignette vidéo pour la charger sur les clients d'affichage
            </p>
          </div>
        )}
      </div>

      {/* Fixed Player Controls Bar at Bottom */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-gray-950/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl p-4">
          <div className="flex items-center gap-4">
            {/* Currently Playing Info */}
            <div className="flex-shrink-0" style={{ width: '250px' }}>
              {selectedVideoInfo ? (
                <div>
                  <p className="truncate text-sm font-medium text-gray-200">
                    {selectedVideoInfo.title}
                    {!selectedVideoInfo.hasCustomTitle && '.mp4'}
                  </p>
                  <p className="text-xs text-gray-500">En lecture</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500">Aucune vidéo chargée</p>
                  <p className="text-xs text-gray-600">Sélectionnez une vidéo ci-dessus</p>
                </div>
              )}
            </div>

            {/* Player Controls */}
            <div className="flex-1">
              <RemoteControls
                videoState={videoState}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
