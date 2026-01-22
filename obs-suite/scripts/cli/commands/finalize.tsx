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
        return await confirm({
          message: `${file.filename.replace('.xml', '.json')} existe déjà. Écraser ?`,
          default: false,
        });
      } catch {
        // Annulé par l'utilisateur (Ctrl+C)
        console.log(colors.warning('\n\n⚠ Annulé par l\'utilisateur'));
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
 * Interactive XML file selection using Ink
 */
async function selectXmlFiles(files: XmlFileStatus[]): Promise<XmlFileStatus[]> {
  // Small delay to let terminal settle after inquirer prompt
  // This prevents leftover input from being captured by Ink
  await new Promise(resolve => setTimeout(resolve, 50));

  return new Promise((resolve) => {
    let result: XmlFileStatus[] = [];

    const { unmount, waitUntilExit } = render(
      <XmlMultiSelect
        files={files}
        onSubmit={(selected) => {
          result = selected;
          unmount();
        }}
        onCancel={() => {
          result = [];
          unmount();
        }}
      />
    );

    waitUntilExit().then(() => {
      resolve(result);
    });
  });
}
