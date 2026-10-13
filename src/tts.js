import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || "en-US-ChristopherNeural";
const TTS_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "tts.py");

/**
 * edge-tts (Microsoft Edge neural voices): no local model, no API key.
 * Writes an mp3 to audioPath and word-level timings (JSON) to wordsPath.
 */
export async function generateSpeech(text, audioPath, wordsPath, { voice } = {}) {
  await run("python3", [TTS_PY, text, voice || DEFAULT_VOICE, audioPath, wordsPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
}
