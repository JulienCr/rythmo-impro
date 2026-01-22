/**
 * Status command - Display video processing status table
 */

import chalk from 'chalk';
import { getAllVideoStatuses } from '../lib/videos.js';
import { findXmlFiles } from '../lib/xml.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';

export async function statusCommand(): Promise<void> {
  console.log(colors.title('\n📊 Rythmo Pipeline Status\n'));

  // Get video statuses
  const videos = getAllVideoStatuses();

  if (videos.length === 0) {
    console.log(colors.warning(`No video files found in ${paths.inDir}\n`));
    return;
  }

  // Calculate column widths
  const maxNameLen = Math.max(
    'Fichier'.length,
    ...videos.map(v => v.filename.length)
  );

  // Header
  console.log(chalk.bold(
    '  ' +
    'Fichier'.padEnd(maxNameLen + 2) +
    'Diar.'.padEnd(8) +
    'XML'.padEnd(8) +
    'Thumb'.padEnd(8) +
    'Final'
  ));
  console.log(chalk.dim('  ' + '─'.repeat(maxNameLen + 2 + 8 * 4)));

  // Rows
  for (const video of videos) {
    const name = video.isNew
      ? colors.newVideo(video.filename.padEnd(maxNameLen + 2))
      : colors.processedVideo(video.filename.padEnd(maxNameLen + 2));

    const diar = video.hasDiarization ? colors.checkmark : colors.cross;
    const xml = video.hasXml ? colors.checkmark : colors.cross;
    const thumb = video.hasThumbnail ? colors.checkmark : colors.cross;
    const final = video.hasFinalVideo ? colors.checkmark : colors.cross;

    console.log(
      `  ${name}${diar.padEnd(8)}${xml.padEnd(8)}${thumb.padEnd(8)}${final}`
    );
  }

  // Summary
  const newCount = videos.filter(v => v.isNew).length;
  const processedCount = videos.length - newCount;
  const completeCount = videos.filter(v =>
    v.hasDiarization && v.hasXml && v.hasThumbnail && v.hasFinalVideo
  ).length;

  console.log(chalk.dim('  ' + '─'.repeat(maxNameLen + 2 + 8 * 4)));
  console.log();
  console.log(chalk.bold('Résumé:'));
  console.log(`  Total: ${videos.length} vidéos`);
  if (newCount > 0) {
    console.log(colors.newVideo(`  Nouveaux: ${newCount}`));
  }
  if (processedCount > 0) {
    console.log(colors.processedVideo(`  Traités: ${processedCount}`));
  }
  console.log(colors.success(`  Complets: ${completeCount}`));

  // XML finalization status
  const xmlFiles = findXmlFiles();
  const pendingXml = xmlFiles.filter(f => !f.hasJson).length;

  if (xmlFiles.length > 0) {
    console.log();
    console.log(chalk.bold('Fichiers XML (final-xml/):'));
    console.log(`  Total: ${xmlFiles.length}`);
    if (pendingXml > 0) {
      console.log(colors.warning(`  À finaliser: ${pendingXml}`));
    }
  }

  console.log();
  console.log(chalk.bold('Répertoires:'));
  console.log(colors.dim(`  Input:  ${paths.inDir}`));
  console.log(colors.dim(`  Output: ${paths.outDir}`));
  console.log();
}
