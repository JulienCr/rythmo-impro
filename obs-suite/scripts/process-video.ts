#!/usr/bin/env node
/**
 * Interactive CLI for video diarization and FCP XML generation
 *
 * Usage:
 *   pnpm process-video                              # Interactive mode - process all videos
 *   pnpm process-video video.mp4                    # Process specific video
 *   pnpm process-video --force                      # Force regenerate all
 *   pnpm process-video --help                       # Show help
 *
 * Steps:
 *   1. Run diarization on videos using run-wsl.sh
 *   2. Generate FCP XML from CLI JSON outputs
 *
 * By default, skips existing files. Use --force to regenerate.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, basename, extname, join } from 'path';
import { execSync } from 'child_process';
import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { generateFcpxml } from '../lib/generateFcpxml';

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = resolve(__dirname, '../..');
const IN_DIR = join(PROJECT_ROOT, 'in');
const OUT_DIR = join(PROJECT_ROOT, 'out');
const DIARIZER_SCRIPT = join(PROJECT_ROOT, 'diarizer', 'run-wsl.sh');
const VOCAL_REMOVAL_SCRIPT = join(PROJECT_ROOT, 'diarizer', 'run-vocal-removal.sh');

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

// ============================================================================
// CLI Arguments Parsing
// ============================================================================

interface CliArgs {
  videoFile?: string;
  force: boolean;
  help: boolean;
  processAll: boolean;
  skipVocalRemoval: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    force: false,
    help: false,
    processAll: false,
    skipVocalRemoval: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--all' || arg === '-a') {
      result.processAll = true;
    } else if (arg === '--skip-vocal-removal') {
      result.skipVocalRemoval = true;
    } else if (!arg.startsWith('-')) {
      result.videoFile = arg;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
${chalk.bold('process-video')} - Interactive video diarization and FCP XML generator

${chalk.bold('USAGE:')}
  pnpm process-video [VIDEO_FILE] [OPTIONS]

${chalk.bold('ARGUMENTS:')}
  VIDEO_FILE              Video filename (e.g., video.mp4)
                          If omitted, shows interactive selection menu

${chalk.bold('OPTIONS:')}
  --force, -f             Force regenerate all files (skip existing check)
  --all, -a               Process all videos without selection prompt
  --skip-vocal-removal    Skip vocal removal step (default: enabled)
  --help, -h              Show this help message

${chalk.bold('EXAMPLES:')}
  ${chalk.dim('# Interactive mode - choose to process all or select one video')}
  pnpm process-video

  ${chalk.dim('# Process specific video directly (skip existing by default)')}
  pnpm process-video juste-leblanc.mp4

  ${chalk.dim('# Process all videos without prompts (skip existing)')}
  pnpm process-video --all

  ${chalk.dim('# Force regenerate everything for all videos')}
  pnpm process-video --all --force

${chalk.bold('DIRECTORIES:')}
  Input:  ${chalk.cyan(IN_DIR)}
  Output: ${chalk.cyan(OUT_DIR)}

${chalk.bold('OUTPUT FILES (per video):')}
  video.cli.json          CLI JSON format (WhisperX-compatible)
  video.enhanced.json     Enhanced JSON with confidence scores
  video.srt               SRT subtitle file
  video.xml               FCP XML for NLE import
  thumbs/video.jpg        Thumbnail image (320px wide)
  final-vids/video.mp4    Video with vocals removed (instrumental)

${chalk.bold('REQUIREMENTS:')}
  - WSL environment with Python venv setup
  - HF_TOKEN in diarizer/.env
  - Run diarizer/setup-wsl.sh first if not set up
  - audio-separator installed: pip install audio-separator onnxruntime-gpu
  - CUDA GPU recommended for vocal removal (30-60s vs 3-10min CPU)
  `);
}

// ============================================================================
// File Discovery
// ============================================================================

function findVideoFiles(): string[] {
  if (!existsSync(IN_DIR)) {
    throw new Error(`Input directory not found: ${IN_DIR}`);
  }

  const files = readdirSync(IN_DIR)
    .filter(file => {
      const ext = extname(file).toLowerCase();
      return VIDEO_EXTENSIONS.includes(ext);
    })
    .map(file => {
      const fullPath = join(IN_DIR, file);
      const stats = statSync(fullPath);
      return { file, mtime: stats.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Sort by modified time (newest first)
    .map(item => item.file);

  return files;
}

function getOutputPaths(videoBasename: string) {
  const nameWithoutExt = videoBasename.replace(extname(videoBasename), '');
  const videoExt = extname(videoBasename); // Preserve original extension
  return {
    cliJson: join(OUT_DIR, `${nameWithoutExt}.cli.json`),
    enhancedJson: join(OUT_DIR, `${nameWithoutExt}.enhanced.json`),
    srt: join(OUT_DIR, `${nameWithoutExt}.srt`),
    xml: join(OUT_DIR, `${nameWithoutExt}.xml`),
    thumbnail: join(OUT_DIR, 'thumbs', `${nameWithoutExt}.jpg`),
    finalVideo: join(OUT_DIR, 'final-vids', `${nameWithoutExt}${videoExt}`),
  };
}

// ============================================================================
// Status Checking
// ============================================================================

function checkDiarizationStatus(outputPaths: ReturnType<typeof getOutputPaths>): {
  exists: boolean;
  files: string[];
} {
  const files = [
    existsSync(outputPaths.cliJson) ? 'cli.json ✓' : 'cli.json ✗',
    existsSync(outputPaths.enhancedJson) ? 'enhanced.json ✓' : 'enhanced.json ✗',
    existsSync(outputPaths.srt) ? 'srt ✓' : 'srt ✗',
  ];

  const exists = existsSync(outputPaths.cliJson) &&
                 existsSync(outputPaths.enhancedJson) &&
                 existsSync(outputPaths.srt);

  return { exists, files };
}

function checkFcpxmlStatus(outputPaths: ReturnType<typeof getOutputPaths>): boolean {
  return existsSync(outputPaths.xml);
}

function checkThumbnailStatus(outputPaths: ReturnType<typeof getOutputPaths>): boolean {
  return existsSync(outputPaths.thumbnail);
}

// ============================================================================
// Diarization (WSL Python)
// ============================================================================

interface DiarizationOptions {
  model?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
  force?: boolean;
  language?: string;
}

function runDiarization(
  videoFiles: string[],
  options: DiarizationOptions = {}
): void {
  console.log(chalk.bold('\n📊 Running speaker diarization...\n'));

  // Check if run-wsl.sh exists
  if (!existsSync(DIARIZER_SCRIPT)) {
    throw new Error(`Diarization script not found: ${DIARIZER_SCRIPT}`);
  }

  // Build command
  const args = [
    DIARIZER_SCRIPT,
    '--input-dir', IN_DIR,
    '--output-dir', OUT_DIR,
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

  if (options.language !== undefined) {
    args.push('--language', options.language);
  }

  const command = args.join(' ');

  console.log(chalk.dim(`Running: ${command}\n`));

  try {
    execSync(command, { stdio: 'inherit' });
    console.log(chalk.green('\n✓ Diarization completed successfully\n'));
  } catch (err) {
    throw new Error(`Diarization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// FCP XML Generation
// ============================================================================

function runFcpxmlGeneration(
  videoBasename: string,
  outputPaths: ReturnType<typeof getOutputPaths>,
  force: boolean
): boolean {
  // Check if XML already exists
  if (!force && existsSync(outputPaths.xml)) {
    console.log(chalk.dim(`  ⏭ Skipping ${videoBasename} - FCP XML already exists`));
    return false;
  }

  // Check if CLI JSON exists
  if (!existsSync(outputPaths.cliJson)) {
    console.log(chalk.yellow(`  ⚠ Skipping ${videoBasename} - CLI JSON not found`));
    return false;
  }

  const videoPath = join(IN_DIR, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(chalk.yellow(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  try {
    console.log(chalk.dim(`  🎬 Generating FCP XML for ${videoBasename}...`));
    generateFcpxml(
      outputPaths.cliJson,
      videoPath,
      outputPaths.xml
    );
    return true;
  } catch (err) {
    console.error(chalk.red(`  ✗ FCP XML generation failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

// ============================================================================
// Thumbnail Generation
// ============================================================================

function generateThumbnail(
  videoBasename: string,
  outputPaths: ReturnType<typeof getOutputPaths>,
  force: boolean
): boolean {
  // Check if thumbnail already exists
  if (!force && existsSync(outputPaths.thumbnail)) {
    console.log(chalk.dim(`  ⏭ Skipping ${videoBasename} - thumbnail already exists`));
    return false;
  }

  const videoPath = join(IN_DIR, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(chalk.yellow(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  try {
    console.log(chalk.dim(`  🖼️  Generating thumbnail for ${videoBasename}...`));

    // Create thumbs directory if it doesn't exist
    const thumbsDir = join(OUT_DIR, 'thumbs');
    if (!existsSync(thumbsDir)) {
      execSync(`mkdir -p "${thumbsDir}"`, { stdio: 'pipe' });
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
    console.error(chalk.red(`  ✗ Thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

// ============================================================================
// Vocal Removal
// ============================================================================

function runVocalRemoval(
  videoBasename: string,
  outputPaths: ReturnType<typeof getOutputPaths>,
  force: boolean
): boolean {
  // Check if final video already exists
  if (!force && existsSync(outputPaths.finalVideo)) {
    console.log(chalk.dim(`  ⏭ Skipping ${videoBasename} - final video already exists`));
    return false;
  }

  const videoPath = join(IN_DIR, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(chalk.yellow(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  // Check if vocal removal script exists
  if (!existsSync(VOCAL_REMOVAL_SCRIPT)) {
    console.log(chalk.yellow(`  ⚠ Skipping ${videoBasename} - vocal removal script not found`));
    console.log(chalk.dim(`     Expected: ${VOCAL_REMOVAL_SCRIPT}`));
    return false;
  }

  try {
    console.log(chalk.dim(`  🎵 Removing vocals from ${videoBasename}...`));

    // Create final-vids directory if needed
    const finalVidsDir = join(OUT_DIR, 'final-vids');
    if (!existsSync(finalVidsDir)) {
      execSync(`mkdir -p "${finalVidsDir}"`, { stdio: 'pipe' });
    }

    // Build command
    const cmd = [
      VOCAL_REMOVAL_SCRIPT,
      '--input', `"${videoPath}"`,
      '--output', `"${outputPaths.finalVideo}"`,
      '--model', '"MDX23C-InstVoc HQ"',
    ];

    if (force) {
      cmd.push('--force');
    }

    const command = cmd.join(' ');

    // Run vocal removal (with progress output)
    execSync(command, { stdio: 'inherit' });

    return true;
  } catch (err) {
    console.error(chalk.red(`  ✗ Vocal removal failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

function checkVocalRemovalStatus(outputPaths: ReturnType<typeof getOutputPaths>): boolean {
  return existsSync(outputPaths.finalVideo);
}

// ============================================================================
// Interactive Video Selection
// ============================================================================

async function selectVideo(videoFiles: string[]): Promise<string | 'all'> {
  const choices = [
    { name: chalk.bold.cyan('Process all videos'), value: 'all' },
    ...videoFiles.map(file => ({
      name: `  ${file}`,
      value: file,
    })),
  ];

  const selected = await select({
    message: 'Select video to process:',
    choices,
  });

  return selected;
}

// ============================================================================
// Batch Processing
// ============================================================================

async function processAllVideos(args: CliArgs): Promise<void> {
  console.log(chalk.bold.blue('\n🎥 Video Processing Pipeline\n'));

  // Find all videos
  const videoFiles = findVideoFiles();

  if (videoFiles.length === 0) {
    throw new Error(`No video files found in ${IN_DIR}`);
  }

  console.log(chalk.cyan(`Found ${videoFiles.length} video file(s):\n`));
  videoFiles.forEach((file, i) => {
    console.log(chalk.dim(`  ${i + 1}. ${file}`));
  });
  console.log();

  // Configure diarization options
  let diarizationOpts: DiarizationOptions = {
    force: args.force,
  };

  if (!args.processAll && !args.videoFile) {
    // Interactive configuration
    const useAdvanced = await confirm({
      message: 'Configure diarization options?',
      default: false,
    });

    if (useAdvanced) {
      const model = await select({
        message: 'Whisper model:',
        choices: [
          { name: 'large-v3 (default, best accuracy, slowest)', value: 'large-v3' },
          { name: 'medium (balanced)', value: 'medium' },
          { name: 'small (fast, lower accuracy)', value: 'small' },
          { name: 'base (very fast, basic accuracy)', value: 'base' },
        ],
        default: 'large-v3',
      });

      if (model !== 'large-v3') {
        diarizationOpts.model = model;
      }

      const speakerConstraints = await confirm({
        message: 'Set speaker count constraints?',
        default: false,
      });

      if (speakerConstraints) {
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

        diarizationOpts.minSpeakers = parseInt(minSpeakers, 10);
        diarizationOpts.maxSpeakers = parseInt(maxSpeakers, 10);
      }
    }
  }

  // Step 1: Run diarization on all videos
  console.log(chalk.bold('\n📊 Step 1: Diarization\n'));
  runDiarization(videoFiles, diarizationOpts);

  // Step 2: Generate FCP XML for each video
  console.log(chalk.bold('\n🎬 Step 2: FCP XML Generation\n'));

  let generatedCount = 0;
  let skippedCount = 0;

  for (const videoFile of videoFiles) {
    const outputPaths = getOutputPaths(videoFile);
    const generated = runFcpxmlGeneration(videoFile, outputPaths, args.force);
    if (generated) {
      generatedCount++;
    } else {
      skippedCount++;
    }
  }

  // Step 3: Generate thumbnails for each video
  console.log(chalk.bold('\n🖼️  Step 3: Thumbnail Generation\n'));

  let thumbsGeneratedCount = 0;
  let thumbsSkippedCount = 0;

  for (const videoFile of videoFiles) {
    const outputPaths = getOutputPaths(videoFile);
    const generated = generateThumbnail(videoFile, outputPaths, args.force);
    if (generated) {
      thumbsGeneratedCount++;
    } else {
      thumbsSkippedCount++;
    }
  }

  // Step 4: Remove vocals from each video
  if (!args.skipVocalRemoval) {
    console.log(chalk.bold('\n🎵 Step 4: Vocal Removal\n'));

    let vocalsRemovedCount = 0;
    let vocalsSkippedCount = 0;

    for (const videoFile of videoFiles) {
      const outputPaths = getOutputPaths(videoFile);
      const generated = runVocalRemoval(videoFile, outputPaths, args.force);
      if (generated) {
        vocalsRemovedCount++;
      } else {
        vocalsSkippedCount++;
      }
    }

    // Final summary
    console.log(chalk.bold.green('\n✅ Processing complete!\n'));
    console.log(chalk.bold('Summary:'));
    console.log(`  Videos processed: ${videoFiles.length}`);
    console.log(`  FCP XML generated: ${generatedCount}`);
    if (skippedCount > 0) {
      console.log(chalk.dim(`  FCP XML skipped: ${skippedCount}`));
    }
    console.log(`  Thumbnails generated: ${thumbsGeneratedCount}`);
    if (thumbsSkippedCount > 0) {
      console.log(chalk.dim(`  Thumbnails skipped: ${thumbsSkippedCount}`));
    }
    console.log(`  Vocals removed: ${vocalsRemovedCount}`);
    if (vocalsSkippedCount > 0) {
      console.log(chalk.dim(`  Vocals skipped: ${vocalsSkippedCount}`));
    }
    console.log();
  } else {
    console.log(chalk.dim('\n⏭ Skipping vocal removal (--skip-vocal-removal flag)\n'));

    // Final summary
    console.log(chalk.bold.green('\n✅ Processing complete!\n'));
    console.log(chalk.bold('Summary:'));
    console.log(`  Videos processed: ${videoFiles.length}`);
    console.log(`  FCP XML generated: ${generatedCount}`);
    if (skippedCount > 0) {
      console.log(chalk.dim(`  FCP XML skipped: ${skippedCount}`));
    }
    console.log(`  Thumbnails generated: ${thumbsGeneratedCount}`);
    if (thumbsSkippedCount > 0) {
      console.log(chalk.dim(`  Thumbnails skipped: ${thumbsSkippedCount}`));
    }
    console.log();
  }

  console.log(chalk.bold('Output directory:'));
  console.log(chalk.cyan(`  ${OUT_DIR}`));
  console.log();
}

// ============================================================================
// Single Video Processing
// ============================================================================

async function processSingleVideo(videoFile: string, args: CliArgs): Promise<void> {
  console.log(chalk.bold.blue('\n🎥 Video Processing Pipeline\n'));

  // Validate video file
  const videoPath = join(IN_DIR, videoFile);
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  console.log(chalk.cyan(`Selected: ${videoFile}\n`));

  const outputPaths = getOutputPaths(videoFile);

  // Check diarization status
  const diarizationStatus = checkDiarizationStatus(outputPaths);

  console.log(chalk.bold('Diarization outputs:'));
  diarizationStatus.files.forEach(file => {
    const icon = file.includes('✓') ? chalk.green(file) : chalk.dim(file);
    console.log(`  ${icon}`);
  });
  console.log();

  let shouldRunDiarization = !diarizationStatus.exists;

  if (diarizationStatus.exists && !args.force) {
    shouldRunDiarization = await confirm({
      message: 'Diarization outputs exist. Regenerate?',
      default: false,
    });
  } else if (args.force) {
    shouldRunDiarization = true;
  }

  if (shouldRunDiarization) {
    // Ask for diarization options
    const useAdvanced = await confirm({
      message: 'Configure diarization options?',
      default: false,
    });

    const diarizationOpts: DiarizationOptions = { force: true };

    if (useAdvanced) {
      const model = await select({
        message: 'Whisper model:',
        choices: [
          { name: 'large-v3 (default, best accuracy, slowest)', value: 'large-v3' },
          { name: 'medium (balanced)', value: 'medium' },
          { name: 'small (fast, lower accuracy)', value: 'small' },
          { name: 'base (very fast, basic accuracy)', value: 'base' },
        ],
        default: 'large-v3',
      });

      if (model !== 'large-v3') {
        diarizationOpts.model = model;
      }

      // language list : en, fr
      const language = await select({
        message: 'Language:',
        choices: [
          { name: 'English', value: 'en' },
          { name: 'French', value: 'fr' },
        ],
        default: null,
      });
  
      if (language !== null) {
        diarizationOpts.language = language;
      }

      const speakerConstraints = await confirm({
        message: 'Set speaker count constraints?',
        default: false,
      });

      if (speakerConstraints) {
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

        diarizationOpts.minSpeakers = parseInt(minSpeakers, 10);
        diarizationOpts.maxSpeakers = parseInt(maxSpeakers, 10);
      }
    }

    runDiarization([videoFile], diarizationOpts);
  } else {
    console.log(chalk.dim('⏭ Skipping diarization\n'));
  }

  // Check FCP XML status
  const fcpxmlExists = checkFcpxmlStatus(outputPaths);

  console.log(chalk.bold('FCP XML output:'));
  console.log(
    fcpxmlExists
      ? `  ${chalk.green('xml ✓')}`
      : `  ${chalk.dim('xml ✗')}`
  );
  console.log();

  let shouldRunFcpxml = !fcpxmlExists;

  if (fcpxmlExists && !args.force) {
    shouldRunFcpxml = await confirm({
      message: 'FCP XML exists. Regenerate?',
      default: false,
    });
  } else if (args.force) {
    shouldRunFcpxml = true;
  }

  if (shouldRunFcpxml) {
    // Verify CLI JSON exists before generating FCP XML
    if (!existsSync(outputPaths.cliJson)) {
      throw new Error(`CLI JSON not found: ${outputPaths.cliJson}. Run diarization first.`);
    }

    console.log(chalk.bold('\n🎬 Generating FCP XML...\n'));
    runFcpxmlGeneration(videoFile, outputPaths, true);
    console.log(chalk.green('\n✓ FCP XML generated successfully\n'));
  } else {
    console.log(chalk.dim('⏭ Skipping FCP XML generation\n'));
  }

  // Check thumbnail status
  const thumbnailExists = checkThumbnailStatus(outputPaths);

  console.log(chalk.bold('Thumbnail output:'));
  console.log(
    thumbnailExists
      ? `  ${chalk.green('thumbnail ✓')}`
      : `  ${chalk.dim('thumbnail ✗')}`
  );
  console.log();

  let shouldRunThumbnail = !thumbnailExists;

  if (thumbnailExists && !args.force) {
    shouldRunThumbnail = await confirm({
      message: 'Thumbnail exists. Regenerate?',
      default: false,
    });
  } else if (args.force) {
    shouldRunThumbnail = true;
  }

  if (shouldRunThumbnail) {
    console.log(chalk.bold('\n🖼️  Generating thumbnail...\n'));
    generateThumbnail(videoFile, outputPaths, true);
    console.log(chalk.green('\n✓ Thumbnail generated successfully\n'));
  } else {
    console.log(chalk.dim('⏭ Skipping thumbnail generation\n'));
  }

  // Check vocal removal status
  if (!args.skipVocalRemoval) {
    const finalVideoExists = checkVocalRemovalStatus(outputPaths);

    console.log(chalk.bold('Final video (instrumental):'));
    console.log(
      finalVideoExists
        ? `  ${chalk.green('final video ✓')}`
        : `  ${chalk.dim('final video ✗')}`
    );
    console.log();

    let shouldRunVocalRemoval = !finalVideoExists;

    if (finalVideoExists && !args.force) {
      shouldRunVocalRemoval = await confirm({
        message: 'Final video exists. Regenerate?',
        default: false,
      });
    } else if (args.force) {
      shouldRunVocalRemoval = true;
    }

    if (shouldRunVocalRemoval) {
      console.log(chalk.bold('\n🎵 Removing vocals...\n'));
      runVocalRemoval(videoFile, outputPaths, true);
      console.log(chalk.green('\n✓ Vocal removal complete\n'));
    } else {
      console.log(chalk.dim('⏭ Skipping vocal removal\n'));
    }
  } else {
    console.log(chalk.dim('⏭ Skipping vocal removal (--skip-vocal-removal flag)\n'));
  }

  // Final summary
  console.log(chalk.bold.green('✅ Processing complete!\n'));
  console.log(chalk.bold('Output files:'));
  if (existsSync(outputPaths.cliJson)) {
    console.log(chalk.green(`  ✓ ${basename(outputPaths.cliJson)}`));
  }
  if (existsSync(outputPaths.enhancedJson)) {
    console.log(chalk.green(`  ✓ ${basename(outputPaths.enhancedJson)}`));
  }
  if (existsSync(outputPaths.srt)) {
    console.log(chalk.green(`  ✓ ${basename(outputPaths.srt)}`));
  }
  if (existsSync(outputPaths.xml)) {
    console.log(chalk.green(`  ✓ ${basename(outputPaths.xml)}`));
  }
  if (existsSync(outputPaths.thumbnail)) {
    console.log(chalk.green(`  ✓ ${basename(outputPaths.thumbnail)}`));
  }
  if (existsSync(outputPaths.finalVideo)) {
    console.log(chalk.green(`  ✓ final-vids/${basename(outputPaths.finalVideo)}`));
  }
  console.log();
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const args = parseArgs();

    if (args.help) {
      showHelp();
      return;
    }

    // Create output directory if needed
    if (!existsSync(OUT_DIR)) {
      throw new Error(`Output directory not found: ${OUT_DIR}`);
    }

    // Check if diarizer script exists
    if (!existsSync(DIARIZER_SCRIPT)) {
      throw new Error(
        `Diarization script not found: ${DIARIZER_SCRIPT}\n` +
        `Please ensure the diarizer setup is complete.`
      );
    }

    // Get list of videos
    const videoFiles = findVideoFiles();

    if (videoFiles.length === 0) {
      throw new Error(`No video files found in ${IN_DIR}`);
    }

    // Determine processing mode
    let selectedVideo: string | 'all';

    if (args.videoFile) {
      // Video specified as argument
      selectedVideo = args.videoFile;
    } else if (args.processAll) {
      // --all flag specified
      selectedVideo = 'all';
    } else {
      // Interactive selection
      selectedVideo = await selectVideo(videoFiles);
    }

    // Process based on selection
    if (selectedVideo === 'all') {
      await processAllVideos(args);
    } else {
      await processSingleVideo(selectedVideo, args);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
    } else {
      console.error(chalk.red(`\n❌ Error: ${String(err)}\n`));
    }
    process.exit(1);
  }
}

main();
