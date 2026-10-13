// Word-by-word captions -> ASS subtitle file.
// One short line at a time; the word being spoken gets a yellow background box
// (black text), the rest are white with a heavy black outline + shadow —
// same look as the Shape Social image text.

const FONT = process.env.CAPTION_FONT || "Montserrat";
const MAX_WORDS = 4;
const GAP_BREAK = 0.35; // seconds of silence that forces a new caption line
const BOX_BGR = "00D7FF"; // #FFD700 in ASS (BGR) order — same yellow as the image highlights

function toASS(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// Normalises raw word timings: drops punctuation-only tokens, strips trailing
// punctuation (keeps ? and !), upper-cases, remembers where a phrase ends.
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

function makeChunks(words, maxChars) {
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= MAX_WORDS || chars > maxChars || prev.brk || w.start - prev.end > GAP_BREAK)) {
      flush();
    }
    cur.push(w);
  }
  flush();
  return chunks;
}

export function buildASS(rawWords, W, H) {
  const portrait = H > W;
  const fontSize = portrait ? 68 : 54;
  const outline = portrait ? 7 : 6;
  const box = portrait ? 14 : 11; // thick outline on the active word = the "box"
  const maxChars = portrait ? 20 : 26;
  const cx = Math.round(W / 2);
  // Sits above the text baked into the image (which lives in the bottom ~30% of it).
  const cy = Math.round(H * 0.52);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,${outline},3,5,30,30,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const words = cleanWords(rawWords);
  const chunks = makeChunks(words, maxChars);
  const events = [];

  chunks.forEach((chunk, ci) => {
    const nextStart = chunks[ci + 1] ? chunks[ci + 1][0].start : Infinity;
    chunk.forEach((w, i) => {
      let end = i < chunk.length - 1 ? chunk[i + 1].start : w.end + 0.15;
      end = Math.min(end, nextStart);
      if (end - w.start < 0.06) end = w.start + 0.06;

      const line = chunk
        .map((x, j) =>
          j === i ? `{\\1c&H000000&\\3c&H${BOX_BGR}&\\bord${box}}${x.text}{\\r}` : x.text
        )
        .join("\\h\\h");

      events.push(
        `Dialogue: 0,${toASS(w.start)},${toASS(end)},Cap,,0,0,0,,{\\pos(${cx},${cy})}${line}`
      );
    });
  });

  return header + "\n" + events.join("\n") + "\n";
}
