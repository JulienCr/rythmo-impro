#!/usr/bin/env node
/**
 * Rythmo CLI - Unified video processing pipeline
 *
 * Usage:
 *   pnpm rythmo                     # Interactive wizard
 *   pnpm rythmo process             # Process videos
 *   pnpm rythmo finalize            # Convert corrected XML to JSON
 *   pnpm rythmo status              # Show status table
 */

import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';

import { processCommand } from './commands/process.js';
import { finalizeCommand } from './commands/finalize.js';
import { statusCommand } from './commands/status.js';
import { findXmlFiles } from './lib/xml.js';
import { colors } from './utils/colors.js';

const program = new Command();

program
  .name('rythmo')
  .description('Rythmo CLI - Unified video processing pipeline for speaker diarization')
  .version('1.0.0')
  .addHelpText('before', `
${chalk.bold.blue('Rythmo CLI')} - Video processing pipeline for speaker diarization

This tool processes video files through a complete pipeline:
  1. ${chalk.cyan('Diarization')}: Extract speaker segments with word-level timestamps
  2. ${chalk.cyan('FCP XML')}: Generate Final Cut Pro XML for NLE editing
  3. ${chalk.cyan('Thumbnails')}: Create preview images for each video
  4. ${chalk.cyan('Vocal Removal')}: Remove vocals for karaoke-style output
`)
  .addHelpText('after', `
${chalk.bold('EXAMPLES:')}
  ${chalk.dim('# Interactive mode - choose to process all or select one video')}
  ${chalk.green('pnpm rythmo')}

  ${chalk.dim('# Process all videos without prompts (skip existing)')}
  ${chalk.green('pnpm rythmo process --all')}

  ${chalk.dim('# Force regenerate everything for all videos')}
  ${chalk.green('pnpm rythmo process --all --force')}

  ${chalk.dim('# Only run vocal removal on videos')}
  ${chalk.green('pnpm rythmo process --vocals-only')}

  ${chalk.dim('# Convert corrected XML files to JSON')}
  ${chalk.green('pnpm rythmo finalize')}

  ${chalk.dim('# Show status table')}
  ${chalk.green('pnpm rythmo status')}

${chalk.bold('WORKFLOW:')}
  1. Run ${chalk.cyan('pnpm rythmo process')} to diarize videos and generate outputs
  2. Edit the XML files in your NLE (Final Cut Pro, DaVinci Resolve, etc.)
  3. Export corrected XML to ${chalk.yellow('out/final-xml/')} directory
  4. Run ${chalk.cyan('pnpm rythmo finalize')} to convert XML to final JSON
  5. Use ${chalk.cyan('pnpm rythmo status')} to check progress at any time

${chalk.bold('OUTPUT DIRECTORIES:')}
  ${chalk.yellow('out/')}           - Diarization JSON, SRT, and XML files
  ${chalk.yellow('out/thumbs/')}    - Video thumbnail images
  ${chalk.yellow('out/final-xml/')} - Place corrected XML files here
  ${chalk.yellow('out/final-vids/')} - Videos with vocals removed
`);

// Process command
program
  .command('process')
  .description(`Process video files through the full pipeline.

  This command runs up to 4 steps for each video:
    1. Diarization - Speaker detection with word-level timestamps
    2. FCP XML     - Generate Final Cut Pro XML for editing
    3. Thumbnails  - Create preview images
    4. Vocal Removal - Remove vocals (optional, slow)

  By default, existing outputs are skipped. Use --force to regenerate.`)
  .option('-f, --force', 'Force regenerate all files (ignore existing outputs)')
  .option('-a, --all', 'Process all videos without interactive selection')
  .option('--skip-vocal-removal', 'Skip the vocal removal step (faster)')
  .option('--vocals-only', 'Run ONLY vocal removal (skip steps 1-3)')
  .addHelpText('after', `
${chalk.bold('EXAMPLES:')}
  ${chalk.dim('# Interactive mode - select which video to process')}
  ${chalk.green('pnpm rythmo process')}

  ${chalk.dim('# Process all videos (skip existing outputs)')}
  ${chalk.green('pnpm rythmo process --all')}

  ${chalk.dim('# Force regenerate all outputs for all videos')}
  ${chalk.green('pnpm rythmo process --all --force')}

  ${chalk.dim('# Process without vocal removal (much faster)')}
  ${chalk.green('pnpm rythmo process --all --skip-vocal-removal')}

  ${chalk.dim('# Only run vocal removal on videos that need it')}
  ${chalk.green('pnpm rythmo process --vocals-only')}

  ${chalk.dim('# Force vocal removal on all videos')}
  ${chalk.green('pnpm rythmo process --vocals-only --force')}

${chalk.bold('OUTPUTS:')}
  For each video, the following files are generated:
    ${chalk.yellow('<video>.cli.json')}      - CLI player format with word timestamps
    ${chalk.yellow('<video>.enhanced.json')} - Extended format with confidence scores
    ${chalk.yellow('<video>.srt')}           - SRT subtitles with speaker labels
    ${chalk.yellow('<video>.xml')}           - FCP XML for NLE import
    ${chalk.yellow('thumbs/<video>.jpg')}    - Thumbnail image
    ${chalk.yellow('final-vids/<video>.mp4')} - Video with vocals removed
`)
  .action(async (options) => {
    try {
      await processCommand(options);
    } catch (err) {
      console.error(colors.error(`\n Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Finalize command
program
  .command('finalize')
  .description(`Convert corrected XML files to final JSON format.

  After editing diarization in your NLE (Final Cut Pro, DaVinci Resolve, etc.),
  export the corrected XML to the final-xml/ directory. This command converts
  those XML files to the final JSON format for use in applications.

  The finalize step preserves your manual corrections and speaker assignments.`)
  .option('-f, --force', 'Overwrite existing JSON files')
  .option('-a, --all', 'Process all XML files without interactive selection')
  .addHelpText('after', `
${chalk.bold('EXAMPLES:')}
  ${chalk.dim('# Interactive mode - select which XML to convert')}
  ${chalk.green('pnpm rythmo finalize')}

  ${chalk.dim('# Convert all pending XML files')}
  ${chalk.green('pnpm rythmo finalize --all')}

  ${chalk.dim('# Force regenerate JSON even if it exists')}
  ${chalk.green('pnpm rythmo finalize --all --force')}

${chalk.bold('WORKFLOW:')}
  1. Edit the XML in your NLE (adjust timings, fix speaker labels)
  2. Export/save the corrected XML to: ${chalk.yellow('out/final-xml/<video>.xml')}
  3. Run ${chalk.cyan('pnpm rythmo finalize')} to generate final JSON

${chalk.bold('INPUT/OUTPUT:')}
  Input:  ${chalk.yellow('out/final-xml/<video>.xml')}  - Your corrected XML
  Output: ${chalk.yellow('out/final-json/<video>.json')} - Final JSON for apps
`)
  .action(async (options) => {
    try {
      await finalizeCommand(options);
    } catch (err) {
      console.error(colors.error(`\n Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description(`Show video processing status overview.

  Displays a table showing the processing state of all videos:
    - Which files have been diarized
    - Which have XML, thumbnails, vocal-removed versions
    - Which corrected XMLs are pending finalization`)
  .addHelpText('after', `
${chalk.bold('EXAMPLE:')}
  ${chalk.green('pnpm rythmo status')}

${chalk.bold('STATUS INDICATORS:')}
  ${chalk.green('Yes')}  - File exists and is up to date
  ${chalk.red('No')}   - File is missing
  ${chalk.yellow('...')} - File is being processed
`)
  .action(async () => {
    try {
      await statusCommand();
    } catch (err) {
      console.error(colors.error(`\n Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Default action (interactive wizard)
program.action(async () => {
  try {
    await interactiveWizard();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      // User cancelled with Ctrl+C
      process.exit(0);
    }
    console.error(colors.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
});

/**
 * Interactive wizard for main menu
 */
async function interactiveWizard(): Promise<void> {
  console.log(chalk.bold.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.bold.blue('│') + chalk.bold('  Bienvenue dans Rythmo CLI                      ') + chalk.bold.blue('│'));
  console.log(chalk.bold.blue('└─────────────────────────────────────────────────┘\n'));

  // Check for pending XML files
  const xmlFiles = findXmlFiles();
  const pendingXml = xmlFiles.filter(f => !f.hasJson).length;

  const choices = [
    {
      name: 'Traiter des vidéos (étape 1)',
      value: 'process' as const,
    },
    {
      name: pendingXml > 0
        ? `Finaliser les XML corrigés (étape 2) [${pendingXml}]`
        : 'Finaliser les XML corrigés (étape 2)',
      value: 'finalize' as const,
    },
    {
      name: 'Voir le statut',
      value: 'status' as const,
    },
    {
      name: 'Quitter',
      value: 'exit' as const,
    },
  ];

  const action = await select({
    message: 'Que voulez-vous faire ?',
    choices,
  });

  switch (action) {
    case 'process':
      await processCommand({});
      break;
    case 'finalize':
      await finalizeCommand({});
      break;
    case 'status':
      await statusCommand();
      break;
    case 'exit':
      console.log(colors.dim('\nAu revoir!\n'));
      break;
  }
}

program.parse();
