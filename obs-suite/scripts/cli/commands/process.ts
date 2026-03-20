/**
 * Process command - Video diarization and processing pipeline
 */

import chalk from 'chalk';
import { existsSync } from 'fs';

import { getAllVideoStatuses, getOutputPaths, type VideoStatus } from '../lib/videos.js';
import { runDiarization, type DiarizationOptions } from '../lib/diarization.js';
import { generateXml } from '../lib/xml.js';
import { generateThumbnail } from '../lib/thumbnails.js';
import { removeVocals } from '../lib/vocals.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import {
  selectWithEscape,
  inputWithEscape,
  checkboxWithEscape,
  confirmWithEscape,
} from '../utils/prompts.js';
import type { DiarizationConfig } from '../schemas/config.js';

interface ProcessCommandOptions {
  force?: boolean;
  all?: boolean;
  skipVocalRemoval?: boolean;
  vocalsOnly?: boolean;
}

/**
 * Run the process command
 */
export async function processCommand(options: ProcessCommandOptions): Promise<void> {
  // Valider les options incompatibles
  if (options.vocalsOnly && options.skipVocalRemoval) {
    throw new Error('Impossible d\'utiliser --vocals-only et --skip-vocal-removal ensemble');
  }

  // Vérifier que le script de diarisation existe (sauf en mode vocals-only)
  if (!options.vocalsOnly && !existsSync(paths.diarizerScript)) {
    throw new Error(
      `Script de diarisation introuvable : ${paths.diarizerScript}\n` +
      `Veuillez vous assurer que la configuration du diariseur est complète.`
    );
  }

  console.log(colors.title('\n🎥 Pipeline de traitement vidéo\n'));

  // Get all video statuses
  const allVideos = getAllVideoStatuses();

  if (allVideos.length === 0) {
    throw new Error(`Aucun fichier vidéo trouvé dans ${paths.inDir}`);
  }

  console.log(colors.info(`${allVideos.length} fichier(s) vidéo trouvé(s)\n`));

  let selectedVideos: VideoStatus[];

  if (options.all) {
    // Process all videos without selection
    selectedVideos = allVideos;
    console.log(colors.dim(`Traitement de toutes les ${allVideos.length} vidéos\n`));
  } else {
    // Interactive multi-select
    selectedVideos = await selectVideos(allVideos);

    if (selectedVideos.length === 0) {
      console.log(colors.warning('\nAucune vidéo sélectionnée. Fin.\n'));
      return;
    }
  }

  // Auto-enable force mode if any selected video is already processed
  const hasProcessedVideos = selectedVideos.some(v => !v.isNew);
  const effectiveForce = options.force || (!options.all && hasProcessedVideos);

  if (hasProcessedVideos && !options.force && !options.all) {
    console.log(colors.info('Mode --force activé automatiquement (vidéos déjà traitées sélectionnées)\n'));
  }

  // Configure diarization options
  let diarizationOpts: DiarizationOptions = {
    force: effectiveForce,
  };

  if (!options.all && !options.vocalsOnly) {
    // Interactive configuration
    const useAdvanced = await confirmWithEscape({
      message: 'Configurer les options de diarisation ?',
      default: false,
    });

    if (useAdvanced) {
      const config = await configureDiarization();
      diarizationOpts = { ...diarizationOpts, ...config };
    }
  }

  // Process videos with effective force mode
  await processVideos(selectedVideos, diarizationOpts, { ...options, force: effectiveForce });
}

/**
 * Interactive video selection using inquirer checkbox
 */
async function selectVideos(videos: VideoStatus[]): Promise<VideoStatus[]> {
  const newVideos = videos.filter(v => v.isNew);
  const processedVideos = videos.filter(v => !v.isNew);

  // Build choices with separators
  const choices: Array<{ name: string; value: string; checked: boolean } | { type: 'separator'; separator: string }> = [];

  if (newVideos.length > 0) {
    choices.push({ type: 'separator', separator: chalk.dim('─── NOUVEAUX ───────────────────────────────') });
    for (const v of newVideos) {
      choices.push({
        name: chalk.green(v.filename),
        value: v.filename,
        checked: true, // Pre-select new videos
      });
    }
  }

  if (processedVideos.length > 0) {
    choices.push({ type: 'separator', separator: chalk.dim('─── DÉJÀ TRAITÉS ───────────────────────────') });
    for (const v of processedVideos) {
      choices.push({
        name: chalk.gray(`${v.filename}  ✓`),
        value: v.filename,
        checked: false,
      });
    }
  }

  const selected = await checkboxWithEscape({
    message: 'Sélectionnez les vidéos à traiter :',
    choices: choices as Parameters<typeof checkboxWithEscape>[0]['choices'],
    pageSize: 15,
  });

  return videos.filter(v => (selected as string[]).includes(v.filename));
}

/**
 * Interactive diarization configuration
 */
async function configureDiarization(): Promise<Partial<DiarizationConfig>> {
  const config: Partial<DiarizationConfig> = {};

  const model = await selectWithEscape({
    message: 'Modèle Whisper :',
    choices: [
      { name: 'large-v3 (défaut, meilleure précision, plus lent)', value: 'large-v3' as const },
      { name: 'medium (équilibré)', value: 'medium' as const },
      { name: 'small (rapide, précision réduite)', value: 'small' as const },
      { name: 'base (très rapide, précision basique)', value: 'base' as const },
    ],
    default: 'large-v3',
  });

  if (model !== 'large-v3') {
    config.model = model;
  }

  const language = await selectWithEscape({
    message: 'Langue :',
    choices: [
      { name: 'Détection automatique', value: 'auto' as const },
      { name: 'Français', value: 'fr' as const },
      { name: 'Anglais', value: 'en' as const },
    ],
    default: 'auto',
  });

  if (language !== 'auto') {
    config.language = language;
  }

  const useSpeakerConstraints = await confirmWithEscape({
    message: 'Définir des contraintes sur le nombre de locuteurs ?',
    default: false,
  });

  if (useSpeakerConstraints) {
    const minSpeakers = await inputWithEscape({
      message: 'Nombre minimum de locuteurs :',
      default: '2',
      validate: (val) => {
        const num = parseInt(val, 10);
        return num > 0 ? true : 'Doit être positif';
      },
    });

    const maxSpeakers = await inputWithEscape({
      message: 'Nombre maximum de locuteurs :',
      default: '4',
      validate: (val) => {
        const num = parseInt(val, 10);
        return num >= parseInt(minSpeakers, 10) ? true : 'Doit être >= nombre minimum';
      },
    });

    config.minSpeakers = parseInt(minSpeakers, 10);
    config.maxSpeakers = parseInt(maxSpeakers, 10);
  }

  return config;
}

/**
 * Process selected videos through the pipeline
 */
async function processVideos(
  videos: VideoStatus[],
  diarizationOpts: DiarizationOptions,
  options: ProcessCommandOptions
): Promise<void> {
  const videoFilenames = videos.map(v => v.filename);

  const stats = {
    xmlGenerated: 0,
    xmlSkipped: 0,
    thumbsGenerated: 0,
    thumbsSkipped: 0,
    vocalsRemoved: 0,
    vocalsSkipped: 0,
  };

  // Skip diarization, FCP XML, and thumbnails if --vocals-only is set
  if (!options.vocalsOnly) {
    // Étape 1 : Diarisation
    console.log(chalk.bold('\n📊 Étape 1 : Diarisation\n'));
    runDiarization(videoFilenames, diarizationOpts);

    // Étape 2 : Génération FCP XML
    console.log(chalk.bold('\n🎬 Étape 2 : Génération FCP XML\n'));

    for (const video of videos) {
      const outputPaths = getOutputPaths(video.filename);
      const generated = generateXml(video.filename, outputPaths, options.force || false);
      if (generated) {
        stats.xmlGenerated++;
      } else {
        stats.xmlSkipped++;
      }
    }

    // Étape 3 : Génération des miniatures
    console.log(chalk.bold('\n🖼️  Étape 3 : Génération des miniatures\n'));

    for (const video of videos) {
      const outputPaths = getOutputPaths(video.filename);
      const generated = generateThumbnail(video.filename, outputPaths, options.force || false);
      if (generated) {
        stats.thumbsGenerated++;
      } else {
        stats.thumbsSkipped++;
      }
    }
  } else {
    console.log(colors.dim('\n⏭ Diarisation, FCP XML et miniatures ignorés (option --vocals-only)\n'));
  }

  // Étape 4 : Suppression des voix
  if (!options.skipVocalRemoval) {
    console.log(chalk.bold('\n🎵 Étape 4 : Suppression des voix\n'));

    for (const video of videos) {
      const outputPaths = getOutputPaths(video.filename);
      const generated = removeVocals(video.filename, outputPaths, options.force || false);
      if (generated) {
        stats.vocalsRemoved++;
      } else {
        stats.vocalsSkipped++;
      }
    }
  } else {
    console.log(colors.dim('\n⏭ Suppression des voix ignorée (option --skip-vocal-removal)\n'));
  }

  // Résumé final
  console.log(colors.success('\n✅ Traitement terminé !\n'));
  console.log(chalk.bold('Résumé :'));
  console.log(`  Vidéos traitées : ${videos.length}`);

  if (!options.vocalsOnly) {
    console.log(`  FCP XML générés : ${stats.xmlGenerated}`);
    if (stats.xmlSkipped > 0) {
      console.log(colors.dim(`  FCP XML ignorés : ${stats.xmlSkipped}`));
    }
    console.log(`  Miniatures générées : ${stats.thumbsGenerated}`);
    if (stats.thumbsSkipped > 0) {
      console.log(colors.dim(`  Miniatures ignorées : ${stats.thumbsSkipped}`));
    }
  }

  if (!options.skipVocalRemoval) {
    console.log(`  Voix supprimées : ${stats.vocalsRemoved}`);
    if (stats.vocalsSkipped > 0) {
      console.log(colors.dim(`  Suppressions ignorées : ${stats.vocalsSkipped}`));
    }
  }

  console.log();
  console.log(chalk.bold('Répertoire de sortie :'));
  console.log(colors.info(`  ${paths.outDir}`));
  console.log();
}
