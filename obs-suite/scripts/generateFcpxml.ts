#!/usr/bin/env node
/**
 * CLI script to generate FCPXML from speaker diarization CLI JSON
 *
 * Usage: pnpm run generate-fcpxml <input.cli.json> <video.mp4> <output.xml>
 * Example: pnpm run generate-fcpxml ../out/juste-leblanc.cli.json ../in/juste-leblanc.mp4 ../out/juste-leblanc.xml
 */

import { generateFcpxml } from '../lib/generateFcpxml';

// Get command-line arguments
const [cliJsonPath, videoPath, outputPath] = process.argv.slice(2);

if (!cliJsonPath || !videoPath || !outputPath) {
  console.error('Usage: pnpm run generate-fcpxml <input.cli.json> <video.mp4> <output.xml>');
  console.error('');
  console.error('Arguments:');
  console.error('  input.cli.json  - Path to CLI JSON diarization file');
  console.error('  video.mp4       - Path to video file');
  console.error('  output.xml      - Path for output FCPXML file');
  console.error('');
  console.error('Example:');
  console.error('  pnpm run generate-fcpxml ../out/juste-leblanc.cli.json ../in/juste-leblanc.mp4 ../out/juste-leblanc.xml');
  process.exit(1);
}

try {
  generateFcpxml(cliJsonPath, videoPath, outputPath);
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
