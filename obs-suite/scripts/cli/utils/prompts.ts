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
 * Wrapper for select prompt with Escape key support
 */
export async function selectWithEscape<T>(options: Parameters<typeof select<T>>[0]): Promise<T> {
  const { controller, cleanup } = createEscapeController();

  try {
    const result = await select({
      ...options,
      // @ts-expect-error - signal is supported but types may be outdated
      signal: controller.signal,
    });
    return result;
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
 * Wrapper for input prompt with Escape key support
 */
export async function inputWithEscape(options: Parameters<typeof input>[0]): Promise<string> {
  const { controller, cleanup } = createEscapeController();

  try {
    const result = await input({
      ...options,
      // @ts-expect-error - signal is supported but types may be outdated
      signal: controller.signal,
    });
    return result;
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
 * Wrapper for checkbox prompt with Escape key support
 */
export async function checkboxWithEscape<T>(options: Parameters<typeof checkbox<T>>[0]): Promise<T[]> {
  const { controller, cleanup } = createEscapeController();

  try {
    const result = await checkbox({
      ...options,
      // @ts-expect-error - signal is supported but types may be outdated
      signal: controller.signal,
    });
    return result;
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
 * Wrapper for confirm prompt with Escape key support
 */
export async function confirmWithEscape(options: Parameters<typeof confirm>[0]): Promise<boolean> {
  const { controller, cleanup } = createEscapeController();

  try {
    const result = await confirm({
      ...options,
      // @ts-expect-error - signal is supported but types may be outdated
      signal: controller.signal,
    });
    return result;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new EscapeCancelledError();
    }
    throw err;
  } finally {
    cleanup();
  }
}
