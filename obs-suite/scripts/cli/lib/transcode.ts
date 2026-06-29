/**
 * Video codec detection and transcoding to H264/AAC/MP4
 *
 * Ensures all videos entering the pipeline are in a compatible format
 * for WhisperX/pyannote diarization.
 */

import ffmpeg from 'fluent-ffmpeg';
import { rename, unlink } from 'fs/promises';
import { extname, dirname, basename, join } from 'path';
import { colors } from '../utils/colors.js';

interface FfprobeStream {
  codec_name?: string;
  codec_type?: string;
}

interface FfprobeData {
  streams: FfprobeStream[];
  format: { format_name?: string };
}

export interface VideoCodecInfo {
  video: string | null;
  audio: string | null;
  container: string;
}

/**
 * Probe a video file and return its codec information.
 */
export function getVideoInfo(filePath: string): Promise<VideoCodecInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, data: FfprobeData) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      const audioStream = data.streams.find((s) => s.codec_type === 'audio');
      resolve({
        video: videoStream?.codec_name ?? null,
        audio: audioStream?.codec_name ?? null,
        container: extname(filePath).toLowerCase().replace('.', ''),
      });
    });
  });
}

/**
 * Check if a video is already in a compatible format (H264/AAC/MP4).
 */
export function isCompatible(info: VideoCodecInfo): boolean {
  const videoOk = info.video === 'h264';
  const audioOk = info.audio === null || info.audio === 'aac';
  const containerOk = info.container === 'mp4';
  return videoOk && audioOk && containerOk;
}

/**
 * Return a human-readable description of why a video is incompatible.
 */
function incompatibilityReason(info: VideoCodecInfo): string {
  const reasons: string[] = [];
  if (info.video !== 'h264') reasons.push(`video: ${info.video ?? 'none'} (need h264)`);
  if (info.audio !== null && info.audio !== 'aac') reasons.push(`audio: ${info.audio} (need aac)`);
  if (info.container !== 'mp4') reasons.push(`container: .${info.container} (need .mp4)`);
  return reasons.join(', ');
}

interface ProgressInfo {
  percent?: number;
}

/**
 * Transcode a video to H264/AAC/MP4, using stream copy when possible.
 */
export function transcodeToCompatible(
  inputPath: string,
  outputPath: string,
  info: VideoCodecInfo,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    // Video: copy if already h264, otherwise transcode
    if (info.video === 'h264') {
      command = command.outputOptions(['-c:v', 'copy']);
    } else {
      command = command.outputOptions(['-c:v', 'libx264', '-crf', '23', '-preset', 'medium']);
    }

    // Audio: copy if already aac, transcode if present but not aac, skip if absent
    if (info.audio === 'aac') {
      command = command.outputOptions(['-c:a', 'copy']);
    } else if (info.audio !== null) {
      command = command.outputOptions(['-c:a', 'aac', '-b:a', '192k']);
    } else {
      command = command.outputOptions(['-an']);
    }

    command
      .on('progress', (progress: ProgressInfo) => {
        if (progress.percent !== undefined && onProgress) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputPath);
  });
}

/**
 * Ensure a video file is H264/AAC/MP4, transcoding in-place if needed.
 *
 * If the file is already compatible, returns its path unchanged.
 * If transcoding is needed, writes to a temp file, removes the original,
 * and renames the temp file. If the original had a non-.mp4 extension,
 * the final file will have a .mp4 extension.
 *
 * @returns The final file path (may differ from input if extension changed)
 */
export async function ensureCompatible(filePath: string): Promise<string> {
  const info = await getVideoInfo(filePath);

  if (isCompatible(info)) {
    console.log(colors.dim(`  ${colors.checkmark} ${basename(filePath)} — déjà compatible (h264/aac/mp4)`));
    return filePath;
  }

  const reason = incompatibilityReason(info);
  console.log(colors.info(`  ${colors.arrow} ${basename(filePath)} — transcodage requis (${reason})`));

  const dir = dirname(filePath);
  const nameWithoutExt = basename(filePath, extname(filePath));
  const finalPath = join(dir, `${nameWithoutExt}.mp4`);
  const tempPath = join(dir, `${nameWithoutExt}.tmp.mp4`);

  let lastPercent = -1;
  try {
    await transcodeToCompatible(filePath, tempPath, info, (percent) => {
      // Log progress every 10%
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        process.stdout.write(colors.dim(`    ${percent}%\r`));
      }
    });
    console.log(colors.dim(`    100%`));

    // Replace original with transcoded file.
    // On Linux/macOS, rename atomically overwrites the target if it exists,
    // so we rename first to avoid a window where neither file exists.
    await rename(tempPath, finalPath);
    if (filePath !== finalPath) {
      await unlink(filePath);
    }
  } catch (err) {
    // Clean up temp file if it was created
    await unlink(tempPath).catch(() => {});
    throw err;
  }

  console.log(colors.success(`  ${colors.checkmark} ${basename(finalPath)}`));
  return finalPath;
}
