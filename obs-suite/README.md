# rythmo-impro Overlay Suite

Next.js application for speaker diarization visualization overlays for OBS.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server (default port 3000)
pnpm dev

# Or with custom port
PORT=8080 NEXT_PUBLIC_PORT=8080 pnpm dev
```

**Then open**: http://localhost:3000/overlay/rythmo (or your custom port)

## Usage

### Development

View the overlay with default example video:
```
http://localhost:3000/overlay/rythmo
```

With custom video and cues:
```
http://localhost:3000/overlay/rythmo?video=/media/your-video.mp4&cues=/cues/your-video.json
```

### OBS Integration

1. In OBS, add **Browser Source**
2. Configure:
   - URL: `http://localhost:3000/overlay/rythmo`
   - Width: 1920 (match your video resolution)
   - Height: 1080 (match your video resolution)
   - FPS: 60
3. The overlay displays colored bars showing who speaks when

## Adding New Videos

1. Place video file in `public/media/`
2. Run diarization (see main project README in parent directory)
3. Place generated JSON in `public/cues/`
4. Access via: `?video=/media/YOUR_VIDEO.mp4&cues=/cues/YOUR_VIDEO.json`

## Lane Colors

- Lane 0 (top): Blue (#007AFF)
- Lane 1: Red (#FF3B30)
- Lane 2: Yellow (#FFD60A)
- Lane 3: Green (#34C759)
- Lane 4: Purple (#AF52DE)

## Project Structure

```
obs-suite/
├── app/overlay/rythmo/page.tsx    # Main overlay page
├── components/RythmoOverlay.tsx   # Canvas visualization (60fps)
├── lib/loadCues.ts                # Type definitions & validation
├── public/
│   ├── media/                     # Video files
│   └── cues/                      # Diarization JSON
```

## Features

- **Rolling window**: ±3 seconds around current playback time
- **60fps rendering**: Smooth canvas-based visualization
- **Fixed lanes**: Each speaker stays in the same lane
- **Simultaneous speech**: Multiple speakers shown at once
- **Type-safe**: TypeScript with runtime JSON validation

## Configuration

### Port Configuration

The server port can be customized via environment variables:

**Option 1: Command line**
```bash
PORT=8080 NEXT_PUBLIC_PORT=8080 pnpm dev
```

**Option 2: .env file**
```bash
# Copy example config
cp .env.example .env

# Edit .env and set:
PORT=8080
NEXT_PUBLIC_PORT=8080
NEXT_PUBLIC_HOSTNAME=localhost

# Run normally
pnpm dev
```

**Important**:
- `PORT` - Server port (used by Node.js server)
- `NEXT_PUBLIC_PORT` - Public port (exposed to browser for WebSocket)
- These should **always match** for WebSocket to work correctly
- WebSocket automatically uses the correct port when accessed via browser

### Available Overlays

- `/overlay/rythmo` - Legacy single-video overlay with bande rythmo
- `/overlay/composite` - **New!** Dual-video overlay with character info and bande rythmo (16:9 ratio)

## Troubleshooting

**Can't see overlay**: Make sure you're at `/overlay/rythmo` or `/overlay/composite`, not just `/`

**Video won't play**: Verify file is in `public/media/` with correct path

**WebSocket connection failed**: Ensure PORT and NEXT_PUBLIC_PORT match in your .env file

**OBS alignment issues**: Match Browser Source dimensions to video resolution

**Performance issues**: Reduce video resolution or check CPU usage in OBS stats
