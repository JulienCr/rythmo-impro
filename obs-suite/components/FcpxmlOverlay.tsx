'use client';

import { useEffect, useRef, RefObject } from 'react';
import type { CharacterVisualizationData } from '@/lib/fcpxmlTypes';

interface FcpxmlOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  visualizationData: CharacterVisualizationData;
  windowMs?: number;      // Default: 6000 (±3s rolling window)
  laneHeight?: number;    // Default: 32px (visible bars)
  laneGap?: number;       // Default: 1px (minimal gap)
}

export default function FcpxmlOverlay({
  videoRef,
  visualizationData,
  windowMs = 6000,
  laneHeight = 32,
  laneGap = 1,
}: FcpxmlOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate number of lanes needed
  const numLanes = visualizationData.tracks.length;
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

    // Current time at 1/5 from left (show more of what's coming)
    const timeBeforeMs = windowMs * 0.2;  // 20% before
    const timeAfterMs = windowMs * 0.8;   // 80% after

    let animationFrameId: number;

    const render = () => {
      const currentTimeMs = video.currentTime * 1000;
      const windowStart = currentTimeMs - timeBeforeMs;
      const windowEnd = currentTimeMs + timeAfterMs;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw segments (with early break optimization)
      for (const segment of visualizationData.segments) {
        // Early break: segments are sorted, so we're done
        if (segment.t0 > windowEnd) break;

        // Skip segments before window
        if (segment.t1 < windowStart) continue;

        // Calculate visible portion
        const visibleStart = Math.max(segment.t0, windowStart);
        const visibleEnd = Math.min(segment.t1, windowEnd);

        // Map time to X coordinates (rolling window)
        const xStart = ((visibleStart - windowStart) / windowMs) * canvas.width;
        const xEnd = ((visibleEnd - windowStart) / windowMs) * canvas.width;
        const width = xEnd - xStart;

        // Y position from pre-calculated lane
        const y = segment.lane * (laneHeight + laneGap);

        // Draw segment bar
        ctx.fillStyle = segment.color;  // Use track color, not fixed palette
        ctx.fillRect(xStart, y, width, laneHeight);
      }

      // Draw playhead (vertical line at 1/5 from left)
      const playheadX = canvas.width * 0.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, totalHeight);
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    // Start animation loop
    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef, visualizationData, windowMs, laneHeight, laneGap, totalHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{
        imageRendering: 'crisp-edges',
        pointerEvents: 'none',
      }}
    />
  );
}
