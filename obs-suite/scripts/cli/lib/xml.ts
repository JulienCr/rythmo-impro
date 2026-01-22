/**
 * FCP XML generation and conversion utilities
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { generateFcpxml } from '../../../lib/generateFcpxml.js';
import { convertFcpxmlToTracks } from '../../../lib/convertFcpxml.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import type { VideoOutputPaths } from './videos.js';

/**
 * Generate FCP XML for a video file
 * @returns true if generated, false if skipped
 */
export function generateXml(
  videoBasename: string,
  outputPaths: VideoOutputPaths,
  force: boolean
): boolean {
  // Check if XML already exists
  if (!force && existsSync(outputPaths.xml)) {
    console.log(colors.dim(`  ⏭ Skipping ${videoBasename} - FCP XML already exists`));
    return false;
  }

  // Check if CLI JSON exists
  if (!existsSync(outputPaths.cliJson)) {
    console.log(colors.warning(`  ⚠ Skipping ${videoBasename} - CLI JSON not found`));
    return false;
  }

  const videoPath = join(paths.inDir, videoBasename);

  if (!existsSync(videoPath)) {
    console.log(colors.warning(`  ⚠ Skipping ${videoBasename} - video file not found`));
    return false;
  }

  try {
    console.log(colors.dim(`  🎬 Generating FCP XML for ${videoBasename}...`));
    generateFcpxml(outputPaths.cliJson, videoPath, outputPaths.xml);
    return true;
  } catch (err) {
    console.error(colors.error(`  ✗ FCP XML generation failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

/** XML file with its status */
export interface XmlFileStatus {
  filename: string;
  fullPath: string;
  jsonPath: string;
  hasJson: boolean;
}

/**
 * Find all XML files in the final-xml directory
 */
export function findXmlFiles(): XmlFileStatus[] {
  if (!existsSync(paths.finalXmlDir)) {
    return [];
  }

  const files = readdirSync(paths.finalXmlDir)
    .filter(file => extname(file).toLowerCase() === '.xml')
    .sort()
    .map(filename => {
      const fullPath = join(paths.finalXmlDir, filename);
      const nameWithoutExt = basename(filename, extname(filename));
      const jsonPath = join(paths.finalJsonDir, `${nameWithoutExt}.json`);

      return {
        filename,
        fullPath,
        jsonPath,
        hasJson: existsSync(jsonPath),
      };
    });

  // Sort: files without JSON first, then alphabetically
  return files.sort((a, b) => {
    if (a.hasJson !== b.hasJson) {
      return a.hasJson ? 1 : -1;  // Without JSON first
    }
    return a.filename.localeCompare(b.filename);
  });
}

/** Conversion result */
export interface ConversionResult {
  xmlFile: string;
  status: 'converted' | 'skipped' | 'error';
  error?: string;
}

/**
 * Convert a single XML file to JSON
 */
export async function convertXmlToJson(
  xmlFile: XmlFileStatus,
  force: boolean,
  promptOverwrite?: () => Promise<boolean>
): Promise<ConversionResult> {
  const jsonFile = basename(xmlFile.jsonPath);

  console.log(colors.info(`\n📄 Processing: ${xmlFile.filename}`));

  // Check if JSON already exists
  if (existsSync(xmlFile.jsonPath)) {
    if (force) {
      console.log(colors.dim('  ♻ Overwriting existing file (--force)'));
    } else if (promptOverwrite) {
      const shouldOverwrite = await promptOverwrite();
      if (!shouldOverwrite) {
        console.log(colors.dim('  ⏭ Skipped'));
        return { xmlFile: xmlFile.filename, status: 'skipped' };
      }
    } else {
      console.log(colors.dim('  ⏭ Skipped (file exists)'));
      return { xmlFile: xmlFile.filename, status: 'skipped' };
    }
  }

  // Read XML file
  let xmlContent: string;
  try {
    xmlContent = readFileSync(xmlFile.fullPath, 'utf-8');
  } catch (err) {
    const errorMsg = `Failed to read XML: ${err instanceof Error ? err.message : String(err)}`;
    console.log(colors.error(`  ✗ ${errorMsg}`));
    return { xmlFile: xmlFile.filename, status: 'error', error: errorMsg };
  }

  // Convert XML to JSON
  let jsonData;
  try {
    jsonData = convertFcpxmlToTracks(xmlContent);
  } catch (err) {
    const errorMsg = `Conversion failed: ${err instanceof Error ? err.message : String(err)}`;
    console.log(colors.error(`  ✗ ${errorMsg}`));
    return { xmlFile: xmlFile.filename, status: 'error', error: errorMsg };
  }

  // Ensure output directory exists
  if (!existsSync(paths.finalJsonDir)) {
    mkdirSync(paths.finalJsonDir, { recursive: true });
  }

  // Write JSON file
  try {
    const jsonContent = JSON.stringify(jsonData, null, 2);
    writeFileSync(xmlFile.jsonPath, jsonContent, 'utf-8');
    console.log(colors.success(`  ✓ Generated: ${jsonFile}`));
    return { xmlFile: xmlFile.filename, status: 'converted' };
  } catch (err) {
    const errorMsg = `Failed to write JSON: ${err instanceof Error ? err.message : String(err)}`;
    console.log(colors.error(`  ✗ ${errorMsg}`));
    return { xmlFile: xmlFile.filename, status: 'error', error: errorMsg };
  }
}
