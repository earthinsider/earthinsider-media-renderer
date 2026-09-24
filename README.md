# earthinsider-media-renderer

Standalone service (separate from the n8n instance) that does exactly two
things for EarthInsider's video pipeline:

1. Turns the voiceover script into speech (Kokoro-82M, open source, self-hosted).
2. Renders two videos from a static social image + that audio:
   - `reel.mp4` — 1080x1920 (9:16). Image is never cropped; it's contain-fit
     onto a black canvas, with a slow Ken Burns zoom-in applied.
   - `wide.mp4` — 1920x1080 (16:9). Static, no zoom — image shrunk to fit,
     centered, black backdrop filling the rest.

Both videos' length matches the (sped-up) voiceover's duration.

n8n stays the orchestrator: it calls this service, fetches the two videos,
uploads them to Cloudinary (same sign/upload/delete pattern already used for
the static social image), publishes to the platforms, then tells this
service to delete its temp files.

## Endpoints

### `POST /render`
```json
{
  "text": "the voiceover_hook script",
  "image_url": "https://res.cloudinary.com/earthinsider/.../image.webp",
  "speed": 1.12,          // optional, overrides DEFAULT_SPEED
  "voice": "af_heart"     // optional, overrides DEFAULT_VOICE
}
```
Response:
```json
{
  "job_id": "…",
  "duration_seconds": 27.4,
  "reel_url": "https://<this-service>/files/<job_id>/reel.mp4",
  "wide_url": "https://<this-service>/files/<job_id>/wide.mp4"
}
```

### `GET /files/:jobId/:filename`
Serves `reel.mp4` or `wide.mp4` for that job. Fetch this from n8n with an
HTTP Request node set to response format "file", same as other binary fetches
already used elsewhere in the n8n workflows.

### `DELETE /files/:jobId`
Deletes that job's temp files. Call this once both videos are confirmed
uploaded to Cloudinary. There's also an automatic safety-net cleanup
(`AUTO_CLEANUP_MINUTES`, default 30) in case this never gets called.

## Local setup
```bash
npm install
cp .env.example .env
npm start
# in another terminal:
curl -X POST http://localhost:10000/render \
  -H "Content-Type: application/json" \
  -d '{"text":"This is a test.","image_url":"https://example.com/test.jpg"}'
```

## Deploying on Render
- Push this repo to GitHub, connect it as a **Docker** web service on Render
  (the included `Dockerfile` installs ffmpeg; `render.yaml` is a ready-made
  blueprint if you want to use Render's Blueprints feature).
- Give it real memory headroom — Kokoro (`q8`) plus ffmpeg encoding two
  videos per request needs more than a starter instance. Start at 2GB RAM
  and adjust based on actual render times/costs.
- `KOKORO_DTYPE` can be bumped to `fp32` for the best possible voice quality
  if the plan has RAM/CPU to spare, or dropped to `q4` if you need it
  lighter/faster.

## Things to double-check before relying on this
- **kokoro-js API**: the model id and `.generate()` / `.save()` calls in
  `src/tts.js` are written against kokoro-js's documented usage, but this
  package's API has moved before and this code hasn't been run yet (no
  network access in the environment this was drafted in). Run the local
  test above first — if the API's shifted, `src/tts.js` is the only file
  that needs touching.
- **Zoom feel**: the reel's zoom speed/max zoom are constants at the top of
  `buildReel()` in `src/video.js` — tune `ZOOM_PER_FRAME` / `MAX_ZOOM` there.
- **Canvas sizes**: also constants in `src/video.js` (`W`/`H` in each
  function) if 1080x1920 / 1920x1080 ever need to change.
