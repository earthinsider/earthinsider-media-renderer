// Word-by-word captions -> ASS subtitle file.
// One short line at a time. The word being spoken sits on a yellow rounded-rectangle
// (black text); the others are white with a heavy black outline + shadow, like the
// Shape Social image text. Words are placed one by one from measured widths, so the
// gap between words and the box are exact.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const MEASURE_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "measure.py");
const FONT_NAME = process.env.CAPTION_FONT || "Montserrat";

const MAX_WORDS = 6;
const GAP_BREAK = 0.35; // seconds of silence that forces a new caption line
const BOX_BGR = "00D7FF"; // #FFD700 in ASS (BGR) order, same yellow as the image highlights

function toASS(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// Drops punctuation-only tokens, strips trailing punctuation (keeps ? and !),
// upper-cases, remembers where a phrase ends.
export function cleanWords(raw) {
  const out = [];
  for (const r of raw) {
    const t = String(r.text ?? "").trim();
    if (!t) continue;
    if (!/[\p{L}\p{N}]/u.test(t)) {
      if (out.length && /[.,;:!?…]/.test(t)) out[out.length - 1].brk = true;
      continue;
    }
    const brk = /[.,;:!?…]["”')]*$/.test(t);
    const clean = t
      .replace(/^["“‘(]+/, "")
      .replace(/[.,;:"”)…]+$/, "")
      .replace(/[{}\\]/g, "");
    if (!clean) continue;
    out.push({ text: clean.toUpperCase(), start: r.start, end: r.end, brk });
  }
  return out;
}

// Real glyph widths from the same font file libass will use (see measure.py).
// Never throws: falls back to rough estimates so the video still gets captions.
export async function measureWords(rawWords) {
  const words = [...new Set(cleanWords(rawWords).map((w) => w.text))];
  try {
    const { stdout } = await run("python3", [MEASURE_PY, JSON.stringify({ font: FONT_NAME, words })], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (e) {
    console.warn("[captions] font measuring failed, using estimates:", String(e.message).split("\n")[0]);
    const widths = {};
    for (const w of words) widths[w] = w.length * 0.6;
    return { family: FONT_NAME, ascent: 0.8, capH: 0.6, space: 0.3, widths };
  }
}

function makeChunks(words, widthOf, maxW, gap) {
  const chunks = [];
  let cur = [];
  let curW = 0;
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
    curW = 0;
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const nextW = cur.length ? curW + gap + widthOf(w) : widthOf(w);
    if (cur.length && (cur.length >= MAX_WORDS || nextW > maxW || prev.brk || w.start - prev.end > GAP_BREAK)) {
      flush();
    }
    curW = cur.length ? curW + gap + widthOf(w) : widthOf(w);
    cur.push(w);
  }
  flush();
  return chunks;
}

const n1 = (v) => Math.round(v * 10) / 10;

// Rounded rectangle as an ASS drawing (origin top-left).
function roundedRect(w, h, r) {
  const k = 0.5523 * r;
  return (
    `m ${n1(r)} 0 l ${n1(w - r)} 0 ` +
    `b ${n1(w - r + k)} 0 ${n1(w)} ${n1(r - k)} ${n1(w)} ${n1(r)} ` +
    `l ${n1(w)} ${n1(h - r)} ` +
    `b ${n1(w)} ${n1(h - r + k)} ${n1(w - r + k)} ${n1(h)} ${n1(w - r)} ${n1(h)} ` +
    `l ${n1(r)} ${n1(h)} ` +
    `b ${n1(r - k)} ${n1(h)} 0 ${n1(h - r + k)} 0 ${n1(h - r)} ` +
    `l 0 ${n1(r)} ` +
    `b 0 ${n1(r - k)} ${n1(r - k)} 0 ${n1(r)} 0`
  );
}

export function buildASS(rawWords, W, H, metrics) {
  const portrait = H > W;
  const S = portrait ? 64 : 50; // ASS font size
  const outline = portrait ? 6 : 5;
  // Reels/Shorts put their buttons on the right edge, so portrait captions sit a bit left of centre.
  const cx = portrait ? W * 0.46 : W / 2;
  const cy = H * 0.52; // vertical centre of the capitals, above the text baked into the image
  const maxW = portrait ? W * 0.8 : W * 0.5;

  const gap = 0.38 * S; // space between words
  const padX = 0.15 * S; // box padding left/right of the word
  const padY = 0.2 * S; // box padding above/below the capitals
  const capH = metrics.capH * S;
  const boxH = capH + 2 * padY;
  const radius = 0.26 * boxH; // slightly rounded corners
  const yb = cy + capH / 2 + (1 - metrics.ascent) * S; // bottom of the text line box for \an1

  const widthOf = (w) => (metrics.widths[w.text] ?? w.text.length * 0.6) * S;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${metrics.family},${S},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,${outline},3,1,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const words = cleanWords(rawWords);
  const chunks = makeChunks(words, widthOf, maxW, gap);
  const events = [];

  chunks.forEach((chunk, ci) => {
    const widths = chunk.map(widthOf);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chunk.length - 1);
    let x = cx - total / 2;
    const xs = widths.map((wd) => {
      const xi = x;
      x += wd + gap;
      return xi;
    });
    const nextStart = chunks[ci + 1] ? chunks[ci + 1][0].start : Infinity;

    chunk.forEach((w, i) => {
      let end = i < chunk.length - 1 ? chunk[i + 1].start : w.end + 0.15;
      end = Math.min(end, nextStart);
      if (end - w.start < 0.06) end = w.start + 0.06;
      const t0 = toASS(w.start);
      const t1 = toASS(end);

      // the box behind the word being spoken
      events.push(
        `Dialogue: 0,${t0},${t1},Cap,,0,0,0,,{\\an7\\pos(${n1(xs[i] - padX)},${n1(cy - boxH / 2)})\\p1\\bord0\\shad0\\1c&H${BOX_BGR}&}` +
          roundedRect(widths[i] + 2 * padX, boxH, radius)
      );
      // every word of the line; the spoken one is black, the rest white
      chunk.forEach((cw, j) => {
        const tag = j === i ? "\\1c&H000000&\\bord0\\shad0" : "";
        events.push(`Dialogue: 1,${t0},${t1},Cap,,0,0,0,,{\\an1\\pos(${n1(xs[j])},${n1(yb)})${tag}}${cw.text}`);
      });
    });
  });

  return header + "\n" + events.join("\n") + "\n";
}
