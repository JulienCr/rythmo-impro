/**
 * Escape-enabled prompt wrappers for @inquirer/prompts
 */

import { select, input, checkbox, confirm } from '@inquirer/prompts';
import * as readline from 'readline';

// Custom error for Escape cancellation
export class EscapeCancelledError extends Error {
  constructor() {
    super('Cancelled by Escape key');
    this.name = 'EscapeCancelledError';
  }
}

/**
 * Check if an error is from user cancellation (Escape or Ctrl+C)
 */
export function isCancelError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'EscapeCancelledError' ||
           err.name === 'AbortError' ||
           err.name === 'ExitPromptError' ||
           (err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE';
  }
  return false;
}

/**
 * Create an AbortController that triggers on Escape key
 */
function createEscapeController(): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const onKeypress = (_str: string, key: readline.Key) => {
    if (key.name === 'escape') {
      controller.abort();
    }
  };

  // Set raw mode to capture individual keystrokes
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    if (!process.stdin.isRaw) {
      process.stdin.setRawMode(true);
    }
  }

  process.stdin.on('keypress', onKeypress);

  const cleanup = () => {
    process.stdin.removeListener('keypress', onKeypress);
  };

  return { controller, cleanup };
}

/**
 * Run an @inquirer/prompts function with Escape key cancellation support.
 * Wraps the prompt with an AbortController that fires on Escape,
 * converting the abort into an EscapeCancelledError.
 */
async function withEscape<T, O extends object>(
  promptFn: (options: O & { signal?: AbortSignal }) => Promise<T>,
  options: O,
): Promise<T> {
  const { controller, cleanup } = createEscapeController();

  try {
    return await promptFn({
      ...options,
      signal: controller.signal,
    } as O & { signal: AbortSignal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new EscapeCancelledError();
    }
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * Wrapper for select prompt with Escape key support
 */
export async function selectWithEscape<T>(options: Parameters<typeof select<T>>[0]): Promise<T> {
  return withEscape(select, options);
}

/**
 * Wrapper for input prompt with Escape key support
 */
export async function inputWithEscape(options: Parameters<typeof input>[0]): Promise<string> {
  return withEscape(input, options);
}

/**
 * Wrapper for checkbox prompt with Escape key support
 */
export async function checkboxWithEscape<T>(options: Parameters<typeof checkbox<T>>[0]): Promise<T[]> {
  return withEscape(checkbox, options);
}

/**
 * Wrapper for confirm prompt with Escape key support
 */
export async function confirmWithEscape(options: Parameters<typeof confirm>[0]): Promise<boolean> {
  return withEscape(confirm, options);
}
