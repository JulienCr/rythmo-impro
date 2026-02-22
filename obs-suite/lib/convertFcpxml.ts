/**
 * FCPXML to CharacterTracksData converter
 *
 * Converts Final Cut Pro XML files (with colored slugs on character tracks)
 * into JSON format suitable for timeline visualization.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  CharacterTracksData,
  CharacterTrack,
  TimeSegment,
  FcpxmlDocument,
  FcpxmlTrack,
  FcpxmlGeneratorItem,
  FcpxmlParameter,
} from './fcpxmlTypes';

// Fixed color palette for character tracks (max 5 chars, notable differences)
const TRACK_COLOR_PALETTE = [
  '#07F',  // Blue
  '#F33',  // Red
  '#FD0',  // Yellow
  '#3C7',  // Green
  '#A5D',  // Purple
  '#F90',  // Orange
  '#F25',  // Pink
  '#5CF',  // Teal
];

/**
 * Main conversion function
 * @param xmlContent - Raw FCPXML string content
 * @returns CharacterTracksData object
 */
export function convertFcpxmlToTracks(xmlContent: string): CharacterTracksData {
  // Parse XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    trimValues: true,
  });

  let parsed: FcpxmlDocument;
  try {
    parsed = parser.parse(xmlContent);
  } catch (err) {
    throw new Error(`Failed to parse FCPXML: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Extract FPS
  const fps = extractFps(parsed);
  if (!fps || fps <= 0) {
    throw new Error('Cannot determine FPS from FCPXML');
  }

  // Extract character tracks (skip track 1 - main video)
  const tracks = extractCharacterTracks(parsed, fps);

  return {
    version: 1,
    format: 'fcpxml-tracks',
    fps,
    tracks,
  };
}

/**
 * Extract FPS from FCPXML
 */
function extractFps(parsed: FcpxmlDocument): number | null {
  const timebase = parsed.xmeml?.sequence?.rate?.timebase;
  return typeof timebase === 'number' ? timebase : null;
}

/**
 * Extract all video tracks (skip track 1 - main video)
 */
function extractCharacterTracks(parsed: FcpxmlDocument, fps: number): CharacterTrack[] {
  const videoTracks = parsed.xmeml?.sequence?.media?.video?.track;

  if (!videoTracks) {
    return [];  // No tracks - valid case
  }

  // Normalize to array (XML parser may return single object if only one track)
  const tracksArray = Array.isArray(videoTracks) ? videoTracks : [videoTracks];

  const characterTracks: CharacterTrack[] = [];

  // Process tracks (skip track 1 at index 0)
  for (let trackIndex = 1; trackIndex < tracksArray.length; trackIndex++) {
    const track = tracksArray[trackIndex];
    const trackNumber = trackIndex; // Track 2 = index 1 → Char1

    // Extract track name from MZ.TrackName attribute, or fallback to Char{N}
    const trackName = track['MZ.TrackName'] || `Char${trackNumber}`;

    // Extract generator items (colored slugs)
    const generatorItems = extractGeneratorItems(track);

    if (generatorItems.length === 0) {
      continue;  // Skip tracks with no generator items
    }

    // Convert to segments
    const segments: TimeSegment[] = [];

    for (const item of generatorItems) {
      let start = item.start ?? 0;
      let end = item.end ?? 0;
      const clipDuration = (item.in != null && item.out != null && item.out > item.in)
        ? item.out - item.in
        : null;

      // FCP XML uses -1 to mean "unset" - compute from in/out points
      if (start < 0 && clipDuration != null) {
        start = end - clipDuration;
      }
      if (end <= 0 && clipDuration != null) {
        end = start + clipDuration;
      }

      // Validate frame numbers
      if (end <= start) {
        throw new Error(`Invalid segment at frames ${start}-${end} (track ${trackName}): end must be greater than start`);
      }

      // Convert frames to seconds, clamp negative starts to 0
      const startSec = Math.max(0, framesToSeconds(start, fps));
      const endSec = framesToSeconds(end, fps);

      segments.push({ start: startSec, end: endSec });
    }

    // Sort segments by start time
    segments.sort((a, b) => a.start - b.start);

    // Use hardcoded color palette
    const color = TRACK_COLOR_PALETTE[(trackIndex - 1) % TRACK_COLOR_PALETTE.length];

    characterTracks.push({
      name: trackName,
      color,
      segments,
    });
  }

  return characterTracks;
}

/**
 * Extract generator items from a track
 */
function extractGeneratorItems(track: FcpxmlTrack): FcpxmlGeneratorItem[] {
  const items = track.generatoritem;

  if (!items) {
    return [];
  }

  // Normalize to array
  return Array.isArray(items) ? items : [items];
}

/**
 * Convert frame numbers to seconds
 */
function framesToSeconds(frame: number, fps: number): number {
  return frame / fps;
}
