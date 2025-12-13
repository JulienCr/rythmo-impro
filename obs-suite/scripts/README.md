# OBS Suite Scripts

This directory contains CLI scripts for processing video diarization and FCP XML generation.

## Available Scripts

### 1. `process-video.ts` (Recommended)

**Interactive CLI for complete video processing pipeline**

Orchestrates the complete workflow: diarization → FCP XML generation.

```bash
# Interactive mode - process all videos with prompts
pnpm process-video

# Process all videos without prompts (skip existing)
pnpm process-video --all

# Process specific video
pnpm process-video juste-leblanc.mp4

# Force regenerate everything
pnpm process-video --all --force
```

**Features**:
- **Batch processing**: Processes all videos in `/in` directory by default
- **Smart skip-existing**: Automatically skips files that already exist
- **Interactive configuration**: Prompts for model selection and speaker constraints
- **WSL integration**: Uses `run-wsl.sh` to run Python diarization
- **Colored output**: Beautiful terminal UI with chalk

**Use when**: You want an automated workflow for processing multiple videos end-to-end.

---

### 2. `generateFcpxml.ts`

**Generate FCP XML from CLI JSON diarization data**

```bash
pnpm generate-fcpxml <input.cli.json> <video.mp4> <output.xml>

# Example:
pnpm generate-fcpxml ../out/juste-leblanc.cli.json ../in/juste-leblanc.mp4 ../out/juste-leblanc.xml
```

**Use when**: You already have diarization outputs and only need FCP XML.

---

### 3. `convertFcpxml.ts`

**Convert FCP XML to character tracks JSON**

```bash
pnpm convert-fcpxml <input.xml> <output.json>

# Example:
pnpm convert-fcpxml public/fcpxml/scene.xml public/tracks/scene.json
```

**Use when**: You manually edited FCP XML in a video editor and want to convert it back to JSON format for visualization.

---

## Workflow Comparison

### Option A: Interactive CLI (Recommended)
```bash
cd obs-suite
pnpm process-video
# Processes all videos → generates FCP XML → done!
```

### Option B: Manual (Advanced)
```bash
# 1. Run diarization (from project root)
./diarizer/run-wsl.sh --input-dir ./in --output-dir ./out

# 2. Generate FCP XML for each video
cd obs-suite
pnpm generate-fcpxml ../out/video.cli.json ../in/video.mp4 ../out/video.xml
```

---

## Prerequisites

All scripts require:
- **Node.js** and **pnpm** installed
- Dependencies installed: `pnpm install`

Diarization-related scripts additionally require:
- **WSL environment** with Python venv setup
- **HF_TOKEN** in `diarizer/.env`
- Setup complete: `cd diarizer && ./setup-wsl.sh`

---

## Directory Structure

Scripts expect this structure:
```
rythmo-impro/
├── in/                      # Input videos
│   ├── video1.mp4
│   └── video2.mp4
├── out/                     # Generated outputs
│   ├── video1.cli.json
│   ├── video1.enhanced.json
│   ├── video1.srt
│   └── video1.xml
├── diarizer/                # Python diarization service
│   ├── run-wsl.sh           # WSL wrapper script
│   ├── main.py              # Diarization logic
│   └── .env                 # HF_TOKEN configuration
└── obs-suite/
    └── scripts/             # This directory
        ├── process-video.ts
        ├── generateFcpxml.ts
        └── convertFcpxml.ts
```

---

## Output Files

Each video generates:

| File | Format | Purpose |
|------|--------|---------|
| `video.cli.json` | CLI JSON | WhisperX-compatible format for CLI audio players |
| `video.enhanced.json` | Enhanced JSON | Includes confidence scores and metadata |
| `video.srt` | SRT subtitles | Standard subtitle format with speaker labels |
| `video.xml` | FCP XML | Final Cut Pro XML for import into NLEs (Premiere, Resolve, etc.) |

---

## Default Behavior

### Skip Existing (Enabled by Default)
- Diarization outputs (`.cli.json`, `.enhanced.json`, `.srt`) are skipped if they exist
- FCP XML (`.xml`) is skipped if it exists
- Use `--force` to override and regenerate everything

### Model Selection
- **Default model**: `large-v3` (best accuracy, slowest)
- Can be changed via interactive prompts or command-line arguments

### Batch Processing
- Processes **all videos** in `/in` directory by default
- Can specify a single video as an argument

---

## Tips

- **Use `--all` for automation**: Skips all prompts and processes everything
- **Use `--force` sparingly**: Diarization is expensive (GPU/time)
- **Check existing outputs**: Script shows status before processing
- **Run setup first**: `cd diarizer && ./setup-wsl.sh` before first use
- **Set HF_TOKEN**: Create `diarizer/.env` with your Hugging Face token

---

## Troubleshooting

**"HF_TOKEN environment variable is required"**
```bash
cd diarizer
echo "HF_TOKEN=your_huggingface_token" > .env
```

**"Diarization script not found"**
```bash
cd diarizer
./setup-wsl.sh
```

**"No video files found in /in"**
- Ensure videos are placed in `rythmo-impro/in/` directory
- Supported formats: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

**"CUDA not available"**
- The script will automatically fall back to CPU (slower)
- Ensure CUDA is properly configured in WSL if you want GPU acceleration

---

## Examples

### Process all videos with defaults
```bash
cd obs-suite
pnpm process-video --all
```

### Process specific video with custom settings
```bash
cd obs-suite
pnpm process-video juste-leblanc.mp4
# Follow interactive prompts to configure model and speaker constraints
```

### Force regenerate everything
```bash
cd obs-suite
pnpm process-video --all --force
```

### Direct diarization (bypass TypeScript wrapper)
```bash
./diarizer/run-wsl.sh --input-dir ./in --output-dir ./out --model large-v3 --min-speakers 2 --max-speakers 4
```
