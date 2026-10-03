import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function buildStatic(imagePath, audioPath, durationSec, outPath, W, H) {
  // setsar=1 explicitly declares square pixels — fixes YouTube Shorts
  // rejecting the video for not being detected as portrait orientation.
  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
    `setsar=1`;

  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-threads", "1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    outPath,
  ]);
}

// 9:16 reel — 1080×1920, static, centered, black backdrop
export async function buildReel(imagePath, audioPath, durationSec, outPath) {
  return buildStatic(imagePath, audioPath, durationSec, outPath, 1080, 1920);
}

// 16:9 wide — 1920×1080, static, centered, black backdrop
export async function buildWide(imagePath, audioPath, durationSec, outPath) {
  return buildStatic(imagePath, audioPath, durationSec, outPath, 1920, 1080);
}
