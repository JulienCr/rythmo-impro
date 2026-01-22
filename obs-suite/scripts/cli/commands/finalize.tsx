/**
 * Finalize command - Convert corrected XML files to JSON
 */

import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';

import { findXmlFiles, convertXmlToJson, type XmlFileStatus, type ConversionResult } from '../lib/xml.js';
import { XmlMultiSelect } from '../components/XmlMultiSelect.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';

interface FinalizeCommandOptions {
  force?: boolean;
  all?: boolean;
}

/**
 * Run the finalize command
 */
export async function finalizeCommand(options: FinalizeCommandOptions): Promise<void> {
  console.log(colors.title('\n🎬 Finalize Corrected XML Files\n'));

  if (options.force) {
    console.log(colors.warning('⚡ Force mode enabled - will overwrite existing files\n'));
  }

  // Find all XML files
  const xmlFiles = findXmlFiles();

  if (xmlFiles.length === 0) {
    console.log(colors.warning(`No XML files found in ${paths.finalXmlDir}\n`));
    console.log(colors.dim('Place corrected XML files in this directory to convert them to JSON.\n'));
    return;
  }

  console.log(colors.info(`Found ${xmlFiles.length} XML file(s)\n`));

  let selectedFiles: XmlFileStatus[];

  if (options.all) {
    // Process all files without selection
    selectedFiles = xmlFiles;
    console.log(colors.dim(`Processing all ${xmlFiles.length} files\n`));
  } else {
    // Interactive multi-select
    selectedFiles = await selectXmlFiles(xmlFiles);

    if (selectedFiles.length === 0) {
      console.log(colors.warning('\nNo files selected. Exiting.\n'));
      return;
    }
  }

  // Process files
  const results: ConversionResult[] = [];

  for (const file of selectedFiles) {
    const promptOverwrite = async () => {
      try {
        return await confirm({
          message: `${file.filename.replace('.xml', '.json')} already exists. Overwrite?`,
          default: false,
        });
      } catch {
        // User cancelled (Ctrl+C)
        console.log(colors.warning('\n\n⚠ Cancelled by user'));
        process.exit(0);
      }
    };

    const result = await convertXmlToJson(
      file,
      options.force || false,
      options.all ? undefined : promptOverwrite
    );
    results.push(result);
  }

  // Show summary
  console.log(colors.success('\n✅ Finalization complete!\n'));

  const convertedCount = results.filter(r => r.status === 'converted').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Total files: ${selectedFiles.length}`);
  console.log(colors.success(`  Converted: ${convertedCount}`));
  if (skippedCount > 0) {
    console.log(colors.dim(`  Skipped: ${skippedCount}`));
  }
  if (errorCount > 0) {
    console.log(colors.error(`  Errors: ${errorCount}`));
  }
  console.log();

  // Show errors if any
  if (errorCount > 0) {
    console.log(chalk.bold.red('Errors:\n'));
    results
      .filter(r => r.status === 'error')
      .forEach(r => {
        console.log(colors.error(`  ✗ ${r.xmlFile}`));
        console.log(colors.dim(`    ${r.error}`));
      });
    console.log();
  }

  console.log(chalk.bold('Output directory:'));
  console.log(colors.info(`  ${paths.finalJsonDir}`));
  console.log();
}

/**
 * Interactive XML file selection using Ink
 */
async function selectXmlFiles(files: XmlFileStatus[]): Promise<XmlFileStatus[]> {
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <XmlMultiSelect
        files={files}
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
