'use client';

import { useEffect, useRef, RefObject, useState } from 'react';
import { VisualizationData, Subtitle } from '@/lib/loadCues';

interface RythmoOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  visualizationData: VisualizationData;
  windowMs?: number;      // Default: 6000 (±3s rolling window)
  laneHeight?: number;    // Default: 20px
  laneGap?: number;       // Default: 8px
  subtitles?: Subtitle[]; // Optional SRT subtitles
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
  visualizationData,
  windowMs = 6000,
  laneHeight = 20,
  laneGap = 8,
  subtitles = [],
}: RythmoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');

  // Calculate number of lanes needed
  const numLanes = visualizationData.speakers.length;
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

      // Collect currently active words (for text display)
      const activeWords: Array<{ text: string; speaker: string; lane: number }> = [];

      // Draw each word that intersects the window
      // Words are sorted by t0, so we can break early
      for (const word of visualizationData.words) {
        // Break early if we've passed the window end
        if (word.t0 > windowEnd) {
          break;
        }

        // Skip words before the window
        if (word.t1 < windowStart) {
          continue;
        }

        // Check if word is currently being spoken (intersects current time)
        if (word.t0 <= currentTimeMs && word.t1 >= currentTimeMs) {
          activeWords.push({
            text: word.text,
            speaker: word.speaker,
            lane: word.lane
          });
        }

        // Calculate visible portion of word within window
        const visibleStart = Math.max(word.t0, windowStart);
        const visibleEnd = Math.min(word.t1, windowEnd);

        // Map time to canvas X coordinates
        const xStart = ((visibleStart - windowStart) / windowMs) * canvas.width;
        const xEnd = ((visibleEnd - windowStart) / windowMs) * canvas.width;
        const width = xEnd - xStart;

        // Calculate Y position based on pre-calculated lane
        const y = word.lane * (laneHeight + laneGap);

        // Draw the word bar
        ctx.fillStyle = LANE_COLORS[word.lane] || '#888888';
        ctx.fillRect(xStart, y, width, laneHeight);
      }

      // Draw current time indicator (vertical line at center)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, totalHeight);
      ctx.stroke();

      // Update current text from JSON data
      if (activeWords.length > 0) {
        // Group by speaker and lane, then join text
        const textBySpeaker = new Map<string, string[]>();

        for (const word of activeWords) {
          const key = `${word.speaker}`;
          if (!textBySpeaker.has(key)) {
            textBySpeaker.set(key, []);
          }
          textBySpeaker.get(key)!.push(word.text);
        }

        // Format text with speaker labels if multiple speakers
        const formattedText = Array.from(textBySpeaker.entries())
          .map(([speaker, words]) => {
            const text = words.join(' ');
            return textBySpeaker.size > 1 ? `[${speaker}] ${text}` : text;
          })
          .join(' | ');

        setCurrentSubtitle(formattedText);
      } else if (subtitles.length > 0) {
        // Fall back to SRT subtitles if no active words
        const activeSubtitle = subtitles.find(
          sub => currentTimeMs >= sub.t0 && currentTimeMs <= sub.t1
        );
        setCurrentSubtitle(activeSubtitle?.text || '');
      } else {
        setCurrentSubtitle('');
      }

      // Schedule next frame
      animationFrameId = requestAnimationFrame(render);
    };

    // Start animation loop
    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef, visualizationData, windowMs, laneHeight, laneGap, totalHeight, subtitles]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="block"
        style={{ imageRendering: 'crisp-edges' }}
      />
      {currentSubtitle && (
        <div
          className="absolute bottom-4 left-0 right-0 text-center pointer-events-none"
          style={{
            textShadow: '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8)'
          }}
        >
          <p className="text-white text-2xl font-bold px-4">
            {currentSubtitle}
          </p>
        </div>
      )}
    </>
  );
}
