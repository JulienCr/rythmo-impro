/**
 * FCPXML Generator - Converts CLI JSON diarization data to Final Cut Pro XML
 *
 * Generates FCPXML files compatible with Premiere Pro, DaVinci Resolve, and other NLEs.
 * Creates a video track with the original video and speaker tracks with colored bars.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { execSync } from 'child_process';
import { XMLBuilder } from 'fast-xml-parser';
import {
  CliJsonData,
  CliSegment,
  GenerateFcpxmlOptions,
  validateCliJsonData,
} from './fcpxmlTypes';

// ============================================================================
// Constants
// ============================================================================

/** Premiere Pro tick format: 254,016,000,000 ticks per second */
const TICKS_PER_SECOND = 254016000000;

/** Lane colors matching RythmoOverlay */
const LANE_COLORS = [
  { hex: '#007AFF', r: 0,   g: 122, b: 255 },  // Lane 0: Blue
  { hex: '#FF3B30', r: 255, g: 59,  b: 48  },  // Lane 1: Red
  { hex: '#FFD60A', r: 255, g: 214, b: 10  },  // Lane 2: Yellow
  { hex: '#34C759', r: 52,  g: 199, b: 89  },  // Lane 3: Green
  { hex: '#AF52DE', r: 175, g: 82,  b: 222 },  // Lane 4: Purple
];

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Generate FCPXML from CLI JSON diarization data
 *
 * @param cliJsonPath - Path to CLI JSON file
 * @param videoPath - Path to video file
 * @param outputPath - Path for output XML file
 * @param options - Optional generation settings
 */
export function generateFcpxml(
  cliJsonPath: string,
  videoPath: string,
  outputPath: string,
  options: GenerateFcpxmlOptions = {}
): void {
  // Resolve absolute paths
  const absCliPath = resolve(cliJsonPath);
  const absVideoPath = resolve(videoPath);
  const absOutputPath = resolve(outputPath);

  // Validate input files
  if (!existsSync(absCliPath)) {
    throw new Error(`CLI JSON file not found: ${absCliPath}`);
  }

  if (!existsSync(absVideoPath)) {
    throw new Error(`Video file not found: ${absVideoPath}`);
  }

  // Load and validate CLI JSON
  const cliJsonContent = readFileSync(absCliPath, 'utf-8');
  const cliData: CliJsonData = JSON.parse(cliJsonContent);
  validateCliJsonData(cliData);

  // Detect or use provided FPS
  const fps = options.fps ?? detectVideoFramerate(absVideoPath);

  // Assign lanes to speakers
  const laneMap = assignLanes(cliData.segments);

  // Generate FCPXML document
  const xmlContent = buildFcpxmlDocument(cliData, absVideoPath, fps, laneMap, options);

  // Write output
  writeFileSync(absOutputPath, xmlContent, 'utf-8');

  // Log summary
  const speakers = Array.from(laneMap.entries()).sort((a, b) => a[1] - b[1]);
  const videoFilename = basename(absVideoPath);
  const totalFrames = secondsToFrames(
    Math.max(...cliData.segments.map(s => s.end)),
    fps
  );

  console.log(`✓ Generated FCPXML: ${absOutputPath}`);
  console.log(`  Video: ${videoFilename} (${totalFrames} frames, ${(totalFrames / fps).toFixed(2)}s)`);
  console.log(`  FPS: ${fps.toFixed(2)}`);
  console.log(`  Tracks: ${speakers.length + 1} (1 video + ${speakers.length} speakers)`);
  console.log(`  Total segments: ${cliData.segments.length}`);

  if (speakers.length > 0) {
    console.log(`  Speakers:`);
    speakers.forEach(([speaker, lane]) => {
      const totalDuration = cliData.segments
        .filter(s => s.speaker === speaker)
        .reduce((sum, s) => sum + (s.end - s.start), 0);
      const color = LANE_COLORS[lane % LANE_COLORS.length].hex;
      console.log(`    ${speaker} → Lane ${lane} (${color}, ${totalDuration.toFixed(1)}s total)`);
    });
  }
}

// ============================================================================
// Lane Assignment
// ============================================================================

interface SpeakerStats {
  totalDuration: number;
  firstSpeech: number;
}

/**
 * Assign speakers to lanes using deterministic algorithm
 * Replicates Python algorithm from diarizer/main.py:144-196
 *
 * Algorithm:
 * 1. Calculate total speaking duration per speaker
 * 2. Sort by duration (descending), then by first speech (ascending)
 * 3. Assign lanes 0, 1, 2, 3, 4...
 *
 * @param segments - Array of CLI segments
 * @returns Map of speaker ID to lane number
 */
function assignLanes(segments: CliSegment[]): Map<string, number> {
  if (segments.length === 0) {
    return new Map();
  }

  const stats = new Map<string, SpeakerStats>();

  // Calculate total duration and first speech per speaker
  for (const seg of segments) {
    if (!stats.has(seg.speaker)) {
      stats.set(seg.speaker, {
        totalDuration: 0,
        firstSpeech: seg.start,
      });
    }

    const s = stats.get(seg.speaker)!;
    s.totalDuration += (seg.end - seg.start);
    s.firstSpeech = Math.min(s.firstSpeech, seg.start);
  }

  // Sort speakers: duration descending, then first speech ascending
  const sorted = Array.from(stats.entries()).sort(([, a], [, b]) => {
    // Primary: total duration (descending)
    if (b.totalDuration !== a.totalDuration) {
      return b.totalDuration - a.totalDuration;
    }
    // Tie-breaker: first speech time (ascending)
    return a.firstSpeech - b.firstSpeech;
  });

  // Assign lanes
  const laneMap = new Map<string, number>();
  sorted.forEach(([speaker], idx) => laneMap.set(speaker, idx));

  return laneMap;
}

// ============================================================================
// Video Framerate Detection
// ============================================================================

/**
 * Detect video framerate using ffprobe
 *
 * @param videoPath - Absolute path to video file
 * @returns FPS as a float (e.g., 25.0, 23.976, 29.97)
 */
function detectVideoFramerate(videoPath: string): number {
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const output = execSync(cmd, { encoding: 'utf-8' }).trim();

    // Parse output format: "25/1" or "30000/1001"
    const match = output.match(/^(\d+)\/(\d+)$/);
    if (!match) {
      throw new Error(`Unexpected ffprobe output format: ${output}`);
    }

    const [, numStr, denStr] = match;
    const fps = parseInt(numStr, 10) / parseInt(denStr, 10);

    if (fps <= 0 || !isFinite(fps)) {
      throw new Error(`Invalid FPS value: ${fps}`);
    }

    console.log(`✓ Detected FPS: ${fps.toFixed(2)} (${output})`);
    return fps;

  } catch (err) {
    if (err instanceof Error && err.message.includes('command not found')) {
      throw new Error('ffprobe not found. Install ffmpeg: apt install ffmpeg (or brew install ffmpeg on macOS)');
    }
    throw new Error(`Failed to detect framerate: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// Time Conversion Utilities
// ============================================================================

/**
 * Convert seconds to frame number
 */
function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Convert frame number to Premiere Pro ticks
 */
function framesToTicks(frame: number, fps: number): number {
  return Math.round(frame * (TICKS_PER_SECOND / fps));
}

// ============================================================================
// XML Document Generation
// ============================================================================

/**
 * Build complete FCPXML document
 *
 * @param cliData - Validated CLI JSON data
 * @param videoPath - Absolute path to video file
 * @param fps - Video framerate
 * @param laneMap - Speaker to lane mapping
 * @param options - Generation options
 * @returns FCPXML string
 */
function buildFcpxmlDocument(
  cliData: CliJsonData,
  videoPath: string,
  fps: number,
  laneMap: Map<string, number>,
  options: GenerateFcpxmlOptions
): string {
  const videoFilename = basename(videoPath);
  const projectName = options.projectName ?? videoFilename;

  // Calculate total duration in frames
  const maxTime = cliData.segments.length > 0
    ? Math.max(...cliData.segments.map(s => s.end))
    : 0;
  const totalFrames = secondsToFrames(maxTime, fps);
  const totalTicks = framesToTicks(totalFrames, fps);

  // Build tracks
  const videoTracks = [];

  // Track 1: Video clip
  videoTracks.push(createVideoTrack(videoPath, videoFilename, totalFrames, totalTicks, fps));

  // Tracks 2-N: Speaker tracks
  const speakers = Array.from(laneMap.entries()).sort((a, b) => a[1] - b[1]);

  for (const [speaker, lane] of speakers) {
    const speakerSegments = cliData.segments.filter(s => s.speaker === speaker);
    videoTracks.push(createSpeakerTrack(speaker, lane, speakerSegments, fps));
  }

  // Build FCPXML structure
  const xmlObject = {
    '?xml': {
      '@_version': '1.0',
      '@_encoding': 'UTF-8',
    },
    xmeml: {
      '@_version': '4',
      sequence: {
        '@_id': 'sequence-1',
        '@_TL.SQAudioVisibleBase': '0',
        '@_TL.SQVideoVisibleBase': '0',
        '@_TL.SQVisibleBaseTime': '0',
        '@_TL.SQAVDividerPosition': '0.5',
        '@_TL.SQHideShyTracks': '0',
        '@_TL.SQHeaderWidth': '204',
        uuid: generateUuid(),
        duration: totalFrames,
        rate: {
          timebase: Math.round(fps),
          ntsc: 'FALSE',
        },
        name: projectName,
        media: {
          video: {
            format: {
              samplecharacteristics: {
                rate: {
                  timebase: Math.round(fps),
                  ntsc: 'FALSE',
                },
                codec: {
                  name: 'Apple ProRes 422',
                  appspecificdata: {
                    appname: 'Final Cut Pro',
                    appmanufacturer: 'Apple Inc.',
                    appversion: '7.0',
                    data: {
                      qtcodec: {
                        codecname: 'Apple ProRes 422',
                        codectypename: 'Apple ProRes 422',
                        codectypecode: 'apcn',
                        codecvendorcode: 'appl',
                        spatialquality: 1024,
                        temporalquality: 0,
                        keyframerate: 0,
                        datarate: 0,
                      },
                    },
                  },
                },
                width: 1920,
                height: 1080,
                anamorphic: 'FALSE',
                pixelaspectratio: 'square',
                fielddominance: 'none',
                colordepth: 24,
              },
            },
            track: videoTracks,
          },
          audio: {
            numOutputChannels: 2,
            format: {
              samplecharacteristics: {
                depth: 16,
                samplerate: 48000,
              },
            },
            outputs: {
              group: [
                {
                  index: 1,
                  numchannels: 1,
                  downmix: 0,
                  channel: { index: 1 },
                },
                {
                  index: 2,
                  numchannels: 1,
                  downmix: 0,
                  channel: { index: 2 },
                },
              ],
            },
            track: [
              createAudioTrack(videoPath, videoFilename, totalFrames, totalTicks, fps, 1, 0),
              createAudioTrack(videoPath, videoFilename, totalFrames, totalTicks, fps, 2, 1),
            ],
          },
        },
        timecode: {
          rate: {
            timebase: Math.round(fps),
            ntsc: 'FALSE',
          },
          string: '00:00:00:00',
          frame: 0,
          displayformat: 'NDF',
        },
      },
    },
  };

  // Build XML
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '\t',
    suppressEmptyNode: true,
  });

  const xmlContent = builder.build(xmlObject);

  // Add DOCTYPE declaration after XML prolog
  // The XMLBuilder doesn't properly support DOCTYPE, so we add it manually
  const lines = xmlContent.split('\n');
  if (lines[0].startsWith('<?xml')) {
    lines.splice(1, 0, '<!DOCTYPE xmeml>');
    return lines.join('\n');
  }

  return xmlContent;
}

/**
 * Create video track (Track 1)
 */
function createVideoTrack(
  videoPath: string,
  videoFilename: string,
  totalFrames: number,
  totalTicks: number,
  fps: number
): object {
  const fileUrl = `file://localhost${videoPath}`;

  return {
    '@_TL.SQTrackShy': '0',
    '@_TL.SQTrackExpandedHeight': '41',
    '@_TL.SQTrackExpanded': '0',
    '@_MZ.TrackTargeted': '1',
    clipitem: {
      '@_id': 'clipitem-1',
      masterclipid: 'masterclip-1',
      name: videoFilename,
      enabled: 'TRUE',
      duration: totalFrames,
      rate: {
        timebase: Math.round(fps),
        ntsc: 'FALSE',
      },
      start: 0,
      end: totalFrames,
      in: 0,
      out: totalFrames,
      pproTicksIn: 0,
      pproTicksOut: totalTicks,
      alphatype: 'none',
      pixelaspectratio: 'square',
      anamorphic: 'FALSE',
      file: {
        '@_id': 'file-1',
        name: videoFilename,
        pathurl: fileUrl,
        rate: {
          timebase: Math.round(fps),
          ntsc: 'FALSE',
        },
        duration: totalFrames,
        timecode: {
          rate: {
            timebase: Math.round(fps),
            ntsc: 'FALSE',
          },
          string: '00:00:00:00',
          frame: 0,
          displayformat: 'NDF',
        },
        media: {
          video: {
            samplecharacteristics: {
              rate: {
                timebase: Math.round(fps),
                ntsc: 'FALSE',
              },
              width: 1920,
              height: 1080,
              anamorphic: 'FALSE',
              pixelaspectratio: 'square',
              fielddominance: 'none',
            },
          },
          audio: {
            samplecharacteristics: {
              depth: 16,
              samplerate: 48000,
            },
            channelcount: 2,
          },
        },
      },
    },
    enabled: 'TRUE',
    locked: 'FALSE',
  };
}

/**
 * Create audio track
 */
function createAudioTrack(
  videoPath: string,
  videoFilename: string,
  totalFrames: number,
  totalTicks: number,
  fps: number,
  trackIndex: number,
  explodedTrackIndex: number
): object {
  const audioClipId = `clipitem-audio${trackIndex}`;

  return {
    '@_TL.SQTrackAudioKeyframeStyle': '0',
    '@_TL.SQTrackShy': '0',
    '@_TL.SQTrackExpandedHeight': '41',
    '@_TL.SQTrackExpanded': '0',
    '@_MZ.TrackTargeted': '1',
    '@_PannerCurrentValue': '0.5',
    '@_PannerIsInverted': 'true',
    '@_PannerStartKeyframe': '-91445760000000000,0.5,0,0,0,0,0,0',
    '@_PannerName': 'Balance',
    '@_currentExplodedTrackIndex': explodedTrackIndex,
    '@_totalExplodedTrackCount': '2',
    '@_premiereTrackType': 'Stereo',
    clipitem: {
      '@_id': audioClipId,
      '@_premiereChannelType': 'stereo',
      masterclipid: 'masterclip-1',
      name: videoFilename,
      enabled: 'TRUE',
      duration: totalFrames,
      rate: {
        timebase: Math.round(fps),
        ntsc: 'FALSE',
      },
      start: 0,
      end: totalFrames,
      in: 0,
      out: totalFrames,
      pproTicksIn: 0,
      pproTicksOut: totalTicks,
      file: { '@_id': 'file-1' },
      sourcetrack: {
        mediatype: 'audio',
        trackindex: trackIndex,
      },
    },
    enabled: 'TRUE',
    locked: 'FALSE',
    outputchannelindex: trackIndex,
  };
}

/**
 * Create speaker track (Track 2-N) with generator items
 */
function createSpeakerTrack(
  speaker: string,
  lane: number,
  segments: CliSegment[],
  fps: number
): object {
  const color = LANE_COLORS[lane % LANE_COLORS.length];

  // Create generator items for each segment
  const generatorItems = segments.map((seg, idx) => {
    const startFrame = secondsToFrames(seg.start, fps);
    const endFrame = secondsToFrames(seg.end, fps);
    const duration = endFrame - startFrame;

    // Generator items use a large offset for in/out values
    const inOffset = 90000;

    return {
      '@_id': `clipitem-speaker${lane}-${idx}`,
      name: 'Cache couleur',
      enabled: 'TRUE',
      duration: 1080000, // Standard duration value
      start: startFrame,
      end: endFrame,
      in: inOffset + startFrame,
      out: inOffset + endFrame,
      rate: {
        timebase: Math.round(fps),
        ntsc: 'FALSE',
      },
      effect: {
        name: 'Color',
        effectid: 'Color',
        effectcategory: 'Matte',
        effecttype: 'generator',
        mediatype: 'video',
        parameter: {
          '@_authoringApp': 'PremierePro',
          parameterid: 'fillcolor',
          name: 'Color',
          value: {
            alpha: 0,
            red: color.r,
            green: color.g,
            blue: color.b,
          },
        },
      },
    };
  });

  return {
    '@_TL.SQTrackShy': '0',
    '@_TL.SQTrackExpandedHeight': '41',
    '@_TL.SQTrackExpanded': '0',
    '@_MZ.TrackTargeted': '0',
    '@_MZ.TrackName': speaker,
    generatoritem: generatorItems,
    enabled: 'TRUE',
    locked: 'FALSE',
  };
}

/**
 * Generate a random UUID for the sequence
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
