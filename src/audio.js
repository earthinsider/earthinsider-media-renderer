import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Speeds up an audio file without changing its pitch, using ffmpeg's
 * atempo filter. atempo accepts 0.5–2.0 in a single pass, which covers
 * any realistic speed-up for a voiceover.
 */
export async function speedUpAudio(inputPath, outputPath, speed = 1.12) {
  await run("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-filter:a", `atempo=${speed}`,
    "-vn",
    outputPath,
  ]);
}

/**
 * Returns the duration (in seconds, float) of an audio/video file via ffprobe.
 */
export async function getAudioDuration(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`Could not read duration from ${filePath}`);
  }
  return seconds;
}
