import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Speed up audio (pitch preserved) and prepend silence for the hook text.
 * silenceBefore: seconds of silence added at the start so the hook text
 * shows before the voiceover begins.
 */
export async function speedUpAudio(inputPath, outputPath, speed = 1.0, silenceBefore = 2.0) {
  const delayMs  = Math.round(silenceBefore * 1000);
  const filterStr = `adelay=${delayMs}|${delayMs},atempo=${speed}`;

  await run("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-filter:a", filterStr,
    "-vn",
    outputPath,
  ]);
}

export async function getAudioDuration(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const s = parseFloat(stdout.trim());
  if (!Number.isFinite(s)) throw new Error(`Cannot read duration from ${filePath}`);
  return s;
}
