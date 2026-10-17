import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIG = { maxBuffer: 50 * 1024 * 1024 };

export async function getAudioDuration(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const s = parseFloat(stdout.trim());
  if (!Number.isFinite(s)) throw new Error(`Cannot read duration from ${filePath}`);
  return s;
}

const clampTempo = (v) => Math.min(2, Math.max(0.5, Number(v) || 1));

/**
 * [hook] + pause + [script] -> speed change (pitch preserved) -> short tail of silence.
 * Writes a 48 kHz mono wav. Returns the tempo that was applied (caption timings scale by it).
 */
export async function joinVoice({ hookPath, scriptPath, outputPath, speed = 1.15, pause = 0.35, tail = 0.4 }) {
  const tempo = clampTempo(speed);
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono";
  let inputs, filter;
  if (hookPath) {
    inputs = ["-i", hookPath, "-i", scriptPath];
    filter =
      `[0:a]${fmt},apad=pad_dur=${pause}[h];[1:a]${fmt}[s];` +
      `[h][s]concat=n=2:v=0:a=1[c];[c]atempo=${tempo},apad=pad_dur=${tail}[out]`;
  } else {
    inputs = ["-i", scriptPath];
    filter = `[0:a]${fmt},atempo=${tempo},apad=pad_dur=${tail}[out]`;
  }
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s16le", outputPath], BIG);
  return tempo;
}

// Voice clean-up: rumble cut, mild denoise, de-ess, a little warmth/presence EQ, gentle compression.
const VOICE_CHAIN = [
  "highpass=f=70",
  "afftdn=nr=6:nf=-45",
  "deesser=i=0.25",
  "equalizer=f=300:t=q:w=1:g=-1.5",
  "equalizer=f=3200:t=q:w=1:g=2.5",
  "acompressor=threshold=-20dB:ratio=3:attack=10:release=120:makeup=1.4",
].join(",");

const TARGET = "I=-14:TP=-1.5:LRA=11"; // ~what YouTube/Instagram/TikTok normalise to

/**
 * Cleans the voice and sets its loudness to -14 LUFS with a true-peak limiter (two-pass, accurate).
 * Louder where it was quiet, but it never clips.
 */
export async function cleanVoice(inputPath, outputPath) {
  // pass 1: measure
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-i", inputPath, "-af", `${VOICE_CHAIN},loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"],
    BIG
  );
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  let norm = `loudnorm=${TARGET}`; // fallback: single pass
  if (m) {
    const j = JSON.parse(m[0]);
    if (Number.isFinite(parseFloat(j.input_i))) {
      norm =
        `loudnorm=${TARGET}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}` +
        `:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    }
  }
  // pass 2: apply
  await run(
    "ffmpeg",
    ["-y", "-i", inputPath, "-af", `${VOICE_CHAIN},${norm},aresample=48000,alimiter=limit=0.84:level=0:latency=1`, "-c:a", "pcm_s16le", outputPath],
    BIG
  );
  return m ? JSON.parse(m[0]) : null;
}

/**
 * Voice + background music (ducked under the voice) + whoosh at given times -> stereo wav.
 * sfx: [{ t: seconds, vol: 0..1 }], whooshPath/musicPath may be null.
 */
export async function mixFinal({ voicePath, outputPath, musicPath = null, whooshPath = null, sfx = [] }) {
  const dur = await getAudioDuration(voicePath);
  const inputs = ["-i", voicePath];
  const parts = [];
  const mixIn = [];
  let idx = 1;

  if (musicPath) {
    inputs.push("-stream_loop", "-1", "-i", musicPath);
    parts.push(
      `[0:a]asplit=2[v1][v2]`,
      `[${idx}:a]atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-26:TP=-3:LRA=7,aresample=48000,` +
        `afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, dur - 1.2).toFixed(3)}:d=1.2[m]`,
      // the voice pushes the music down by roughly 7 dB while it speaks
      `[m][v1]sidechaincompress=threshold=0.04:ratio=3:attack=30:release=400[md]`
    );
    mixIn.push("[v2]", "[md]");
    idx += 1;
  } else {
    parts.push(`[0:a]anull[v2]`);
    mixIn.push("[v2]");
  }

  if (whooshPath) {
    sfx.forEach((s, i) => {
      inputs.push("-i", whooshPath);
      const ms = Math.max(0, Math.round(s.t * 1000));
      parts.push(`[${idx}:a]adelay=${ms}:all=1,volume=${s.vol ?? 0.7}[s${i}]`);
      mixIn.push(`[s${i}]`);
      idx += 1;
    });
  }

  parts.push(
    `${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first:dropout_transition=0[mix]`,
    `[mix]alimiter=limit=0.84:level=0:latency=1,aformat=sample_fmts=s16:channel_layouts=stereo[out]`
  );

  await run("ffmpeg", ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", outputPath], BIG);
}
