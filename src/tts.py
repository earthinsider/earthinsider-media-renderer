"""
edge-tts helper: text -> mp3 + word-level timings (JSON).
Usage: python3 tts.py <text> <voice> <audio_out.mp3> <words_out.json>
"""
import asyncio
import json
import sys

import edge_tts


async def run(text, voice, audio_path, words_path):
    try:
        # edge-tts >= 7 defaults to sentence-level timing; ask for words.
        communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    except TypeError:
        # older edge-tts: word-level timing is already the default.
        communicate = edge_tts.Communicate(text, voice)

    words = []
    with open(audio_path, "wb") as f:
        async for chunk in communicate.stream():
            kind = chunk["type"]
            if kind == "audio":
                f.write(chunk["data"])
            elif kind in ("WordBoundary", "SentenceBoundary"):
                start = chunk["offset"] / 10_000_000
                end = start + chunk["duration"] / 10_000_000
                parts = chunk["text"].split()
                if kind == "WordBoundary" or len(parts) <= 1:
                    words.append({"text": chunk["text"], "start": start, "end": end})
                else:
                    # Sentence-level fallback: spread words by character length.
                    total = sum(len(p) for p in parts) or 1
                    t = start
                    for p in parts:
                        d = (end - start) * len(p) / total
                        words.append({"text": p, "start": t, "end": t + d})
                        t += d

    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(words, f)


if __name__ == "__main__":
    text, voice, audio_path, words_path = sys.argv[1:5]
    asyncio.run(run(text, voice, audio_path, words_path))
