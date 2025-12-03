## Goal

Implement an MVP that:

* Takes a **video file** as input.
* Runs **speaker diarization** (who speaks when) via **WhisperX + pyannote** in **Docker (Python)**.
* Emits a **minimal JSON** with segments per unknown speaker (`SPEAKER_00`, …).
* Provides a **Next.js page** (OBS browser-source friendly) that **plays the video** and draws a **fixed-lane “bande rythmo”** overlay:

  * Lanes are **stable** (e.g., Lane 0 = Blue always on top, Lane 1 = Red middle, Lane 2 = Yellow bottom).
  * When multiple speakers talk simultaneously, **multiple lanes show bars at once**.
* No rhythm/pitch/intonation; **timings only**.

## Non-Goals

* No identity recognition.
* No live audio capture.
* No rhythm/intonation visualization.

## Constraints

* Python runs **only inside Docker**.
* Use **WhisperX** diarization with **pyannote** (Hugging Face token via env).
* Output JSON ms-based, compact.
* Integrate in existing **Next.js + Tailwind** app (“OBS Suite”), **pnpm**.

## Deliverables (files & structure)

```
/diarizer/
  Dockerfile
  requirements.txt
  main.py                 # CLI entrypoint: runs WhisperX diarization → cues.json
  README.md
/obs-suite/               # existing Next.js app
  app/overlay/rythmo/page.tsx      # or pages/overlay/rythmo.tsx (if pages router)
  components/RythmoOverlay.tsx
  lib/loadCues.ts
  public/media/scene01.mp4
  public/cues/scene01.json
```

## Diarization JSON (output schema)

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

* Times in **ms** integers.
* `laneMap` = stable assignment **after** seeing all speakers (deterministic rule below).
* `durationMs` from the video (fallback: compute via ffprobe inside container).

## Lane & Color Policy

* Fixed lane indices: **0=Blue, 1=Red, 2=Yellow, 3=Green, 4=Purple** (extendable).
* Deterministic speaker→lane assignment:

  1. Sort speakers by **total spoken duration desc**.
  2. Assign to lanes in order `[0,1,2,3,4]`.
  3. Persist mapping in `laneMap`.
* Default colors (Tailwind/CSS vars OK):

  * `0: #007AFF` (Blue, top)
  * `1: #FF3B30` (Red, middle)
  * `2: #FFD60A` (Yellow, bottom)
  * `3: #34C759` (Green)
  * `4: #AF52DE` (Purple)

## Dockerized Python (WhisperX + pyannote)

**requirements.txt**

* `whisperx==<latest-stable>`
* `torch` / `torchaudio` (CPU by default; allow CUDA if base image supports)
* `ffmpeg-python` or shell ffmpeg
* `numpy`, `tqdm`
* `pyannote.audio` (as required by WhisperX for diarization)

**Dockerfile (CPU base, minimal)**

* Base: `python:3.10-slim`
* Install `ffmpeg`, system deps.
* `pip install -r requirements.txt`
* `ENV HF_TOKEN=...` (not hardcoded)
* `ENTRYPOINT ["python", "/app/main.py"]`

**main.py (CLI)**

* Args:

  * `--input /in/video.mp4`
  * `--output /out/cues.json`
  * `--model tiny|base|small|medium` (default small)
  * `--language auto|fr|en` (default auto)
* Steps:

  1. Validate input path (no traversal outside `/in`).
  2. Use WhisperX to transcribe **with diarization enabled** (pyannote; needs `HF_TOKEN` env).
  3. Extract **(speaker, start, end)** tuples from diarization result.
  4. Compute `durationMs` (ffprobe).
  5. Aggregate total durations per speaker, sort, build `laneMap`.
  6. Emit JSON per schema.
* Robustness:

  * Catch errors; exit non-zero on failure.
  * Do **not** log `HF_TOKEN`.
  * Ensure ms rounding and `t1 > t0`.

**Run examples**

```bash
# build
docker build -t obs-rythmo-diarizer ./diarizer

# run (CPU)
docker run --rm -e HF_TOKEN=$HF_TOKEN \
  -v "$PWD/in":/in -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --input /in/scene01.mp4 --output /out/scene01.json --model small
```

## Next.js Overlay (HTML + video + canvas)

**Functional spec**

* Single page that:

  1. Loads `videoSrc` and `cuesUrl` from query string (or static files).
  2. Renders `<video src="/media/scene01.mp4" muted playsInline controls>` (muted if needed).
  3. Draws **canvas overlay** with **fixed lanes**:

     * For each `segment` whose `[t0, t1]` intersects a **rolling window** around `currentTime`, draw a bar in its lane.
     * MVP window: currentTime ± 3s; draw future segments with 50% opacity (optional).
     * Bar X position = linear map of time within window; Y = `laneIndex * laneHeight`.
     * Fill color = lane color; simple rounded rect.
  4. Repaint on `timeupdate` / `requestAnimationFrame`.

**RythmoOverlay.tsx**

* Props: `{ videoRef, cues, windowMs=6000, laneHeight=20, laneGap=8 }`
* Compute `lanes = max(laneMap)+1`.
* `useEffect` + `requestAnimationFrame` loop to:

  * Read `videoRef.current.currentTime`.
  * Convert to ms; compute window; filter segments; draw.

**page.tsx**

* Read `?video=/media/scene01.mp4&cues=/cues/scene01.json`.
* `fetch(cues)` on mount; set state.
* Render `<video>` and `<canvas>` stacked (absolute overlay).
* Tailwind container with aspect-fit; ensure canvas resizes to video size (observe `videoWidth/Height`).

**lib/loadCues.ts**

* Type definitions for JSON.
* Validator (basic shape check).

**Tailwind**

* Minimal utility classes; no external UI libs required.

## OBS Integration

* Use **Browser Source** pointing to overlay URL, e.g.:

  * `http://localhost:3000/overlay/rythmo?video=/media/scene01.mp4&cues=/cues/scene01.json`
* Size = video resolution; disable hardware acceleration quirks if needed.
* Audio: you can keep the video muted (overlay only) or audible for rehearsal; Twitch output can be the actors’ mics.

## Determinism & Testing

* Ensure `laneMap` is deterministic (total duration desc; tie-break by earliest first speech).
* Unit test (Python): given synthetic diarization, check `laneMap` and JSON structure.
* Frontend test: mock cues; freeze `currentTime`; snapshot canvas (optional).

## Security & Ops

* HF token via env (`HF_TOKEN`), never logged.
* Sanitize input names; restrict volumes to `/in` and `/out`.
* Cache models in Docker layer or bind mount a cache dir to avoid re-download.

## Acceptance Criteria

* `docker run ...` on a sample `.mp4` yields `/out/scene01.json` matching schema with ≥1 speaker and valid times.
* Next.js page displays video and **stable top-to-bottom lanes** (Blue, Red, Yellow, …).
* When overlapping speech occurs, **multiple bars** are visible simultaneously (each in its fixed lane).
* Visual remains smooth at 60fps on 1080p in OBS Browser Source.

