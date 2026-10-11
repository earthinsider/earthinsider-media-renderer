import express from "express";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

import { generateSpeech }              from "./src/tts.js";
import { speedUpAudio, getAudioDuration } from "./src/audio.js";
import { buildReel, buildWide }        from "./src/video.js";
import { parseVTT, buildASS, HOOK_DURATION_SECS } from "./src/subtitles.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT            = process.env.PORT            || 10000;
const DEFAULT_SPEED   = Number(process.env.DEFAULT_SPEED || 1.0);
const AUTO_CLEANUP_MS = Number(process.env.AUTO_CLEANUP_MINUTES || 30) * 60 * 1000;
const JOBS_DIR        = path.join(process.cwd(), "jobs");

await mkdir(JOBS_DIR, { recursive: true });

function jobDir(id)            { return path.join(JOBS_DIR, id); }
function publicUrl(req, id, f) { return `${req.protocol}://${req.get("host")}/files/${id}/${f}`; }

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await finished(Readable.fromWeb(res.body).pipe(createWriteStream(dest)));
}

// ── health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Bluesky ───────────────────────────────────────────────────────────────────
const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER || "earthinsider.bsky.social";
const BLUESKY_PASSWORD   = process.env.BLUESKY_PASSWORD;

app.post("/bluesky-post", async (req, res) => {
  const { video_url, text, facets } = req.body || {};
  if (!video_url || !text) return res.status(400).json({ error: "video_url and text required" });
  if (!BLUESKY_PASSWORD)  return res.status(500).json({ error: "BLUESKY_PASSWORD not set" });
  try {
    const sess = await (await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: BLUESKY_IDENTIFIER, password: BLUESKY_PASSWORD }),
    })).json();
    if (!sess.accessJwt) throw new Error("Bluesky auth failed: " + JSON.stringify(sess).slice(0, 200));

    const vidBuf = Buffer.from(await (await fetch(video_url)).arrayBuffer());
    const blobData = await (await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.accessJwt}`, "Content-Type": "video/mp4" },
      body: vidBuf,
    })).json();
    if (!blobData.blob) throw new Error("Blob upload failed: " + JSON.stringify(blobData).slice(0, 200));

    const postData = await (await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.accessJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: sess.did, collection: "app.bsky.feed.post", record: {
        "$type": "app.bsky.feed.post", text, facets: facets || [],
        createdAt: new Date().toISOString(),
        embed: { "$type": "app.bsky.embed.video", video: blobData.blob, aspectRatio: { width: 9, height: 16 } },
      }}),
    })).json();

    res.json({ success: true, uri: postData.uri });
  } catch (err) {
    console.error("[bluesky-post]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Tumblr ────────────────────────────────────────────────────────────────────
const TBL_CK  = process.env.TUMBLR_CONSUMER_KEY;
const TBL_CS  = process.env.TUMBLR_CONSUMER_SECRET;
const TBL_AT  = process.env.TUMBLR_ACCESS_TOKEN;
const TBL_AS  = process.env.TUMBLR_ACCESS_SECRET;
const TBL_BLG = process.env.TUMBLR_BLOG || "earthinsider.tumblr.com";

function tumblrOAuth(method, url) {
  const nonce = randomUUID().replace(/-/g, "");
  const ts    = Math.floor(Date.now() / 1000).toString();
  const p     = { oauth_consumer_key: TBL_CK, oauth_nonce: nonce,
                  oauth_signature_method: "HMAC-SHA1", oauth_timestamp: ts,
                  oauth_token: TBL_AT, oauth_version: "1.0" };
  const base  = [method.toUpperCase(), encodeURIComponent(url),
    encodeURIComponent(Object.keys(p).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join("&"))
  ].join("&");
  p.oauth_signature = createHmac("sha1", `${encodeURIComponent(TBL_CS)}&${encodeURIComponent(TBL_AS)}`).update(base).digest("base64");
  return "OAuth " + Object.entries(p).map(([k, v]) => `${k}="${encodeURIComponent(v)}"`).join(", ");
}

app.post("/tumblr-video", async (req, res) => {
  const { video_url, caption, tags } = req.body || {};
  if (!video_url) return res.status(400).json({ error: "video_url required" });
  if (!TBL_CK || !TBL_CS || !TBL_AT || !TBL_AS) return res.status(500).json({ error: "Tumblr creds not set" });
  try {
    const vidBuf = Buffer.from(await (await fetch(video_url)).arrayBuffer());
    const form   = new FormData();
    form.append("type",    "video");
    form.append("caption", caption || "");
    form.append("tags",    tags    || "");
    form.append("data",    new Blob([vidBuf], { type: "video/mp4" }), "video.mp4");
    const url = `https://api.tumblr.com/v2/blog/${TBL_BLG}/post`;
    const r   = await fetch(url, { method: "POST", headers: { Authorization: tumblrOAuth("POST", url) }, body: form });
    const d   = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Tumblr failed (${r.status}): ${JSON.stringify(d).slice(0, 300)}`);
    res.json({ success: true, tumblr_id: d.response?.id });
  } catch (err) {
    console.error("[tumblr-video]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── /render ───────────────────────────────────────────────────────────────────
app.post("/render", async (req, res) => {
  const { text, image_url, speed, voice, hook_text } = req.body || {};
  if (!text || !image_url) return res.status(400).json({ error: "text and image_url required" });

  const jobId = randomUUID();
  const dir   = jobDir(jobId);
  const t0    = Date.now();
  const lap   = (label, from) => { console.log(`[render:${jobId}] ${label}: ${((Date.now()-from)/1000).toFixed(1)}s`); return Date.now(); };

  try {
    await mkdir(dir, { recursive: true });

    let t = Date.now();

    // 1. Image
    const imagePath = path.join(dir, "source.jpg");
    await downloadToFile(image_url, imagePath);
    t = lap("download image", t);

    // 2. TTS + subtitles
    const rawAudioPath = path.join(dir, "voice_raw.mp3");
    const vttPath      = path.join(dir, "captions.vtt");
    await generateSpeech(text, rawAudioPath, vttPath, { voice });
    t = lap("edge-tts", t);

    // 3. Speed up + prepend hook silence
    const finalAudioPath = path.join(dir, "voice.mp3");
    await speedUpAudio(rawAudioPath, finalAudioPath, speed || DEFAULT_SPEED, HOOK_DURATION_SECS);
    t = lap("speed up audio", t);

    // 4. Duration (includes hook silence)
    const durationSeconds = await getAudioDuration(finalAudioPath);
    t = lap("probe duration", t);

    // 5. Generate ASS subtitle files (one per aspect ratio)
    let assReel = null, assWide = null;
    try {
      const vttContent = await readFile(vttPath, "utf8");
      const words = parseVTT(vttContent);
      if (words.length > 0) {
        const hookStr = (hook_text || "").trim();
        const reelASS = buildASS(words, hookStr, 1080, 1920);
        const wideASS = buildASS(words, hookStr, 1920, 1080);
        assReel = path.join(dir, "captions_reel.ass");
        assWide = path.join(dir, "captions_wide.ass");
        await writeFile(assReel, reelASS, "utf8");
        await writeFile(assWide, wideASS, "utf8");
      }
    } catch (e) {
      console.warn(`[render:${jobId}] Subtitle generation skipped:`, e.message);
    }
    t = lap("build ASS subtitles", t);

    // 6. Render videos
    const reelPath = path.join(dir, "reel.mp4");
    const widePath = path.join(dir, "wide.mp4");
    await buildReel(imagePath, finalAudioPath, durationSeconds, reelPath, assReel);
    t = lap("build reel", t);
    await buildWide(imagePath, finalAudioPath, durationSeconds, widePath, assWide);
    t = lap("build wide", t);

    lap("TOTAL", t0);

    setTimeout(() => rm(dir, { recursive: true, force: true }).catch(() => {}), AUTO_CLEANUP_MS);

    res.json({
      job_id: jobId,
      duration_seconds: durationSeconds,
      reel_url: publicUrl(req, jobId, "reel.mp4"),
      wide_url: publicUrl(req, jobId, "wide.mp4"),
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    console.error(`[render:${jobId}]`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── static files ──────────────────────────────────────────────────────────────
app.get("/files/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  if (!["reel.mp4", "wide.mp4"].includes(filename)) return res.status(404).end();
  res.sendFile(path.join(jobDir(jobId), filename), err => { if (err && !res.headersSent) res.status(404).end(); });
});

app.delete("/files/:jobId", async (req, res) => {
  await rm(jobDir(req.params.jobId), { recursive: true, force: true }).catch(() => {});
  res.json({ deleted: true });
});

app.listen(PORT, () => console.log(`earthinsider-media-renderer listening on :${PORT}`));
