'use client';

import { useEffect, useRef, RefObject } from 'react';
import type { CharacterVisualizationData } from '@/lib/fcpxmlTypes';

/**
 * Truncate text to fit within a given pixel width, appending ellipsis if needed.
 * Returns null if even a single character with ellipsis exceeds the available width.
 */
function truncateTextToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  availableWidth: number
): string | null {
  if (ctx.measureText(text).width <= availableWidth) {
    return text;
  }

  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '\u2026').width <= availableWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const result = lo > 0 ? text.slice(0, lo) + '\u2026' : null;
  return result && ctx.measureText(result).width <= availableWidth ? result : null;
}

interface RythmoOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  visualizationData: CharacterVisualizationData;
  windowMs?: number;      // Default: 6000 (±3s rolling window)
  laneHeight?: number;    // Default: 32px (visible bars)
  laneGap?: number;       // Default: 1px (minimal gap)
  prerollStartTime?: number | null; // Timestamp (Date.now()) when preroll started
  onPrerollComplete?: () => void;   // Called when preroll finishes
}

export default function RythmoOverlay({
  videoRef,
  visualizationData,
  windowMs = 6000,
  laneHeight = 32,
  laneGap = 1,
  prerollStartTime = null,
  onPrerollComplete,
}: RythmoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prerollCompleteCalledRef = useRef(false);

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
      canvas.style.width = `${video.clientWidth}px`;
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

  // Calculate preroll duration to ensure 3 seconds before first band
  const bufferMs = 3000; // Required buffer before first segment
  const earliestSegmentTime = visualizationData.segments.reduce(
    (min, s) => Math.min(min, s.t0),
    bufferMs
  );
  const prerollDurationMs = Math.max(0, bufferMs - earliestSegmentTime);

  // Reset preroll complete flag when preroll starts
  useEffect(() => {
    if (prerollStartTime !== null) {
      prerollCompleteCalledRef.current = false;
    }
  }, [prerollStartTime]);

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

      // Calculate current time based on preroll or video playback
      let currentTimeMs: number;

      if (prerollStartTime !== null) {
        // During preroll: time goes from -prerollDuration to 0
        const elapsed = Date.now() - prerollStartTime;
        currentTimeMs = elapsed - prerollDurationMs;

        // Check if preroll is complete (reached time 0)
        if (currentTimeMs >= 0 && !prerollCompleteCalledRef.current) {
          prerollCompleteCalledRef.current = true;
          onPrerollComplete?.();
        }
      } else {
        // Normal playback: use video time
        currentTimeMs = video.currentTime * 1000;
      }

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

        const width = xEnd - xStart;
        ctx.fillStyle = segment.color;
        ctx.fillRect(xStart, y, width, laneHeight);

        // Draw character name if bar is wide enough
        const minWidthForText = 50;
        if (width >= minWidthForText) {
          const fontSize = Math.round(laneHeight * 0.6);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const padding = 8;
          const displayText = truncateTextToFit(ctx, segment.trackName, width - padding * 2);

          if (displayText) {
            const textX = xStart + padding;
            const textY = y + laneHeight / 2;

            // Black text with white outline for visibility
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 3;
            ctx.strokeText(displayText, textX, textY);
            ctx.fillStyle = 'black';
            ctx.fillText(displayText, textX, textY);
          }
        }
      }

      // Draw playhead
      const playheadX = canvas.width * playheadRatio;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, totalHeight);
      ctx.stroke();

      // Draw remaining time timer
      const videoDuration = video.duration;
      if (videoDuration && !isNaN(videoDuration) && videoDuration > 0) {
        const remainingSec = prerollStartTime !== null
          ? videoDuration
          : videoDuration - video.currentTime;

        let timerText: string;
        if (remainingSec >= 60) {
          const minutes = Math.floor(remainingSec / 60);
          const seconds = Math.floor(remainingSec % 60);
          timerText = `-${minutes}:${String(seconds).padStart(2, '0')}`;
        } else {
          timerText = `-${Math.floor(remainingSec)}s`;
        }

        const timerFontSize = Math.round(laneHeight * 0.5);
        ctx.font = `bold ${timerFontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';

        const timerPadX = 6;
        const timerPadY = 3;
        const timerX = canvas.width - 12;
        const timerY = totalHeight / 2;
        const timerWidth = ctx.measureText(timerText).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(
          timerX - timerWidth - timerPadX,
          timerY - timerFontSize / 2 - timerPadY,
          timerWidth + timerPadX * 2,
          timerFontSize + timerPadY * 2
        );

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(timerText, timerX, timerY);
      }

      animationFrameId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef, visualizationData, windowMs, laneHeight, laneGap, totalHeight, prerollStartTime, prerollDurationMs, onPrerollComplete]);

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
