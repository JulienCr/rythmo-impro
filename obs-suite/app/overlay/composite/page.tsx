'use client';

/**
 * Composite Overlay Page
 *
 * A comprehensive 16:9 overlay containing:
 * - Two video players (dual camera angles)
 * - Character information panel
 * - Bande rythmo visualization
 *
 * URL Parameters:
 *   video1   - Path to first video (e.g., /api/out/media/scene01.mp4)
 *   video2   - Path to second video (optional)
 *   tracks   - Path to tracks JSON (auto-derived from video1 if not provided)
 *
 * Example:
 *   /overlay/composite?video1=/api/out/media/scene01.mp4&video2=/api/out/media/scene01-alt.mp4
 */

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense, useCallback } from 'react';
import { loadTracksFromUrl } from '@/lib/loadFcpxmlTracks';
import type { CharacterVisualizationData } from '@/lib/fcpxmlTypes';
import { extractBasename, deriveTracksUrl } from '@/lib/urlUtils';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  isLoadVideoCommand,
  isPlayCommand,
  isPauseCommand,
  isSeekCommand,
  generateClientId,
  type StateUpdate,
} from '@/lib/websocket/types';
import { CharacterInfo } from '@/components/CharacterInfo';
import RythmoOverlay from '@/components/RythmoOverlay';

function CompositeOverlayContent() {
  const searchParams = useSearchParams();
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);

  const [visualizationData, setVisualizationData] = useState<CharacterVisualizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsVideo1Src, setWsVideo1Src] = useState<string>('');
  const [wsVideo2Src, setWsVideo2Src] = useState<string>('');
  const [wsTracksUrl, setWsTracksUrl] = useState<string>('');
  const lastStateUpdateRef = useRef<number>(0);
  const clientIdRef = useRef<string>(generateClientId());

  // WebSocket connection (display client)
  const { connected, send } = useWebSocket({
    clientType: 'display',
    onMessage: (message) => {
      // Handle load_video command
      if (isLoadVideoCommand(message)) {
        console.log('[WS] Loading video:', message.videoPath);
        setWsVideo1Src(message.videoPath);
        // Optionally load second video from message.video2Path if available
        setWsTracksUrl(message.tracksPath);
      }

      // Handle play command
      if (isPlayCommand(message)) {
        console.log('[WS] Play command');
        video1Ref.current?.play().catch(err => console.warn('[WS] Play failed (video1):', err));
        video2Ref.current?.play().catch(err => console.warn('[WS] Play failed (video2):', err));
      }

      // Handle pause command
      if (isPauseCommand(message)) {
        console.log('[WS] Pause command');
        video1Ref.current?.pause();
        video2Ref.current?.pause();
      }

      // Handle seek command
      if (isSeekCommand(message)) {
        console.log('[WS] Seek command:', message.time);
        if (video1Ref.current) video1Ref.current.currentTime = message.time;
        if (video2Ref.current) video2Ref.current.currentTime = message.time;
      }
    },
  });

  // Send state update via WebSocket (throttled)
  const sendStateUpdate = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastStateUpdateRef.current < 500) return;

    const video1 = video1Ref.current;
    if (!video1 || !connected) return;

    const stateUpdate: Omit<StateUpdate, 'timestamp'> = {
      type: 'state_update',
      clientId: clientIdRef.current,
      state: {
        playing: !video1.paused,
        currentTime: video1.currentTime,
        duration: video1.duration || 0,
        rate: video1.playbackRate,
        videoPath: video1.src,
      },
    };

    send(stateUpdate);
    lastStateUpdateRef.current = now;
  }, [connected, send]);

  // Get query parameters
  const video1Param = searchParams.get('video1') || searchParams.get('video');
  const video2Param = searchParams.get('video2');
  const tracksParam = searchParams.get('tracks');

  // Derive paths: WebSocket state takes priority over query parameters
  let video1Src: string;
  let video2Src: string;
  let tracksUrl: string;

  if (wsVideo1Src && wsTracksUrl) {
    video1Src = wsVideo1Src;
    video2Src = wsVideo2Src;
    tracksUrl = wsTracksUrl;
  } else if (video1Param) {
    video1Src = video1Param;
    video2Src = video2Param || '';
    tracksUrl = tracksParam || deriveTracksUrl(video1Param);
  } else {
    video1Src = '';
    video2Src = '';
    tracksUrl = '';
  }

  // Load tracks on mount or URL change
  useEffect(() => {
    if (!video1Src || !tracksUrl) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        const vizData = await loadTracksFromUrl(tracksUrl);
        setVisualizationData(vizData);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load tracks:', err);
        setError(err instanceof Error ? err.message : 'Failed to load tracks');
        setLoading(false);
      }
    };

    loadData();
  }, [tracksUrl, video1Src]);

  // Sync video2 with video1
  useEffect(() => {
    const video1 = video1Ref.current;
    const video2 = video2Ref.current;

    if (!video1 || !video2 || !video2Src) return;

    const syncVideo2 = () => {
      if (Math.abs(video2.currentTime - video1.currentTime) > 0.1) {
        video2.currentTime = video1.currentTime;
      }
    };

    video1.addEventListener('seeked', syncVideo2);
    video1.addEventListener('timeupdate', syncVideo2);

    return () => {
      video1.removeEventListener('seeked', syncVideo2);
      video1.removeEventListener('timeupdate', syncVideo2);
    };
  }, [video2Src]);

  // Send state updates via WebSocket
  useEffect(() => {
    const video = video1Ref.current;
    if (!video) return;

    const handleTimeUpdate = () => sendStateUpdate();
    const handlePlay = () => sendStateUpdate(true);
    const handlePause = () => sendStateUpdate(true);
    const handleLoadedMetadata = () => sendStateUpdate(true);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    if (connected) {
      sendStateUpdate(true);
    }

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [sendStateUpdate, connected]);

  if (!video1Src) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Aucune vidéo chargée</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* 16:9 Container */}
      <div className="relative w-full h-full max-w-full max-h-full" style={{ aspectRatio: '16/9' }}>
        <div className="absolute inset-0 flex flex-col">
          {/* Top Section: Dual Videos */}
          <div className="flex-none grid grid-cols-2 gap-1 h-[60%]">
            {/* Video 1 */}
            <div className="relative bg-gray-900 overflow-hidden">
              <video
                ref={video1Ref}
                src={video1Src}
                className="w-full h-full object-contain"
                playsInline
              />
              <div className="absolute top-2 left-2 bg-black bg-opacity-60 px-2 py-1 rounded text-white text-xs font-mono">
                Caméra 1
              </div>
            </div>

            {/* Video 2 */}
            <div className="relative bg-gray-900 overflow-hidden">
              {video2Src ? (
                <>
                  <video
                    ref={video2Ref}
                    src={video2Src}
                    className="w-full h-full object-contain"
                    playsInline
                  />
                  <div className="absolute top-2 left-2 bg-black bg-opacity-60 px-2 py-1 rounded text-white text-xs font-mono">
                    Caméra 2
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  <span className="text-sm">Pas de deuxième caméra</span>
                </div>
              )}
            </div>
          </div>

          {/* Middle Section: Character Info */}
          <div className="flex-none h-[15%] px-4 py-2 bg-gray-950 border-y border-gray-800 overflow-hidden">
            {visualizationData && (
              <div className="h-full overflow-y-auto">
                <CharacterInfo tracks={visualizationData.tracks} />
              </div>
            )}
          </div>

          {/* Bottom Section: Bande Rythmo */}
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            {visualizationData && !loading && !error && (
              <RythmoOverlay
                videoRef={video1Ref}
                visualizationData={visualizationData}
                windowMs={6000}
                laneHeight={32}
                laneGap={1}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompositeOverlayPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    }>
      <CompositeOverlayContent />
    </Suspense>
  );
}
