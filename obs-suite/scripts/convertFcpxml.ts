#!/usr/bin/env node
/**
 * CLI script to convert FCPXML files to character tracks JSON
 *
 * Usage: pnpm run convert-fcpxml <input.xml> <output.json>
 * Example: pnpm run convert-fcpxml public/fcpxml/scene.xml public/tracks/scene.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { convertFcpxmlToTracks } from '../lib/convertFcpxml';

// Get command-line arguments
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/convertFcpxml.ts <input.xml> <output.json>');
  console.error('');
  console.error('Example:');
  console.error('  pnpm run convert-fcpxml public/fcpxml/scene.xml public/tracks/scene.json');
  process.exit(1);
}

try {
  // Read XML file
  const xmlContent = readFileSync(resolve(inputPath), 'utf-8');

  // Convert to tracks data
  const tracksData = convertFcpxmlToTracks(xmlContent);

  // Write JSON file
  writeFileSync(resolve(outputPath), JSON.stringify(tracksData, null, 2), 'utf-8');

  // Print summary
  console.log(`✓ Converted ${inputPath} → ${outputPath}`);
  console.log(`  FPS: ${tracksData.fps}`);
  console.log(`  Tracks: ${tracksData.tracks.length}`);
  tracksData.tracks.forEach((track, i) => {
    console.log(`    ${i + 1}. ${track.name} (${track.color}) - ${track.segments.length} segments`);
  });
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
