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

import torch

# PyTorch 2.8+ compatibility fix for WhisperX/pyannote model loading
# Register all required classes as safe globals for torch.load
try:
    import typing
    import collections
    import collections.abc
    import omegaconf
    from torch.torch_version import TorchVersion
    from omegaconf import OmegaConf
    # Import from actual module paths (required for PyTorch unpickler to find them)
    from omegaconf.dictconfig import DictConfig
    from omegaconf.listconfig import ListConfig
    from omegaconf.basecontainer import BaseContainer
    from omegaconf.base import (
        Container,
        Node,
        ContainerMetadata,
        Metadata,          # Parent class of ContainerMetadata, used in model serialization
        Box,               # Base class for nodes containing other nodes
        SCMode,            # Structured config conversion mode enum
        UnionNode,         # Union type handler
    )
    from omegaconf.nodes import ValueNode, StringNode, IntegerNode, FloatNode, BooleanNode

    # Add all required classes
    safe_globals = [
        # Built-in types
        list,
        dict,
        tuple,
        set,
        frozenset,
        str,
        int,
        float,
        bool,
        bytes,
        bytearray,
        type(None),
        # PyTorch internal types
        TorchVersion,      # PyTorch version info stored in model checkpoints
        # Collections types
        collections.OrderedDict,
        collections.defaultdict,
        collections.Counter,
        collections.deque,
        collections.namedtuple,
        collections.ChainMap,
        # OmegaConf classes
        DictConfig,
        ListConfig,
        BaseContainer,     # Parent class of DictConfig and ListConfig
        Container,
        Node,
        ContainerMetadata,
        Metadata,          # NEW: Base metadata class for all nodes
        Box,               # NEW: Base class for container nodes
        SCMode,            # NEW: Structured config mode enum
        UnionNode,         # NEW: Union type handler
        ValueNode,
        StringNode,
        IntegerNode,
        FloatNode,
        BooleanNode,
        # Typing classes
        typing.Any,
        typing.Dict,
        typing.List,
        typing.Tuple,
        typing.Union,
        typing.Optional,
    ]

    # Add any other OmegaConf types
    for attr_name in dir(omegaconf):
        attr = getattr(omegaconf, attr_name)
        if isinstance(attr, type) and attr not in safe_globals:
            safe_globals.append(attr)

    torch.serialization.add_safe_globals(safe_globals)
except (ImportError, Exception) as e:
    # If safe globals registration fails, warn but continue
    # (allows code to work with older PyTorch versions)
    import sys
    print(f"Warning: Failed to register safe globals: {e}", file=sys.stderr)

import whisperx
from whisperx.diarize import DiarizationPipeline, assign_word_speakers
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
    device: str = "cuda",
    min_speakers: int = None,
    max_speakers: int = None,
    clustering_threshold: float = None
) -> Dict:
    """
    Run WhisperX diarization on video file.

    Args:
        video_path: Path to video file
        model_size: Whisper model size (tiny, base, small, medium, large, large-v2, large-v3)
        language: Language code (auto, en, fr, etc.)
        device: Device to run on (cuda or cpu)
        min_speakers: Minimum number of speakers (None = auto-detect)
        max_speakers: Maximum number of speakers (None = auto-detect)
        clustering_threshold: Pyannote clustering threshold (0.0-2.0, None = auto)
            Higher values → fewer speakers (more merging)
            Lower values → more speakers (more fragmentation)

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
        diarize_model = DiarizationPipeline(
            use_auth_token=hf_token,
            device=device
        )
        logger.info(f"      (Analyzing speakers in audio...)")

        # Build diarization kwargs
        diarize_kwargs = {}

        # Strategy 1: Use num_speakers if min==max (forces exact count)
        if min_speakers is not None and max_speakers is not None and min_speakers == max_speakers:
            diarize_kwargs['num_speakers'] = min_speakers
            logger.info(f"      Forcing exactly {min_speakers} speakers (num_speakers)")
        else:
            # Strategy 2: Use min/max range
            if min_speakers is not None:
                diarize_kwargs['min_speakers'] = min_speakers
                logger.info(f"      Minimum speakers: {min_speakers}")
            if max_speakers is not None:
                diarize_kwargs['max_speakers'] = max_speakers
                logger.info(f"      Maximum speakers: {max_speakers}")

        if clustering_threshold is not None:
            diarize_kwargs['clustering_threshold'] = clustering_threshold
            logger.info(f"      Attempting clustering threshold: {clustering_threshold}")

        if not diarize_kwargs:
            logger.info(f"      Auto-detecting speakers with default settings")

        try:
            diarize_segments = diarize_model(audio, **diarize_kwargs)
            logger.info(f"      ✓ Speaker diarization complete")
        except TypeError as e:
            # Clustering threshold might not be supported in this WhisperX version
            if clustering_threshold is not None and 'clustering_threshold' in str(e):
                logger.warning(f"      ⚠ Clustering threshold not supported by this WhisperX version")
                logger.warning(f"      Try upgrading WhisperX or use min/max speakers to constrain detection")
                diarize_kwargs.pop('clustering_threshold', None)
                diarize_segments = diarize_model(audio, **diarize_kwargs)
                logger.info(f"      ✓ Speaker diarization complete (without clustering parameter)")
            else:
                raise

        # Assign speakers to words
        logger.info(f"[6/6] Assigning speakers to transcribed words...")
        result = assign_word_speakers(diarize_segments, result)
        logger.info(f"      ✓ Speaker assignment complete")

        logger.info("✓ All processing steps completed successfully!")
        return result

    except Exception as e:
        logger.error(f"Diarization failed: {e}")
        raise RuntimeError(f"Diarization failed: {e}")


def extract_segments(
    diarization_result: Dict,
    silence_threshold_sec: float = 0.3,
    merge_gap_sec: float = 0.1,
    min_duration_sec: float = 0.2,
    min_word_confidence: float = 0.5
) -> List[Dict]:
    """
    Extract refined speaker segments using word-level timestamps.

    This function leverages precise word-level timestamps from WhisperX to:
    - Tighten segment boundaries using first/last word timestamps
    - Split segments on long internal silences (word gaps)
    - Filter very short segments (likely noise)
    - Merge adjacent same-speaker segments with small gaps
    - Skip segments without words (silence periods)
    - Filter low-confidence words (hallucinations in silence)

    Processing phases:
    1. Word-level extraction with silence splitting
    2. Filter short segments
    3. Merge adjacent same-speaker segments
    4. Convert to milliseconds and validate

    Args:
        diarization_result: Result from run_diarization() containing:
            - segments[i]['words'] = list of word dicts with:
                - word: str (word text)
                - start: float (seconds)
                - end: float (seconds)
                - score: float (alignment confidence, 0.0-1.0)
                - speaker: str (e.g., "SPEAKER_00")

        silence_threshold_sec: Split segments when word gap >= this value.
            Default 0.3s. Increase to allow longer natural pauses.

        merge_gap_sec: Merge adjacent same-speaker segments when gap < this.
            Default 0.1s. Use 0.0 to disable merging entirely.

        min_duration_sec: Filter segments shorter than this duration.
            Default 0.2s. Use 0.0 to keep all segments.

        min_word_confidence: Filter words with confidence score below this.
            Default 0.5. Helps remove hallucinated words in silence.

    Returns:
        List of segment dicts with keys:
            - speaker: str (e.g., "SPEAKER_00")
            - t0: int (start time in milliseconds)
            - t1: int (end time in milliseconds)

    Edge cases handled:
        - Segments without words: Skipped entirely (no bars in silence)
        - Words without speaker: Skipped (logged at debug level)
        - Low-confidence words: Skipped (likely hallucinations)
        - Mid-segment speaker changes: Creates separate segments
        - Invalid timestamps (t1 <= t0): Filtered with warning
    """

    # PHASE 1: Word-level extraction with silence splitting
    # ======================================================
    # Process each segment's words array to get precise boundaries.
    # This replaces the old approach which only looked at segment start/end.
    # Benefits:
    # - Tighter boundaries (first/last word instead of segment padding)
    # - Detects speaker changes within segments
    # - Enables silence-based splitting

    raw_segments = []

    for seg in diarization_result.get('segments', []):
        words = seg.get('words', [])

        # SKIP segments without words - these are likely silence or noise
        # We only create segments where there are actual transcribed words
        if not words:
            logger.debug(f"Skipping segment at {seg.get('start', 0):.2f}s - no words detected "
                       f"(likely silence or non-speech audio)")
            continue

        # Group consecutive words by speaker, splitting on speaker changes and long silences
        current_group = []

        for word in words:
            speaker = word.get('speaker')

            # Skip words without speaker assignment
            if not speaker:
                logger.debug(f"Word '{word.get('word', '?')}' at "
                           f"{word.get('start', 0):.2f}s has no speaker, skipping")
                continue

            # Skip words without valid timestamps
            if 'start' not in word or 'end' not in word:
                logger.debug(f"Word '{word.get('word', '?')}' missing timestamps, skipping")
                continue

            # Skip low-confidence words (likely hallucinations in silence)
            # WhisperX provides a 'score' field for alignment confidence
            confidence = word.get('score', 1.0)
            if confidence < 0.5:
                logger.debug(f"Skipping low-confidence word '{word.get('word', '?')}' "
                           f"(confidence: {confidence:.2f}) - likely silence/noise")
                continue

            # Check for speaker change
            if current_group and current_group[0].get('speaker') != speaker:
                # Speaker changed: emit current group and start new one
                raw_segments.append(_words_to_segment(current_group))
                logger.debug(f"Speaker change detected, splitting segment")
                current_group = []

            # Check for long silence WITHIN same speaker
            if current_group:
                gap_sec = word['start'] - current_group[-1]['end']

                if gap_sec >= silence_threshold_sec:
                    # Long silence: emit current group and start new one
                    raw_segments.append(_words_to_segment(current_group))
                    logger.debug(f"Long silence ({gap_sec:.2f}s) detected, splitting segment")
                    current_group = []

            current_group.append(word)

        # Emit final group for this segment
        if current_group:
            raw_segments.append(_words_to_segment(current_group))

    logger.info(f"Phase 1: Extracted {len(raw_segments)} raw segments from word-level data")


    # PHASE 2: Filter short segments
    # ===============================
    # Remove segments below minimum duration threshold
    # This helps eliminate noise, filler artifacts, and extremely brief utterances

    filtered_segments = []
    filtered_count = 0

    for seg in raw_segments:
        duration_sec = seg['t1_sec'] - seg['t0_sec']

        if duration_sec < min_duration_sec:
            filtered_count += 1
            logger.debug(f"Filtered short segment: {duration_sec:.2f}s < {min_duration_sec}s "
                       f"(speaker {seg['speaker']})")
            continue

        filtered_segments.append(seg)

    if filtered_count > 0:
        logger.info(f"Phase 2: Filtered {filtered_count} short segments "
                   f"(< {min_duration_sec}s), {len(filtered_segments)} remaining")
    else:
        logger.info(f"Phase 2: No short segments filtered, {len(filtered_segments)} remaining")


    # PHASE 3: Merge adjacent same-speaker segments
    # ==============================================
    # Consolidate fragments by merging same-speaker segments with small gaps
    # This addresses the major fragmentation issue (85% of gaps are <500ms)

    merged_segments = []
    merge_count = 0

    for seg in filtered_segments:
        # Try to merge with previous segment
        if merged_segments and merged_segments[-1]['speaker'] == seg['speaker']:
            gap_sec = seg['t0_sec'] - merged_segments[-1]['t1_sec']

            if gap_sec < merge_gap_sec:
                # Merge: extend previous segment to current end
                merged_segments[-1]['t1_sec'] = seg['t1_sec']
                merge_count += 1
                logger.debug(f"Merged segments with {gap_sec*1000:.0f}ms gap "
                           f"(speaker {seg['speaker']})")
                continue

        # No merge: add as new segment
        merged_segments.append(seg)

    if merge_count > 0:
        logger.info(f"Phase 3: Merged {merge_count} adjacent same-speaker segments, "
                   f"{len(merged_segments)} remaining")
    else:
        logger.info(f"Phase 3: No segments merged, {len(merged_segments)} remaining")


    # PHASE 4: Convert to milliseconds and validate
    # ==============================================
    # Final conversion to output format with validation

    final_segments = []
    invalid_count = 0

    for seg in merged_segments:
        t0 = int(seg['t0_sec'] * 1000)
        t1 = int(seg['t1_sec'] * 1000)

        # Ensure t1 > t0
        if t1 <= t0:
            logger.warning(f"Skipping invalid segment: t0={t0}, t1={t1} "
                         f"(speaker {seg['speaker']})")
            invalid_count += 1
            continue

        final_segments.append({
            'speaker': seg['speaker'],
            't0': t0,
            't1': t1
        })

    # Summary logging
    logger.info(f"Phase 4: Extracted {len(final_segments)} final segments "
               f"(from {len(raw_segments)} raw → {len(filtered_segments)} filtered → "
               f"{len(merged_segments)} merged)")

    if invalid_count > 0:
        logger.warning(f"Filtered {invalid_count} invalid segments (t1 <= t0)")

    return final_segments


def _words_to_segment(words: List[Dict]) -> Dict:
    """
    Convert a list of consecutive words (same speaker) to a segment.

    Uses first word start and last word end for precise boundaries.
    This helper function is used during Phase 1 word-level extraction.

    Args:
        words: List of word dicts with speaker, start, end fields

    Returns:
        Segment dict with speaker, t0_sec, t1_sec, from_words flag

    Raises:
        ValueError: If words list is empty
    """
    if not words:
        raise ValueError("Cannot create segment from empty word list")

    speaker = words[0]['speaker']
    t0_sec = words[0]['start']
    t1_sec = words[-1]['end']

    return {
        'speaker': speaker,
        't0_sec': t0_sec,
        't1_sec': t1_sec,
        'from_words': True,
        'word_count': len(words)
    }


def format_srt_timestamp(seconds: float) -> str:
    """
    Convert seconds to SRT timestamp format (HH:MM:SS,mmm).

    Args:
        seconds: Time in seconds

    Returns:
        Formatted timestamp string
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)

    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def generate_srt(diarization_result: Dict, output_path: Path) -> None:
    """
    Generate SRT subtitle file from diarization result.

    Shows all detected words with speaker labels and confidence scores.
    Useful for auditing what WhisperX detected and debugging issues.

    Args:
        diarization_result: Result from run_diarization with word-level data
        output_path: Path to write SRT file
    """
    srt_lines = []
    subtitle_index = 1

    for seg in diarization_result.get('segments', []):
        words = seg.get('words', [])

        if not words:
            continue

        # Group words into subtitle chunks (max ~5 words or 3 seconds per subtitle)
        current_chunk = []
        chunk_start = None

        for word in words:
            if 'start' not in word or 'end' not in word:
                continue

            word_text = word.get('word', '').strip()
            if not word_text:
                continue

            # Start new chunk if needed
            if chunk_start is None:
                chunk_start = word['start']

            current_chunk.append(word)

            # End chunk if we have 5 words or 3+ seconds elapsed
            chunk_duration = word['end'] - chunk_start
            if len(current_chunk) >= 5 or chunk_duration >= 3.0:
                # Write chunk to SRT
                chunk_end = word['end']

                # Format text with speaker and confidence
                speaker = current_chunk[0].get('speaker', 'UNKNOWN')
                words_text = ' '.join(w.get('word', '').strip() for w in current_chunk)
                avg_confidence = sum(w.get('score', 1.0) for w in current_chunk) / len(current_chunk)

                subtitle_text = f"[{speaker}] {words_text}"
                if avg_confidence < 0.8:
                    subtitle_text += f" (conf: {avg_confidence:.2f})"

                # Write SRT entry
                srt_lines.append(f"{subtitle_index}")
                srt_lines.append(f"{format_srt_timestamp(chunk_start)} --> {format_srt_timestamp(chunk_end)}")
                srt_lines.append(subtitle_text)
                srt_lines.append("")  # Blank line between entries

                subtitle_index += 1
                current_chunk = []
                chunk_start = None

        # Write remaining words in chunk
        if current_chunk:
            chunk_start = current_chunk[0]['start']
            chunk_end = current_chunk[-1]['end']

            speaker = current_chunk[0].get('speaker', 'UNKNOWN')
            words_text = ' '.join(w.get('word', '').strip() for w in current_chunk)
            avg_confidence = sum(w.get('score', 1.0) for w in current_chunk) / len(current_chunk)

            subtitle_text = f"[{speaker}] {words_text}"
            if avg_confidence < 0.8:
                subtitle_text += f" (conf: {avg_confidence:.2f})"

            srt_lines.append(f"{subtitle_index}")
            srt_lines.append(f"{format_srt_timestamp(chunk_start)} --> {format_srt_timestamp(chunk_end)}")
            srt_lines.append(subtitle_text)
            srt_lines.append("")

            subtitle_index += 1

    # Write to file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_lines))

    logger.info(f"✓ Generated SRT subtitle file: {output_path}")
    logger.info(f"  {subtitle_index - 1} subtitle entries created")


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
    device: str,
    min_speakers: int = None,
    max_speakers: int = None,
    silence_threshold_sec: float = 0.3,
    merge_gap_sec: float = 0.1,
    min_duration_sec: float = 0.2,
    clustering_threshold: float = None
) -> bool:
    """
    Process a single video file.

    Args:
        video_path: Path to video file
        output_dir: Output directory for JSON
        model_size: Whisper model size
        language: Language code
        device: Device to run on
        min_speakers: Minimum number of speakers
        max_speakers: Maximum number of speakers
        silence_threshold_sec: Silence split threshold in seconds
        merge_gap_sec: Merge gap threshold in seconds
        min_duration_sec: Minimum segment duration in seconds
        clustering_threshold: Pyannote clustering threshold (0.0-2.0)

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
            device=device,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            clustering_threshold=clustering_threshold
        )

        # Extract segments with word-level processing
        logger.info("Extracting segments with word-level processing...")
        segments = extract_segments(
            diarization_result,
            silence_threshold_sec=silence_threshold_sec,
            merge_gap_sec=merge_gap_sec,
            min_duration_sec=min_duration_sec,
            min_word_confidence=0.5  # Filter hallucinated words in silence
        )

        if not segments:
            logger.error("No speaker segments found in video")
            return False

        # Generate output JSON
        logger.info("Generating output JSON...")
        output_data = generate_output_json(video_path, segments, duration_ms)

        # Write JSON output file
        output_filename = video_path.stem + '.json'
        output_path = output_dir / output_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        logger.info(f"✓ Successfully wrote output to {output_path}")
        logger.info(f"✓ Found {len(output_data['speakers'])} speakers, "
                   f"{len(segments)} segments")

        # Generate SRT subtitle file for auditing
        logger.info("Generating SRT subtitle file for auditing...")
        srt_filename = video_path.stem + '.srt'
        srt_path = output_dir / srt_filename
        generate_srt(diarization_result, srt_path)

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
        choices=['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'],
        default='medium',
        help='Whisper model size (default: medium). large-v3 is most accurate but slowest'
    )
    parser.add_argument(
        '--language',
        default='auto',
        help='Language code (default: auto). Examples: en, fr, es'
    )
    parser.add_argument(
        '--min-speakers',
        type=int,
        default=None,
        help='Minimum number of speakers (default: auto-detect). Helps improve accuracy when you know the expected range.'
    )
    parser.add_argument(
        '--max-speakers',
        type=int,
        default=None,
        help='Maximum number of speakers (default: auto-detect). Helps improve accuracy when you know the expected range.'
    )

    # Segment quality tuning parameters (word-level processing)
    segment_group = parser.add_argument_group(
        'Segment Quality Tuning',
        'Fine-tune segment boundaries and filtering using word-level timestamps'
    )
    segment_group.add_argument(
        '--silence-threshold',
        type=float,
        default=0.3,
        help='Split segments on word gaps >= this value in seconds (default: 0.3). '
             'Increase to allow longer natural pauses within a segment.'
    )
    segment_group.add_argument(
        '--merge-gap',
        type=float,
        default=0.1,
        help='Merge adjacent same-speaker segments with gaps < this value in seconds (default: 0.1). '
             'Increase to be more aggressive in consolidating fragmented speech. '
             'Use 0.0 to disable merging entirely.'
    )
    segment_group.add_argument(
        '--min-duration',
        type=float,
        default=0.2,
        help='Filter segments shorter than this duration in seconds (default: 0.2). '
             'Helps remove filler words and noise. '
             'Use 0.0 to keep all segments.'
    )

    # Speaker clustering parameters
    clustering_group = parser.add_argument_group(
        'Speaker Clustering',
        'Adjust speaker identification sensitivity (reduce fragmentation/merging)'
    )
    clustering_group.add_argument(
        '--clustering-threshold',
        type=float,
        default=None,
        help='Pyannote clustering threshold (range: 0.0-2.0). '
             'Higher values → fewer speakers (more aggressive merging). '
             'Lower values → more speakers (more fragmentation). '
             'Default: auto (pyannote model default ~0.7)'
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
                device=device,
                min_speakers=args.min_speakers,
                max_speakers=args.max_speakers,
                silence_threshold_sec=args.silence_threshold,
                merge_gap_sec=args.merge_gap,
                min_duration_sec=args.min_duration,
                clustering_threshold=args.clustering_threshold
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
