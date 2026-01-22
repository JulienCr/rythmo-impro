/**
 * Project paths configuration
 */

import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OBS_SUITE_ROOT = resolve(__dirname, '../../..');
const PROJECT_ROOT = resolve(OBS_SUITE_ROOT, '..');

export const paths = {
  projectRoot: PROJECT_ROOT,
  obsSuiteRoot: OBS_SUITE_ROOT,

  // Input/Output directories
  inDir: join(PROJECT_ROOT, 'in'),
  outDir: join(PROJECT_ROOT, 'out'),

  // Subdirectories under out/
  thumbsDir: join(PROJECT_ROOT, 'out', 'thumbs'),
  finalVidsDir: join(PROJECT_ROOT, 'out', 'final-vids'),
  finalXmlDir: join(PROJECT_ROOT, 'out', 'final-xml'),
  finalJsonDir: join(PROJECT_ROOT, 'out', 'final-json'),

  // Scripts
  diarizerScript: join(PROJECT_ROOT, 'diarizer', 'run-wsl.sh'),
  vocalRemovalScript: join(PROJECT_ROOT, 'diarizer', 'run-vocal-removal.sh'),
} as const;

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;
