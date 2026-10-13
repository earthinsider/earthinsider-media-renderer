import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function buildVideo(imagePath, audioPath, durationSec, outPath, W, H, extraArgs = [], assPath = null) {
  let vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
    `setsar=1`;

  if (assPath) vf += `,ass=${assPath}`; // burn in the captions

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
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(durationSec),
    ...extraArgs,
    outPath,
  ]);
}

// 9:16 reel — 1080x1920, black bars. -aspect 9:16 flags it as portrait for YouTube Shorts.
export async function buildReel(imagePath, audioPath, durationSec, outPath, assPath = null) {
  return buildVideo(imagePath, audioPath, durationSec, outPath, 1080, 1920, ["-aspect", "9:16"], assPath);
}

// 16:9 wide — 1920x1080, black sides.
export async function buildWide(imagePath, audioPath, durationSec, outPath, assPath = null) {
  return buildVideo(imagePath, audioPath, durationSec, outPath, 1920, 1080, [], assPath);
}
