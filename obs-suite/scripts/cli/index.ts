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
  .description('Rythmo CLI - Unified video processing pipeline')
  .version('1.0.0');

// Process command
program
  .command('process')
  .description('Process video files (diarization, XML, thumbnails, vocal removal)')
  .option('-f, --force', 'Force regenerate all files')
  .option('-a, --all', 'Process all videos without selection prompt')
  .option('--skip-vocal-removal', 'Skip vocal removal step')
  .option('--vocals-only', 'Run ONLY vocal removal (skip diarization, XML, thumbs)')
  .action(async (options) => {
    try {
      await processCommand(options);
    } catch (err) {
      console.error(colors.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Finalize command
program
  .command('finalize')
  .description('Convert corrected XML files from final-xml/ to JSON')
  .option('-f, --force', 'Overwrite existing JSON files')
  .option('-a, --all', 'Process all XML files without selection prompt')
  .action(async (options) => {
    try {
      await finalizeCommand(options);
    } catch (err) {
      console.error(colors.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show video processing status table')
  .action(async () => {
    try {
      await statusCommand();
    } catch (err) {
      console.error(colors.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`));
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
