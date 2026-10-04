import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Background: same image scaled to fill canvas, heavy blur + darkened.
// Foreground: original image scaled to fit, centered.
// No pure black bars — the blurred image fills the leftover space.
function blurBgFilter(W, H) {
  return (
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},` +
    `boxblur=luma_radius=25:luma_power=1,` +
    `eq=brightness=-0.40[bg];` +
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,` +
    `setsar=1[out]`
  );
}

async function buildVideo(imagePath, audioPath, durationSec, outPath, W, H, extraArgs = []) {
  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-filter_complex", blurBgFilter(W, H),
    "-map", "[out]",
    "-map", "1:a",
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

// 9:16 reel — 1080x1920
// -aspect 9:16 explicitly flags the container as vertical so Buffer/YouTube
// correctly detect portrait orientation (setsar=1 alone wasn't enough).
export async function buildReel(imagePath, audioPath, durationSec, outPath) {
  return buildVideo(imagePath, audioPath, durationSec, outPath, 1080, 1920, ["-aspect", "9:16"]);
}

// 16:9 wide — 1920x1080
export async function buildWide(imagePath, audioPath, durationSec, outPath) {
  return buildVideo(imagePath, audioPath, durationSec, outPath, 1920, 1080);
}
