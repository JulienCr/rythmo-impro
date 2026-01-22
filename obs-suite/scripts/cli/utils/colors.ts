/**
 * Color palette for CLI output
 */

import chalk from 'chalk';

/** Lane colors matching RythmoOverlay */
export const LANE_COLORS = [
  '#007AFF',  // Lane 0: Blue
  '#FF3B30',  // Lane 1: Red
  '#FFD60A',  // Lane 2: Yellow
  '#34C759',  // Lane 3: Green
  '#AF52DE',  // Lane 4: Purple
] as const;

/** Styled text helpers */
export const colors = {
  // Status indicators
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,

  // UI elements
  title: chalk.bold.blue,
  subtitle: chalk.bold,
  highlight: chalk.cyan,

  // Video states
  newVideo: chalk.green,
  processedVideo: chalk.dim,

  // Symbols
  checkmark: chalk.green('✓'),
  cross: chalk.red('✗'),
  skip: chalk.dim('⏭'),
  arrow: chalk.cyan('→'),
} as const;
