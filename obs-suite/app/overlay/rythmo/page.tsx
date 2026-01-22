'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense, useCallback } from 'react';
import FcpxmlOverlay from '@/components/FcpxmlOverlay';
import IntroPanel from '@/components/IntroPanel';
import { loadTracksFromUrl } from '@/lib/loadFcpxmlTracks';
import type { CharacterVisualizationData } from '@/lib/fcpxmlTypes';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  isLoadVideoCommand,
  isPlayCommand,
  isPauseCommand,
  isSeekCommand,
  generateClientId,
  type StateUpdate,
} from '@/lib/websocket/types';

interface VideoPaths {
  videoSrc: string;
  tracksUrl: string;
}

/**
 * Derive tracks URL from video path by replacing the extension with .json
 */
function deriveTracksUrl(videoPath: string): string {
  const videoFilename = videoPath.split('/').pop() || '';
  const basename = videoFilename.replace(/\.[^.]+$/, '');
  return `/api/out/final-json/${basename}.json`;
}

/**
 * Derive video and tracks paths from WebSocket state or query parameters.
 * WebSocket state takes priority over query parameters.
 */
function deriveVideoPaths(
  wsVideoSrc: string,
  wsTracksUrl: string,
  videoParam: string | null,
  tracksParam: string | null
): VideoPaths {
  // WebSocket command has set the video
  if (wsVideoSrc && wsTracksUrl) {
    return { videoSrc: wsVideoSrc, tracksUrl: wsTracksUrl };
  }

  // Fall back to query parameters
  if (videoParam) {
    const tracksUrl = tracksParam || deriveTracksUrl(videoParam);
    return { videoSrc: videoParam, tracksUrl };
  }

  // No video loaded
  return { videoSrc: '', tracksUrl: '' };
}

/**
 * Extract video name from URL for display
 */
function extractVideoName(src: string): string {
  if (!src) return 'Vidéo inconnue';
  const filename = src.split('/').pop() || '';
  const basename = filename.replace(/\.[^.]+$/, '');
  return decodeURIComponent(basename) || 'Vidéo inconnue';
}

function FcpxmlOverlayContent() {
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [visualizationData, setVisualizationData] = useState<CharacterVisualizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsVideoSrc, setWsVideoSrc] = useState<string>('');
  const [wsTracksUrl, setWsTracksUrl] = useState<string>('');
  const [showIntro, setShowIntro] = useState(false);
  const lastStateUpdateRef = useRef<number>(0);
  const clientIdRef = useRef<string>(generateClientId());

  // WebSocket connection (display client)
  const { connected, send } = useWebSocket({
    clientType: 'display',
    onMessage: (message) => {
      // Handle load_video command
      if (isLoadVideoCommand(message)) {
        console.log('[WS] Loading video:', message.videoPath);
        setWsVideoSrc(message.videoPath);
        setWsTracksUrl(message.tracksPath);
      }

      // Handle play command
      if (isPlayCommand(message)) {
        console.log('[WS] Play command');
        // Hide intro panel when play command is received
        setShowIntro(false);
        videoRef.current?.play().catch(err => {
          console.warn('[WS] Play failed:', err);
        });
      }

      // Handle pause command
      if (isPauseCommand(message)) {
        console.log('[WS] Pause command');
        videoRef.current?.pause();
      }

      // Handle seek command
      if (isSeekCommand(message)) {
        console.log('[WS] Seek command:', message.time);
        if (videoRef.current) {
          videoRef.current.currentTime = message.time;
        }
      }
    },
  });

  // Send state update via WebSocket (throttled)
  const sendStateUpdate = useCallback((force = false) => {
    const now = Date.now();
    // Throttle to 2 updates per second (unless forced)
    if (!force && now - lastStateUpdateRef.current < 500) return;

    const video = videoRef.current;
    if (!video || !connected) return;

    const stateUpdate: Omit<StateUpdate, 'timestamp'> = {
      type: 'state_update',
      clientId: clientIdRef.current,
      state: {
        playing: !video.paused,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        rate: video.playbackRate,
        videoPath: video.src,
      },
    };

    console.log('[Display] Sending state update:', stateUpdate.state);
    send(stateUpdate);
    lastStateUpdateRef.current = now;
  }, [connected, send]);

  // Derive video/tracks paths: WebSocket state takes priority over query parameters
  const videoParam = searchParams.get('video');
  const tracksParam = searchParams.get('tracks');

  const { videoSrc, tracksUrl } = deriveVideoPaths(
    wsVideoSrc,
    wsTracksUrl,
    videoParam,
    tracksParam
  );

  // Load tracks on mount or URL change
  useEffect(() => {
    if (!videoSrc || !tracksUrl) {
      // No video selected yet
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
        // Show intro panel when data is loaded
        setShowIntro(true);
      } catch (err) {
        console.error('Failed to load tracks:', err);
        setError(err instanceof Error ? err.message : 'Failed to load tracks');
        setLoading(false);
      }
    };

    loadData();
  }, [tracksUrl, videoSrc]);

  // Send state updates via WebSocket
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Event handlers
    const handleTimeUpdate = () => sendStateUpdate();
    const handlePlay = () => sendStateUpdate(true); // Force send on play
    const handlePause = () => sendStateUpdate(true); // Force send on pause
    const handleLoadedMetadata = () => sendStateUpdate(true); // Force send on load

    // Attach event listeners
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    // Send initial state when connected
    if (connected) {
      sendStateUpdate(true);
    }

    // Cleanup - always runs
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [sendStateUpdate, connected]);

  const videoName = extractVideoName(videoSrc);

  return (
    <div className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* 16:9 aspect ratio container */}
      <div className="relative w-full" style={{ aspectRatio: '16/9', maxHeight: '100vh' }}>
        {/* Video fills the 16:9 container */}
        <video
          ref={videoRef}
          src={videoSrc}
          className={videoSrc ? "absolute inset-0 w-full h-full object-contain" : "hidden"}
          playsInline
        />

        {/* Overlay - positioned at bottom, overlaying the video */}
        {videoSrc && visualizationData && !loading && !error && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <FcpxmlOverlay
              videoRef={videoRef}
              visualizationData={visualizationData}
              windowMs={6000}
              laneHeight={32}
              laneGap={1}
            />
          </div>
        )}

        {/* Intro panel - shown initially when data is loaded, hidden on play */}
        {showIntro && visualizationData && (
          <IntroPanel
            visualizationData={visualizationData}
            videoName={videoName}
          />
        )}
      </div>
    </div>
  );
}

export default function FcpxmlOverlayPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    }>
      <FcpxmlOverlayContent />
    </Suspense>
  );
}
