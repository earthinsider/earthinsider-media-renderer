import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Shared renderer: contain-fits the image onto a WxH black canvas (no crop,
 * no zoom, static) and muxes it with the audio for durationSec.
 */
async function buildStatic(imagePath, audioPath, durationSec, outPath, W, H) {
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
    "-preset", "fast", // was "veryfast" for zoompan's sake — a bit slower but noticeably better quality-per-bit, safe now that there's no zoom to buffer
    "-crf", "20", // lower = higher quality (libx264 default is 23); 18-20 is a solid "looks noticeably sharper" range
    "-threads", "1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    outPath,
  ]);
}

// 9:16 "reel" — image contain-fit, centered, black backdrop. Static now (no
// zoom/zoompan) per request — this also removes what was almost certainly
// the biggest memory cost in the whole pipeline.
export async function buildReel(imagePath, audioPath, durationSec, outPath) {
  return buildStatic(imagePath, audioPath, durationSec, outPath, 1080, 1920);
}

// 16:9 "wide" — same treatment, different canvas.
export async function buildWide(imagePath, audioPath, durationSec, outPath) {
  return buildStatic(imagePath, audioPath, durationSec, outPath, 1920, 1080);
}
