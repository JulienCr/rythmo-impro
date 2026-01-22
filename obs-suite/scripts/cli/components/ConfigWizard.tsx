/**
 * Configuration wizard for diarization options
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DiarizationConfig, WhisperModel, Language } from '../schemas/config.js';

interface ConfigWizardProps {
  onComplete: (config: DiarizationConfig) => void;
  onCancel: () => void;
}

type Step = 'model' | 'language' | 'speakerConstraints' | 'minSpeakers' | 'maxSpeakers' | 'confirm';

const MODELS: Array<{ value: WhisperModel; label: string }> = [
  { value: 'large-v3', label: 'large-v3 (meilleure qualité, plus lent)' },
  { value: 'medium', label: 'medium (équilibré)' },
  { value: 'small', label: 'small (rapide, qualité réduite)' },
  { value: 'base', label: 'base (très rapide, qualité basique)' },
];

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'auto', label: 'Automatique' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
];

export function ConfigWizard({ onComplete, onCancel }: ConfigWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('model');
  const [cursor, setCursor] = useState(0);
  const [config, setConfig] = useState<Partial<DiarizationConfig>>({
    model: 'large-v3',
    language: 'auto',
  });
  const [useSpeakerConstraints, setUseSpeakerConstraints] = useState(false);
  const [inputValue, setInputValue] = useState('');

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onCancel();
      exit();
      return;
    }

    if (step === 'model') {
      if (key.upArrow || input === 'k') {
        setCursor(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        setCursor(prev => Math.min(MODELS.length - 1, prev + 1));
      } else if (key.return) {
        setConfig(prev => ({ ...prev, model: MODELS[cursor].value }));
        setCursor(0);
        setStep('language');
      }
    } else if (step === 'language') {
      if (key.upArrow || input === 'k') {
        setCursor(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        setCursor(prev => Math.min(LANGUAGES.length - 1, prev + 1));
      } else if (key.return) {
        setConfig(prev => ({ ...prev, language: LANGUAGES[cursor].value }));
        setCursor(0);
        setStep('speakerConstraints');
      }
    } else if (step === 'speakerConstraints') {
      if (key.upArrow || key.downArrow || input === 'k' || input === 'j') {
        setCursor(prev => prev === 0 ? 1 : 0);
      } else if (key.return) {
        if (cursor === 0) {
          // No constraints
          onComplete(config as DiarizationConfig);
        } else {
          // Use constraints
          setUseSpeakerConstraints(true);
          setInputValue('2');
          setStep('minSpeakers');
        }
      }
    } else if (step === 'minSpeakers') {
      if (key.return) {
        const min = parseInt(inputValue, 10);
        if (!isNaN(min) && min > 0) {
          setConfig(prev => ({ ...prev, minSpeakers: min }));
          setInputValue('4');
          setStep('maxSpeakers');
        }
      } else if (key.backspace || key.delete) {
        setInputValue(prev => prev.slice(0, -1));
      } else if (/^\d$/.test(input)) {
        setInputValue(prev => prev + input);
      }
    } else if (step === 'maxSpeakers') {
      if (key.return) {
        const max = parseInt(inputValue, 10);
        const min = config.minSpeakers || 1;
        if (!isNaN(max) && max >= min) {
          setConfig(prev => ({ ...prev, maxSpeakers: max }));
          onComplete({ ...config, maxSpeakers: max } as DiarizationConfig);
        }
      } else if (key.backspace || key.delete) {
        setInputValue(prev => prev.slice(0, -1));
      } else if (/^\d$/.test(input)) {
        setInputValue(prev => prev + input);
      }
    }
  });

  const renderStep = () => {
    switch (step) {
      case 'model':
        return (
          <>
            <Text bold color="cyan">? Modèle Whisper :</Text>
            <Text> </Text>
            {MODELS.map((model, idx) => (
              <Box key={model.value}>
                <Text color={idx === cursor ? 'cyan' : undefined}>
                  {idx === cursor ? '❯ ' : '  '}{model.label}
                </Text>
              </Box>
            ))}
          </>
        );

      case 'language':
        return (
          <>
            <Text bold color="cyan">? Langue :</Text>
            <Text> </Text>
            {LANGUAGES.map((lang, idx) => (
              <Box key={lang.value}>
                <Text color={idx === cursor ? 'cyan' : undefined}>
                  {idx === cursor ? '❯ ' : '  '}{lang.label}
                </Text>
              </Box>
            ))}
          </>
        );

      case 'speakerConstraints':
        return (
          <>
            <Text bold color="cyan">? Contraintes de locuteurs ?</Text>
            <Text> </Text>
            <Box>
              <Text color={cursor === 0 ? 'cyan' : undefined}>
                {cursor === 0 ? '❯ ' : '  '}Non (détection automatique)
              </Text>
            </Box>
            <Box>
              <Text color={cursor === 1 ? 'cyan' : undefined}>
                {cursor === 1 ? '❯ ' : '  '}Oui (définir min/max)
              </Text>
            </Box>
          </>
        );

      case 'minSpeakers':
        return (
          <>
            <Text bold color="cyan">? Nombre minimum de locuteurs :</Text>
            <Text> </Text>
            <Box>
              <Text color="green">{inputValue || '2'}</Text>
              <Text color="gray">_</Text>
            </Box>
          </>
        );

      case 'maxSpeakers':
        return (
          <>
            <Text bold color="cyan">? Nombre maximum de locuteurs :</Text>
            <Text> </Text>
            <Box>
              <Text color="green">{inputValue || '4'}</Text>
              <Text color="gray">_</Text>
            </Box>
            <Text dimColor>(doit être ≥ {config.minSpeakers})</Text>
          </>
        );
    }
  };

  return (
    <Box flexDirection="column">
      {renderStep()}
      <Text> </Text>
      <Text dimColor>
        [↑/↓] Naviguer  [entrée] Confirmer  [q] Annuler
      </Text>
    </Box>
  );
}
