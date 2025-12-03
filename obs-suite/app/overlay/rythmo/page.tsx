'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import RythmoOverlay from '@/components/RythmoOverlay';
import { loadCuesFromUrl, type CuesData } from '@/lib/loadCues';

function RythmoOverlayContent() {
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [cues, setCues] = useState<CuesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Get query parameters with defaults
  const videoSrc = searchParams.get('video') || '/media/juste-leblanc.mp4';
  const cuesUrl = searchParams.get('cues') || '/cues/juste-leblanc.json';

  // Load cues data on mount or when cuesUrl changes
  useEffect(() => {
    setLoading(true);
    setError(null);

    loadCuesFromUrl(cuesUrl)
      .then(data => {
        setCues(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load cues:', err);
        setError(err instanceof Error ? err.message : 'Failed to load cues');
        setLoading(false);
      });
  }, [cuesUrl]);

  return (
    <div className="relative w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      {loading && (
        <div className="text-white text-xl">
          Loading cues...
        </div>
      )}

      {error && (
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

      {cues && !loading && !error && (
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
          <div className="absolute top-0 left-0 w-full pointer-events-none">
            <RythmoOverlay
              videoRef={videoRef}
              cues={cues}
              windowMs={6000}
              laneHeight={20}
              laneGap={8}
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
