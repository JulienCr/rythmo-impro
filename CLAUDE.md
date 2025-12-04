# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**rythmo-impro** is an OBS overlay system that visualizes speaker diarization from video files. It consists of:

1. **Dockerized Python service** (`/diarizer/`) - Uses WhisperX + pyannote to perform speaker diarization and output JSON timing data
2. **Next.js overlay application** (`/obs-suite/`) - Renders video with a fixed-lane "bande rythmo" visualization for OBS browser sources

The system takes video files as input, identifies who speaks when (without identity recognition), and displays color-coded lanes showing speech timing suitable for theatrical improvisation rehearsal.

## Architecture

### Python Diarization Service (Docker)

**Location**: `/diarizer/`

- **Entry point**: `main.py` - CLI that accepts video input and outputs JSON
- **Technology**: WhisperX with pyannote.audio for speaker diarization
- **Authentication**: Requires `HF_TOKEN` environment variable (Hugging Face) for pyannote models
- **Input/Output**: Mounted volumes at `/in` (video files) and `/out` (JSON output)

**Critical constraints**:
- Python runs ONLY inside Docker (never on host)
- Input paths must be validated (no directory traversal outside `/in`)
- Never log `HF_TOKEN` in any output
- All times must be in milliseconds (integers)

### Next.js Overlay Application

**Location**: `/obs-suite/`

- **Main page**: `app/overlay/rythmo/page.tsx` (or `pages/overlay/rythmo.tsx` if using pages router)
- **Overlay component**: `components/RythmoOverlay.tsx` - Canvas-based visualization
- **Data loader**: `lib/loadCues.ts` - Types and validation for diarization JSON
- **Static assets**:
  - `/public/media/` - Video files
  - `/public/cues/` - Diarization JSON files

**Technology stack**: Next.js + Tailwind CSS + pnpm

## Data Format

The diarization JSON (`/public/cues/*.json`) follows this schema:

```json
{
  "version": 1,
  "video": {
    "src": "scene01.mp4",
    "durationMs": 123456
  },
  "speakers": [
    { "id": "SPEAKER_00" },
    { "id": "SPEAKER_01" }
  ],
  "segments": [
    { "speaker": "SPEAKER_00", "t0": 2510, "t1": 5320 },
    { "speaker": "SPEAKER_01", "t0": 5400, "t1": 6900 }
  ],
  "laneMap": {
    "SPEAKER_00": 0,
    "SPEAKER_01": 1
  }
}
```

- All times are milliseconds (integers)
- `laneMap` assigns speakers to fixed visual lanes using a deterministic algorithm

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

### Docker (Diarization Service)

```bash
# Build the diarization container
docker build -t obs-rythmo-diarizer ./diarizer

# Run diarization on a video file (basic - uses all defaults)
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer

# With model selection and speaker constraints (recommended for better accuracy)
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --model large-v3 --min-speakers 2 --max-speakers 4

# With segment quality tuning (reduce fragmentation)
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --merge-gap 0.8 --silence-threshold 0.6 --min-duration 0.4

# Full tuning (recommended for production)
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --model large-v3 \
  --min-speakers 2 --max-speakers 4 \
  --merge-gap 0.8 --silence-threshold 0.6 --min-duration 0.4 \
  --clustering-threshold 0.9

# Available Whisper models: tiny, base, small, medium, large, large-v2, large-v3 (default: medium)
# large-v3 provides best accuracy but is slowest
# Available languages: auto, fr, en (default: auto)
# Speaker constraints: Use --min-speakers and --max-speakers when you know the expected range
# Segment tuning: --silence-threshold, --merge-gap, --min-duration (see below for details)
```

### Next.js Application

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

**Overlay URL format** (for OBS Browser Source):
```
http://localhost:3000/overlay/rythmo?video=/media/scene01.mp4&cues=/cues/scene01.json
```

## Key Implementation Details

### RythmoOverlay Component

- Uses `<canvas>` overlay on top of `<video>` element (absolute positioning)
- Updates via `requestAnimationFrame` loop synced to `video.currentTime`
- **Rolling window**: Default ±3s around current playback time
- Draws bars for segments intersecting the window
- Each speaker always appears in their assigned lane (simultaneous speech = multiple bars)
- Canvas must resize to match video dimensions (`videoWidth`/`videoHeight`)

### Visualization Parameters

Default values (configurable via props):
- `windowMs`: 6000 (±3 seconds)
- `laneHeight`: 20 pixels
- `laneGap`: 8 pixels

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

1. Docker container processes sample `.mp4` and outputs valid JSON with ≥1 speaker
2. Overlay displays video with stable top-to-bottom colored lanes
3. Overlapping speech shows multiple bars simultaneously (each in its fixed lane)
4. Visual remains smooth at 60fps on 1080p in OBS Browser Source
5. Lane assignments are deterministic across multiple runs on same video
- when we need to pin a python lib version, keep it the reason + version in a file for good memory