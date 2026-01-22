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

  // Canvas sizing effect: match canvas resolution to video dimensions
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function updateCanvasSize(): void {
      if (!video || !canvas) return;
      const videoWidth = video.videoWidth || 1920;
      const displayWidth = video.clientWidth || videoWidth;
      const scale = displayWidth / videoWidth;

      canvas.width = videoWidth;
      canvas.height = totalHeight;
      canvas.style.height = `${totalHeight * scale}px`;
    }

    video.addEventListener('loadedmetadata', updateCanvasSize);
    window.addEventListener('resize', updateCanvasSize);

    // Initialize if metadata already loaded
    if (video.readyState >= 1) {
      updateCanvasSize();
    }

    return () => {
      video.removeEventListener('loadedmetadata', updateCanvasSize);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [videoRef, numLanes, laneHeight, laneGap, totalHeight]);

  // Animation loop for rendering segments
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Playhead at 1/5 from left (show more of what's coming)
    const timeBeforeMs = windowMs * 0.2;
    const timeAfterMs = windowMs * 0.8;
    const playheadRatio = 0.2;

    let animationFrameId: number;

    function render(): void {
      if (!canvas || !video || !ctx) return;

      const currentTimeMs = video.currentTime * 1000;
      const windowStart = currentTimeMs - timeBeforeMs;
      const windowEnd = currentTimeMs + timeAfterMs;

      // Clear and draw background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw visible segments (sorted, so early break is possible)
      for (const segment of visualizationData.segments) {
        if (segment.t0 > windowEnd) break;
        if (segment.t1 < windowStart) continue;

        const visibleStart = Math.max(segment.t0, windowStart);
        const visibleEnd = Math.min(segment.t1, windowEnd);
        const xStart = ((visibleStart - windowStart) / windowMs) * canvas.width;
        const xEnd = ((visibleEnd - windowStart) / windowMs) * canvas.width;
        const y = segment.lane * (laneHeight + laneGap);

        ctx.fillStyle = segment.color;
        ctx.fillRect(xStart, y, xEnd - xStart, laneHeight);
      }

      // Draw playhead
      const playheadX = canvas.width * playheadRatio;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, totalHeight);
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    }

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
