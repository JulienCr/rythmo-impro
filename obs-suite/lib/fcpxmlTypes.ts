/**
 * Type definitions for FCPXML character timeline system
 *
 * Three type layers:
 * 1. Raw FCPXML types (parsed XML structure)
 * 2. Output JSON format (CharacterTracksData - stored in /public/tracks/)
 * 3. Visualization format (CharacterVisualizationData - optimized for canvas rendering)
 */

// ============================================================================
// Layer 1: Raw FCPXML Types (parsed from XML)
// ============================================================================

export interface FcpxmlDocument {
  xmeml?: {
    sequence?: FcpxmlSequence;
  };
}

export interface FcpxmlSequence {
  rate?: {
    timebase?: number;  // FPS (e.g., 25)
    ntsc?: boolean;
  };
  media?: {
    video?: {
      track?: FcpxmlTrack | FcpxmlTrack[];
    };
  };
}

export interface FcpxmlTrack {
  'MZ.TrackName'?: string;  // Character name from Premiere Pro
  generatoritem?: FcpxmlGeneratorItem | FcpxmlGeneratorItem[];
  clipitem?: unknown;  // Video clips (we ignore these)
}

export interface FcpxmlGeneratorItem {
  name?: string;
  start?: number;  // Frame number
  end?: number;    // Frame number (-1 means unset in FCP XML)
  in?: number;     // In-point frame number
  out?: number;    // Out-point frame number
  effect?: {
    parameter?: FcpxmlParameter | FcpxmlParameter[];
  };
}

export interface FcpxmlParameter {
  parameterid?: string;
  value?: {
    red?: number;    // 0-255
    green?: number;  // 0-255
    blue?: number;   // 0-255
    alpha?: number;
  };
}

// ============================================================================
// Layer 2: Output JSON Format (stored in /public/tracks/)
// ============================================================================

export interface CharacterTracksData {
  version: number;  // Format version (start with 1)
  format: 'fcpxml-tracks';
  fps: number;
  tracks: CharacterTrack[];
}

export interface CharacterTrack {
  name: string;           // e.g., "Perso1", "Perso2"
  color: string;          // Hex color "#rrggbb"
  segments: TimeSegment[];
}

export interface TimeSegment {
  start: number;  // seconds (float)
  end: number;    // seconds (float)
}

// ============================================================================
// Layer 3: Visualization Format (runtime, optimized for rendering)
// ============================================================================

export interface CharacterVisualizationData {
  tracks: CharacterTrack[];
  trackMap: Record<string, number>;  // track name → lane index
  segments: VisualizationSegment[];  // Flattened, sorted by start time
  durationSec: number;               // Total video duration
}

export interface VisualizationSegment {
  trackName: string;
  lane: number;      // Pre-calculated lane (0, 1, 2...)
  color: string;     // Pre-calculated color
  t0: number;        // milliseconds (for consistency with RythmoOverlay)
  t1: number;        // milliseconds
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Runtime validation for CharacterTracksData
 * Similar to validateEnhancedCuesData from loadCues.ts
 */
export function validateCharacterTracksData(data: unknown): data is CharacterTracksData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid tracks data: not an object');
  }

  const d = data as Partial<CharacterTracksData>;

  // Version check (accept version 1)
  if (typeof d.version !== 'number' || d.version !== 1) {
    throw new Error(`Invalid tracks data: version must be 1 (got ${d.version})`);
  }

  // Format check
  if (d.format !== 'fcpxml-tracks') {
    throw new Error(`Invalid tracks data: format must be 'fcpxml-tracks' (got ${d.format})`);
  }

  // FPS validation (positive number)
  if (typeof d.fps !== 'number' || d.fps <= 0) {
    throw new Error(`Invalid tracks data: fps must be a positive number (got ${d.fps})`);
  }

  // Tracks array validation
  if (!Array.isArray(d.tracks)) {
    throw new Error('Invalid tracks data: tracks must be an array');
  }

  // Validate each track
  for (let i = 0; i < d.tracks.length; i++) {
    const track = d.tracks[i];

    if (!track || typeof track !== 'object') {
      throw new Error(`Invalid track at index ${i}: not an object`);
    }

    if (typeof track.name !== 'string' || track.name.length === 0) {
      throw new Error(`Invalid track at index ${i}: name must be a non-empty string`);
    }

    if (typeof track.color !== 'string' || !track.color.match(/^#[0-9a-fA-F]{3,6}$/)) {
      throw new Error(`Invalid track at index ${i}: color must be a hex color (#RGB or #RRGGBB)`);
    }

    if (!Array.isArray(track.segments)) {
      throw new Error(`Invalid track at index ${i}: segments must be an array`);
    }

    // Validate segments
    for (let j = 0; j < track.segments.length; j++) {
      const segment = track.segments[j];

      if (!segment || typeof segment !== 'object') {
        throw new Error(`Invalid segment at track ${i}, index ${j}: not an object`);
      }

      if (typeof segment.start !== 'number' || segment.start < 0) {
        throw new Error(`Invalid segment at track ${i}, index ${j}: start must be a non-negative number`);
      }

      if (typeof segment.end !== 'number' || segment.end <= segment.start) {
        throw new Error(`Invalid segment at track ${i}, index ${j}: end (${segment.end}) must be greater than start (${segment.start})`);
      }
    }

    // Verify segments are sorted by start time
    for (let j = 1; j < track.segments.length; j++) {
      if (track.segments[j].start < track.segments[j - 1].start) {
        throw new Error(`Invalid track at index ${i}: segments must be sorted by start time`);
      }
    }
  }

  return true;
}

// ============================================================================
// Layer 4: CLI JSON Format (input for FCPXML generation)
// ============================================================================

/**
 * CLI JSON format (WhisperX-compatible output from diarization)
 * Used as input for FCPXML generator
 */
export interface CliJsonData {
  segments: CliSegment[];
}

export interface CliSegment {
  start: number;      // seconds (float)
  end: number;        // seconds (float)
  speaker: string;    // e.g., "SPEAKER_00"
  text: string;       // Transcribed text
  words?: CliWord[];  // Optional word-level details
}

export interface CliWord {
  start: number;      // seconds (float)
  end: number;        // seconds (float)
  word: string;       // Word text
}

/**
 * Options for FCPXML generation
 */
export interface GenerateFcpxmlOptions {
  fps?: number;           // Override auto-detected FPS
  projectName?: string;   // Custom project name (defaults to video filename)
}

/**
 * Runtime validation for CliJsonData
 */
export function validateCliJsonData(data: unknown): data is CliJsonData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid CLI JSON: not an object');
  }

  const d = data as Partial<CliJsonData>;

  if (!Array.isArray(d.segments)) {
    throw new Error('Invalid CLI JSON: segments must be an array');
  }

  for (let i = 0; i < d.segments.length; i++) {
    const seg = d.segments[i];

    if (!seg || typeof seg !== 'object') {
      throw new Error(`Invalid segment at index ${i}: not an object`);
    }

    if (typeof seg.start !== 'number' || seg.start < 0) {
      throw new Error(`Invalid segment at index ${i}: start must be non-negative (got ${seg.start})`);
    }

    if (typeof seg.end !== 'number' || seg.end <= seg.start) {
      throw new Error(`Invalid segment at index ${i}: end (${seg.end}) must be greater than start (${seg.start})`);
    }

    if (typeof seg.speaker !== 'string' || seg.speaker.length === 0) {
      throw new Error(`Invalid segment at index ${i}: speaker must be a non-empty string`);
    }

    if (typeof seg.text !== 'string') {
      throw new Error(`Invalid segment at index ${i}: text must be a string`);
    }
  }

  return true;
}

// ============================================================================
// Layer 5: Video Metadata (custom titles, etc.)
// ============================================================================

/**
 * Video metadata stored in {basename}.meta.json
 * Used for custom video titles and other user-configurable metadata
 */
export interface VideoMeta {
  version: number;
  videoTitle?: string;
  characterNames?: Record<string, string>;
}

/**
 * Runtime validation for VideoMeta
 */
export function validateVideoMeta(data: unknown): data is VideoMeta {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<VideoMeta>;

  // Version check (accept version 1)
  if (typeof d.version !== 'number' || d.version !== 1) {
    return false;
  }

  // videoTitle is optional but must be a string if present
  if (d.videoTitle !== undefined && typeof d.videoTitle !== 'string') {
    return false;
  }

  // characterNames is optional but must be a Record<string, string> if present
  if (d.characterNames !== undefined) {
    if (typeof d.characterNames !== 'object' || d.characterNames === null || Array.isArray(d.characterNames)) {
      return false;
    }
    for (const [key, value] of Object.entries(d.characterNames)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return false;
      }
    }
  }

  return true;
}
