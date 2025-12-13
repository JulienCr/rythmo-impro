/**
 * Data loader for FCPXML character tracks
 *
 * Loads JSON from URL, validates, and transforms to visualization format
 * Pattern matches: lib/loadCues.ts (async fetch, validate, transform)
 */

import {
  CharacterTracksData,
  CharacterVisualizationData,
  VisualizationSegment,
  validateCharacterTracksData,
} from './fcpxmlTypes';

/**
 * Load and validate tracks data from URL
 * @param url - URL to tracks JSON file (e.g., /tracks/juste-leblanc.json)
 * @returns CharacterVisualizationData ready for canvas rendering
 */
export async function loadTracksFromUrl(url: string): Promise<CharacterVisualizationData> {
  // Fetch JSON
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load tracks from ${url}: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  // Validate schema
  validateCharacterTracksData(json);

  // Transform to visualization format
  return transformToVisualizationData(json);
}

/**
 * Transform CharacterTracksData to visualization format
 * - Creates trackMap (name → lane index)
 * - Flattens segments array
 * - Converts to milliseconds
 * - Sorts by start time
 */
export function transformToVisualizationData(
  tracks: CharacterTracksData
): CharacterVisualizationData {
  // Create track map (name → lane index)
  const trackMap: Record<string, number> = {};
  tracks.tracks.forEach((track, index) => {
    trackMap[track.name] = index;
  });

  // Flatten segments array
  const segments: VisualizationSegment[] = [];

  for (const [index, track] of tracks.tracks.entries()) {
    const lane = index;

    for (const segment of track.segments) {
      segments.push({
        trackName: track.name,
        lane: lane,
        color: track.color,
        t0: Math.floor(segment.start * 1000),  // seconds → milliseconds
        t1: Math.floor(segment.end * 1000),
      });
    }
  }

  // Sort by start time (t0)
  segments.sort((a, b) => a.t0 - b.t0);

  // Calculate max duration from segments
  const durationMs = segments.length > 0
    ? Math.max(...segments.map(s => s.t1))
    : 0;
  const durationSec = durationMs / 1000;

  return {
    tracks: tracks.tracks,
    trackMap,
    segments,
    durationSec,
  };
}
