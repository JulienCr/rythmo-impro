/**
 * Vocal removal utilities
 */

import { existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import type { VideoOutputPaths } from './videos.js';

/**
 * Remove vocals from a video file
 * @returns true if processed, false if skipped
 */
export function removeVocals(
  videoBasename: string,
  outputPaths: VideoOutputPaths,
  force: boolean
): boolean {
  // Check if final video already exists
  if (!force && existsSync(outputPaths.finalVideo)) {
    console.log(colors.dim(`  ⏭ Skipping ${videoBasename} - final video already exists`));
    return false;
  }

  const videoPath = join(paths.inDir, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(colors.warning(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  // Check if vocal removal script exists
  if (!existsSync(paths.vocalRemovalScript)) {
    console.log(colors.warning(`  ⚠ Skipping ${videoBasename} - vocal removal script not found`));
    console.log(colors.dim(`     Expected: ${paths.vocalRemovalScript}`));
    return false;
  }

  try {
    console.log(colors.dim(`  🎵 Removing vocals from ${videoBasename}...`));

    // Create final-vids directory if needed
    if (!existsSync(paths.finalVidsDir)) {
      mkdirSync(paths.finalVidsDir, { recursive: true });
    }

    // Build command arguments as an array (safe from shell injection)
    const args = [
      '--input', videoPath,
      '--output', outputPaths.finalVideo,
      '--model', 'MDX23C-InstVoc HQ',
    ];

    if (force) {
      args.push('--force');
    }

    // Run vocal removal (with progress output)
    execFileSync(paths.vocalRemovalScript, args, { stdio: 'inherit' });

    return true;
  } catch (err) {
    console.error(colors.error(`  ✗ Vocal removal failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

/**
 * Check if vocal removal is available
 */
export function isVocalRemovalAvailable(): boolean {
  return existsSync(paths.vocalRemovalScript);
}
