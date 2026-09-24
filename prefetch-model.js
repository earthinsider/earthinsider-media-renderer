import { KokoroTTS } from "kokoro-js";

// Runs once during `docker build` so the model is already cached inside the
// image by the time the container starts — no download happens on a real
// request anymore, which is what was corrupting under runtime memory
// pressure. Keep this in sync with the KOKORO_DTYPE set in the Dockerfile
// below (changing the quality level means rebuilding, not just changing a
// runtime env var).
const dtype = process.env.KOKORO_DTYPE || "q4";

console.log(`Prefetching Kokoro-82M (dtype=${dtype})...`);
await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype,
});
console.log("Model cached into the image.");
