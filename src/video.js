import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const FPS = 25;

/**
 * 9:16 "reel" output — the source image is never cropped: it's contain-fit
 * onto a 1080x1920 black canvas, then a slow Ken Burns zoom-in is applied
 * to the whole frame. Some of the black backdrop will get zoomed into as
 * well (that's normal Ken Burns behaviour) — only the image's own content
 * is never cut to force-fit the aspect ratio.
 *
 * Tune the canvas size or zoom speed by editing the constants below.
 */
export async function buildReel(imagePath, audioPath, durationSec, outPath) {
  const W = 1080;
  const H = 1920;
  const frames = Math.max(1, Math.round(durationSec * FPS));
  const ZOOM_PER_FRAME = 0.0006; // increase for a more noticeable zoom
  const MAX_ZOOM = 1.08;

  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
    `zoompan=z='min(zoom+${ZOOM_PER_FRAME},${MAX_ZOOM})':d=${frames}:s=${W}x${H}:fps=${FPS}`;

  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-vf", vf,
    "-c:v", "libx264",
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
 * a 1920x1080 canvas, centered, with the rest of the frame filled black.
 */
export async function buildWide(imagePath, audioPath, durationSec, outPath) {
  const W = 1920;
  const H = 1080;

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
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    outPath,
  ]);
}
