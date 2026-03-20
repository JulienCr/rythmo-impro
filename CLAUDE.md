# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**rythmo-impro** is a speaker diarization system that processes video files to identify who speaks when (without identity recognition). It consists of:

1. **Dockerized Python service** (`/diarizer/`) - Uses WhisperX + pyannote to perform speaker diarization and output word-level detailed JSON data
2. **Next.js overlay application** (`/obs-suite/`) - *(Legacy)* Renders video with a fixed-lane "bande rythmo" visualization for OBS browser sources

The system takes video files as input and outputs detailed transcription with word-level timestamps, suitable for:
- CLI audio player playback with synchronized transcripts
- Theatrical improvisation rehearsal analysis
- Subtitle generation
- Speech analysis and debugging

## Architecture

### Python Diarization Service (Docker)

**Location**: `/diarizer/`

- **Entry point**: `main.py` - CLI that accepts video input and outputs multiple JSON formats + SRT subtitles
- **Technology**: WhisperX with pyannote.audio for speaker diarization
- **Authentication**: Requires `HF_TOKEN` environment variable (Hugging Face) for pyannote models
- **Input/Output**: Mounted volumes at `/in` (video files) and `/out` (JSON + SRT output)

**Critical constraints**:
- Python runs ONLY inside Docker (never on host)
- Input paths must be validated (no directory traversal outside `/in`)
- Never log `HF_TOKEN` in any output
- Output format uses seconds (floats) for timestamps, preserving word-level precision

### Next.js Overlay Application

**Location**: `/obs-suite/`

- **Main page**: `app/overlay/rythmo/page.tsx` (or `pages/overlay/rythmo.tsx` if using pages router)
- **Overlay component**: `components/RythmoOverlay.tsx` - Canvas-based visualization
- **Data loader**: `lib/loadCues.ts` - Types and validation for diarization JSON
- **Static assets**:
  - `/public/media/` - Video files
  - `/public/cues/` - Diarization JSON files

**Technology stack**: Next.js + Tailwind CSS + pnpm

## Output Formats

The diarization service generates **three output files** per video:

### 1. CLI Player JSON Format (`video.cli.json`)

Strict WhisperX-compatible format for use with CLI audio players:

```json
{
  "segments": [
    {
      "start": 1.246,
      "end": 4.669,
      "speaker": "SPEAKER_00",
      "text": "Monsieur Pignon, what a pleasure to see you again.",
      "words": [
        {"start": 1.246, "end": 1.550, "word": "Monsieur"},
        {"start": 1.560, "end": 2.100, "word": "Pignon"},
        {"start": 2.120, "end": 2.300, "word": "what"}
      ]
    }
  ]
}
```

**Key features**:
- Times in **seconds** (floats)
- Word-level timestamps for each word
- Transcribed text with punctuation (when available)
- Compatible with https://github.com/cheuerde/tools/tree/main/cli_audio_player_with_transcripts

### 2. Enhanced JSON Format (`video.enhanced.json`)

Extended format with metadata and confidence scores for debugging:

```json
{
  "version": 1,
  "format": "enhanced",
  "video": {
    "filename": "scene01.mp4",
    "durationMs": 123456,
    "durationSec": 123.456
  },
  "speakers": [
    {"id": "SPEAKER_00"},
    {"id": "SPEAKER_01"}
  ],
  "segments": [
    {
      "id": 0,
      "start": 1.246,
      "end": 4.669,
      "speaker": "SPEAKER_00",
      "text": "Monsieur Pignon, what a pleasure to see you again.",
      "word_count": 9,
      "words": [
        {
          "start": 1.246,
          "end": 1.550,
          "word": "Monsieur",
          "confidence": 0.92
        }
      ]
    }
  ],
  "stats": {
    "total_segments": 28,
    "total_speakers": 2,
    "total_words": 245
  }
}
```

**Key features**:
- Includes confidence scores for each word
- Video metadata and statistics
- Segment IDs for reference
- Useful for quality analysis and debugging

### 3. SRT Subtitle Format (`video.srt`)

Standard SRT subtitle file with speaker labels:

```
1
00:00:01,246 --> 00:00:04,669
[SPEAKER_00] Monsieur Pignon, what a pleasure to see you again.

2
00:00:13,921 --> 00:00:14,622
[SPEAKER_01] Thank you.
```

**Key features**:
- Standard SRT format compatible with video editors
- Shows speaker labels in brackets
- Includes confidence warnings for low-quality segments
- Useful for subtitle creation and manual review

## Lane Assignment Algorithm

**Critical for consistency**: Speaker-to-lane mapping must be deterministic and stable across runs.

1. Calculate total spoken duration for each speaker (sum of all segment durations)
2. Sort speakers by total duration (descending)
3. Tie-breaker: If durations are equal, use earliest first speech time
4. Assign to lanes in order: 0, 1, 2, 3, 4...

**Lane colors** (fixed):
- Lane 0 (top): Blue `#007AFF`
- Lane 1: Red `#FF3B30`
- Lane 2: Yellow `#FFD60A`
- Lane 3: Green `#34C759`
- Lane 4: Purple `#AF52DE`

## Common Commands

### Interactive Video Processing (Recommended)

**Location**: `/obs-suite/scripts/process-video.ts`

The easiest way to process videos is using the interactive CLI, which handles both diarization and FCP XML generation:

```bash
# Navigate to obs-suite directory
cd obs-suite

# Interactive mode - process all videos with prompts
pnpm process-video

# Process all videos without prompts (skip existing files)
pnpm process-video --all

# Process specific video (skip existing files by default)
pnpm process-video juste-leblanc.mp4

# Force regenerate everything for all videos
pnpm process-video --all --force

# Process all videos but skip vocal removal
pnpm process-video --all --skip-vocal-removal

# Show help
pnpm process-video --help
```

**Features**:
- Batch processing: Processes all videos in `/in` directory by default
- Smart skip-existing: Automatically skips videos that already have outputs
- Interactive prompts for configuration (model selection, speaker constraints)
- Generates diarization outputs, FCP XML, thumbnails, AND vocal-removed videos in one command
- Uses WSL Python environment (no Docker required)
- Default model: `large-v3` (best accuracy)

**Workflow**:
1. Scans `/in` directory for all video files
2. Runs diarization (skips videos with existing outputs unless `--force`)
3. Generates FCP XML for each video (skips if XML exists unless `--force`)
4. Generates thumbnails for each video (skips if thumbnail exists unless `--force`)
5. Removes vocals from each video using audio-separator (skips if final video exists unless `--force`)
6. Shows summary of processed/skipped files

**Prerequisites**:
- WSL environment with Python venv setup
- HF_TOKEN in `diarizer/.env`
- Run `diarizer/setup-wsl.sh` first if not set up
- audio-separator installed: `pip install audio-separator onnxruntime-gpu`
- CUDA GPU recommended for vocal removal (30-60s vs 3-10min CPU)

### WSL Python (Diarization Service)

**Note**: Docker is no longer used. The system now runs directly in WSL with a Python virtual environment.

```bash
# Setup (first time only)
cd diarizer
./setup-wsl.sh

# Create .env file with your Hugging Face token
echo "HF_TOKEN=your_token_here" > .env

# Run diarization on all videos in ../in/ (uses defaults)
./run-wsl.sh --input-dir ../in --output-dir ../out

# Process a single video
./run-wsl.sh --input-dir ../in --output-dir ../out --input video.mp4

# Process all videos with large-v3 model (default) and skip existing
./run-wsl.sh --input-dir ../in --output-dir ../out --model large-v3

# Force reprocess all videos (skip-existing is default, use --no-skip-existing to override)
./run-wsl.sh --input-dir ../in --output-dir ../out --no-skip-existing

# With model selection and speaker constraints (recommended for better accuracy)
./run-wsl.sh --input-dir ../in --output-dir ../out \
  --model large-v3 --min-speakers 2 --max-speakers 4

# With segment quality tuning (reduce fragmentation)
./run-wsl.sh --input-dir ../in --output-dir ../out \
  --merge-gap 0.8 --silence-threshold 0.6 --min-duration 0.4

# Full tuning (recommended for production)
./run-wsl.sh --input-dir ../in --output-dir ../out \
  --model large-v3 \
  --min-speakers 2 --max-speakers 4 \
  --merge-gap 0.8 --silence-threshold 0.6 --min-duration 0.4 \
  --clustering-threshold 0.9

# Available Whisper models: tiny, base, small, medium, large, large-v2, large-v3 (default: large-v3)
# large-v3 provides best accuracy but is slowest
# Available languages: auto, fr, en (default: auto)
# Speaker constraints: Use --min-speakers and --max-speakers when you know the expected range
# Segment tuning: --silence-threshold, --merge-gap, --min-duration (see below for details)

# Skip existing (default behavior):
# - --skip-existing (default): Skip videos that already have all 3 output files
# - --no-skip-existing: Force reprocess all videos even if outputs exist

# Output files generated per video:
# - video.cli.json (CLI player format with word-level detail)
# - video.enhanced.json (extended format with confidence scores)
# - video.srt (SRT subtitles)
# - video.xml (FCP XML for NLE import)
# - thumbs/video.jpg (thumbnail image)
# - final-vids/video.mp4 (video with vocals removed)
```

### Vocal Removal (audio-separator)

The vocal removal step uses `audio-separator` with the MDX23C-InstVoc HQ model to create instrumental versions of videos. This is integrated into the `process-video` pipeline as Step 4.

```bash
# Skip vocal removal in the pipeline
pnpm process-video --all --skip-vocal-removal

# Standalone vocal removal (if needed)
cd diarizer
./run-vocal-removal.sh --input ../in/video.mp4 --output ../out/final-vids/video.mp4

# Force regenerate
./run-vocal-removal.sh --input ../in/video.mp4 --output ../out/final-vids/video.mp4 --force

# Custom model (default: MDX23C-InstVoc HQ)
./run-vocal-removal.sh --input ../in/video.mp4 --output ../out/final-vids/video.mp4 --model "MDX23C-InstVoc HQ"
```

**How it works**:
1. Extracts audio as WAV from input video (ffmpeg)
2. Removes vocals using audio-separator with CUDA acceleration
3. Remuxes instrumental audio with original video track (video codec copied, no re-encode)

**Output**:
- Creates `out/final-vids/video.mp4` with instrumental audio only
- Preserves original video quality (video stream is copied, not re-encoded)
- Audio encoded as AAC at 192kbps

**Performance**:
- With CUDA GPU: 30-60 seconds per video
- With CPU only: 3-10 minutes per video (automatic fallback if GPU unavailable)

**Special cases**:
- Videos without audio tracks are copied as-is (no processing)
- If GPU memory is insufficient, automatically falls back to CPU processing

### Next.js Application *(Legacy - Not Currently Used)*

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start
```

**Note**: The overlay application is currently not actively used. The diarization service focuses on generating detailed word-level JSON formats for external tools like CLI audio players.

## Key Implementation Details

### RythmoOverlay Component

- Uses `<canvas>` overlay on top of `<video>` element (absolute positioning)
- Updates via `requestAnimationFrame` loop synced to `video.currentTime`
- **Rolling window**: Default 6s window with playhead at 20% from left (1.2s before, 4.8s after)
- Draws bars for segments intersecting the window
- Each speaker always appears in their assigned lane (simultaneous speech = multiple bars)
- Canvas must resize to match video dimensions (`videoWidth`/`videoHeight`)

### Visualization Parameters

Default values (configurable via props):
- `windowMs`: 6000 (playhead at 20%, showing 1.2s before and 4.8s after)
- `laneHeight`: 32 pixels
- `laneGap`: 1 pixel

### OBS Integration

- Use **Browser Source** in OBS pointing to the overlay URL
- Set size to match video resolution
- Video can be muted (overlay only) or audible for rehearsal
- Keep audio for Twitch output on actors' microphones, not video

## Improving Speaker Detection Accuracy

Speaker diarization accuracy depends on several factors. The system now uses **word-level timestamps** to dramatically reduce fragmentation and improve segment boundaries.

### 1. Model Selection
- **Whisper model size**: Larger models (large-v3) provide better transcription quality
  - `tiny`: Fastest, least accurate
  - `small`: Good balance for testing
  - `medium`: Default, good for most cases
  - `large-v3`: Best accuracy, slowest (recommended for production)

### 2. Speaker Constraints
When you know the expected number of speakers, use constraints:
```bash
--min-speakers 2 --max-speakers 4
```
This prevents over-segmentation (too many speakers) or under-segmentation (too few).

### 3. Segment Quality Tuning (Word-Level Processing)

**NEW**: The system now leverages word-level timestamps from WhisperX to provide precise segment boundaries and reduce fragmentation.

#### Silence Threshold (`--silence-threshold`)
Splits segments when the gap between words exceeds this duration (in seconds).
- **Default**: 0.5 seconds
- **Lower (0.2-0.4)**: More sensitive to pauses, creates shorter segments
- **Higher (0.8-1.0)**: Allows longer natural pauses within segments
- **Use case**: Increase for conversational speech with thinking pauses

Example:
```bash
--silence-threshold 0.8  # Allow longer pauses in conversational content
```

#### Merge Gap (`--merge-gap`)
Merges adjacent same-speaker segments when the gap between them is less than this duration (in seconds).
- **Default**: 0.5 seconds
- **Lower (0.2-0.3)**: Less aggressive merging, preserves more segment boundaries
- **Higher (0.8-1.0)**: More aggressive merging, reduces fragmentation
- **Use case**: Increase if you see many tiny segments from same speaker

Example:
```bash
--merge-gap 0.8  # Aggressively merge fragmented segments
```

#### Minimum Duration (`--min-duration`)
Filters out segments shorter than this duration (in seconds).
- **Default**: 0.3 seconds
- **Lower (0.1-0.2)**: Preserves short utterances like "yes", "okay"
- **Higher (0.5-1.0)**: More aggressive filtering, removes filler words
- **Use case**: Increase to clean up noisy diarization with many tiny segments

Example:
```bash
--min-duration 0.5  # Filter short filler segments
```

### 4. Speaker Clustering Threshold (`--clustering-threshold`)

Controls how aggressively the system groups similar voices together at the diarization level.
- **Default**: ~0.7 (auto, set by pyannote model)
- **Range**: 0.0 to 2.0
- **Lower (0.5-0.6)**: More speakers, less merging (use if different people are incorrectly merged)
- **Higher (0.8-1.0)**: Fewer speakers, more merging (use if one person is incorrectly split)

Example:
```bash
--clustering-threshold 0.9  # Merge voices that sound similar (reduce fragmentation)
```

### 5. Audio Quality
- Clear audio with minimal background noise
- Distinct speaker voices (different pitch, tone)
- Minimal voice overlap (though simultaneous speech is supported)

### 6. Pyannote.audio Version
Current version: Determined by WhisperX 3.7.4 (likely 3.2.x or 3.3.x)
- WhisperX 3.7.4 uses newer pyannote versions with improved clustering
- Supports better speaker separation for similar-sounding voices

### 7. Language Specification
If you know the language, specify it instead of using auto-detection:
```bash
--language fr  # French
--language en  # English
```

### Recommended Workflow for Tuning

1. **First run**: Use defaults to assess baseline quality
2. **If fragmented** (one person → many segments):
   - Increase `--merge-gap` to 0.8
   - Increase `--clustering-threshold` to 0.9
3. **If merged** (different people → one speaker):
   - Decrease `--clustering-threshold` to 0.6
   - Decrease `--merge-gap` to 0.3
4. **If too many tiny segments**:
   - Increase `--min-duration` to 0.5
   - Increase `--merge-gap` to 0.8
5. **If losing short interjections**:
   - Decrease `--min-duration` to 0.2
   - Decrease `--silence-threshold` to 0.3

## Security Considerations

1. **HF_TOKEN**: Always pass via environment variable, never hardcode, never log
2. **Path validation**: Restrict Docker volumes to `/in` and `/out` directories only
3. **Input sanitization**: Validate video filenames to prevent path traversal
4. **Model caching**: Consider bind-mounting a cache directory to avoid re-downloading models

## Testing Strategy

### Python Service
- Unit tests with synthetic diarization data
- Verify `laneMap` determinism (same input → same lane assignments)
- Validate JSON schema compliance
- Test that `t1 > t0` for all segments

### Next.js Overlay
- Mock cues with known segment data
- Freeze `video.currentTime` and verify canvas rendering
- Test query parameter parsing
- Verify multiple simultaneous speakers render correctly

## Acceptance Criteria

1. Docker container processes sample `.mp4` and outputs 3 files (CLI JSON, enhanced JSON, SRT)
2. CLI JSON matches WhisperX format specification with word-level timestamps
3. Enhanced JSON includes confidence scores and metadata for all segments
4. All segments contain transcribed text (no empty text fields)
5. Word arrays are complete with start/end timestamps for every word
6. Output is deterministic (same input → identical output files across runs)
7. SRT file format is valid and compatible with video editors
8. Text quality: Uses original WhisperX transcription when available, word concatenation as fallback

**Note**: When pinning Python library versions, document the reason + version in DEPENDENCIES.md for good memory.