import { KokoroTTS } from "kokoro-js";

// Loaded once and kept warm in memory for the life of the service,
// so repeated /render calls don't reload the model every time.
let ttsInstance = null;

async function getTTS() {
  if (!ttsInstance) {
    // Model id / dtype per kokoro-js's own docs at the time this was written.
    // Verify these against whatever kokoro-js version actually installs —
    // this package's API has changed before, and it hasn't been run here.
    //
    // dtype options (roughly best quality -> fastest/lightest):
    //   "fp32" > "fp16" > "q8" > "q4"
    // "q8" is a reasonable default balance of quality vs CPU load on Render.
    // Bump to "fp32" if you want the best possible quality and the Render
    // plan has the RAM/CPU to spare.
    ttsInstance = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: process.env.KOKORO_DTYPE || "q8" }
    );
  }
  return ttsInstance;
}

/**
 * Generates speech audio for `text` and writes it to `outputPath` (wav).
 */
export async function generateSpeech(text, outputPath, { voice } = {}) {
  const tts = await getTTS();
  const chosenVoice = voice || process.env.DEFAULT_VOICE || "af_heart";
  const audio = await tts.generate(text, { voice: chosenVoice });
  await audio.save(outputPath);
}
