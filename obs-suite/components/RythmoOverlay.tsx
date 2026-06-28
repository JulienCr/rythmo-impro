'use client';

import { useEffect, useMemo, useRef, useState, RefObject } from 'react';
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

  return lo > 0 ? text.slice(0, lo) + '\u2026' : null;
}

const BUFFER_MS = 3000; // Required buffer before first segment

interface RythmoOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  visualizationData: CharacterVisualizationData;
  windowMs?: number;      // Default: 6000 (±3s rolling window)
  laneHeight?: number;    // Default: 32px (visible bars)
  laneGap?: number;       // Default: 1px (minimal gap)
  prerollStartTime?: number | null; // Timestamp (Date.now()) when preroll started
  onPrerollComplete?: () => void;   // Called when preroll finishes
  // Where to anchor the big "remaining time" overlay:
  // - 'above-band' (default): floats just above the band (band sits at frame bottom)
  // - 'overlay-top-right': inside the band container's top-right (for clipped layouts)
  timerAnchor?: 'above-band' | 'overlay-top-right';
}

export default function RythmoOverlay({
  videoRef,
  visualizationData,
  windowMs = 6000,
  laneHeight = 32,
  laneGap = 1,
  prerollStartTime = null,
  onPrerollComplete,
  timerAnchor = 'above-band',
}: RythmoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prerollCompleteCalledRef = useRef(false);
  const onPrerollCompleteRef = useRef(onPrerollComplete);
  onPrerollCompleteRef.current = onPrerollComplete;

  // Big "remaining time" overlay — rendered as HTML (see return) so it stays
  // readable from across the room, independent of the small lane band height.
  const [timerText, setTimerText] = useState('');
  const [timerUrgent, setTimerUrgent] = useState(false);

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
  const prerollDurationMs = useMemo(() => {
    const earliestSegmentTime = visualizationData.segments.reduce(
      (min, s) => Math.min(min, s.t0),
      BUFFER_MS
    );
    return Math.max(0, BUFFER_MS - earliestSegmentTime);
  }, [visualizationData]);

  // Animation loop for rendering segments
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset preroll flag when this effect (re)starts
    prerollCompleteCalledRef.current = false;

    // Playhead at 1/5 from left (show more of what's coming)
    const timeBeforeMs = windowMs * 0.2;
    const timeAfterMs = windowMs * 0.8;
    const playheadRatio = 0.2;

    // Pre-compute fonts (constant during playback)
    const segmentFontSize = Math.round(laneHeight * 0.6);
    const segmentFont = `bold ${segmentFontSize}px sans-serif`;

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
          onPrerollCompleteRef.current?.();
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

      // Set segment text style once before the loop
      ctx.font = segmentFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

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

      // Compute the big "remaining time" value (drawn as HTML, see return)
      const videoDuration = video.duration;
      if (videoDuration && !isNaN(videoDuration) && videoDuration > 0) {
        const remainingSec = prerollStartTime !== null
          ? videoDuration
          : Math.max(0, videoDuration - video.currentTime);

        let nextText: string;
        if (remainingSec >= 60) {
          const minutes = Math.floor(remainingSec / 60);
          const seconds = Math.floor(remainingSec % 60);
          nextText = `-${minutes}:${String(seconds).padStart(2, '0')}`;
        } else {
          nextText = `-${Math.floor(remainingSec)}s`;
        }

        // Last 10s (only during actual playback) → urgent red highlight
        const nextUrgent = prerollStartTime === null && remainingSec <= 10;
        setTimerText((prev) => (prev === nextText ? prev : nextText));
        setTimerUrgent((prev) => (prev === nextUrgent ? prev : nextUrgent));
      }

      animationFrameId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef, visualizationData, windowMs, laneHeight, laneGap, totalHeight, prerollStartTime, prerollDurationMs]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{
          imageRendering: 'crisp-edges',
          pointerEvents: 'none',
        }}
      />
      {timerText && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: '1.2vw',
            // 'above-band' floats above the band; 'overlay-top-right' stays inside
            // the container (for layouts that clip overflow).
            ...(timerAnchor === 'overlay-top-right'
              ? { top: '0.6vw' }
              : { bottom: 'calc(100% + 0.6vw)' }),
            padding: '0.18em 0.45em',
            borderRadius: '0.16em',
            fontSize: 'clamp(0.7rem, 2.2vw, 3rem)', // scales with the frame, readable in OBS
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            fontFeatureSettings: '"tnum"',
            letterSpacing: '0.02em',
            color: '#FFFFFF',
            background: timerUrgent ? 'rgba(255, 59, 48, 0.9)' : 'rgba(0, 0, 0, 0.6)',
            textShadow: '0 2px 10px rgba(0, 0, 0, 0.9)',
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {timerText}
        </div>
      )}
    </>
  );
}
