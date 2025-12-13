/**
 * Type definitions and loading utilities for speaker diarization cues
 */

export interface Speaker {
  id: string;
}

export interface Subtitle {
  t0: number;  // milliseconds - start time
  t1: number;  // milliseconds - end time
  text: string;
  speaker?: string;  // optional speaker ID from [SPEAKER_XX] tag
}

// Enhanced JSON format types (from diarization service)
export interface EnhancedCuesData {
  version: number;
  format: 'enhanced';
  vad_trimming?: {  // Optional: present in version 2+ when VAD trimming applied
    enabled: boolean;
    threshold: number;
    aggressiveness: string;
  };
  video: {
    filename: string;
    durationMs: number;
    durationSec: number;
  };
  speakers: Speaker[];
  segments: EnhancedSegment[];
  stats: {
    total_segments: number;
    total_speakers: number;
    total_words: number;
  };
}

export interface EnhancedSegment {
  id: number;
  start: number;        // seconds (float)
  end: number;          // seconds (float)
  speaker: string;
  text: string;
  word_count: number;
  words: Word[];
}

export interface Word {
  start: number;        // seconds (float)
  end: number;          // seconds (float)
  word: string;
  confidence: number;   // 0.0-1.0
}

// Visualization data types (transformed for efficient rendering)
export interface VisualizationData {
  speakers: Speaker[];
  laneMap: Record<string, number>;  // Calculated from speaker order
  words: VisualizationWord[];       // Flattened word list for efficient rendering
  durationMs: number;
}

export interface VisualizationWord {
  speaker: string;
  lane: number;         // Pre-calculated lane number
  t0: number;          // milliseconds (for consistency with current code)
  t1: number;          // milliseconds
  text: string;
  confidence: number;
}

/**
 * Validates that data matches the EnhancedCuesData schema
 */
export function validateEnhancedCuesData(data: unknown): data is EnhancedCuesData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Cues data must be an object');
  }

  const obj = data as Record<string, unknown>;

  // Validate version (accept v1 and v2 - same schema, v2 just adds optional VAD metadata)
  if (obj.version !== 1 && obj.version !== 2) {
    throw new Error(`Unsupported version: ${obj.version}. Expected version 1 or 2.`);
  }

  // Validate format
  if (obj.format !== 'enhanced') {
    throw new Error(`Unsupported format: ${obj.format}. Expected 'enhanced'.`);
  }

  // Validate video object
  if (typeof obj.video !== 'object' || obj.video === null) {
    throw new Error('Missing or invalid video object');
  }

  const video = obj.video as Record<string, unknown>;
  if (typeof video.filename !== 'string') {
    throw new Error('video.filename must be a string');
  }
  if (typeof video.durationMs !== 'number' || video.durationMs <= 0) {
    throw new Error('video.durationMs must be a positive number');
  }

  // Validate speakers array
  if (!Array.isArray(obj.speakers)) {
    throw new Error('speakers must be an array');
  }
  if (obj.speakers.length === 0) {
    throw new Error('Enhanced JSON must have at least one speaker');
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
    if (typeof seg.start !== 'number' || seg.start < 0) {
      throw new Error(`Segment ${i}: start must be a non-negative number`);
    }
    if (typeof seg.end !== 'number' || seg.end <= seg.start) {
      throw new Error(`Segment ${i}: end must be greater than start (got start=${seg.start}, end=${seg.end})`);
    }

    // Validate words array
    if (!Array.isArray(seg.words)) {
      throw new Error(`Segment ${i}: words must be an array`);
    }

    for (let j = 0; j < (seg.words as unknown[]).length; j++) {
      const word = (seg.words as unknown[])[j];
      if (typeof word !== 'object' || word === null) {
        throw new Error(`Segment ${i}, word ${j}: must be an object`);
      }
      const w = word as Record<string, unknown>;

      if (typeof w.word !== 'string') {
        throw new Error(`Segment ${i}, word ${j}: word must be a string`);
      }
      if (typeof w.start !== 'number') {
        throw new Error(`Segment ${i}, word ${j}: start must be a number`);
      }
      if (typeof w.end !== 'number') {
        throw new Error(`Segment ${i}, word ${j}: end must be a number`);
      }
      if (typeof w.confidence !== 'number' || w.confidence < 0 || w.confidence > 1) {
        throw new Error(`Segment ${i}, word ${j}: confidence must be a number between 0 and 1`);
      }
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
 * Apply client-side trimming heuristics to word timestamps.
 * Used for legacy files (version 1) or as defensive fallback.
 *
 * Heuristics:
 * 1. Low confidence words (< 0.6): Trim by 30% of duration
 * 2. Long words (> 0.8s): Trim by 20% of duration
 * 3. Last word in segment (gap > 200ms): Trim by 15% of duration
 *
 * @param words Word array to trim
 * @param aggressive If true, apply more aggressive trimming
 * @returns Modified word array
 */
function applyClientSideTrimming(
  words: VisualizationWord[],
  aggressive: boolean = false
): VisualizationWord[] {
  return words.map((word, index) => {
    let trimRatio = 0;

    // Heuristic 1: Low confidence → likely includes silence
    if (word.confidence < 0.6) {
      trimRatio = Math.max(trimRatio, aggressive ? 0.4 : 0.3);
    }

    // Heuristic 2: Long duration → likely trailing silence
    const durationMs = word.t1 - word.t0;
    if (durationMs > 800) {
      trimRatio = Math.max(trimRatio, aggressive ? 0.25 : 0.2);
    }

    // Heuristic 3: Last word in segment (check next word has gap)
    const nextWord = words[index + 1];
    if (nextWord && (nextWord.t0 - word.t1 > 200)) {
      trimRatio = Math.max(trimRatio, 0.15);
    }

    // Apply trim
    if (trimRatio > 0) {
      const trimAmount = durationMs * trimRatio;
      const newT1 = word.t1 - trimAmount;

      // Safety: ensure minimum 50ms duration
      return {
        ...word,
        t1: Math.max(word.t0 + 50, newT1)
      };
    }

    return word;
  });
}

/**
 * Transform enhanced cues data to visualization data
 * Flattens word arrays and converts to milliseconds for efficient rendering
 */
export function transformToVisualizationData(enhanced: EnhancedCuesData): VisualizationData {
  // 1. Calculate lane map from speaker order
  const laneMap: Record<string, number> = {};
  enhanced.speakers.forEach((speaker, index) => {
    laneMap[speaker.id] = index;
  });

  // 2. Flatten all words from all segments into a single array
  const words: VisualizationWord[] = [];

  for (const segment of enhanced.segments) {
    // Skip segments without words
    if (!segment.words || segment.words.length === 0) {
      continue;
    }

    const lane = laneMap[segment.speaker];

    for (const word of segment.words) {
      words.push({
        speaker: segment.speaker,
        lane: lane,
        t0: Math.floor(word.start * 1000),  // Convert seconds to milliseconds
        t1: Math.floor(word.end * 1000),
        text: word.word,
        confidence: word.confidence
      });
    }
  }

  // 3. Sort words by start time for efficient rendering
  words.sort((a, b) => a.t0 - b.t0);

  // 4. Apply client-side trimming if needed (version 1 files or defensive fallback)
  let finalWords = words;
  const vadApplied = enhanced.vad_trimming?.enabled ?? false;

  if (!vadApplied) {
    // Version 1 file: apply client-side trimming to remove trailing silence
    console.log('[loadCues] No server-side VAD detected, applying client-side trimming');
    finalWords = applyClientSideTrimming(words, false);
  } else {
    console.log('[loadCues] Server-side VAD detected, trusting trimmed timestamps');
  }

  return {
    speakers: enhanced.speakers,
    laneMap,
    words: finalWords,
    durationMs: enhanced.video.durationMs
  };
}

/**
 * Loads and validates cues data from a URL
 * Only supports enhanced JSON format
 */
export async function loadCuesFromUrl(url: string): Promise<VisualizationData> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch cues: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Validate enhanced format
    if (validateEnhancedCuesData(data)) {
      // Transform to visualization format
      return transformToVisualizationData(data);
    }

    // TypeScript knows data is EnhancedCuesData here
    throw new Error('Validation failed');
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in cues file: ${error.message}`);
    }
    throw error;
  }
}

