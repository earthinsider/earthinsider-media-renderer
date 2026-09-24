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

## Render free plan — caveats

Starting on the free plan to test this before paying for anything is
reasonable, but know what you're trading off:

- **512MB RAM, shared CPU.** `KOKORO_DTYPE` defaults to `q4` here
  specifically to leave headroom for Node + ffmpeg alongside the model.
  It's still possible a `/render` call OOMs on a big image or long script —
  if that happens, that's the signal to upgrade the plan (bump back to
  `q8`/`fp32` once you do, for better voice quality).
- **Spins down after ~15 minutes idle**, then cold-starts on the next
  request — expect the first `/render` after a quiet period to take much
  longer (model has to load into memory again) before it settles into
  normal speed.
- **Ephemeral disk** — fine for this service, since job files are meant to
  be temporary anyway and get deleted after upload.
- Free plan is genuinely OK for *testing the pipeline end-to-end*. Once
  n8n is calling this in production on a schedule, a paid instance (no
  spin-down, more RAM, better `dtype`) will give faster and more reliable
  renders.

## Step-by-step setup

1. **Unzip this project** and turn it into its own GitHub repo:
   ```bash
   cd earthinsider-media-renderer
   git init
   git add .
   git commit -m "Initial render service"
   git branch -M main
   git remote add origin https://github.com/<your-username>/earthinsider-media-renderer.git
   git push -u origin main
   ```

2. **Create the service on Render:**
   - Render dashboard → **New** → **Web Service**
   - Connect the GitHub repo you just pushed
   - Environment: **Docker** (Render will auto-detect the `Dockerfile`)
   - Instance type: **Free**
   - Health check path: `/health`

3. **Set environment variables** (Render dashboard → Environment), matching
   `.env.example`:
   - `DEFAULT_SPEED=1.12`
   - `DEFAULT_VOICE=af_heart`
   - `KOKORO_DTYPE=q4`
   - `AUTO_CLEANUP_MINUTES=30`

   (If you'd rather not click through the UI, `render.yaml` in this repo
   already has all of this — use Render's **Blueprints** flow instead and
   it'll read the file directly.)

4. **Deploy** and wait for the build to finish (first build installs ffmpeg
   via the Dockerfile + npm installs kokoro-js — can take a few minutes).

5. **Sanity check** once it's live:
   ```bash
   curl https://<your-service>.onrender.com/health
   ```

6. **Test a real render** (first call will be slow — cold start + first
   model load):
   ```bash
   curl -X POST https://<your-service>.onrender.com/render \
     -H "Content-Type: application/json" \
     -d '{"text":"This is a test of the voice.","image_url":"https://<any-public-image>.jpg"}'
   ```
   You should get back `job_id`, `duration_seconds`, `reel_url`, `wide_url`.
   Open those URLs in a browser to check the actual video output.

7. **Clean up the test job** so it doesn't just sit there until the
   auto-cleanup timer:
   ```bash
   curl -X DELETE https://<your-service>.onrender.com/files/<job_id>
   ```

Once this all works, next step is wiring it into n8n (HTTP Request node →
`POST /render`, then two more HTTP Request nodes with response format
"file" to fetch `reel_url`/`wide_url`).

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
