/**
 * Process command - Video diarization and processing pipeline
 */

import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { confirm, select, input } from '@inquirer/prompts';
import { existsSync } from 'fs';

import { getAllVideoStatuses, getOutputPaths, type VideoStatus } from '../lib/videos.js';
import { runDiarization, type DiarizationOptions } from '../lib/diarization.js';
import { generateXml } from '../lib/xml.js';
import { generateThumbnail } from '../lib/thumbnails.js';
import { removeVocals } from '../lib/vocals.js';
import { VideoMultiSelect } from '../components/VideoMultiSelect.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import type { ProcessOptions, DiarizationConfig } from '../schemas/config.js';

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

  // Vérifier que le script de diarisation existe
  if (!existsSync(paths.diarizerScript)) {
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

  // Configure diarization options
  let diarizationOpts: DiarizationOptions = {
    force: options.force,
  };

  if (!options.all && !options.vocalsOnly) {
    // Interactive configuration
    const useAdvanced = await confirm({
      message: 'Configurer les options de diarisation ?',
      default: false,
    });

    if (useAdvanced) {
      const config = await configureDiarization();
      diarizationOpts = { ...diarizationOpts, ...config };
    }
  }

  // Process videos
  await processVideos(selectedVideos, diarizationOpts, options);
}

/**
 * Interactive video selection using Ink
 */
async function selectVideos(videos: VideoStatus[]): Promise<VideoStatus[]> {
  // Small delay to let terminal settle after inquirer prompt
  // This prevents leftover input from being captured by Ink
  await new Promise(resolve => setTimeout(resolve, 50));

  return new Promise((resolve) => {
    let result: VideoStatus[] = [];

    const { unmount, waitUntilExit } = render(
      <VideoMultiSelect
        videos={videos}
        onSubmit={(selected) => {
          result = selected;
          unmount();
        }}
        onCancel={() => {
          result = [];
          unmount();
        }}
      />
    );

    waitUntilExit().then(() => {
      resolve(result);
    });
  });
}

/**
 * Interactive diarization configuration
 */
async function configureDiarization(): Promise<Partial<DiarizationConfig>> {
  const config: Partial<DiarizationConfig> = {};

  const model = await select({
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

  const language = await select({
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

  const useSpeakerConstraints = await confirm({
    message: 'Définir des contraintes sur le nombre de locuteurs ?',
    default: false,
  });

  if (useSpeakerConstraints) {
    const minSpeakers = await input({
      message: 'Nombre minimum de locuteurs :',
      default: '2',
      validate: (val) => {
        const num = parseInt(val, 10);
        return num > 0 ? true : 'Doit être positif';
      },
    });

    const maxSpeakers = await input({
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

  let generatedCount = 0;
  let skippedCount = 0;
  let thumbsGeneratedCount = 0;
  let thumbsSkippedCount = 0;
  let vocalsRemovedCount = 0;
  let vocalsSkippedCount = 0;

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
        generatedCount++;
      } else {
        skippedCount++;
      }
    }

    // Étape 3 : Génération des miniatures
    console.log(chalk.bold('\n🖼️  Étape 3 : Génération des miniatures\n'));

    for (const video of videos) {
      const outputPaths = getOutputPaths(video.filename);
      const generated = generateThumbnail(video.filename, outputPaths, options.force || false);
      if (generated) {
        thumbsGeneratedCount++;
      } else {
        thumbsSkippedCount++;
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
        vocalsRemovedCount++;
      } else {
        vocalsSkippedCount++;
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
    console.log(`  FCP XML générés : ${generatedCount}`);
    if (skippedCount > 0) {
      console.log(colors.dim(`  FCP XML ignorés : ${skippedCount}`));
    }
    console.log(`  Miniatures générées : ${thumbsGeneratedCount}`);
    if (thumbsSkippedCount > 0) {
      console.log(colors.dim(`  Miniatures ignorées : ${thumbsSkippedCount}`));
    }
  }

  if (!options.skipVocalRemoval) {
    console.log(`  Voix supprimées : ${vocalsRemovedCount}`);
    if (vocalsSkippedCount > 0) {
      console.log(colors.dim(`  Suppressions ignorées : ${vocalsSkippedCount}`));
    }
  }

  console.log();
  console.log(chalk.bold('Répertoire de sortie :'));
  console.log(colors.info(`  ${paths.outDir}`));
  console.log();
}
