/**
 * Video file discovery and status checking
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { paths, VIDEO_EXTENSIONS } from '../utils/paths.js';

/** Output paths for a video file */
export interface VideoOutputPaths {
  cliJson: string;
  enhancedJson: string;
  srt: string;
  xml: string;
  thumbnail: string;
  finalVideo: string;
}

/** Video file with its processing status */
export interface VideoStatus {
  filename: string;
  fullPath: string;
  mtime: Date;
  outputs: VideoOutputPaths;
  hasDiarization: boolean;
  hasXml: boolean;
  hasThumbnail: boolean;
  hasFinalVideo: boolean;
  isNew: boolean;
}

/**
 * Find all video files in the input directory
 * @returns Array of video filenames (sorted by modification time, newest first)
 */
export function findVideoFiles(): string[] {
  if (!existsSync(paths.inDir)) {
    throw new Error(`Input directory not found: ${paths.inDir}`);
  }

  const files = readdirSync(paths.inDir)
    .filter(file => {
      const ext = extname(file).toLowerCase();
      return VIDEO_EXTENSIONS.includes(ext as typeof VIDEO_EXTENSIONS[number]);
    })
    .map(file => {
      const fullPath = join(paths.inDir, file);
      const stats = statSync(fullPath);
      return { file, mtime: stats.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .map(item => item.file);

  return files;
}

/**
 * Get output paths for a video file
 */
export function getOutputPaths(videoBasename: string): VideoOutputPaths {
  const nameWithoutExt = videoBasename.replace(extname(videoBasename), '');
  const videoExt = extname(videoBasename);

  return {
    cliJson: join(paths.outDir, `${nameWithoutExt}.cli.json`),
    enhancedJson: join(paths.outDir, `${nameWithoutExt}.enhanced.json`),
    srt: join(paths.outDir, `${nameWithoutExt}.srt`),
    xml: join(paths.outDir, `${nameWithoutExt}.xml`),
    thumbnail: join(paths.thumbsDir, `${nameWithoutExt}.jpg`),
    finalVideo: join(paths.finalVidsDir, `${nameWithoutExt}${videoExt}`),
  };
}

/**
 * Check diarization status for a video
 */
export function checkDiarizationStatus(outputs: VideoOutputPaths): {
  exists: boolean;
  files: Array<{ name: string; exists: boolean }>;
} {
  const files = [
    { name: 'cli.json', exists: existsSync(outputs.cliJson) },
    { name: 'enhanced.json', exists: existsSync(outputs.enhancedJson) },
    { name: 'srt', exists: existsSync(outputs.srt) },
  ];

  const exists = files.every(f => f.exists);

  return { exists, files };
}

/**
 * Get full status for a video file
 */
export function getVideoStatus(filename: string): VideoStatus {
  const fullPath = join(paths.inDir, filename);
  const stats = statSync(fullPath);
  const outputs = getOutputPaths(filename);

  const diarizationStatus = checkDiarizationStatus(outputs);
  const hasXml = existsSync(outputs.xml);
  const hasThumbnail = existsSync(outputs.thumbnail);
  const hasFinalVideo = existsSync(outputs.finalVideo);

  // A video is "new" if it has no diarization outputs
  const isNew = !diarizationStatus.exists;

  return {
    filename,
    fullPath,
    mtime: stats.mtime,
    outputs,
    hasDiarization: diarizationStatus.exists,
    hasXml,
    hasThumbnail,
    hasFinalVideo,
    isNew,
  };
}

/**
 * Get status for all videos in the input directory
 * @returns Videos sorted: new videos first (alphabetically), then processed (alphabetically)
 */
export function getAllVideoStatuses(): VideoStatus[] {
  const videoFiles = findVideoFiles();
  const statuses = videoFiles.map(getVideoStatus);

  // Sort: new videos first, then processed, both groups alphabetically
  return statuses.sort((a, b) => {
    if (a.isNew !== b.isNew) {
      return a.isNew ? -1 : 1;  // New videos first
    }
    return a.filename.localeCompare(b.filename);  // Alphabetical within group
  });
}
