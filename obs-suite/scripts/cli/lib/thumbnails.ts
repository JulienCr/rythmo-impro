/**
 * Thumbnail generation utilities
 */

import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import type { VideoOutputPaths } from './videos.js';

/**
 * Generate thumbnail for a video file
 * @returns true if generated, false if skipped
 */
export function generateThumbnail(
  videoBasename: string,
  outputPaths: VideoOutputPaths,
  force: boolean
): boolean {
  // Check if thumbnail already exists
  if (!force && existsSync(outputPaths.thumbnail)) {
    console.log(colors.dim(`  ⏭ Skipping ${videoBasename} - thumbnail already exists`));
    return false;
  }

  const videoPath = join(paths.inDir, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(colors.warning(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  try {
    console.log(colors.dim(`  🖼️  Generating thumbnail for ${videoBasename}...`));

    // Create thumbs directory if it doesn't exist
    if (!existsSync(paths.thumbsDir)) {
      mkdirSync(paths.thumbsDir, { recursive: true });
    }

    // Detect video duration
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const durationStr = execSync(durationCmd, { encoding: 'utf-8' }).trim();
    const duration = parseFloat(durationStr);

    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Invalid video duration: ${durationStr}`);
    }

    // Extract middle frame (duration / 2)
    const middleTime = duration / 2;
    const ffmpegCmd = `ffmpeg -ss ${middleTime} -i "${videoPath}" -frames:v 1 -vf scale=320:-1 -q:v 5 "${outputPaths.thumbnail}" -y`;

    execSync(ffmpegCmd, { stdio: 'pipe' });

    return true;
  } catch (err) {
    console.error(colors.error(`  ✗ Thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}
