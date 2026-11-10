"""Add stretches where the full 1 fps scan found private text to timeline.json's "blur" list, so
tools/blur_ocr.py samples them at 2 fps too. Prints what it added."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import blurs

KIND = [("email", re.compile(r"@gmail\.com")), ("billing details", re.compile(r"Cra 86F|Mastercard|2972|10/2031|Bogot")),
        ("password suggestion", re.compile(r"Suggested Password")), ("token or private link", blurs.TOKEN)]

p = ROOT / "timeline.json"
tl = json.load(open(p))
for rec in tl["recordings"]:
    f = ROOT / "cache" / rec / "scan_ocr.jsonl"
    if not f.exists():
        continue
    known = tl["blur"].setdefault(rec, [])
    found = []
    for line in open(f):
        d = json.loads(line)
        t = d["t"]
        if not blurs.rects(d["lines"]) or any(a - 2 <= t <= b + 2 for a, b, _ in known):
            continue
        text = " ".join(l[0] for l in d["lines"])
        kind = next((k for k, rx in KIND if rx.search(text)), "Swapcard or attendee sheet")
        if found and t - found[-1][1] <= 3 and found[-1][2] == kind:
            found[-1][1] = t + 1
        else:
            found.append([t - 1, t + 1, kind])
    for a, b, k in found:
        known.append([max(0, a), b, k + " (found by full scan)"])
        print(rec, a, b, k)
    known.sort()
open(p, "w").write(json.dumps(tl, indent=1, ensure_ascii=False) + "\n")
