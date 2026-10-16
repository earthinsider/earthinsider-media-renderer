"""
Measures caption words so the highlight box can be drawn as an exact rounded rectangle.
Usage: python3 measure.py '<json: {"font": "Montserrat", "words": ["HELLO", ...]}>'
Prints JSON: family, per-word widths, cap height, ascent ... all as a fraction of the ASS font size.
libass sizes fonts so that (ascent + descent) == the ASS font size, so everything is
normalised by that line height.
"""
import json
import subprocess
import sys

from PIL import ImageFont


def match_font(name):
    out = subprocess.run(
        ["fc-match", "-f", "%{file}|%{family[0]}|%{index}", f"{name}:bold"],
        capture_output=True, text=True, check=True,
    ).stdout
    path, family, index = out.split("|")
    return path, family, int(index or 0)


def main():
    req = json.loads(sys.argv[1])
    path, family, index = match_font(req.get("font") or "sans")
    ref = 1000
    font = ImageFont.truetype(path, ref, index=index)
    ascent, descent = font.getmetrics()
    line = float(ascent + descent)
    l, t, r, b = font.getbbox("H")  # relative to the ascender line
    result = {
        "family": family,
        "ascent": ascent / line,
        "capH": (b - t) / line,
        "space": font.getlength(" ") / line,
        "widths": {w: font.getlength(w) / line for w in set(req["words"])},
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
