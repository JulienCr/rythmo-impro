# rythmo-impro Overlay Suite

Next.js application for speaker diarization visualization overlays for OBS.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

**Then open**: http://localhost:3000/overlay/rythmo

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

## Troubleshooting

**Can't see overlay**: Make sure you're at `/overlay/rythmo`, not just `/`

**Video won't play**: Verify file is in `public/media/` with correct path

**OBS alignment issues**: Match Browser Source dimensions to video resolution

**Performance issues**: Reduce video resolution or check CPU usage in OBS stats
