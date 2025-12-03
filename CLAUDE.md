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

# Run diarization on a video file
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --input /in/scene01.mp4 --output /out/scene01.json --model small

# Available models: tiny, base, small, medium (default: small)
# Available languages: auto, fr, en (default: auto)
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