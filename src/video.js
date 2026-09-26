import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Lowered from 1080x1920/1920x1080 @ 25fps — ffmpeg's zoompan filter is
// known to be memory-hungry at higher resolution/frame counts, and that's
// almost certainly what was pushing this past 512MB. 720p is still fine
// for Reels/Shorts. Raise these again once this is running on a plan with
// more RAM.
const REEL_FPS = 18;

/**
 * 9:16 "reel" output — the source image is never cropped: it's contain-fit
 * onto a black canvas, then a slow Ken Burns zoom-in is applied to the
 * whole frame.
 */
export async function buildReel(imagePath, audioPath, durationSec, outPath) {
  const W = 720;
  const H = 1280;
  const frames = Math.max(1, Math.round(durationSec * REEL_FPS));
  const ZOOM_PER_FRAME = 0.0008; // re-tuned for the lower fps so the total zoom over the clip looks about the same
  const MAX_ZOOM = 1.08;

  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
    `zoompan=z='min(zoom+${ZOOM_PER_FRAME},${MAX_ZOOM})':d=${frames}:s=${W}x${H}:fps=${REEL_FPS}`;

  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast", // lower memory + faster than the default preset, minor quality trade-off that doesn't matter for a social clip
    "-threads", "1", // caps ffmpeg's own parallelism — fewer concurrent frame buffers in memory on a constrained instance
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    outPath,
  ]);
}

/**
 * 16:9 "wide" output — static (no zoom). The image is shrunk to fit inside
 * the canvas, centered, with the rest of the frame filled black. No
 * zoompan here, so this was very unlikely to be the source of the OOM —
 * left at a slightly higher resolution since it's the cheaper of the two.
 */
export async function buildWide(imagePath, audioPath, durationSec, outPath) {
  const W = 1280;
  const H = 720;

  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`;

  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    outPath,
  ]);
}
