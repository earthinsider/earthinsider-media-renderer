import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Builds the final voice track:
 *   [hook] + short pause + [script]  ->  speed change (pitch preserved)  ->  small tail of silence
 * The hook is optional. Returns nothing; use getAudioDuration() afterwards.
 */
export async function buildFinalAudio({ hookPath, scriptPath, outputPath, speed = 1.0, pause = 0.35, tail = 0.4 }) {
  const tempo = Math.min(2, Math.max(0.5, Number(speed) || 1));
  let inputs, filter;

  if (hookPath) {
    inputs = ["-i", hookPath, "-i", scriptPath];
    filter =
      `[0:a]apad=pad_dur=${pause}[h];` +
      `[h][1:a]concat=n=2:v=0:a=1[c];` +
      `[c]atempo=${tempo},apad=pad_dur=${tail}[out]`;
  } else {
    inputs = ["-i", scriptPath];
    filter = `[0:a]atempo=${tempo},apad=pad_dur=${tail}[out]`;
  }

  await run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[out]",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    outputPath,
  ]);

  return tempo;
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
