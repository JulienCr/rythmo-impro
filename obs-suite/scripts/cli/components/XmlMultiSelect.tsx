/**
 * Multi-select component for XML files with sections (NEW/CONVERTED)
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { XmlFileStatus } from '../lib/xml.js';

interface XmlMultiSelectProps {
  files: XmlFileStatus[];
  onSubmit: (selected: XmlFileStatus[]) => void;
  onCancel: () => void;
}

export function XmlMultiSelect({ files, onSubmit, onCancel }: XmlMultiSelectProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Pre-select all files without JSON
    return new Set(files.filter(f => !f.hasJson).map(f => f.filename));
  });

  const newFiles = files.filter(f => !f.hasJson);
  const convertedFiles = files.filter(f => f.hasJson);

  // Build flat list for navigation
  const items: Array<{ type: 'file' | 'section'; file?: XmlFileStatus; label?: string }> = [];

  if (newFiles.length > 0) {
    items.push({ type: 'section', label: 'À CONVERTIR' });
    newFiles.forEach(f => items.push({ type: 'file', file: f }));
  }

  if (convertedFiles.length > 0) {
    items.push({ type: 'section', label: 'DÉJÀ CONVERTIS' });
    convertedFiles.forEach(f => items.push({ type: 'file', file: f }));
  }

  const toggleCurrent = useCallback(() => {
    const item = items[cursor];
    if (item.type === 'file' && item.file) {
      const filename = item.file.filename;
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(filename)) {
          next.delete(filename);
        } else {
          next.add(filename);
        }
        return next;
      });
    }
  }, [cursor, items]);

  const selectAll = useCallback(() => {
    setSelected(new Set(files.map(f => f.filename)));
  }, [files]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onCancel();
      return;
    }

    if (key.return) {
      const selectedFiles = files.filter(f => selected.has(f.filename));
      onSubmit(selectedFiles);
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor(prev => {
        let next = prev - 1;
        while (next >= 0 && items[next].type === 'section') {
          next--;
        }
        return next >= 0 ? next : prev;
      });
    }

    if (key.downArrow || input === 'j') {
      setCursor(prev => {
        let next = prev + 1;
        while (next < items.length && items[next].type === 'section') {
          next++;
        }
        return next < items.length ? next : prev;
      });
    }

    if (input === ' ') {
      toggleCurrent();
    }

    if (input === 'a') {
      selectAll();
    }

    if (input === 'n') {
      selectNone();
    }
  });

  // Ensure cursor starts on first file item
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (items[cursor]?.type === 'section') {
      const firstFileIdx = items.findIndex(i => i.type === 'file');
      if (firstFileIdx >= 0) {
        setCursor(firstFileIdx);
      }
    }
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">? Sélectionnez les fichiers XML à convertir :</Text>
      <Text> </Text>

      {items.map((item, idx) => {
        if (item.type === 'section') {
          return (
            <Box key={`section-${item.label}`}>
              <Text dimColor>  ─── {item.label} ───────────────────────────────</Text>
            </Box>
          );
        }

        const file = item.file!;
        const isSelected = selected.has(file.filename);
        const isCursor = idx === cursor;

        return (
          <Box key={file.filename}>
            <Text color={isCursor ? 'cyan' : undefined}>
              {isCursor ? '❯ ' : '  '}
            </Text>
            <Text color={isSelected ? 'green' : 'gray'}>
              {isSelected ? '◉' : '○'}
            </Text>
            <Text color={file.hasJson ? 'gray' : 'green'}>
              {' '}{file.filename}
            </Text>
            {file.hasJson && (
              <Text color="gray">  ✓</Text>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        [espace] Sélectionner  [a] Tous  [n] Aucun  [entrée] Confirmer  [q] Annuler
      </Text>
      <Text dimColor>
        Sélectionnés: {selected.size}/{files.length}
      </Text>
    </Box>
  );
}
