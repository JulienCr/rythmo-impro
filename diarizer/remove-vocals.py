#!/usr/bin/env python3
"""
Vocal removal using audio-separator with CUDA acceleration.
Extracts audio, removes vocals, remuxes with original video.
"""

import argparse
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

try:
    from audio_separator.separator import Separator
except ImportError:
    print("❌ audio-separator not installed!")
    print("Run: pip install audio-separator onnxruntime-gpu")
    sys.exit(1)


def check_audio_stream(video_path: Path) -> bool:
    """Check if video has an audio stream."""
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(video_path)
        ], capture_output=True, text=True, check=True)

        return bool(result.stdout.strip())
    except subprocess.CalledProcessError:
        return False


def remove_vocals(
    video_path: Path,
    output_path: Path,
    model: str = "MDX23C-InstVoc HQ",
    force: bool = False
) -> bool:
    """
    Remove vocals from video and create instrumental version.

    Args:
        video_path: Input video file
        output_path: Output video path (instrumental audio)
        model: audio-separator model name
        force: Overwrite existing output

    Returns:
        True if successful
    """
    # Skip if exists and not force
    if output_path.exists() and not force:
        print(f"⏭ Skipping {video_path.name} - output exists")
        return False

    # Check if video has audio
    if not check_audio_stream(video_path):
        print(f"⚠ No audio track found in {video_path.name}")
        print(f"  Copying video as-is...")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(video_path, output_path)
        return True

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # 1. Extract audio as WAV
        audio_wav = tmpdir / f"{video_path.stem}.wav"
        print(f"[1/3] Extracting audio from {video_path.name}...")
        try:
            subprocess.run([
                'ffmpeg', '-i', str(video_path),
                '-vn', '-acodec', 'pcm_s16le',
                '-ar', '44100', '-ac', '2',
                str(audio_wav), '-y'
            ], check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            print(f"✗ Audio extraction failed: {e.stderr.decode()}")
            return False

        # 2. Separate vocals using audio-separator
        print(f"[2/3] Removing vocals (model: {model})...")
        print(f"      This may take 30-60 seconds with CUDA...")

        try:
            # Map user-friendly model names to actual filenames
            model_map = {
                'MDX23C-InstVoc HQ': 'MDX23C-8KFFT-InstVoc_HQ.ckpt',
                'MDX23C-InstVoc HQ 2': 'MDX23C-8KFFT-InstVoc_HQ_2.ckpt',
            }
            model_filename = model_map.get(model, model)

            # Check CUDA availability
            import torch
            use_cuda = torch.cuda.is_available()

            if not use_cuda:
                print(f"⚠ CUDA not available - using CPU (will be slow)")

            # Initialize separator with output configuration
            separator = Separator(
                output_dir=str(tmpdir),
                output_format='wav',
                normalization_threshold=0.9,
                output_single_stem='Instrumental',  # Only extract instrumental
            )

            # Load the model
            separator.load_model(model_filename=model_filename)

            # Separate vocals
            output_files = separator.separate(str(audio_wav))

            # Find the instrumental output - audio-separator creates:
            # {stem}_(Instrumental)_{model_name}.wav
            model_name_short = model_filename.replace('.ckpt', '')
            instrumental_wav = tmpdir / f"{video_path.stem}_(Instrumental)_{model_name_short}.wav"

            if not instrumental_wav.exists():
                # Fallback: search for any file with (Instrumental) in the name
                instrumental_files = list(tmpdir.glob(f"{video_path.stem}*Instrumental*.wav"))
                if instrumental_files:
                    instrumental_wav = instrumental_files[0]
                else:
                    raise RuntimeError(f"Instrumental track not created. Expected: {instrumental_wav}")

        except Exception as e:
            print(f"✗ Vocal removal failed: {e}")
            return False

        # 3. Remux instrumental audio with original video
        print(f"[3/3] Remuxing video with instrumental audio...")
        try:
            subprocess.run([
                'ffmpeg',
                '-i', str(video_path),           # Original video (video stream)
                '-i', str(instrumental_wav),     # Instrumental audio
                '-map', '0:v',                   # Take video from input 0
                '-map', '1:a',                   # Take audio from input 1
                '-c:v', 'copy',                  # Copy video codec (no re-encode)
                '-c:a', 'aac',                   # Encode audio as AAC
                '-b:a', '192k',                  # Audio bitrate
                str(output_path), '-y'
            ], check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            print(f"✗ Video remux failed: {e.stderr.decode()}")
            return False

    print(f"✓ Generated instrumental video: {output_path.name}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Remove vocals from video using audio-separator'
    )
    parser.add_argument('--input', required=True, help='Input video file')
    parser.add_argument('--output', required=True, help='Output video file')
    parser.add_argument('--model', default='MDX23C-InstVoc HQ',
                       help='audio-separator model (default: MDX23C-InstVoc HQ)')
    parser.add_argument('--force', action='store_true',
                       help='Overwrite existing output')

    args = parser.parse_args()

    success = remove_vocals(
        Path(args.input),
        Path(args.output),
        model=args.model,
        force=args.force
    )

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
