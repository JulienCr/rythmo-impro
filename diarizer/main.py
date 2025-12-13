#!/usr/bin/env python3
"""
Speaker Diarization CLI for rythmo-impro
Uses WhisperX + pyannote to identify who speaks when in video files.
"""

import argparse
import gc
import json
import logging
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import psutil
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
# Set root logger to WARNING to suppress noisy third-party library logs
logging.basicConfig(
    level=logging.WARNING,
    format='%(message)s'  # Clean format without timestamps for third-party warnings
)

# Configure our logger with cleaner format
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Add handler with nice formatting for our logs
handler = logging.StreamHandler()
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.propagate = False  # Don't propagate to root logger

# Suppress noisy third-party loggers
logging.getLogger('whisperx').setLevel(logging.ERROR)
logging.getLogger('whisperx.asr').setLevel(logging.ERROR)
logging.getLogger('whisperx.vads').setLevel(logging.ERROR)
logging.getLogger('whisperx.diarize').setLevel(logging.ERROR)
logging.getLogger('pyannote').setLevel(logging.ERROR)
logging.getLogger('pyannote.audio').setLevel(logging.ERROR)
logging.getLogger('speechbrain').setLevel(logging.ERROR)
logging.getLogger('lightning').setLevel(logging.ERROR)
logging.getLogger('lightning_fabric').setLevel(logging.ERROR)

# Suppress specific warnings and info messages
import warnings
warnings.filterwarnings('ignore', category=UserWarning)
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', message='.*torchaudio.*')
warnings.filterwarnings('ignore', message='.*TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD.*')
warnings.filterwarnings('ignore', message='.*Model was trained with.*')
warnings.filterwarnings('ignore', message='.*Lightning automatically upgraded.*')
warnings.filterwarnings('ignore', message='.*Registered checkpoint.*')

# Also suppress these at the logging level
logging.getLogger('pytorch_lightning').setLevel(logging.ERROR)
logging.getLogger('lightning.pytorch').setLevel(logging.ERROR)


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


# Memory requirements for Whisper models (in GB)
MODEL_MEMORY_REQUIREMENTS = {
    'tiny': 1.0,
    'base': 1.5,
    'small': 2.5,
    'medium': 5.0,
    'large': 10.0,
    'large-v2': 10.0,
    'large-v3': 10.0,
}
DIARIZATION_MEMORY_GB = 2.0  # pyannote pipeline
ALIGNMENT_MEMORY_GB = 1.0     # per language


class ModelManager:
    """
    Manages model lifecycle for batch video processing.

    Loads models once, reuses across videos, handles cleanup.
    This prevents memory leaks when processing multiple videos sequentially.
    """

    def __init__(self, device: str, model_size: str, hf_token: str):
        """
        Initialize ModelManager.

        Args:
            device: Device to run models on ('cuda' or 'cpu')
            model_size: Whisper model size (tiny, base, small, medium, large, etc.)
            hf_token: Hugging Face token for pyannote models
        """
        self.device = device
        self.model_size = model_size
        self.hf_token = hf_token

        # Model instances (loaded lazily)
        self.whisper_model = None
        self.diarize_model = None
        self.alignment_models = {}  # Cache by language code

        # Memory tracking
        self.initial_memory = None

    def _check_available_memory(self, required_gb: float) -> None:
        """
        Check if sufficient memory is available before loading models.

        Args:
            required_gb: Estimated memory requirement in GB

        Raises:
            RuntimeError: If insufficient memory
        """
        if self.device == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA requested but not available")

            # Check GPU memory
            free_memory = torch.cuda.get_device_properties(0).total_memory
            allocated = torch.cuda.memory_allocated(0)
            available_gb = (free_memory - allocated) / 1e9

            if available_gb < required_gb:
                raise RuntimeError(
                    f"Insufficient GPU memory: {available_gb:.2f}GB available, "
                    f"{required_gb:.2f}GB required"
                )

            logger.debug(f"GPU memory check: {available_gb:.2f}GB available "
                        f"(need {required_gb:.2f}GB)")
        else:
            # Check system RAM
            mem = psutil.virtual_memory()
            available_gb = mem.available / 1e9

            if available_gb < required_gb:
                raise RuntimeError(
                    f"Insufficient RAM: {available_gb:.2f}GB available, "
                    f"{required_gb:.2f}GB required"
                )

            logger.debug(f"RAM check: {available_gb:.2f}GB available "
                        f"(need {required_gb:.2f}GB)")

    def load_whisper_model(self) -> None:
        """Load WhisperX model once."""
        if self.whisper_model is not None:
            logger.debug("WhisperX model already loaded, reusing...")
            return

        # Check memory before loading
        required_gb = MODEL_MEMORY_REQUIREMENTS.get(self.model_size, 10.0)
        self._check_available_memory(required_gb)

        logger.info(f"Loading Whisper model ({self.model_size})...")
        self.whisper_model = whisperx.load_model(
            self.model_size,
            self.device,
            compute_type="float16" if self.device == "cuda" else "int8"
        )
        logger.info(f"   ✓ Whisper ready")

    def load_diarization_model(self) -> None:
        """Load pyannote diarization pipeline once."""
        if self.diarize_model is not None:
            logger.debug("Diarization model already loaded, reusing...")
            return

        # Check memory before loading
        self._check_available_memory(DIARIZATION_MEMORY_GB)

        logger.info(f"Loading speaker diarization model...")
        self.diarize_model = DiarizationPipeline(
            use_auth_token=self.hf_token,
            device=self.device
        )
        logger.info(f"   ✓ Diarization ready")

    def get_alignment_model(self, language_code: str) -> Tuple:
        """
        Get or load alignment model for language (cached).

        Args:
            language_code: Language code (e.g., 'en', 'fr')

        Returns:
            Tuple of (model, metadata)
        """
        if language_code in self.alignment_models:
            logger.debug(f"Using cached alignment model for language '{language_code}'")
            return self.alignment_models[language_code]

        # Check memory before loading
        self._check_available_memory(ALIGNMENT_MEMORY_GB)

        logger.debug(f"Loading alignment model for language '{language_code}'...")
        model, metadata = whisperx.load_align_model(
            language_code=language_code,
            device=self.device
        )
        self.alignment_models[language_code] = (model, metadata)
        logger.debug(f"Alignment model loaded and cached")

        return model, metadata

    def cleanup_alignment_model(self, language_code: str) -> None:
        """
        Remove alignment model from cache to free memory.

        Args:
            language_code: Language code to remove
        """
        if language_code in self.alignment_models:
            model, metadata = self.alignment_models[language_code]
            if self.device == "cuda" and hasattr(model, 'to'):
                model = model.to('cpu')
            del model
            del metadata
            del self.alignment_models[language_code]
            logger.info(f"  ✓ Alignment model ({language_code}) unloaded")

    def cleanup_all(self) -> None:
        """Unload all models and clear GPU cache."""
        # Cleanup WhisperX model
        if self.whisper_model is not None:
            # WhisperX FasterWhisperPipeline doesn't have .to() method
            # Just delete the reference and let garbage collection handle it
            del self.whisper_model
            self.whisper_model = None
            logger.info("   ✓ Whisper unloaded")

        # Cleanup diarization model
        if self.diarize_model is not None:
            if self.device == "cuda" and hasattr(self.diarize_model, 'to'):
                self.diarize_model = self.diarize_model.to('cpu')
            del self.diarize_model
            self.diarize_model = None
            logger.info("   ✓ Diarization unloaded")

        # Cleanup alignment models
        for lang, (model, metadata) in list(self.alignment_models.items()):
            if self.device == "cuda" and hasattr(model, 'to'):
                model = model.to('cpu')
            del model
            del metadata
            logger.debug(f"Alignment model ({lang}) unloaded")
        self.alignment_models.clear()

        # Clear GPU cache
        if self.device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            logger.info("   ✓ GPU cache cleared")

        # Python garbage collection
        gc.collect()
        logger.debug("Python garbage collection completed")

    def log_memory_stats(self, label: str) -> None:
        """
        Log current memory usage.

        Args:
            label: Label for this memory snapshot
        """
        # System memory
        mem = psutil.virtual_memory()
        logger.info(f"📊 Memory [{label}]")
        logger.info(f"   RAM: {mem.used / 1e9:.1f}GB / {mem.total / 1e9:.1f}GB ({mem.percent:.0f}%)")

        # GPU memory (if CUDA)
        if self.device == "cuda" and torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                allocated = torch.cuda.memory_allocated(i) / 1e9
                reserved = torch.cuda.memory_reserved(i) / 1e9
                logger.info(f"   GPU {i}: {allocated:.1f}GB allocated, {reserved:.1f}GB reserved")


def run_diarization(
    video_path: Path,
    model_size: str = "small",
    language: str = "auto",
    device: str = "cuda",
    min_speakers: int = None,
    max_speakers: int = None,
    clustering_threshold: float = None,
    whisper_model = None,
    diarize_model = None,
    alignment_models: Optional[Dict] = None,
    reuse_models: bool = False
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
        whisper_model: Pre-loaded WhisperX model (optional, for batch processing)
        diarize_model: Pre-loaded pyannote diarization model (optional, for batch processing)
        alignment_models: Dict of language code to (model, metadata) tuples (optional)
        reuse_models: If True, don't cleanup models after processing (for batch mode)

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

    # Track if models were loaded internally (for cleanup)
    model_loaded_internally = whisper_model is None
    alignment_model_loaded_internally = False
    diarize_model_loaded_internally = diarize_model is None

    try:
        # Load Whisper model (or use pre-loaded)
        if whisper_model is None:
            logger.info(f"[1/6] Loading Whisper model '{model_size}' on {device}...")
            logger.info(f"      (This may take a minute on first run)")
            model = whisperx.load_model(
                model_size,
                device,
                compute_type="float16" if device == "cuda" else "int8"
            )
            logger.info(f"      ✓ Model loaded successfully")
        else:
            logger.info(f"[1/6] Using pre-loaded Whisper model '{model_size}'...")
            model = whisper_model

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

        # Align timestamps (use cached if available)
        logger.info(f"[4/6] Aligning timestamps...")
        if alignment_models is not None and detected_lang in alignment_models:
            logger.info(f"      Using cached alignment model for '{detected_lang}'")
            model_a, metadata = alignment_models[detected_lang]
        else:
            model_a, metadata = whisperx.load_align_model(
                language_code=result["language"],
                device=device
            )
            # Cache the model if alignment_models dict is provided
            if alignment_models is not None:
                alignment_models[detected_lang] = (model_a, metadata)
                logger.info(f"      ✓ Alignment model loaded and cached")
            else:
                alignment_model_loaded_internally = True
                logger.info(f"      ✓ Alignment model loaded")

        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device
        )
        logger.info(f"      ✓ Timestamps aligned")

        # Diarize (use pre-loaded if available)
        logger.info(f"[5/6] Running speaker diarization...")
        if diarize_model is None:
            logger.info(f"      (Loading pyannote models - this may take a minute)")
            diarize_model = DiarizationPipeline(
                use_auth_token=hf_token,
                device=device
            )
        else:
            logger.info(f"      Using pre-loaded diarization model")
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

        # Cleanup if models were loaded internally and not reusing
        if not reuse_models:
            if model_loaded_internally and model is not None:
                # WhisperX FasterWhisperPipeline doesn't have .to() method
                del model
            if alignment_model_loaded_internally and model_a is not None:
                if device == "cuda" and hasattr(model_a, 'to'):
                    model_a = model_a.to('cpu')
                del model_a
                del metadata
            if diarize_model_loaded_internally and diarize_model is not None:
                if device == "cuda" and hasattr(diarize_model, 'to'):
                    diarize_model = diarize_model.to('cpu')
                del diarize_model
            if device == "cuda":
                torch.cuda.empty_cache()

        return result

    except Exception as e:
        logger.error(f"Diarization failed: {e}")
        raise RuntimeError(f"Diarization failed: {e}")


def extract_segments(
    diarization_result: Dict,
    silence_threshold_sec: float = 0.3,
    merge_gap_sec: float = 0.1,
    min_duration_sec: float = 0.2,
    min_word_confidence: float = 0.3
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
    # - Preserves original transcription text with punctuation when possible

    raw_segments = []

    for seg in diarization_result.get('segments', []):
        words = seg.get('words', [])
        original_text = seg.get('text', '')  # WhisperX segment text with punctuation

        # SKIP segments without words - these are likely silence or noise
        # We only create segments where there are actual transcribed words
        if not words:
            logger.debug(f"Skipping segment at {seg.get('start', 0):.2f}s - no words detected "
                       f"(likely silence or non-speech audio)")
            continue

        # Group consecutive words by speaker, splitting on speaker changes and long silences
        current_group = []
        segment_was_split = False  # Track if we split this segment into multiple parts
        first_group_for_segment = True  # Track if this is the first group from this segment

        for word in words:
            speaker = word.get('speaker')

            # Skip words without speaker assignment
            if not speaker:
                logger.debug(f"Word '{word.get('word', '?')}' at "
                           f"{word.get('start', 0):.2f}s has no speaker, skipping")
                segment_was_split = True  # Skipped word means text won't match
                continue

            # Skip words without valid timestamps
            if 'start' not in word or 'end' not in word:
                logger.debug(f"Word '{word.get('word', '?')}' missing timestamps, skipping")
                segment_was_split = True
                continue

            # Skip low-confidence words (likely hallucinations in silence)
            # WhisperX provides a 'score' field for alignment confidence
            confidence = word.get('score', 1.0)
            if confidence < min_word_confidence:
                logger.debug(f"Skipping low-confidence word '{word.get('word', '?')}' "
                           f"(confidence: {confidence:.2f}) - likely silence/noise")
                segment_was_split = True
                continue

            # Check for speaker change
            if current_group and current_group[0].get('speaker') != speaker:
                # Speaker changed: emit current group and start new one
                # Use original text for first group if not split yet, otherwise concatenate
                text_to_use = original_text if (first_group_for_segment and not segment_was_split) else None
                raw_segments.append(_words_to_segment(current_group, text_to_use))
                logger.debug(f"Speaker change detected, splitting segment")
                current_group = []
                segment_was_split = True
                first_group_for_segment = False

            # Check for long silence WITHIN same speaker
            if current_group:
                gap_sec = word['start'] - current_group[-1]['end']

                if gap_sec >= silence_threshold_sec:
                    # Long silence: emit current group and start new one
                    text_to_use = original_text if (first_group_for_segment and not segment_was_split) else None
                    raw_segments.append(_words_to_segment(current_group, text_to_use))
                    logger.debug(f"Long silence ({gap_sec:.2f}s) detected, splitting segment")
                    current_group = []
                    segment_was_split = True
                    first_group_for_segment = False

            current_group.append(word)

        # Emit final group for this segment
        if current_group:
            # Use original text if this is the only group and we didn't skip any words
            text_to_use = original_text if (first_group_for_segment and not segment_was_split) else None
            raw_segments.append(_words_to_segment(current_group, text_to_use))

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
    # Also concatenates text and words arrays when merging

    merged_segments = []
    merge_count = 0

    for seg in filtered_segments:
        # Try to merge with previous segment
        if merged_segments and merged_segments[-1]['speaker'] == seg['speaker']:
            gap_sec = seg['t0_sec'] - merged_segments[-1]['t1_sec']

            if gap_sec < merge_gap_sec:
                # Merge: extend previous segment to current end
                merged_segments[-1]['t1_sec'] = seg['t1_sec']

                # Concatenate text with space
                merged_segments[-1]['text'] += ' ' + seg.get('text', '')

                # Extend words array
                merged_segments[-1]['words'].extend(seg.get('words', []))

                # Update word count
                merged_segments[-1]['word_count'] = len(merged_segments[-1]['words'])

                merge_count += 1
                logger.debug(f"Merged segments with {gap_sec*1000:.0f}ms gap "
                           f"(speaker {seg['speaker']})")
                continue

        # No merge: add as new segment (need to copy to avoid mutation)
        merged_segments.append(seg.copy())

    if merge_count > 0:
        logger.info(f"Phase 3: Merged {merge_count} adjacent same-speaker segments, "
                   f"{len(merged_segments)} remaining")
    else:
        logger.info(f"Phase 3: No segments merged, {len(merged_segments)} remaining")


    # PHASE 4: Validate and prepare final output
    # ============================================
    # Validate segment timing and preserve all fields for output generation

    final_segments = []
    invalid_count = 0

    for seg in merged_segments:
        # Ensure t1 > t0 (using seconds for validation)
        if seg['t1_sec'] <= seg['t0_sec']:
            logger.warning(f"Skipping invalid segment: t0={seg['t0_sec']:.3f}s, "
                         f"t1={seg['t1_sec']:.3f}s (speaker {seg['speaker']})")
            invalid_count += 1
            continue

        # Keep all fields: speaker, timing in seconds, text, and words array
        final_segments.append({
            'speaker': seg['speaker'],
            't0_sec': seg['t0_sec'],
            't1_sec': seg['t1_sec'],
            'text': seg.get('text', ''),
            'words': seg.get('words', []),
            'word_count': seg.get('word_count', 0)
        })

    # Summary logging
    logger.info(f"Phase 4: Extracted {len(final_segments)} final segments "
               f"(from {len(raw_segments)} raw → {len(filtered_segments)} filtered → "
               f"{len(merged_segments)} merged)")

    if invalid_count > 0:
        logger.warning(f"Filtered {invalid_count} invalid segments (t1 <= t0)")

    return final_segments


def _words_to_segment(words: List[Dict], segment_text: str = None) -> Dict:
    """
    Convert a list of consecutive words (same speaker) to a segment.

    Uses first word start and last word end for precise boundaries.
    Now preserves word-level data and original transcription text.
    This helper function is used during Phase 1 word-level extraction.

    Args:
        words: List of word dicts with speaker, start, end, word, score fields
        segment_text: Optional original WhisperX segment text with punctuation.
                     If None, text will be constructed by concatenating words.

    Returns:
        Segment dict with speaker, t0_sec, t1_sec, text, words, from_words flag

    Raises:
        ValueError: If words list is empty
    """
    if not words:
        raise ValueError("Cannot create segment from empty word list")

    speaker = words[0]['speaker']
    t0_sec = words[0]['start']
    t1_sec = words[-1]['end']

    # Fallback: if no segment text provided, concatenate words
    if segment_text is None:
        segment_text = ' '.join(w.get('word', '').strip() for w in words)

    return {
        'speaker': speaker,
        't0_sec': t0_sec,
        't1_sec': t1_sec,
        'text': segment_text,
        'words': words,  # Full word array with confidence scores
        'from_words': True,
        'word_count': len(words)
    }


def apply_vad_trimming(
    segments: List[Dict],
    audio_path: Path,
    vad_threshold: float = 0.5,
    vad_aggressiveness: str = 'medium'
) -> List[Dict]:
    """
    Trim word end timestamps using Silero VAD to remove trailing silence.

    For each word:
    1. Extract audio segment [word.start, word.end]
    2. Run VAD to find actual speech boundaries
    3. Trim word.end to last speech frame + small buffer
    4. Ensure trimmed end >= word.start (avoid invalid timestamps)

    Args:
        segments: List of segment dicts with words arrays
        audio_path: Path to audio/video file
        vad_threshold: Speech probability threshold (0.0-1.0, default 0.5)
        vad_aggressiveness: Preset level ('low', 'medium', 'high')

    Returns:
        Modified segments list with trimmed word timestamps
    """
    import torch
    import whisperx

    # VAD aggressiveness presets
    VAD_PRESETS = {
        'low': {'min_speech_duration_ms': 250, 'min_silence_duration_ms': 100, 'threshold': 0.4},
        'medium': {'min_speech_duration_ms': 200, 'min_silence_duration_ms': 80, 'threshold': 0.5},
        'high': {'min_speech_duration_ms': 150, 'min_silence_duration_ms': 50, 'threshold': 0.6}
    }

    preset = VAD_PRESETS.get(vad_aggressiveness, VAD_PRESETS['medium'])
    actual_threshold = preset['threshold'] if vad_threshold == 0.5 else vad_threshold

    logger.info(f"Loading Silero VAD model (aggressiveness: {vad_aggressiveness})...")

    try:
        # Load Silero VAD model
        model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True
        )
        get_speech_timestamps = utils[0]

        # Load audio
        logger.info(f"Loading audio for VAD processing: {audio_path}")
        audio = whisperx.load_audio(str(audio_path))
        sample_rate = 16000  # WhisperX uses 16kHz

        total_words = sum(len(seg.get('words', [])) for seg in segments)
        trimmed_count = 0
        total_trim_ms = 0

        logger.info(f"Processing {total_words} words with VAD...")

        # Process each segment
        for seg_idx, segment in enumerate(segments):
            words = segment.get('words', [])

            if not words:
                continue

            # Process each word in segment
            for word_idx, word in enumerate(words):
                # Skip very short words (< 200ms) - already tight
                word_duration = word['end'] - word['start']
                if word_duration < 0.2:
                    continue

                # Extract word audio segment
                word_start_sample = int(word['start'] * sample_rate)
                word_end_sample = int(word['end'] * sample_rate)

                # Ensure we don't go out of bounds
                word_end_sample = min(word_end_sample, len(audio))
                if word_start_sample >= word_end_sample:
                    continue

                word_audio = audio[word_start_sample:word_end_sample]

                # Run VAD on word audio
                try:
                    word_audio_tensor = torch.from_numpy(word_audio)
                    speech_timestamps = get_speech_timestamps(
                        word_audio_tensor,
                        model,
                        threshold=actual_threshold,
                        sampling_rate=sample_rate,
                        min_speech_duration_ms=preset['min_speech_duration_ms'],
                        min_silence_duration_ms=preset['min_silence_duration_ms'],
                        window_size_samples=512  # 32ms @ 16kHz
                    )

                    # Find last speech frame
                    if speech_timestamps:
                        last_speech_end = speech_timestamps[-1]['end']  # Relative to word start

                        # Convert back to absolute time with small buffer (50ms)
                        buffer_samples = int(0.05 * sample_rate)  # 50ms buffer
                        trimmed_end_sample = word_start_sample + last_speech_end + buffer_samples

                        # Update word end time
                        new_end = trimmed_end_sample / sample_rate
                        original_end = word['end']

                        # Safety: ensure end > start + 50ms and don't extend beyond original
                        new_end = max(word['start'] + 0.05, min(new_end, original_end))

                        # Only update if we actually trimmed something (> 10ms reduction)
                        if original_end - new_end > 0.01:
                            trim_amount_ms = (original_end - new_end) * 1000
                            word['end'] = new_end
                            trimmed_count += 1
                            total_trim_ms += trim_amount_ms

                            logger.debug(
                                f"Trimmed word '{word.get('word', '?')}' by {trim_amount_ms:.0f}ms "
                                f"({original_end:.3f}s → {new_end:.3f}s)"
                            )

                except Exception as e:
                    logger.warning(f"VAD failed for word '{word.get('word', '?')}': {e}")
                    continue

        # Update segment boundaries based on trimmed words
        for segment in segments:
            words = segment.get('words', [])
            if words:
                segment['t0_sec'] = words[0]['start']
                segment['t1_sec'] = words[-1]['end']

        avg_trim = total_trim_ms / trimmed_count if trimmed_count > 0 else 0
        logger.info(
            f"✓ VAD trimming complete: {trimmed_count}/{total_words} words trimmed "
            f"(avg: {avg_trim:.0f}ms per word)"
        )

        return segments

    except Exception as e:
        logger.error(f"VAD trimming failed: {e}", exc_info=True)
        logger.warning("Continuing without VAD trimming...")
        return segments


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


def generate_cli_json(segments: List[Dict], output_path: Path) -> None:
    """
    Generate CLI-compatible JSON (strict WhisperX format).

    Output format matches CLI audio player expectations:
    {segments: [{start, end, speaker, text, words: [{start, end, word}]}]}

    Args:
        segments: List of segment dicts with t0_sec, t1_sec, text, words
        output_path: Path to write CLI JSON file
    """
    cli_segments = []

    for seg in segments:
        cli_seg = {
            'start': seg['t0_sec'],
            'end': seg['t1_sec'],
            'speaker': seg['speaker'],
            'text': seg.get('text', ''),
            'words': [
                {
                    'start': w['start'],
                    'end': w['end'],
                    'word': w.get('word', '')
                }
                for w in seg.get('words', [])
            ]
        }
        cli_segments.append(cli_seg)

    output_data = {'segments': cli_segments}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    logger.info(f"✓ Generated CLI JSON: {output_path}")
    logger.info(f"  {len(cli_segments)} segments with word-level detail")


def generate_enhanced_json(
    segments: List[Dict],
    video_path: Path,
    duration_ms: int,
    output_path: Path,
    vad_enabled: bool = False,
    vad_threshold: float = 0.5,
    vad_aggressiveness: str = 'medium'
) -> None:
    """
    Generate enhanced JSON with debugging metadata.

    Includes: confidence scores, segment IDs, video metadata, statistics, VAD info.

    Args:
        segments: List of segment dicts with t0_sec, t1_sec, text, words
        video_path: Path to video file
        duration_ms: Video duration in milliseconds
        output_path: Path to write enhanced JSON file
        vad_enabled: Whether VAD trimming was applied
        vad_threshold: VAD threshold used (if enabled)
        vad_aggressiveness: VAD aggressiveness preset used (if enabled)
    """
    # Collect all unique speakers
    speakers = sorted(list(set(seg['speaker'] for seg in segments)))

    enhanced_segments = []
    for idx, seg in enumerate(segments):
        enhanced_seg = {
            'id': idx,
            'start': seg['t0_sec'],
            'end': seg['t1_sec'],
            'speaker': seg['speaker'],
            'text': seg.get('text', ''),
            'word_count': len(seg.get('words', [])),
            'words': [
                {
                    'start': w['start'],
                    'end': w['end'],
                    'word': w.get('word', ''),
                    'confidence': w.get('score', 1.0)  # Include confidence
                }
                for w in seg.get('words', [])
            ]
        }
        enhanced_segments.append(enhanced_seg)

    output_data = {
        'version': 2 if vad_enabled else 1,
        'format': 'enhanced',
        'video': {
            'filename': video_path.name,
            'durationMs': duration_ms,
            'durationSec': duration_ms / 1000.0
        },
        'speakers': [{'id': spk} for spk in speakers],
        'segments': enhanced_segments,
        'stats': {
            'total_segments': len(segments),
            'total_speakers': len(speakers),
            'total_words': sum(len(seg.get('words', [])) for seg in segments)
        }
    }

    # Add VAD metadata if VAD was applied
    if vad_enabled:
        output_data['vad_trimming'] = {
            'enabled': True,
            'threshold': vad_threshold,
            'aggressiveness': vad_aggressiveness
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    logger.info(f"✓ Generated enhanced JSON: {output_path}")
    logger.info(f"  Includes confidence scores and metadata")


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
    min_word_confidence: float = 0.3,
    clustering_threshold: float = None,
    enable_vad_trimming: bool = False,
    vad_threshold: float = 0.5,
    vad_aggressiveness: str = 'medium',
    model_manager: Optional['ModelManager'] = None
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
        min_word_confidence: Minimum confidence for words (0.0-1.0)
        clustering_threshold: Pyannote clustering threshold (0.0-2.0)
        enable_vad_trimming: Enable VAD-based word timestamp trimming
        vad_threshold: VAD speech probability threshold (0.0-1.0)
        vad_aggressiveness: VAD aggressiveness preset ('low', 'medium', 'high')
        model_manager: Pre-loaded ModelManager for batch processing (optional)

    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f"\n{'='*60}")
        logger.info(f"📹 {video_path.name}")
        logger.info(f"{'='*60}")

        # Get video duration
        logger.info("Getting video duration...")
        duration_ms = get_video_duration_ms(video_path)

        # Extract models from model_manager if provided
        if model_manager:
            whisper_model = model_manager.whisper_model
            diarize_model = model_manager.diarize_model
            alignment_models = model_manager.alignment_models
            reuse_models = True
        else:
            whisper_model = None
            diarize_model = None
            alignment_models = None
            reuse_models = False

        # Run diarization
        logger.info(f"Starting diarization (device: {device})...")
        diarization_result = run_diarization(
            video_path,
            model_size=model_size,
            language=language,
            device=device,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            clustering_threshold=clustering_threshold,
            whisper_model=whisper_model,
            diarize_model=diarize_model,
            alignment_models=alignment_models,
            reuse_models=reuse_models
        )

        # Extract segments with word-level processing
        logger.info("Extracting segments with word-level processing...")
        segments = extract_segments(
            diarization_result,
            silence_threshold_sec=silence_threshold_sec,
            merge_gap_sec=merge_gap_sec,
            min_duration_sec=min_duration_sec,
            min_word_confidence=min_word_confidence
        )

        if not segments:
            logger.error("No speaker segments found in video")
            return False

        # Apply VAD trimming if enabled
        if enable_vad_trimming:
            logger.info(f"Applying VAD trimming (aggressiveness: {vad_aggressiveness})...")
            segments = apply_vad_trimming(
                segments,
                video_path,
                vad_threshold=vad_threshold,
                vad_aggressiveness=vad_aggressiveness
            )

        # Generate CLI format (strict compatibility with CLI audio player)
        logger.info("Generating CLI player JSON...")
        cli_output_path = output_dir / f"{video_path.stem}.cli.json"
        generate_cli_json(segments, cli_output_path)

        # Generate enhanced format (with metadata and confidence scores)
        logger.info("Generating enhanced JSON with metadata...")
        enhanced_output_path = output_dir / f"{video_path.stem}.enhanced.json"
        generate_enhanced_json(
            segments,
            video_path,
            duration_ms,
            enhanced_output_path,
            vad_enabled=enable_vad_trimming,
            vad_threshold=vad_threshold,
            vad_aggressiveness=vad_aggressiveness
        )

        # Generate SRT subtitle file for auditing
        logger.info("Generating SRT subtitle file...")
        srt_path = output_dir / f"{video_path.stem}.srt"
        generate_srt(diarization_result, srt_path)

        # Summary
        unique_speakers = len(set(seg['speaker'] for seg in segments))
        logger.info(f"\n✓ Successfully processed {video_path.name}")
        logger.info(f"  {unique_speakers} speakers, {len(segments)} segments")
        logger.info(f"  Output files:")
        logger.info(f"    - {cli_output_path.name} (CLI player format)")
        logger.info(f"    - {enhanced_output_path.name} (with metadata)")
        logger.info(f"    - {srt_path.name} (subtitles)")

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
        help='Input directory containing video files (default: ../in). Used when processing all videos.'
    )
    parser.add_argument(
        '--input',
        default=None,
        help='Process a single video file (path relative to input-dir). If specified, only this video is processed.'
    )
    parser.add_argument(
        '--output-dir',
        default='../out',
        help='Output directory for JSON files (default: ../out)'
    )
    parser.add_argument(
        '--model',
        choices=['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'],
        default='large-v3',
        help='Whisper model size (default: large-v3). large-v3 is most accurate but slowest'
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
    segment_group.add_argument(
        '--min-word-confidence',
        type=float,
        default=0.3,
        help='Minimum confidence score for words (range: 0.0-1.0, default: 0.3). '
             'Lower values keep more words but may include hallucinations. '
             'Higher values filter more aggressively. '
             'If you are missing words, try lowering this to 0.2 or 0.1.'
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

    # Voice Activity Detection (VAD) for silence trimming
    vad_group = parser.add_argument_group(
        'Voice Activity Detection (VAD)',
        'Trim word timestamps to remove trailing silence using Silero VAD'
    )
    vad_group.add_argument(
        '--enable-vad-trimming',
        action='store_true',
        default=False,
        help='Enable VAD-based trimming of word timestamps (removes trailing silence). '
             'Default: disabled for backward compatibility. '
             'Recommended for visualization to prevent bars appearing during silence.'
    )
    vad_group.add_argument(
        '--vad-threshold',
        type=float,
        default=0.5,
        help='VAD speech probability threshold (range: 0.0-1.0, default: 0.5). '
             'Higher = more aggressive trimming (may cut off breathy speech ends). '
             'Lower = more conservative (may keep some trailing silence).'
    )
    vad_group.add_argument(
        '--vad-aggressiveness',
        choices=['low', 'medium', 'high'],
        default='medium',
        help='VAD aggressiveness preset (default: medium). '
             'low = conservative (250ms min speech, 100ms min silence), '
             'medium = balanced (200ms min speech, 80ms min silence), '
             'high = aggressive (150ms min speech, 50ms min silence).'
    )

    # Skip existing files option
    parser.add_argument(
        '--skip-existing',
        action='store_true',
        default=True,
        help='Skip videos that already have output files (default: True). Use --no-skip-existing to force reprocess.'
    )
    parser.add_argument(
        '--no-skip-existing',
        action='store_false',
        dest='skip_existing',
        help='Force reprocess all videos, even if output files exist'
    )

    args = parser.parse_args()

    try:
        # Resolve directories relative to script location
        script_dir = Path(__file__).parent
        input_dir = (script_dir / args.input_dir).resolve()
        output_dir = (script_dir / args.output_dir).resolve()

        logger.info(f"\n{'='*60}")
        logger.info(f"DIARIZATION SERVICE")
        logger.info(f"{'='*60}")
        logger.info(f"Input:  {input_dir}")
        logger.info(f"Output: {output_dir}")

        # Get video files to process
        if args.input:
            # Process single video file
            video_path = input_dir / args.input
            if not video_path.exists():
                logger.error(f"Video file not found: {video_path}")
                sys.exit(1)

            video_files = [video_path]
            logger.info(f"\nProcessing single video: {args.input}")
        else:
            # Get all video files
            logger.info("\n🔍 Scanning for video files...")
            video_files = get_video_files(input_dir)

            if not video_files:
                logger.error(f"❌ No video files found in {input_dir}")
                sys.exit(1)

            logger.info(f"\nFound {len(video_files)} video(s):")
            for i, video_file in enumerate(video_files, 1):
                logger.info(f"   {i}. {video_file.name}")

            # Ask for confirmation
            response = input(f"\nProcess all {len(video_files)} video(s)? [Y/n]: ").strip().lower()
            if response and response not in ['y', 'yes']:
                logger.info("Operation cancelled by user")
                sys.exit(0)

        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)

        # Determine device
        device = "cuda" if torch.cuda.is_available() else "cpu"
        device_icon = "🚀" if device == "cuda" else "💻"
        logger.info(f"\n{device_icon} Device: {device.upper()}")

        # Get HF token for ModelManager
        hf_token = os.environ.get('HF_TOKEN')
        if not hf_token:
            logger.error("HF_TOKEN environment variable is required for pyannote diarization.")
            logger.error("Get your token at https://huggingface.co/settings/tokens")
            sys.exit(1)

        # Initialize ModelManager for batch processing
        logger.info(f"\n{'─'*60}")
        logger.info(f"INITIALIZING MODELS")
        logger.info(f"{'─'*60}")
        model_manager = ModelManager(device, args.model, hf_token)
        model_manager.log_memory_stats("Initial")

        # Pre-load models
        logger.info("")
        model_manager.load_whisper_model()
        model_manager.load_diarization_model()
        logger.info("")
        model_manager.log_memory_stats("After loading")

        # Process all videos
        results = []
        skipped_count = 0

        try:
            for i, video_path in enumerate(video_files, 1):
                logger.info(f"\n{'─'*60}")
                logger.info(f"[{i}/{len(video_files)}] {video_path.name}")
                logger.info(f"{'─'*60}")

                # Check if output files already exist
                cli_output = output_dir / f"{video_path.stem}.cli.json"
                enhanced_output = output_dir / f"{video_path.stem}.enhanced.json"
                srt_output = output_dir / f"{video_path.stem}.srt"

                if args.skip_existing and cli_output.exists() and enhanced_output.exists() and srt_output.exists():
                    logger.info(f"⏭ Already processed (use --no-skip-existing to reprocess)")
                    results.append((video_path.name, True))
                    skipped_count += 1
                    continue

                # Log memory before processing
                model_manager.log_memory_stats(f"Video {i}")

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
                    min_word_confidence=args.min_word_confidence,
                    clustering_threshold=args.clustering_threshold,
                    enable_vad_trimming=args.enable_vad_trimming,
                    vad_threshold=args.vad_threshold,
                    vad_aggressiveness=args.vad_aggressiveness,
                    model_manager=model_manager
                )
                results.append((video_path.name, success))

                # Cleanup GPU cache between videos
                if device == "cuda":
                    torch.cuda.empty_cache()

        finally:
            # Cleanup all models at end
            logger.info(f"\n{'─'*60}")
            logger.info("🧹 CLEANUP")
            logger.info(f"{'─'*60}")
            model_manager.cleanup_all()
            logger.info("")
            model_manager.log_memory_stats("Final")

        # Summary
        logger.info(f"\n{'='*60}")
        logger.info("✨ PROCESSING COMPLETE")
        logger.info(f"{'='*60}")
        successful = sum(1 for _, success in results if success)
        logger.info(f"✓ Processed: {successful}/{len(results)}")
        if skipped_count > 0:
            logger.info(f"⏭ Skipped:   {skipped_count}")

        if successful < len(results):
            logger.info(f"\n❌ Failed videos:")
            for name, success in results:
                if not success:
                    logger.info(f"   • {name}")

        sys.exit(0 if successful == len(results) else 1)

    except KeyboardInterrupt:
        logger.info("\nOperation cancelled by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
