/**
 * Video download using yt-dlp
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';

export interface DownloadOptions {
  url: string;
  filename?: string;
  force?: boolean;
}

/**
 * Download a video using yt-dlp into the input directory.
 * Returns the path to the downloaded file.
 */
export function downloadVideo(options: DownloadOptions): string {
  // Build output template
  const outputTemplate = options.filename
    ? join(paths.inDir, options.filename)
    : join(paths.inDir, '%(title)s.%(ext)s');

  // If a specific filename is given, check if it already exists
  if (options.filename && !options.force) {
    const outputPath = join(paths.inDir, options.filename);
    if (existsSync(outputPath)) {
      console.log(colors.dim(`  ⏭ Fichier existant : ${options.filename}`));
      return outputPath;
    }
  }

  const args = [
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    ...(options.force ? [] : ['--no-overwrites']),
    options.url,
  ];

  console.log(colors.info(`  Téléchargement : ${options.url}`));
  console.log(colors.dim(`  Destination : ${paths.inDir}/\n`));

  try {
    const result = spawnSync('yt-dlp', args, {
      stdio: 'inherit',
      cwd: paths.inDir,
    });
    if (result.status !== 0) {
      throw new Error(`Exit code ${result.status}`);
    }
  } catch {
    throw new Error(`Échec du téléchargement de : ${options.url}`);
  }

  // Figure out what was downloaded
  if (options.filename) {
    return join(paths.inDir, options.filename);
  }

  // Use yt-dlp to get the filename it would produce
  try {
    const result = spawnSync(
      'yt-dlp',
      ['--print', 'filename', '--merge-output-format', 'mp4', '-o', outputTemplate, options.url],
      { encoding: 'utf-8', cwd: paths.inDir }
    );
    return (result.stdout as string).trim();
  } catch {
    return paths.inDir;
  }
}
