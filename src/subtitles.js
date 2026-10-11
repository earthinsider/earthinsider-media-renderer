import { readFile, writeFile } from "node:fs/promises";

const HOOK_DURATION = 2.0; // seconds of hook text before voiceover starts
const CONTEXT_WORDS = 2;   // previous words shown dimmed behind current word

// ── VTT parser ──────────────────────────────────────────────────────────────
function parseVTTTime(t) {
  const parts = t.trim().split(":");
  if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
  return parseFloat(t);
}

export function parseVTT(content) {
  const words = [];
  const blocks = content.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
    const tLine = lines.find(l => l.includes("-->"));
    if (!tLine) continue;
    const [rawStart, rawRest] = tLine.split("-->");
    const rawEnd = rawRest.trim().split(" ")[0]; // strip "align:start position:0%"
    const word = lines[lines.length - 1];
    if (!word || word.toUpperCase() === "WEBVTT") continue;
    words.push({ word, start: parseVTTTime(rawStart), end: parseVTTTime(rawEnd) });
  }
  return words;
}

// ── ASS time format ──────────────────────────────────────────────────────────
function toASS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
}

// ── Hook text line breaker ───────────────────────────────────────────────────
function breakHook(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\\N"); // ASS newline
}

// ── ASS generator ────────────────────────────────────────────────────────────
// ASS colours: &HAABBGGRR (alpha, blue, green, red)
// Yellow  #FFFF00 → &H0000FFFF
// Grey    #888888 → &H00888888
// White   #FFFFFF → &H00FFFFFF
// Black   #000000 → &H00000000
// Semi-transparent black backdrop → &H88000000
export function buildASS(words, hookText, W, H) {
  const isPortrait = H > W;
  const capSize  = isPortrait ? 82 : 60;
  const hookSize = isPortrait ? 72 : 55;
  const marginV  = isPortrait ? 200 : 80;
  const maxChars = isPortrait ? 18 : 28;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Liberation Sans,${capSize},&H0000FFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,1,0,1,5,2,2,40,40,${marginV},1
Style: Dim,Liberation Sans,${Math.round(capSize*0.85)},&H00888888,&H00FFFFFF,&H00000000,&H88000000,0,0,0,0,100,100,1,0,1,4,1,2,40,40,${marginV},1
Style: Hook,Liberation Sans,${hookSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H88000000,-1,0,0,0,100,100,2,0,1,5,3,5,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = [];

  // Hook text: 0:00 → HOOK_DURATION (centered on screen)
  if (hookText && hookText.trim()) {
    const hookContent = breakHook(hookText.toUpperCase(), maxChars);
    events.push(`Dialogue: 0,0:00:00.00,${toASS(HOOK_DURATION - 0.05)},Hook,,0,0,0,,${hookContent}`);
  }

  // Word-by-word captions: offset by HOOK_DURATION
  for (let i = 0; i < words.length; i++) {
    const { word, start, end } = words[i];
    const t0 = toASS(start + HOOK_DURATION);
    const t1 = toASS(end   + HOOK_DURATION);

    // Previous context words (dimmed, separate layer below)
    const prev = words.slice(Math.max(0, i - CONTEXT_WORDS), i);
    if (prev.length > 0) {
      const dimText = prev.map(w => w.word.toUpperCase()).join(" ");
      events.push(`Dialogue: 0,${t0},${t1},Dim,,0,0,0,,${escASS(dimText)}`);
    }

    // Current word (yellow, bold, slightly above centre of caption area)
    events.push(`Dialogue: 1,${t0},${t1},Cap,,0,0,0,,${escASS(word.toUpperCase())}`);
  }

  return header + "\n" + events.join("\n") + "\n";
}

function escASS(s) {
  // Escape ASS special chars in word text
  return s.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

export const HOOK_DURATION_SECS = HOOK_DURATION;
