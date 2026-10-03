import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || "en-US-ChristopherNeural";

/**
 * edge-tts (Microsoft Edge Neural TTS) — no local model, no API key.
 * Calls Microsoft servers directly. Much better quality than MeloTTS.
 * Outputs MP3 to outputPath.
 */
export async function generateSpeech(text, outputPath, { voice } = {}) {
  const chosenVoice = voice || DEFAULT_VOICE;
  await run("edge-tts", [
    "--voice", chosenVoice,
    "--text",  text,
    "--write-media", outputPath,
  ]);
}
