/**
 * Extract the basename (filename without extension) from a URL or path.
 */
export function extractBasename(src: string): string {
  const filename = src.split('/').pop() || '';
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Derive tracks JSON URL from a video path.
 */
export function deriveTracksUrl(videoPath: string): string {
  return `/api/out/final-json/${extractBasename(videoPath)}.json`;
}
