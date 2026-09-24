import { writeFile } from "node:fs/promises";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_TTS_MODEL = process.env.CLOUDFLARE_TTS_MODEL || "@cf/myshell-ai/melotts";

/**
 * Generates speech for `text` via Cloudflare Workers AI and writes it to
 * `outputPath`. Runs on Cloudflare's infrastructure, not on this box — so
 * it doesn't touch Render's memory budget at all, unlike a locally-loaded
 * model.
 *
 * NOTE: this was written without network access to test against a live
 * response, going off Cloudflare Workers AI's usual request/response
 * pattern (same account you already use for the Flux image node). It
 * handles both plausible response shapes — raw audio bytes, or a JSON
 * `{ result: { audio: "<base64>" } }` wrapper — but if it errors with
 * "Unexpected Cloudflare TTS response shape", check the logged raw
 * response and adjust the `data?.result?.audio` line below to match
 * whatever field Cloudflare actually returns.
 */
export async function generateSpeech(text, outputPath) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set (use the same account + token as the existing Flux image node)"
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_TTS_MODEL}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloudflare TTS request failed (${res.status}): ${errText}`);
  }

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("audio")) {
    // Cloudflare returned raw audio bytes directly.
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outputPath, buf);
    return;
  }

  // Otherwise assume the { result: { ... } } JSON wrapper Cloudflare
  // Workers AI uses for its other models, with base64 audio inside.
  const data = await res.json();
  const base64Audio = data?.result?.audio;

  if (!base64Audio) {
    throw new Error(
      `Unexpected Cloudflare TTS response shape: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  await writeFile(outputPath, Buffer.from(base64Audio, "base64"));
}
