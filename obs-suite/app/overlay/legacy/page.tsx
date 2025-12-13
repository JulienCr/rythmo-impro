'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import RythmoOverlay from '@/components/RythmoOverlay';
import { loadCuesFromUrl, loadSubtitlesFromUrl, type VisualizationData, type Subtitle } from '@/lib/loadCues';

interface VideoInfo {
  filename: string;
  basename: string;
}

function RythmoOverlayContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [visualizationData, setVisualizationData] = useState<VisualizationData | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableVideos, setAvailableVideos] = useState<VideoInfo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  // Get query parameters
  const videoParam = searchParams.get('video');
  const cuesParam = searchParams.get('cues');
  const subtitlesUrl = searchParams.get('subtitles') || null;

  // Derive paths from video parameter or use defaults
  let videoSrc: string;
  let cuesUrl: string;

  if (videoParam) {
    videoSrc = videoParam;
    // If cues param provided, use it; otherwise derive from video basename
    if (cuesParam) {
      cuesUrl = cuesParam;
    } else {
      // Extract basename from video path
      const videoFilename = videoParam.split('/').pop() || '';
      const basename = videoFilename.replace(/\.[^.]+$/, ''); // Remove extension
      cuesUrl = `/api/out/${basename}.enhanced.json`;
    }
  } else {
    // No video param - will show selector
    videoSrc = '';
    cuesUrl = '';
  }

  // Load available videos when no video parameter is provided
  useEffect(() => {
    if (!videoParam) {
      setLoadingVideos(true);
      fetch('/api/out/list-videos')
        .then(res => res.json())
        .then(data => {
          setAvailableVideos(data.videos || []);
          setLoadingVideos(false);
        })
        .catch(err => {
          console.error('Failed to load videos:', err);
          setError('Failed to load available videos');
          setLoadingVideos(false);
        });
    }
  }, [videoParam]);

  // Handle video selection
  const handleVideoSelect = (video: VideoInfo) => {
    const videoPath = `/api/out/final-vids/${video.filename}`;
    const cuesPath = `/api/out/${video.basename}.enhanced.json`;
    router.push(`/overlay/rythmo?video=${encodeURIComponent(videoPath)}&cues=${encodeURIComponent(cuesPath)}`);
  };

  // Load cues data on mount or when cuesUrl changes
  useEffect(() => {
    if (!videoSrc || !cuesUrl) {
      // No video selected yet
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        // Load cues (required)
        const vizData = await loadCuesFromUrl(cuesUrl);
        setVisualizationData(vizData);

        // Load subtitles (optional)
        if (subtitlesUrl) {
          try {
            const srtData = await loadSubtitlesFromUrl(subtitlesUrl);
            setSubtitles(srtData);
          } catch (srtError) {
            console.warn('Failed to load subtitles, continuing without them:', srtError);
            setSubtitles([]);
          }
        } else {
          setSubtitles([]);
        }

        setLoading(false);
      } catch (err) {
        console.error('Failed to load cues:', err);
        setError(err instanceof Error ? err.message : 'Failed to load cues');
        setLoading(false);
      }
    };

    loadData();
  }, [cuesUrl, subtitlesUrl, videoSrc]);

  return (
    <div className="relative w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* Video selector - shown when no video parameter */}
      {!videoParam && (
        <div className="w-full max-w-2xl p-8">
          <h1 className="text-white text-3xl font-bold mb-8 text-center">Select Video</h1>

          {loadingVideos && (
            <div className="text-white text-xl text-center">
              Loading available videos...
            </div>
          )}

          {!loadingVideos && availableVideos.length === 0 && (
            <div className="text-yellow-500 text-center">
              <p className="mb-4">No videos found in out/final-vids/</p>
              <p className="text-sm text-gray-400">
                Add video files to the out/final-vids/ directory
              </p>
            </div>
          )}

          {!loadingVideos && availableVideos.length > 0 && (
            <div className="space-y-3">
              {availableVideos.map((video) => (
                <button
                  key={video.filename}
                  onClick={() => handleVideoSelect(video)}
                  className="w-full px-6 py-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-left transition-colors"
                >
                  <div className="font-medium">{video.filename}</div>
                  <div className="text-sm text-gray-400 mt-1">
                    Cues: {video.basename}.enhanced.json
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {videoParam && loading && (
        <div className="text-white text-xl">
          Loading cues...
        </div>
      )}

      {/* Error state */}
      {videoParam && error && (
        <div className="text-red-500 text-xl p-8 max-w-2xl">
          <h2 className="font-bold mb-4">Error Loading Cues</h2>
          <p className="font-mono text-sm bg-red-900/20 p-4 rounded">
            {error}
          </p>
          <p className="mt-4 text-sm text-gray-400">
            URL: {cuesUrl}
          </p>
        </div>
      )}

      {/* Video player with overlay */}
      {videoParam && visualizationData && !loading && !error && (
        <div className="relative">
          {/* Video element */}
          <video
            ref={videoRef}
            src={videoSrc}
            className="block max-w-full max-h-screen"
            controls
            playsInline
            autoPlay={false}
          />

          {/* Canvas overlay - absolutely positioned over video */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
            <RythmoOverlay
              videoRef={videoRef}
              visualizationData={visualizationData}
              windowMs={6000}
              laneHeight={20}
              laneGap={8}
              subtitles={subtitles}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function RythmoOverlayPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <RythmoOverlayContent />
    </Suspense>
  );
}
