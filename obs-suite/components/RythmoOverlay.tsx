'use client';

import { useEffect, useRef, RefObject } from 'react';
import { CuesData } from '@/lib/loadCues';

interface RythmoOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cues: CuesData;
  windowMs?: number;      // Default: 6000 (±3s rolling window)
  laneHeight?: number;    // Default: 20px
  laneGap?: number;       // Default: 8px
}

// Lane colors - fixed mapping per specification
const LANE_COLORS: Record<number, string> = {
  0: '#007AFF',  // Blue (top)
  1: '#FF3B30',  // Red
  2: '#FFD60A',  // Yellow
  3: '#34C759',  // Green
  4: '#AF52DE',  // Purple
};

export default function RythmoOverlay({
  videoRef,
  cues,
  windowMs = 6000,
  laneHeight = 20,
  laneGap = 8,
}: RythmoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate number of lanes needed
  const numLanes = Math.max(...Object.values(cues.laneMap)) + 1;
  const totalHeight = numLanes * (laneHeight + laneGap) - laneGap;

  // Effect 1: Handle canvas sizing based on video dimensions
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const updateCanvasSize = () => {
      // Use actual video dimensions for canvas resolution
      const videoWidth = video.videoWidth || 1920;
      const videoHeight = video.videoHeight || 1080;

      // Set canvas internal resolution
      canvas.width = videoWidth;
      canvas.height = totalHeight;

      // Set CSS display size to match video element's display size
      const displayWidth = video.clientWidth || videoWidth;
      const scale = displayWidth / videoWidth;

      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${totalHeight * scale}px`;
    };

    // Listen for when video dimensions become available
    video.addEventListener('loadedmetadata', updateCanvasSize);
    window.addEventListener('resize', updateCanvasSize);

    // Initial size if metadata already loaded
    if (video.readyState >= 1) {
      updateCanvasSize();
    }

    return () => {
      video.removeEventListener('loadedmetadata', updateCanvasSize);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [videoRef, numLanes, laneHeight, laneGap, totalHeight]);

  // Effect 2: Animation loop for rendering segments
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const halfWindow = windowMs / 2;

    const render = () => {
      // Get current playback time in milliseconds
      const currentTimeMs = video.currentTime * 1000;

      // Calculate window bounds
      const windowStart = currentTimeMs - halfWindow;
      const windowEnd = currentTimeMs + halfWindow;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw each segment that intersects the window
      for (const segment of cues.segments) {
        // Skip segments outside the window
        if (segment.t1 < windowStart || segment.t0 > windowEnd) {
          continue;
        }

        // Get lane for this segment
        const lane = cues.laneMap[segment.speaker];
        if (lane === undefined) continue;

        // Calculate visible portion of segment within window
        const visibleStart = Math.max(segment.t0, windowStart);
        const visibleEnd = Math.min(segment.t1, windowEnd);

        // Map time to canvas X coordinates
        const xStart = ((visibleStart - windowStart) / windowMs) * canvas.width;
        const xEnd = ((visibleEnd - windowStart) / windowMs) * canvas.width;
        const width = xEnd - xStart;

        // Calculate Y position based on lane
        const y = lane * (laneHeight + laneGap);

        // Draw the bar
        ctx.fillStyle = LANE_COLORS[lane] || '#888888';
        ctx.fillRect(xStart, y, width, laneHeight);
      }

      // Draw current time indicator (vertical line at center)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, totalHeight);
      ctx.stroke();

      // Schedule next frame
      animationFrameId = requestAnimationFrame(render);
    };

    // Start animation loop
    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef, cues, windowMs, laneHeight, laneGap, totalHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}
