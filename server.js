import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

import { generateSpeech } from "./src/tts.js";
import { speedUpAudio, getAudioDuration } from "./src/audio.js";
import { buildReel, buildWide } from "./src/video.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const JOBS_DIR = path.join(process.cwd(), "jobs");
const DEFAULT_SPEED = Number(process.env.DEFAULT_SPEED || 1.12);
// Safety net: auto-delete a job's files this long after creation, in case
// the caller (n8n) never hits DELETE /files/:jobId after uploading to Cloudinary.
const AUTO_CLEANUP_MS =
  Number(process.env.AUTO_CLEANUP_MINUTES || 30) * 60 * 1000;

await mkdir(JOBS_DIR, { recursive: true });

function jobDir(jobId) {
  return path.join(JOBS_DIR, jobId);
}

function publicUrl(req, jobId, filename) {
  return `${req.protocol}://${req.get("host")}/files/${jobId}/${filename}`;
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (status ${res.status})`);
  }
  const fileStream = createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
}

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /render
 * Body: { text: string, image_url: string, speed?: number, voice?: string }
 * Response: { job_id, duration_seconds, reel_url, wide_url }
 *
 * n8n should fetch reel_url / wide_url (HTTP Request node, response format
 * "file"), upload each to Cloudinary as usual, then call
 * DELETE /files/:job_id once both uploads are confirmed.
 */
app.post("/render", async (req, res) => {
  const { text, image_url, speed, voice } = req.body || {};

  if (!text || !image_url) {
    return res.status(400).json({ error: "text and image_url are required" });
  }

  const jobId = randomUUID();
  const dir = jobDir(jobId);

  try {
    await mkdir(dir, { recursive: true });

    // 1. Source image
    const imagePath = path.join(dir, "source.jpg");
    await downloadToFile(image_url, imagePath);

    // 2. Text -> speech
    const rawAudioPath = path.join(dir, "voice_raw.wav");
    await generateSpeech(text, rawAudioPath, { voice });

    // 3. Speed up (pitch preserved)
    const finalAudioPath = path.join(dir, "voice.wav");
    await speedUpAudio(rawAudioPath, finalAudioPath, speed || DEFAULT_SPEED);

    // 4. Duration drives both videos' length
    const durationSeconds = await getAudioDuration(finalAudioPath);

    // 5. Render both formats
    const reelPath = path.join(dir, "reel.mp4");
    const widePath = path.join(dir, "wide.mp4");
    await buildReel(imagePath, finalAudioPath, durationSeconds, reelPath);
    await buildWide(imagePath, finalAudioPath, durationSeconds, widePath);

    // 6. Schedule the safety-net cleanup
    setTimeout(() => {
      rm(dir, { recursive: true, force: true }).catch(() => {});
    }, AUTO_CLEANUP_MS);

    res.json({
      job_id: jobId,
      duration_seconds: durationSeconds,
      reel_url: publicUrl(req, jobId, "reel.mp4"),
      wide_url: publicUrl(req, jobId, "wide.mp4"),
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    console.error(`[render:${jobId}]`, err);
    res.status(500).json({ error: err.message || "render failed" });
  }
});

// Serves the two rendered files for a job so n8n can fetch them.
app.get("/files/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  if (!["reel.mp4", "wide.mp4"].includes(filename)) {
    return res.status(404).end();
  }
  res.sendFile(path.join(jobDir(jobId), filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// n8n calls this once both videos are uploaded to Cloudinary.
app.delete("/files/:jobId", async (req, res) => {
  const { jobId } = req.params;
  await rm(jobDir(jobId), { recursive: true, force: true }).catch(() => {});
  res.json({ deleted: true });
});

app.listen(PORT, () => {
  console.log(`earthinsider-media-renderer listening on :${PORT}`);
});
