#!/usr/bin/env node
/**
 * Batch FCPXML to JSON converter
 *
 * Usage:
 *   pnpm batch-convert-xml
 *   pnpm batch-convert-xml --force
 *
 * Processes all XML files from out/final-xml/ and generates
 * JSON files in out/final-json/ using the convertFcpxml library.
 *
 * Options:
 *   --force    Overwrite existing JSON files without prompting
 *
 * Features:
 *   - Interactive overwrite prompts for existing files (unless --force)
 *   - Continues on error (doesn't abort batch)
 *   - Shows detailed summary at end
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, basename, extname } from 'path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { convertFcpxmlToTracks } from '../lib/convertFcpxml';

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = resolve(__dirname, '../..');
const XML_DIR = join(PROJECT_ROOT, 'out', 'final-xml');
const JSON_DIR = join(PROJECT_ROOT, 'out', 'final-json');

// Parse CLI flags
const FORCE = process.argv.includes('--force');

// ============================================================================
// Types
// ============================================================================

interface ConversionResult {
  xmlFile: string;
  status: 'converted' | 'skipped' | 'error';
  error?: string;
}

// ============================================================================
// File Discovery
// ============================================================================

function findXmlFiles(): string[] {
  if (!existsSync(XML_DIR)) {
    return [];
  }

  const files = readdirSync(XML_DIR)
    .filter(file => extname(file).toLowerCase() === '.xml')
    .sort();

  return files;
}

// ============================================================================
// Conversion Logic
// ============================================================================

async function convertXmlFile(
  xmlFile: string,
  results: ConversionResult[]
): Promise<void> {
  const xmlPath = join(XML_DIR, xmlFile);
  const nameWithoutExt = basename(xmlFile, extname(xmlFile));
  const jsonFile = `${nameWithoutExt}.json`;
  const jsonPath = join(JSON_DIR, jsonFile);

  console.log(chalk.cyan(`\n📄 Processing: ${xmlFile}`));

  // Check if JSON already exists
  if (existsSync(jsonPath)) {
    if (FORCE) {
      console.log(chalk.dim('  ♻ Overwriting existing file (--force)'));
    } else {
      try {
        const shouldOverwrite = await confirm({
          message: `${jsonFile} already exists. Overwrite?`,
          default: false,
        });

        if (!shouldOverwrite) {
          console.log(chalk.dim('  ⏭ Skipped'));
          results.push({ xmlFile, status: 'skipped' });
          return;
        }
      } catch (err) {
        // User cancelled (Ctrl+C)
        console.log(chalk.yellow('\n\n⚠ Cancelled by user'));
        process.exit(0);
      }
    }
  }

  // Read XML file
  let xmlContent: string;
  try {
    xmlContent = readFileSync(xmlPath, 'utf-8');
  } catch (err) {
    const errorMsg = `Failed to read XML: ${err instanceof Error ? err.message : String(err)}`;
    console.log(chalk.red(`  ✗ ${errorMsg}`));
    results.push({ xmlFile, status: 'error', error: errorMsg });
    return;
  }

  // Convert XML to JSON
  let jsonData;
  try {
    jsonData = convertFcpxmlToTracks(xmlContent);
  } catch (err) {
    const errorMsg = `Conversion failed: ${err instanceof Error ? err.message : String(err)}`;
    console.log(chalk.red(`  ✗ ${errorMsg}`));
    results.push({ xmlFile, status: 'error', error: errorMsg });
    return;
  }

  // Write JSON file
  try {
    const jsonContent = JSON.stringify(jsonData, null, 2);
    writeFileSync(jsonPath, jsonContent, 'utf-8');
    console.log(chalk.green(`  ✓ Generated: ${jsonFile}`));
    results.push({ xmlFile, status: 'converted' });
  } catch (err) {
    const errorMsg = `Failed to write JSON: ${err instanceof Error ? err.message : String(err)}`;
    console.log(chalk.red(`  ✗ ${errorMsg}`));
    results.push({ xmlFile, status: 'error', error: errorMsg });
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 Batch FCPXML to JSON Converter\n'));

  if (FORCE) {
    console.log(chalk.yellow('⚡ Force mode enabled - will overwrite existing files\n'));
  }

  // Find all XML files
  const xmlFiles = findXmlFiles();

  if (xmlFiles.length === 0) {
    if (!existsSync(XML_DIR)) {
      console.log(chalk.yellow(`⚠ Directory not found: ${XML_DIR}`));
    } else {
      console.log(chalk.yellow('⚠ No XML files found'));
    }
    console.log();
    return;
  }

  console.log(chalk.cyan(`Found ${xmlFiles.length} XML file(s):\n`));
  xmlFiles.forEach((file, i) => {
    console.log(chalk.dim(`  ${i + 1}. ${file}`));
  });
  console.log();

  // Create output directory if needed
  if (!existsSync(JSON_DIR)) {
    console.log(chalk.dim(`Creating directory: ${JSON_DIR}\n`));
    try {
      mkdirSync(JSON_DIR, { recursive: true });
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: Failed to create JSON directory: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  }

  // Process each XML file
  const results: ConversionResult[] = [];

  for (const xmlFile of xmlFiles) {
    await convertXmlFile(xmlFile, results);
  }

  // Show summary
  console.log(chalk.bold.green('\n✅ Batch conversion complete!\n'));

  const convertedCount = results.filter(r => r.status === 'converted').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Total files: ${xmlFiles.length}`);
  console.log(chalk.green(`  Converted: ${convertedCount}`));
  if (skippedCount > 0) {
    console.log(chalk.dim(`  Skipped: ${skippedCount}`));
  }
  if (errorCount > 0) {
    console.log(chalk.red(`  Errors: ${errorCount}`));
  }
  console.log();

  // Show errors if any
  if (errorCount > 0) {
    console.log(chalk.bold.red('Errors:\n'));
    results
      .filter(r => r.status === 'error')
      .forEach(r => {
        console.log(chalk.red(`  ✗ ${r.xmlFile}`));
        console.log(chalk.dim(`    ${r.error}`));
      });
    console.log();
  }

  console.log(chalk.bold('Output directory:'));
  console.log(chalk.cyan(`  ${JSON_DIR}`));
  console.log();
}

main().catch(err => {
  console.error(chalk.red(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
