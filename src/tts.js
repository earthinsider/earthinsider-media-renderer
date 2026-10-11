import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || "en-US-ChristopherNeural";

/**
 * edge-tts: Microsoft Edge Neural TTS — no local model, no API key.
 * Outputs MP3 audio to audioPath and optional word-level VTT to subtitlePath.
 */
export async function generateSpeech(text, audioPath, subtitlePath, { voice } = {}) {
  const chosenVoice = voice || DEFAULT_VOICE;
  const args = [
    "--voice", chosenVoice,
    "--text",  text,
    "--write-media", audioPath,
  ];
  if (subtitlePath) args.push("--write-subtitles", subtitlePath);
  await run("edge-tts", args);
}
