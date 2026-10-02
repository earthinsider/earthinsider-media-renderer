import express from "express";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
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

const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER || "earthinsider.bsky.social";
const BLUESKY_PASSWORD   = process.env.BLUESKY_PASSWORD;

/**
 * POST /bluesky-post
 * Body: { video_url, text, facets?, published_url?, card_title?, card_description? }
 *
 * Handles the full Bluesky video post flow on this server so n8n never has
 * to hold large binary video data in memory:
 *   1. Create session
 *   2. Download video from render's own /files/ URL (local-ish fetch)
 *   3. Upload blob to Bluesky
 *   4. Create post record (app.bsky.embed.video)
 */
app.post("/bluesky-post", async (req, res) => {
  const { video_url, text, facets, published_url, card_title, card_description } = req.body || {};

  if (!video_url || !text) {
    return res.status(400).json({ error: "video_url and text are required" });
  }
  if (!BLUESKY_PASSWORD) {
    return res.status(500).json({ error: "BLUESKY_PASSWORD env var not set" });
  }

  try {
    // 1. Auth
    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: BLUESKY_IDENTIFIER, password: BLUESKY_PASSWORD }),
    });
    const session = await sessionRes.json();
    if (!session.accessJwt) {
      throw new Error("Bluesky auth failed: " + JSON.stringify(session).slice(0, 200));
    }

    // 2. Download video (fetching from our own /files/ URL — lightweight)
    const vidRes = await fetch(video_url);
    if (!vidRes.ok) throw new Error(`Video download failed: ${vidRes.status}`);
    const vidBuf = Buffer.from(await vidRes.arrayBuffer());

    // 3. Upload blob
    const blobRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "video/mp4" },
      body: vidBuf,
    });
    const blobData = await blobRes.json();
    if (!blobData.blob) {
      throw new Error("Blob upload failed: " + JSON.stringify(blobData).slice(0, 200));
    }

    // 4. Create post record
    const record = {
      "$type": "app.bsky.feed.post",
      text,
      facets: facets || [],
      createdAt: new Date().toISOString(),
      embed: {
        "$type": "app.bsky.embed.video",
        video: blobData.blob,
        aspectRatio: { width: 9, height: 16 },
      },
    };
    const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    });
    const postData = await postRes.json();

    res.json({ success: true, uri: postData.uri, cid: postData.cid });
  } catch (err) {
    console.error("[bluesky-post]", err);
    res.status(500).json({ error: err.message });
  }
});

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
  const t0 = Date.now();
  const lap = (label, from) => {
    const ms = Date.now() - from;
    console.log(`[render:${jobId}] ${label}: ${(ms / 1000).toFixed(1)}s`);
    return Date.now();
  };

  try {
    await mkdir(dir, { recursive: true });

    // 1. Source image
    let t = Date.now();
    const imagePath = path.join(dir, "source.jpg");
    await downloadToFile(image_url, imagePath);
    t = lap("download image", t);

    // 2. Text -> speech
    const rawAudioPath = path.join(dir, "voice_raw.wav");
    await generateSpeech(text, rawAudioPath, { voice });
    t = lap("cloudflare tts", t);

    // 3. Speed up (pitch preserved)
    const finalAudioPath = path.join(dir, "voice.wav");
    await speedUpAudio(rawAudioPath, finalAudioPath, speed || DEFAULT_SPEED);
    t = lap("speed up audio", t);

    // 4. Duration drives both videos' length
    const durationSeconds = await getAudioDuration(finalAudioPath);
    t = lap("probe duration", t);

    // 5. Render both formats
    const reelPath = path.join(dir, "reel.mp4");
    const widePath = path.join(dir, "wide.mp4");
    await buildReel(imagePath, finalAudioPath, durationSeconds, reelPath);
    t = lap("build reel", t);
    await buildWide(imagePath, finalAudioPath, durationSeconds, widePath);
    t = lap("build wide", t);

    lap("TOTAL", t0);

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

// ── Tumblr ────────────────────────────────────────────────────────────────────
const TUMBLR_CONSUMER_KEY    = process.env.TUMBLR_CONSUMER_KEY;
const TUMBLR_CONSUMER_SECRET = process.env.TUMBLR_CONSUMER_SECRET;
const TUMBLR_ACCESS_TOKEN    = process.env.TUMBLR_ACCESS_TOKEN;
const TUMBLR_ACCESS_SECRET   = process.env.TUMBLR_ACCESS_SECRET;
const TUMBLR_BLOG            = process.env.TUMBLR_BLOG || "earthinsider.tumblr.com";

// OAuth1 header for multipart/form-data requests.
// Per OAuth1 spec: body params are NOT included in the signature base string
// for multipart uploads — only the OAuth header params go in.
function buildTumblrOAuthHeader(method, url) {
  const nonce     = randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key:     TUMBLR_CONSUMER_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        timestamp,
    oauth_token:            TUMBLR_ACCESS_TOKEN,
    oauth_version:          "1.0",
  };

  const paramStr = Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramStr),
  ].join("&");

  const signingKey = `${encodeURIComponent(TUMBLR_CONSUMER_SECRET)}&${encodeURIComponent(TUMBLR_ACCESS_SECRET)}`;
  oauthParams.oauth_signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  return "OAuth " + Object.entries(oauthParams)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ");
}

/**
 * POST /tumblr-video
 * Body: { video_url, caption, tags }
 * Downloads the video from our own /files/ URL, signs the request with
 * OAuth1, and posts to Tumblr's legacy video endpoint — so n8n never
 * needs to touch the binary file.
 */
app.post("/tumblr-video", async (req, res) => {
  const { video_url, caption, tags } = req.body || {};

  if (!video_url) return res.status(400).json({ error: "video_url is required" });
  if (!TUMBLR_CONSUMER_KEY || !TUMBLR_CONSUMER_SECRET || !TUMBLR_ACCESS_TOKEN || !TUMBLR_ACCESS_SECRET) {
    return res.status(500).json({ error: "Tumblr credential env vars not set" });
  }

  try {
    // 1. Download video
    const vidRes = await fetch(video_url);
    if (!vidRes.ok) throw new Error(`Video download failed: ${vidRes.status}`);
    const vidBuf = Buffer.from(await vidRes.arrayBuffer());

    // 2. Build multipart form — Node 18+ built-in FormData + Blob
    const form = new FormData();
    form.append("type",    "video");
    form.append("caption", caption || "");
    form.append("tags",    tags    || "");
    form.append("data",    new Blob([vidBuf], { type: "video/mp4" }), "video.mp4");

    // 3. OAuth1 sign + post
    const tumblrUrl = `https://api.tumblr.com/v2/blog/${TUMBLR_BLOG}/post`;
    const authHeader = buildTumblrOAuthHeader("POST", tumblrUrl);

    const postRes = await fetch(tumblrUrl, {
      method:  "POST",
      headers: { Authorization: authHeader },
      body:    form,
    });

    const data = await postRes.json().catch(() => ({}));
    if (!postRes.ok) {
      throw new Error(`Tumblr failed (${postRes.status}): ${JSON.stringify(data).slice(0, 300)}`);
    }

    res.json({ success: true, tumblr_id: data.response?.id });
  } catch (err) {
    console.error("[tumblr-video]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Static file serving ───────────────────────────────────────────────────────
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
  
