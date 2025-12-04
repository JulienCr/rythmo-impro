/**
 * Type definitions and loading utilities for speaker diarization cues
 */

export interface Speaker {
  id: string;
}

export interface Segment {
  speaker: string;
  t0: number;  // milliseconds - start time
  t1: number;  // milliseconds - end time
}

export interface Subtitle {
  t0: number;  // milliseconds - start time
  t1: number;  // milliseconds - end time
  text: string;
  speaker?: string;  // optional speaker ID from [SPEAKER_XX] tag
}

export interface CuesData {
  version: number;
  video: {
    src: string;
    durationMs: number;
  };
  speakers: Speaker[];
  segments: Segment[];
  laneMap: Record<string, number>;
  subtitles?: Subtitle[];  // optional subtitles from SRT
}

/**
 * Validates that data matches the CuesData schema
 */
export function validateCuesData(data: unknown): data is CuesData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Cues data must be an object');
  }

  const obj = data as Record<string, unknown>;

  // Validate version
  if (obj.version !== 1) {
    throw new Error(`Unsupported version: ${obj.version}. Expected version 1.`);
  }

  // Validate video object
  if (typeof obj.video !== 'object' || obj.video === null) {
    throw new Error('Missing or invalid video object');
  }

  const video = obj.video as Record<string, unknown>;
  if (typeof video.src !== 'string') {
    throw new Error('video.src must be a string');
  }
  if (typeof video.durationMs !== 'number' || video.durationMs <= 0) {
    throw new Error('video.durationMs must be a positive number');
  }

  // Validate speakers array
  if (!Array.isArray(obj.speakers)) {
    throw new Error('speakers must be an array');
  }
  for (const speaker of obj.speakers) {
    if (typeof speaker !== 'object' || speaker === null) {
      throw new Error('Each speaker must be an object');
    }
    if (typeof (speaker as Record<string, unknown>).id !== 'string') {
      throw new Error('speaker.id must be a string');
    }
  }

  // Validate segments array
  if (!Array.isArray(obj.segments)) {
    throw new Error('segments must be an array');
  }
  for (let i = 0; i < obj.segments.length; i++) {
    const segment = obj.segments[i];
    if (typeof segment !== 'object' || segment === null) {
      throw new Error(`Segment ${i} must be an object`);
    }
    const seg = segment as Record<string, unknown>;
    if (typeof seg.speaker !== 'string') {
      throw new Error(`Segment ${i}: speaker must be a string`);
    }
    if (typeof seg.t0 !== 'number' || seg.t0 < 0) {
      throw new Error(`Segment ${i}: t0 must be a non-negative number`);
    }
    if (typeof seg.t1 !== 'number' || seg.t1 <= seg.t0) {
      throw new Error(`Segment ${i}: t1 must be greater than t0 (got t0=${seg.t0}, t1=${seg.t1})`);
    }
  }

  // Validate laneMap
  if (typeof obj.laneMap !== 'object' || obj.laneMap === null) {
    throw new Error('laneMap must be an object');
  }

  const laneMap = obj.laneMap as Record<string, unknown>;
  const speakerIds = new Set((obj.speakers as Speaker[]).map(s => s.id));

  for (const [speaker, lane] of Object.entries(laneMap)) {
    if (!speakerIds.has(speaker)) {
      throw new Error(`laneMap references unknown speaker: ${speaker}`);
    }
    if (typeof lane !== 'number' || lane < 0 || !Number.isInteger(lane)) {
      throw new Error(`laneMap[${speaker}] must be a non-negative integer`);
    }
  }

  return true;
}

/**
 * SRT timestamp format: HH:MM:SS,mmm
 * Converts to milliseconds
 */
function parseSrtTimestamp(timestamp: string): number {
  const [time, ms] = timestamp.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + Number(ms);
}

/**
 * Extract speaker ID from SRT subtitle text
 * Format: [SPEAKER_00] text or [UNKNOWN] text
 * Returns { speaker, text } or null if no speaker tag found
 */
function extractSpeaker(text: string): { speaker: string; text: string } | null {
  const match = text.match(/^\[([A-Z_0-9]+)\]\s*(.*)/);
  if (!match) return null;
  return { speaker: match[1], text: match[2] };
}

/**
 * Parse SRT file content into subtitles
 */
function parseSrtToSubtitles(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const blocks = content.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // Line 0: sequence number (ignored)
    // Line 1: timestamp range
    // Line 2+: subtitle text
    const timestampLine = lines[1];
    const textLines = lines.slice(2).join(' ');

    // Parse timestamps
    const timestampMatch = timestampLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timestampMatch) continue;

    const t0 = parseSrtTimestamp(timestampMatch[1]);
    const t1 = parseSrtTimestamp(timestampMatch[2]);

    // Extract speaker (optional)
    const speakerData = extractSpeaker(textLines);

    subtitles.push({
      t0,
      t1,
      text: speakerData ? speakerData.text : textLines,
      speaker: speakerData?.speaker,
    });
  }

  return subtitles;
}

/**
 * Load subtitles from SRT URL
 */
export async function loadSubtitlesFromUrl(url: string): Promise<Subtitle[]> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch subtitles: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    return parseSrtToSubtitles(content);
  } catch (error) {
    console.error('Failed to load subtitles:', error);
    throw error;
  }
}

/**
 * Loads and validates cues data from a URL
 * Only supports JSON format for cues
 */
export async function loadCuesFromUrl(url: string): Promise<CuesData> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch cues: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (validateCuesData(data)) {
      return data;
    }

    // TypeScript knows data is CuesData here
    throw new Error('Validation failed');
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in cues file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Helper: Get segments that intersect a time window
 */
export function getSegmentsInWindow(
  segments: Segment[],
  currentTimeMs: number,
  windowMs: number
): Segment[] {
  const halfWindow = windowMs / 2;
  const windowStart = currentTimeMs - halfWindow;
  const windowEnd = currentTimeMs + halfWindow;

  return segments.filter(
    segment => segment.t1 >= windowStart && segment.t0 <= windowEnd
  );
}
