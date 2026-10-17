import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(HERE, "..", "assets", "music");

// Everything here is synthesised by ffmpeg, so there is no licence or Content ID question.
let assetsPromise = null;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function makeWhoosh(out) {
  // pink noise swell + a quick rising tone, ~0.9 s
  const filter =
    "[0:a]highpass=f=350,lowpass=f=7000,afade=t=in:st=0:d=0.45:curve=qsin,afade=t=out:st=0.45:d=0.45:curve=hsin[n];" +
    "[1:a]afade=t=in:st=0:d=0.4,afade=t=out:st=0.4:d=0.5,lowpass=f=5000[c];" +
    "[n][c]amix=inputs=2:normalize=0,volume=0.9,aformat=channel_layouts=mono[o]";
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "anoisesrc=d=0.9:c=pink:r=48000:a=0.7",
    "-f", "lavfi", "-i", "aevalsrc='0.16*sin(2*PI*(250*t+2600*t*t))':d=0.9:s=48000",
    "-filter_complex", filter, "-map", "[o]", "-c:a", "pcm_s16le", out,
  ]);
}

async function makeBed(out) {
  // 70 s dark A-minor pad with a very soft 72 bpm pulse. Level is set later in the mix.
  const expr =
    "0.20*(sin(2*PI*110*t)+0.6*sin(2*PI*110.4*t))" +
    "+0.14*(sin(2*PI*164.81*t)+0.6*sin(2*PI*165.2*t))" +
    "+0.12*(sin(2*PI*220*t)+0.5*sin(2*PI*220.5*t))" +
    "+0.08*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.07*t))" +
    "+0.06*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.05*t))" +
    "+0.30*pow(sin(PI*t*1.2),24)*sin(2*PI*52*t)";
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':d=70:s=48000`,
    "-af", "lowpass=f=2200,aecho=0.7:0.6:420|700:0.3|0.2,tremolo=f=0.2:d=0.25,aformat=channel_layouts=mono",
    "-c:a", "pcm_s16le", out,
  ], { maxBuffer: 50 * 1024 * 1024 });
}

export function ensureAssets(baseDir) {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const dir = path.join(baseDir, "_assets");
      await mkdir(dir, { recursive: true });
      const whoosh = path.join(dir, "whoosh.wav");
      const bed = path.join(dir, "bed.wav");
      if (!(await exists(whoosh))) await makeWhoosh(whoosh);
      if (!(await exists(bed))) await makeBed(bed);
      return { whoosh, bed };
    })().catch((e) => { assetsPromise = null; throw e; });
  }
  return assetsPromise;
}

/** Your own tracks in assets/music/ win; otherwise the synthesised bed is used. */
export async function pickMusic(jobId, bedPath) {
  try {
    const files = (await readdir(MUSIC_DIR)).filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f)).sort();
    if (files.length) {
      const n = parseInt(createHash("md5").update(jobId).digest("hex").slice(0, 8), 16) % files.length;
      return path.join(MUSIC_DIR, files[n]);
    }
  } catch { /* no folder -> use the bed */ }
  return bedPath;
}
