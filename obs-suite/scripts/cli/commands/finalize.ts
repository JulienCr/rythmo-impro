/**
 * Finalize command - Convert corrected XML files to JSON
 */

import chalk from 'chalk';

import { findXmlFiles, convertXmlToJson, type XmlFileStatus, type ConversionResult } from '../lib/xml.js';
import { paths } from '../utils/paths.js';
import { colors } from '../utils/colors.js';
import { checkboxWithEscape, confirmWithEscape, isCancelError } from '../utils/prompts.js';

interface FinalizeCommandOptions {
  force?: boolean;
  all?: boolean;
}

/**
 * Run the finalize command
 */
export async function finalizeCommand(options: FinalizeCommandOptions): Promise<void> {
  console.log(colors.title('\n🎬 Finalisation des fichiers XML corrigés\n'));

  if (options.force) {
    console.log(colors.warning('⚡ Mode forcé activé - les fichiers existants seront écrasés\n'));
  }

  // Find all XML files
  const xmlFiles = findXmlFiles();

  if (xmlFiles.length === 0) {
    console.log(colors.warning(`Aucun fichier XML trouvé dans ${paths.finalXmlDir}\n`));
    console.log(colors.dim('Placez les fichiers XML corrigés dans ce répertoire pour les convertir en JSON.\n'));
    return;
  }

  console.log(colors.info(`${xmlFiles.length} fichier(s) XML trouvé(s)\n`));

  let selectedFiles: XmlFileStatus[];

  if (options.all) {
    // Traiter tous les fichiers sans sélection
    selectedFiles = xmlFiles;
    console.log(colors.dim(`Traitement de tous les ${xmlFiles.length} fichiers\n`));
  } else {
    // Interactive multi-select
    selectedFiles = await selectXmlFiles(xmlFiles);

    if (selectedFiles.length === 0) {
      console.log(colors.warning('\nAucun fichier sélectionné. Fin.\n'));
      return;
    }
  }

  // Process files
  const results: ConversionResult[] = [];

  for (const file of selectedFiles) {
    const promptOverwrite = async () => {
      try {
        return await confirmWithEscape({
          message: `${file.filename.replace('.xml', '.json')} existe déjà. Écraser ?`,
          default: false,
        });
      } catch (err) {
        if (isCancelError(err)) {
          // Annulé par l'utilisateur (Escape ou Ctrl+C)
          throw err; // Propagate to return to main menu
        }
        throw err;
      }
    };

    const result = await convertXmlToJson(
      file,
      options.force || false,
      options.all ? undefined : promptOverwrite
    );
    results.push(result);
  }

  // Afficher le résumé
  console.log(colors.success('\n✅ Finalisation terminée !\n'));

  const convertedCount = results.filter(r => r.status === 'converted').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log(chalk.bold('Résumé :'));
  console.log(`  Total fichiers : ${selectedFiles.length}`);
  console.log(colors.success(`  Convertis : ${convertedCount}`));
  if (skippedCount > 0) {
    console.log(colors.dim(`  Ignorés : ${skippedCount}`));
  }
  if (errorCount > 0) {
    console.log(colors.error(`  Erreurs : ${errorCount}`));
  }
  console.log();

  // Afficher les erreurs si présentes
  if (errorCount > 0) {
    console.log(chalk.bold.red('Erreurs :\n'));
    results
      .filter(r => r.status === 'error')
      .forEach(r => {
        console.log(colors.error(`  ✗ ${r.xmlFile}`));
        console.log(colors.dim(`    ${r.error}`));
      });
    console.log();
  }

  console.log(chalk.bold('Répertoire de sortie :'));
  console.log(colors.info(`  ${paths.finalJsonDir}`));
  console.log();
}

/**
 * Interactive XML file selection using inquirer checkbox
 */
async function selectXmlFiles(files: XmlFileStatus[]): Promise<XmlFileStatus[]> {
  const newFiles = files.filter(f => !f.hasJson);
  const convertedFiles = files.filter(f => f.hasJson);

  // Build choices with separators
  const choices: Array<{ name: string; value: string; checked: boolean } | { type: 'separator'; separator: string }> = [];

  if (newFiles.length > 0) {
    choices.push({ type: 'separator', separator: chalk.dim('─── À CONVERTIR ───────────────────────────') });
    for (const f of newFiles) {
      choices.push({
        name: chalk.green(f.filename),
        value: f.filename,
        checked: true, // Pre-select files without JSON
      });
    }
  }

  if (convertedFiles.length > 0) {
    choices.push({ type: 'separator', separator: chalk.dim('─── DÉJÀ CONVERTIS ────────────────────────') });
    for (const f of convertedFiles) {
      choices.push({
        name: chalk.gray(`${f.filename}  ✓`),
        value: f.filename,
        checked: false,
      });
    }
  }

  const selected = await checkboxWithEscape({
    message: 'Sélectionnez les fichiers XML à convertir :',
    choices: choices as Parameters<typeof checkboxWithEscape>[0]['choices'],
    pageSize: 15,
  });

  return files.filter(f => (selected as string[]).includes(f.filename));
}
