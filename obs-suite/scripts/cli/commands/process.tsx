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
  // Validate incompatible flags
  if (options.vocalsOnly && options.skipVocalRemoval) {
    throw new Error('Cannot use --vocals-only and --skip-vocal-removal together');
  }

  // Verify diarizer script exists
  if (!existsSync(paths.diarizerScript)) {
    throw new Error(
      `Diarization script not found: ${paths.diarizerScript}\n` +
      `Please ensure the diarizer setup is complete.`
    );
  }

  console.log(colors.title('\n🎥 Video Processing Pipeline\n'));

  // Get all video statuses
  const allVideos = getAllVideoStatuses();

  if (allVideos.length === 0) {
    throw new Error(`No video files found in ${paths.inDir}`);
  }

  console.log(colors.info(`Found ${allVideos.length} video file(s)\n`));

  let selectedVideos: VideoStatus[];

  if (options.all) {
    // Process all videos without selection
    selectedVideos = allVideos;
    console.log(colors.dim(`Processing all ${allVideos.length} videos\n`));
  } else {
    // Interactive multi-select
    selectedVideos = await selectVideos(allVideos);

    if (selectedVideos.length === 0) {
      console.log(colors.warning('\nNo videos selected. Exiting.\n'));
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
      message: 'Configure diarization options?',
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
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <VideoMultiSelect
        videos={videos}
        onSubmit={(selected) => {
          unmount();
          resolve(selected);
        }}
        onCancel={() => {
          unmount();
          resolve([]);
        }}
      />
    );

    waitUntilExit();
  });
}

/**
 * Interactive diarization configuration
 */
async function configureDiarization(): Promise<Partial<DiarizationConfig>> {
  const config: Partial<DiarizationConfig> = {};

  const model = await select({
    message: 'Whisper model:',
    choices: [
      { name: 'large-v3 (default, best accuracy, slowest)', value: 'large-v3' as const },
      { name: 'medium (balanced)', value: 'medium' as const },
      { name: 'small (fast, lower accuracy)', value: 'small' as const },
      { name: 'base (very fast, basic accuracy)', value: 'base' as const },
    ],
    default: 'large-v3',
  });

  if (model !== 'large-v3') {
    config.model = model;
  }

  const language = await select({
    message: 'Language:',
    choices: [
      { name: 'Auto-detect', value: 'auto' as const },
      { name: 'French', value: 'fr' as const },
      { name: 'English', value: 'en' as const },
    ],
    default: 'auto',
  });

  if (language !== 'auto') {
    config.language = language;
  }

  const useSpeakerConstraints = await confirm({
    message: 'Set speaker count constraints?',
    default: false,
  });

  if (useSpeakerConstraints) {
    const minSpeakers = await input({
      message: 'Minimum speakers:',
      default: '2',
      validate: (val) => {
        const num = parseInt(val, 10);
        return num > 0 ? true : 'Must be positive';
      },
    });

    const maxSpeakers = await input({
      message: 'Maximum speakers:',
      default: '4',
      validate: (val) => {
        const num = parseInt(val, 10);
        return num >= parseInt(minSpeakers, 10) ? true : 'Must be >= min speakers';
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
    // Step 1: Run diarization
    console.log(chalk.bold('\n📊 Step 1: Diarization\n'));
    runDiarization(videoFilenames, diarizationOpts);

    // Step 2: Generate FCP XML for each video
    console.log(chalk.bold('\n🎬 Step 2: FCP XML Generation\n'));

    for (const video of videos) {
      const outputPaths = getOutputPaths(video.filename);
      const generated = generateXml(video.filename, outputPaths, options.force || false);
      if (generated) {
        generatedCount++;
      } else {
        skippedCount++;
      }
    }

    // Step 3: Generate thumbnails for each video
    console.log(chalk.bold('\n🖼️  Step 3: Thumbnail Generation\n'));

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
    console.log(colors.dim('\n⏭ Skipping diarization, FCP XML, and thumbnails (--vocals-only flag)\n'));
  }

  // Step 4: Remove vocals
  if (!options.skipVocalRemoval) {
    console.log(chalk.bold('\n🎵 Step 4: Vocal Removal\n'));

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
    console.log(colors.dim('\n⏭ Skipping vocal removal (--skip-vocal-removal flag)\n'));
  }

  // Final summary
  console.log(colors.success('\n✅ Processing complete!\n'));
  console.log(chalk.bold('Summary:'));
  console.log(`  Videos processed: ${videos.length}`);

  if (!options.vocalsOnly) {
    console.log(`  FCP XML generated: ${generatedCount}`);
    if (skippedCount > 0) {
      console.log(colors.dim(`  FCP XML skipped: ${skippedCount}`));
    }
    console.log(`  Thumbnails generated: ${thumbsGeneratedCount}`);
    if (thumbsSkippedCount > 0) {
      console.log(colors.dim(`  Thumbnails skipped: ${thumbsSkippedCount}`));
    }
  }

  if (!options.skipVocalRemoval) {
    console.log(`  Vocals removed: ${vocalsRemovedCount}`);
    if (vocalsSkippedCount > 0) {
      console.log(colors.dim(`  Vocals skipped: ${vocalsSkippedCount}`));
    }
  }

  console.log();
  console.log(chalk.bold('Output directory:'));
  console.log(colors.info(`  ${paths.outDir}`));
  console.log();
}
