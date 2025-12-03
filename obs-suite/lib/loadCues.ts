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

export interface CuesData {
  version: number;
  video: {
    src: string;
    durationMs: number;
  };
  speakers: Speaker[];
  segments: Segment[];
  laneMap: Record<string, number>;
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
 * Loads and validates cues data from a URL
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
