#!/usr/bin/env python3
"""
Speaker Diarization CLI for rythmo-impro
Uses WhisperX + pyannote to identify who speaks when in video files.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import whisperx
import torch
from tqdm import tqdm

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def get_video_duration_ms(video_path: Path) -> int:
    """
    Get video duration in milliseconds using ffprobe.

    Args:
        video_path: Path to video file

    Returns:
        Duration in milliseconds
    """
    import subprocess

    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        duration_sec = float(result.stdout.strip())
        return int(duration_sec * 1000)
    except Exception as e:
        logger.warning(f"Could not determine video duration: {e}")
        return 0


def assign_lanes(segments: List[Dict]) -> Tuple[Dict[str, int], List[Dict]]:
    """
    Assign speakers to lanes using deterministic algorithm.

    Algorithm:
    1. Calculate total spoken duration for each speaker
    2. Sort by total duration (descending)
    3. Tie-breaker: earliest first speech time
    4. Assign lanes in order: 0, 1, 2, 3, 4...

    Args:
        segments: List of segment dicts with 'speaker', 't0', 't1'

    Returns:
        Tuple of (lane_map dict, speakers list)
    """
    if not segments:
        return {}, []

    # Calculate total duration and first speech time per speaker
    speaker_stats = {}
    for seg in segments:
        speaker = seg['speaker']
        duration = seg['t1'] - seg['t0']

        if speaker not in speaker_stats:
            speaker_stats[speaker] = {
                'total_duration': 0,
                'first_speech': seg['t0']
            }

        speaker_stats[speaker]['total_duration'] += duration
        speaker_stats[speaker]['first_speech'] = min(
            speaker_stats[speaker]['first_speech'],
            seg['t0']
        )

    # Sort speakers: by total duration (desc), then by first speech (asc)
    sorted_speakers = sorted(
        speaker_stats.keys(),
        key=lambda s: (-speaker_stats[s]['total_duration'], speaker_stats[s]['first_speech'])
    )

    # Assign lanes
    lane_map = {speaker: idx for idx, speaker in enumerate(sorted_speakers)}
    speakers = [{'id': speaker} for speaker in sorted_speakers]

    logger.info(f"Assigned {len(speakers)} speakers to lanes:")
    for speaker, lane in lane_map.items():
        duration_sec = speaker_stats[speaker]['total_duration'] / 1000
        logger.info(f"  {speaker} → Lane {lane} ({duration_sec:.1f}s total)")

    return lane_map, speakers


def run_diarization(
    video_path: Path,
    model_size: str = "small",
    language: str = "auto",
    device: str = "cuda"
) -> Dict:
    """
    Run WhisperX diarization on video file.

    Args:
        video_path: Path to video file
        model_size: Whisper model size (tiny, base, c, medium)
        language: Language code (auto, en, fr, etc.)
        device: Device to run on (cuda or cpu)

    Returns:
        Diarization result dictionary

    Raises:
        RuntimeError: If diarization fails
    """
    hf_token = os.environ.get('HF_TOKEN')
    if not hf_token:
        raise RuntimeError(
            "HF_TOKEN environment variable is required for pyannote diarization. "
            "Get your token at https://huggingface.co/settings/tokens"
        )

    # Check if CUDA is available
    if device == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA not available, falling back to CPU")
        device = "cpu"

    logger.info(f"[1/6] Loading Whisper model '{model_size}' on {device}...")
    logger.info(f"      (This may take a minute on first run)")

    try:
        # Load Whisper model
        model = whisperx.load_model(
            model_size,
            device,
            compute_type="float16" if device == "cuda" else "int8"
        )
        logger.info(f"      ✓ Model loaded successfully")

        # Load audio
        logger.info(f"[2/6] Loading audio from {video_path.name}...")
        audio = whisperx.load_audio(str(video_path))
        logger.info(f"      ✓ Audio loaded ({len(audio)/16000:.1f}s duration)")

        # Transcribe
        logger.info(f"[3/6] Transcribing audio...")
        if language == "auto":
            logger.info(f"      (Auto-detecting language - this may take longer)")
        result = model.transcribe(
            audio,
            batch_size=16 if device == "cuda" else 4,
            language=None if language == "auto" else language
        )
        detected_lang = result.get("language", "unknown")
        logger.info(f"      ✓ Transcription complete (language: {detected_lang})")

        # Align timestamps
        logger.info(f"[4/6] Aligning timestamps...")
        model_a, metadata = whisperx.load_align_model(
            language_code=result["language"],
            device=device
        )
        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device
        )
        logger.info(f"      ✓ Timestamps aligned")

        # Diarize
        logger.info(f"[5/6] Running speaker diarization...")
        logger.info(f"      (Loading pyannote models - this may take a minute)")
        diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=hf_token,
            device=device
        )
        logger.info(f"      (Analyzing speakers in audio...)")
        diarize_segments = diarize_model(audio)
        logger.info(f"      ✓ Speaker diarization complete")

        # Assign speakers to words
        logger.info(f"[6/6] Assigning speakers to transcribed words...")
        result = whisperx.assign_word_speakers(diarize_segments, result)
        logger.info(f"      ✓ Speaker assignment complete")

        logger.info("✓ All processing steps completed successfully!")
        return result

    except Exception as e:
        logger.error(f"Diarization failed: {e}")
        raise RuntimeError(f"Diarization failed: {e}")


def extract_segments(diarization_result: Dict) -> List[Dict]:
    """
    Extract clean speaker segments from diarization result.

    Args:
        diarization_result: Result from run_diarization

    Returns:
        List of segments with speaker, t0, t1 in milliseconds
    """
    segments = []

    for segment in diarization_result.get('segments', []):
        speaker = segment.get('speaker')
        if not speaker:
            continue

        start = segment.get('start', 0)
        end = segment.get('end', 0)

        # Convert to milliseconds
        t0 = int(start * 1000)
        t1 = int(end * 1000)

        # Ensure t1 > t0
        if t1 <= t0:
            logger.warning(f"Skipping invalid segment: t0={t0}, t1={t1}")
            continue

        segments.append({
            'speaker': speaker,
            't0': t0,
            't1': t1
        })

    logger.info(f"Extracted {len(segments)} valid segments")
    return segments


def generate_output_json(
    video_path: Path,
    segments: List[Dict],
    duration_ms: int
) -> Dict:
    """
    Generate final JSON output according to schema.

    Args:
        video_path: Path to video file
        segments: List of segment dicts
        duration_ms: Video duration in milliseconds

    Returns:
        Complete JSON structure
    """
    lane_map, speakers = assign_lanes(segments)

    return {
        'version': 1,
        'video': {
            'src': video_path.name,
            'durationMs': duration_ms
        },
        'speakers': speakers,
        'segments': segments,
        'laneMap': lane_map
    }


def get_video_files(directory: Path) -> List[Path]:
    """
    Get all video files from a directory.

    Args:
        directory: Directory to scan for video files

    Returns:
        List of video file paths
    """
    video_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v'}
    video_files = []

    if not directory.exists():
        logger.warning(f"Directory does not exist: {directory}")
        return video_files

    for file_path in directory.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in video_extensions:
            video_files.append(file_path)

    return sorted(video_files)


def process_video(
    video_path: Path,
    output_dir: Path,
    model_size: str,
    language: str,
    device: str
) -> bool:
    """
    Process a single video file.

    Args:
        video_path: Path to video file
        output_dir: Output directory for JSON
        model_size: Whisper model size
        language: Language code
        device: Device to run on

    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f"\n{'='*60}")
        logger.info(f"Processing: {video_path.name}")
        logger.info(f"{'='*60}")

        # Get video duration
        logger.info("Getting video duration...")
        duration_ms = get_video_duration_ms(video_path)

        # Run diarization
        logger.info(f"Starting diarization (device: {device})...")
        diarization_result = run_diarization(
            video_path,
            model_size=model_size,
            language=language,
            device=device
        )

        # Extract segments
        logger.info("Extracting segments...")
        segments = extract_segments(diarization_result)

        if not segments:
            logger.error("No speaker segments found in video")
            return False

        # Generate output JSON
        logger.info("Generating output JSON...")
        output_data = generate_output_json(video_path, segments, duration_ms)

        # Write output file
        output_filename = video_path.stem + '.json'
        output_path = output_dir / output_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        logger.info(f"✓ Successfully wrote output to {output_path}")
        logger.info(f"✓ Found {len(output_data['speakers'])} speakers, "
                   f"{len(segments)} segments")

        return True

    except Exception as e:
        logger.error(f"✗ Failed to process {video_path.name}: {e}", exc_info=True)
        return False


def main():
    """Main CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description='Run speaker diarization on video files for rythmo-impro'
    )
    parser.add_argument(
        '--input-dir',
        default='../in',
        help='Input directory containing video files (default: ../in)'
    )
    parser.add_argument(
        '--output-dir',
        default='../out',
        help='Output directory for JSON files (default: ../out)'
    )
    parser.add_argument(
        '--model',
        choices=['tiny', 'base', 'small', 'medium'],
        default='medium',
        help='Whisper model size (default: small)'
    )
    parser.add_argument(
        '--language',
        default='auto',
        help='Language code (default: auto). Examples: en, fr, es'
    )

    args = parser.parse_args()

    try:
        # Resolve directories relative to script location
        script_dir = Path(__file__).parent
        input_dir = (script_dir / args.input_dir).resolve()
        output_dir = (script_dir / args.output_dir).resolve()

        logger.info(f"Input directory: {input_dir}")
        logger.info(f"Output directory: {output_dir}")

        # Get all video files
        logger.info("\nScanning for video files...")
        video_files = get_video_files(input_dir)

        if not video_files:
            logger.error(f"No video files found in {input_dir}")
            sys.exit(1)

        logger.info(f"\nFound {len(video_files)} video file(s):")
        for i, video_file in enumerate(video_files, 1):
            logger.info(f"  {i}. {video_file.name}")

        # Ask for confirmation
        response = input(f"\nProcess all {len(video_files)} video(s)? [Y/n]: ").strip().lower()
        if response and response not in ['y', 'yes']:
            logger.info("Operation cancelled by user")
            sys.exit(0)

        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)

        # Determine device
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"\nUsing device: {device}")

        # Process all videos
        results = []
        for i, video_path in enumerate(video_files, 1):
            logger.info(f"\n[{i}/{len(video_files)}] Processing video...")
            success = process_video(
                video_path,
                output_dir,
                model_size=args.model,
                language=args.language,
                device=device
            )
            results.append((video_path.name, success))

        # Summary
        logger.info(f"\n{'='*60}")
        logger.info("PROCESSING COMPLETE")
        logger.info(f"{'='*60}")
        successful = sum(1 for _, success in results if success)
        logger.info(f"Successfully processed: {successful}/{len(results)}")

        if successful < len(results):
            logger.info("\nFailed videos:")
            for name, success in results:
                if not success:
                    logger.info(f"  ✗ {name}")

        sys.exit(0 if successful == len(results) else 1)

    except KeyboardInterrupt:
        logger.info("\nOperation cancelled by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
