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
 * Run diarization on video files
 * @param videoFiles - Array of video filenames to process (or empty for all)
 * @param options - Diarization options
 */
export function runDiarization(
  videoFiles: string[],
  options: DiarizationOptions = {}
): void {
  console.log(colors.title('\n📊 Running speaker diarization...\n'));

  if (!existsSync(paths.diarizerScript)) {
    throw new Error(`Diarization script not found: ${paths.diarizerScript}`);
  }

  // Build command arguments as an array (safe from shell injection)
  const args = [
    '--input-dir', paths.inDir,
    '--output-dir', paths.outDir,
  ];

  // If processing a single video, add --input parameter
  if (videoFiles.length === 1) {
    args.push('--input', videoFiles[0]);
  }

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

  console.log(colors.dim(`Running: ${paths.diarizerScript} ${args.join(' ')}\n`));

  try {
    execFileSync(paths.diarizerScript, args, { stdio: 'inherit' });
    console.log(colors.success('\n✓ Diarization completed successfully\n'));
  } catch (err) {
    throw new Error(`Diarization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
