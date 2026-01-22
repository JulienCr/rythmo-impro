/**
 * Multi-select component for video files with sections (NEW/PROCESSED)
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { VideoStatus } from '../lib/videos.js';

interface VideoMultiSelectProps {
  videos: VideoStatus[];
  onSubmit: (selected: VideoStatus[]) => void;
  onCancel: () => void;
}

export function VideoMultiSelect({ videos, onSubmit, onCancel }: VideoMultiSelectProps) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Pre-select all new videos
    return new Set(videos.filter(v => v.isNew).map(v => v.filename));
  });

  const newVideos = videos.filter(v => v.isNew);
  const processedVideos = videos.filter(v => !v.isNew);

  // Build flat list for navigation
  const items: Array<{ type: 'video' | 'section'; video?: VideoStatus; label?: string }> = [];

  if (newVideos.length > 0) {
    items.push({ type: 'section', label: 'NOUVEAUX' });
    newVideos.forEach(v => items.push({ type: 'video', video: v }));
  }

  if (processedVideos.length > 0) {
    items.push({ type: 'section', label: 'DÉJÀ TRAITÉS' });
    processedVideos.forEach(v => items.push({ type: 'video', video: v }));
  }

  const videoItems = items.filter(i => i.type === 'video');

  const toggleCurrent = useCallback(() => {
    const item = items[cursor];
    if (item.type === 'video' && item.video) {
      const filename = item.video.filename;
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
    setSelected(new Set(videos.map(v => v.filename)));
  }, [videos]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  useInput((input, key) => {
    if (key.escape || (input === 'q')) {
      onCancel();
      exit();
      return;
    }

    if (key.return) {
      const selectedVideos = videos.filter(v => selected.has(v.filename));
      onSubmit(selectedVideos);
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor(prev => {
        let next = prev - 1;
        // Skip section headers
        while (next >= 0 && items[next].type === 'section') {
          next--;
        }
        return next >= 0 ? next : prev;
      });
    }

    if (key.downArrow || input === 'j') {
      setCursor(prev => {
        let next = prev + 1;
        // Skip section headers
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

  // Ensure cursor starts on first video item
  React.useEffect(() => {
    if (items[cursor]?.type === 'section') {
      const firstVideoIdx = items.findIndex(i => i.type === 'video');
      if (firstVideoIdx >= 0) {
        setCursor(firstVideoIdx);
      }
    }
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">? Sélectionnez les vidéos à traiter :</Text>
      <Text> </Text>

      {items.map((item, idx) => {
        if (item.type === 'section') {
          return (
            <Box key={`section-${item.label}`}>
              <Text dimColor>  ─── {item.label} ───────────────────────────────</Text>
            </Box>
          );
        }

        const video = item.video!;
        const isSelected = selected.has(video.filename);
        const isCursor = idx === cursor;

        return (
          <Box key={video.filename}>
            <Text color={isCursor ? 'cyan' : undefined}>
              {isCursor ? '❯ ' : '  '}
            </Text>
            <Text color={isSelected ? 'green' : 'gray'}>
              {isSelected ? '◉' : '○'}
            </Text>
            <Text color={video.isNew ? 'green' : 'gray'}>
              {' '}{video.filename}
            </Text>
            {!video.isNew && (
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
        Sélectionnés: {selected.size}/{videos.length}
      </Text>
    </Box>
  );
}
