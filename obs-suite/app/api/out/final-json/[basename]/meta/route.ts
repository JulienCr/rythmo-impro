/**
 * API route for managing video metadata (.meta.json files)
 *
 * GET /api/out/final-json/{basename}/meta
 *   - Returns the metadata for a video (empty object if file doesn't exist)
 *
 * POST /api/out/final-json/{basename}/meta
 *   - Creates or updates the metadata file with new title
 *   - Body: { videoTitle: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import type { VideoMeta } from '@/lib/fcpxmlTypes';
import { validateVideoMeta } from '@/lib/fcpxmlTypes';

// Force dynamic rendering - always read fresh from filesystem
export const dynamic = 'force-dynamic';

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = resolve(process.cwd(), '..');
const FINAL_JSON_DIR = join(PROJECT_ROOT, 'out', 'final-json');

/**
 * Validate basename to prevent path traversal
 */
function isValidBasename(basename: string): boolean {
  // Must not contain path separators or be empty
  if (!basename || basename.includes('/') || basename.includes('\\') || basename.includes('..')) {
    return false;
  }
  // Must be a reasonable filename
  if (basename.length > 255) {
    return false;
  }
  return true;
}

/**
 * Get the meta file path for a video basename
 */
function getMetaFilePath(basename: string): string {
  return join(FINAL_JSON_DIR, `${basename}.meta.json`);
}

// ============================================================================
// GET Handler - Read metadata
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ basename: string }> }
) {
  const { basename } = await params;

  if (!isValidBasename(basename)) {
    return NextResponse.json({ error: 'Invalid basename' }, { status: 400 });
  }

  try {
    const metaFilePath = getMetaFilePath(basename);

    const content = await readFile(metaFilePath, 'utf-8').catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    });

    if (content === null) {
      return NextResponse.json({});
    }

    const meta = JSON.parse(content);
    if (!validateVideoMeta(meta)) {
      console.warn(`Invalid meta file for ${basename}, returning empty object`);
      return NextResponse.json({});
    }
    return NextResponse.json(meta);
  } catch (err) {
    console.error('Error reading meta file:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST Handler - Write metadata
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ basename: string }> }
) {
  const { basename } = await params;

  if (!isValidBasename(basename)) {
    return NextResponse.json({ error: 'Invalid basename' }, { status: 400 });
  }

  try {
    const body = await request.json();

    if (body.videoTitle !== undefined && typeof body.videoTitle !== 'string') {
      return NextResponse.json({ error: 'videoTitle must be a string' }, { status: 400 });
    }

    const metaFilePath = getMetaFilePath(basename);

    const meta: VideoMeta = {
      version: 1,
      videoTitle: body.videoTitle,
    };

    await mkdir(FINAL_JSON_DIR, { recursive: true });
    await writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

    return NextResponse.json(meta);
  } catch (err) {
    console.error('Error writing meta file:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
