/**
 * Video download using yt-dlp
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import { ensureCompatible } from './transcode.js';

export interface DownloadOptions {
  url: string;
  filename?: string;
  force?: boolean;
}

/**
 * Download a video using yt-dlp into the input directory.
 * After download, verifies codecs and transcodes to H264/AAC/MP4 if needed.
 * Returns the path to the final (possibly transcoded) file.
 */
export async function downloadVideo(options: DownloadOptions): Promise<string> {
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
  let downloadedPath: string;

  if (options.filename) {
    downloadedPath = join(paths.inDir, options.filename);
  } else {
    // Use yt-dlp to get the filename it would produce
    const result = spawnSync(
      'yt-dlp',
      ['--print', 'filename', '--merge-output-format', 'mp4', '-o', outputTemplate, options.url],
      { encoding: 'utf-8', cwd: paths.inDir }
    );
    const filename = (result.stdout as string).trim();
    if (!filename || result.status !== 0) {
      console.warn(colors.warning('  Impossible de déterminer le nom du fichier téléchargé'));
      return paths.inDir;
    }
    downloadedPath = filename;
  }

  // Ensure the downloaded video is H264/AAC/MP4
  console.log(colors.dim('\n  Vérification des codecs...'));
  try {
    downloadedPath = await ensureCompatible(downloadedPath);
  } catch (err) {
    console.warn(colors.warning(`  Échec de la vérification/transcodage : ${err instanceof Error ? err.message : String(err)}`));
  }

  return downloadedPath;
}
