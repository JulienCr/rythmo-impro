# Rythmo-Impro Diarization Service

Speaker diarization service using WhisperX and pyannote.audio. Analyzes video files to identify who speaks when, outputting timing data for the rythmo overlay visualization.

**Supported environments:**
- ✅ **WSL (Windows Subsystem for Linux)** - Recommended for Windows development
- ✅ **Docker** - For production or isolated environments
- ✅ **Native Linux** - Works directly on Linux systems

## Prerequisites

### 1. Hugging Face Token (Required)

pyannote.audio requires authentication with Hugging Face.

**Get your token:**

1. Create a free account at [huggingface.co](https://huggingface.co/)
2. Go to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
3. Click "New token" and create a token with `read` permission
4. Accept the user agreement for pyannote models:
   - Visit [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
   - Click "Agree and access repository"
   - Visit [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
   - Click "Agree and access repository"

**Set your token:**

Create a `.env` file in the `diarizer/` directory:

```bash
# diarizer/.env
HF_TOKEN=your_token_here
```

**Important:** The `.env` file is automatically ignored by git. Never commit your token!

---

## Setup Method 1: WSL (Recommended for Windows)

This is the simplest and fastest method for development on Windows.

### Initial Setup

```bash
# In WSL terminal, navigate to the repository
cd /mnt/d/dev/rythmo-impro

# Run the setup script (one-time setup)
cd diarizer
./setup-wsl.sh
```

The setup script will:
- Install Python 3.10, ffmpeg, and system dependencies
- Create a virtual environment
- Install PyTorch (with CUDA support if available)
- Install WhisperX and all dependencies

### Running Diarization

```bash
# From repository root
./diarizer/run-wsl.sh --input in/video.mp4 --output out/cues.json

# With options
./diarizer/run-wsl.sh \
  --input in/scene01.mp4 \
  --output out/scene01.json \
  --model small \
  --language fr
```

The run script automatically:
- Activates the virtual environment
- Loads your HF_TOKEN from `.env`
- Runs the diarization

### Available Options

```bash
--input     # Input video file path (required)
--output    # Output JSON file path (required)
--model     # Whisper model size: tiny, base, small, medium (default: small)
--language  # Language code: auto, en, fr, es, etc. (default: auto)
```

---

## Setup Method 2: Docker

For production or if you prefer containerized environments.

### Building the Container

```bash
# From the repository root
docker build -t obs-rythmo-diarizer ./diarizer
```

This will take several minutes on first build as it downloads models and dependencies.

### Docker Usage

```bash
# From the repository root
docker run --rm \
  --env-file ./diarizer/.env \
  -v "$PWD/in":/in \
  -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --input /in/scene01.mp4 \
  --output /out/scene01.json
```

### With GPU Acceleration

```bash
# From the repository root
docker run --rm --gpus all \
  --env-file ./diarizer/.env \
  -v "$PWD/in":/in \
  -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --input /in/scene01.mp4 \
  --output /out/scene01.json \
  --model small
```

### Docker Example with Specific Language

```bash
# From the repository root
docker run --rm --gpus all \
  --env-file ./diarizer/.env \
  -v "$PWD/in":/in \
  -v "$PWD/out":/out \
  obs-rythmo-diarizer \
  --input /in/scene_fr.mp4 \
  --output /out/scene_fr.json \
  --model small \
  --language fr
```

---

## Model Options

**Model sizes** (applies to both WSL and Docker):
- `tiny`: Fastest, least accurate (~1GB RAM, ~2 min for 10min video on GPU)
- `base`: Fast, decent accuracy (~1GB RAM, ~3 min for 10min video on GPU)
- `small`: Balanced - **default** (~2GB RAM, ~5 min for 10min video on GPU)
- `medium`: Slower, more accurate (~5GB RAM, ~10 min for 10min video on GPU)

**Language options:**
- `auto`: Automatic detection (default)
- `en`: English
- `fr`: French
- `es`: Spanish
- See [Whisper documentation](https://github.com/openai/whisper) for all supported languages

---

## Output Format

The service generates a JSON file with this structure:

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

**Lane assignment** is deterministic:
1. Speakers sorted by total spoken duration (descending)
2. Tie-breaker: earliest first speech time
3. Assigned to lanes 0, 1, 2, 3, 4... in order

## Troubleshooting

### WSL-Specific Issues

**"Command not found: ./setup-wsl.sh"**
- Make sure you're in WSL, not Windows PowerShell/CMD
- Verify the script is executable: `chmod +x diarizer/setup-wsl.sh diarizer/run-wsl.sh`

**"Virtual environment not found"**
- Run the setup script first: `cd diarizer && ./setup-wsl.sh`

**WSL can't find the repository**
- Windows drives are mounted at `/mnt/c/`, `/mnt/d/`, etc.
- Example: `cd /mnt/d/dev/rythmo-impro`

### General Issues

**"HF_TOKEN environment variable is required"**
- **WSL**: Make sure `diarizer/.env` exists with your token
- **Docker**: Pass the env file with `--env-file ./diarizer/.env`

### "Could not authenticate" or "Repository not found"

You need to accept the user agreements for pyannote models (see Prerequisites section above).

### "CUDA out of memory"

Try a smaller model (`--model tiny` or `--model base`) or run without `--gpus all` to use CPU.

### Slow processing on CPU

This is expected. GPU acceleration is 10-20x faster. Consider:
- Using a smaller model (`--model tiny`)
- Processing shorter video clips
- Using a machine with CUDA support

### "Input path must be within /in" (Docker only)

For security, the Docker service only accepts input files from the `/in` volume. Make sure your video file is in the directory you mounted to `/in`.

For WSL, you can use any path on your system.

## Performance Notes

**Model caching**:
- **WSL**: Models are cached in `~/.cache/huggingface` automatically
- **Docker**: Models are downloaded on first run. To persist the cache across runs:

```bash
# From the repository root
docker run --rm --gpus all \
  --env-file ./diarizer/.env \
  -v "$PWD/in":/in \
  -v "$PWD/out":/out \
  -v "$PWD/cache":/tmp/huggingface \
  obs-rythmo-diarizer \
  --input /in/scene01.mp4 \
  --output /out/scene01.json
```

## Security

- **Never log or commit your HF_TOKEN**
- Input paths are validated to prevent directory traversal
- Only files within `/in` volume can be accessed
- Consider using read-only mounts: `-v "$PWD/in":/in:ro`

## Next Steps

After generating the JSON file, copy it to your Next.js application:

```bash
cp out/scene01.json ../obs-suite/public/cues/
cp in/scene01.mp4 ../obs-suite/public/media/
```

Then use the overlay page with:
```
http://localhost:3000/overlay/rythmo?video=/media/scene01.mp4&cues=/cues/scene01.json
```
