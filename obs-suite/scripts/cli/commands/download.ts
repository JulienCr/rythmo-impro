/**
 * Download command - Download videos using yt-dlp
 */

import chalk from 'chalk';
import { mkdirSync } from 'fs';

import { downloadVideo } from '../lib/download.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import { inputWithEscape, confirmWithEscape } from '../utils/prompts.js';

interface DownloadCommandOptions {
  url?: string;
  output?: string;
  force?: boolean;
}

/**
 * Run the download command
 */
export async function downloadCommand(options: DownloadCommandOptions): Promise<void> {
  console.log(colors.title('\n📥 Téléchargement de vidéo\n'));

  // Ensure input directory exists
  mkdirSync(paths.inDir, { recursive: true });

  let url = options.url;

  if (!url) {
    url = await inputWithEscape({
      message: 'URL de la vidéo (YouTube, etc.) :',
      validate: (val) => val.trim().length > 0 ? true : 'URL requise',
    });
  }

  url = url.trim();

  let filename = options.output;

  if (!filename) {
    const customName = await confirmWithEscape({
      message: 'Donner un nom personnalisé au fichier ?',
      default: false,
    });

    if (customName) {
      filename = await inputWithEscape({
        message: 'Nom du fichier (ex: ma-video.mp4) :',
        validate: (val) => val.trim().length > 0 ? true : 'Nom requis',
      });
      // Ensure .mp4 extension
      if (!filename.match(/\.\w+$/)) {
        filename += '.mp4';
      }
    }
  }

  console.log();

  const outputPath = await downloadVideo({
    url,
    filename,
    force: options.force,
  });

  console.log(colors.success('\n✅ Téléchargement terminé !'));
  console.log(colors.info(`  Fichier : ${outputPath}\n`));
  console.log(chalk.dim(`  Utilisez ${chalk.cyan('pnpm rythmo process')} pour traiter cette vidéo.\n`));
}
