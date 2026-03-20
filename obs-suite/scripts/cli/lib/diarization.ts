/**
 * Diarization runner (wrapper for run-wsl.sh)
 */

import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import type { DiarizationConfig } from '../schemas/config.js';

export interface DiarizationOptions extends Partial<DiarizationConfig> {
  force?: boolean;
}

/**
 * Build shared diarization arguments (excluding --input)
 */
function buildBaseArgs(options: DiarizationOptions): string[] {
  const args = [
    '--input-dir', paths.inDir,
    '--output-dir', paths.outDir,
  ];

  // Add model (default: large-v3)
  const model = options.model || 'large-v3';
  args.push('--model', model);

  // Add skip-existing flag (inverted from force)
  if (options.force) {
    args.push('--no-skip-existing');
  } else {
    args.push('--skip-existing');
  }

  // Add optional parameters
  if (options.minSpeakers !== undefined) {
    args.push('--min-speakers', options.minSpeakers.toString());
  }
  if (options.maxSpeakers !== undefined) {
    args.push('--max-speakers', options.maxSpeakers.toString());
  }
  if (options.language !== undefined && options.language !== 'auto') {
    args.push('--language', options.language);
  }

  return args;
}

/**
 * Run diarization on video files.
 * When videoFiles is empty, processes all videos in input-dir.
 * When videoFiles has entries, runs the diarizer once per file so that
 * only the selected subset is processed (the diarizer's --input flag
 * accepts a single filename).
 */
export function runDiarization(
  videoFiles: string[],
  options: DiarizationOptions = {}
): void {
  console.log(colors.title('\n📊 Running speaker diarization...\n'));

  if (!existsSync(paths.diarizerScript)) {
    throw new Error(`Diarization script not found: ${paths.diarizerScript}`);
  }

  const baseArgs = buildBaseArgs(options);

  if (videoFiles.length === 0) {
    // Process all videos in input-dir
    console.log(colors.dim(`Running: ${paths.diarizerScript} ${baseArgs.join(' ')}\n`));
    try {
      execFileSync(paths.diarizerScript, baseArgs, { stdio: 'inherit' });
      console.log(colors.success('\n✓ Diarization completed successfully\n'));
    } catch (err) {
      throw new Error(`Diarization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Process each selected video individually
    for (const file of videoFiles) {
      const args = [...baseArgs, '--input', file];
      console.log(colors.dim(`Running: ${paths.diarizerScript} ${args.join(' ')}\n`));
      try {
        execFileSync(paths.diarizerScript, args, { stdio: 'inherit' });
      } catch (err) {
        throw new Error(`Diarization failed for ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(colors.success('\n✓ Diarization completed successfully\n'));
  }
}
