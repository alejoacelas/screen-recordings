"""Where to pixelate: rectangles over private text, found by OCR of the screen.

tools/blur_ocr.py samples the stretches listed under "blur" in timeline.json at 2 fps and
tools/scan_ocr.py samples whole recordings at 1 fps. Each sample's OCR lines go through RULES below,
and every rectangle stays on for HOLD seconds either side of its sample.
"""
import json, re
from functools import lru_cache
from pathlib import Path

CACHE = Path(__file__).parent / "cache"
PAD = 0.006

TEXT = re.compile(
    r"[\w.+-]+@gmail\.com"                                   # email addresses in the browser
    r"|Cra 86F|Bogot[aá], DC|110871|Mastercard|•••• ?2972|\b10/2031\b"   # billing address and card
    r"|(?=\w*\d)(?=\w*[^\W\d_A-ZА-Я])(?=\w*[A-ZА-Я])\w{20,}")       # tokens, generated passwords, private doc ids


def _box(lines):
    x0 = min(l[1] for l in lines); y0 = min(l[2] for l in lines)
    x1 = max(l[1] + l[3] for l in lines); y1 = max(l[2] + l[4] for l in lines)
    return [x0 - PAD, y0 - PAD, x1 - x0 + 2 * PAD, y1 - y0 + 2 * PAD]


def rects(lines):
    """Rectangles (x, y, w, h in 0-1 screen coordinates) to pixelate in one OCR'd frame."""
    out = []
    text = " ".join(l[0] for l in lines)
    for l in lines:
        if TEXT.search(l[0]):
            out.append(_box([l]))
        if "Suggested Password" in l[0]:  # Chrome's popup: the suggestion sits on the line below
            s, x, y, w, h = l
            out.append([x - 0.03, y - h, max(w, 0.08) + 0.06, 3.4 * h])
    if re.search(r"swapcard\.com/messages", text):
        # Swapcard messages: everything below the browser bar is other people's names, photos and messages
        bar = [l for l in lines if "swapcard.com" in l[0]]
        top = max(l[2] + l[4] for l in bar) + 0.01
        out.append([0, top, 1, 1 - top])
    elif "swapcard" in text.lower():
        # Swapcard pages: meeting requests and notifications from other attendees
        for l in lines:
            if l[0].strip() in ("Decline", "Accept"):
                pop = [m for m in lines if l[1] - 0.2 < m[1] < l[1] + 0.2 and l[2] - 0.28 < m[2] < l[2] + 0.02]
                b = _box(pop)
                out.append([b[0] - 0.03, b[1] - 0.01, b[2] + 0.04, b[3] + 0.02])
    head = [l for l in lines if l[0].strip() == "First Name"]
    if head and re.search(r"Attendee|EAGx", text):
        # attendee spreadsheet: every cell below the header row, and the formula bar
        h = min(head, key=lambda l: l[2])
        right = min([l[1] for l in lines if l[0].strip() == "Tables" and l[1] > 0.5] or [1.0])
        cells = [l for l in lines if l[2] > h[2] + h[4] * 0.6 and l[1] < right and l[2] < 0.97]
        out += [_box([c]) for c in cells]
        ref = [l for l in lines if re.fullmatch(r"[A-Z]{1,2}\d{1,4}", l[0].strip()) and l[2] < h[2]]
        for r_ in ref:
            out += [_box([l]) for l in lines if abs(l[2] - r_[2]) < 0.012 and l[1] > r_[1] + 0.02 and l[1] < right]
    return [[max(0, x), max(0, y), min(w, 1 - max(0, x)), min(h, 1 - max(0, y))] for x, y, w, h in out]


@lru_cache(None)
def samples(rec):
    """[(t, hold, rects)] for every OCR sample of the recording that has something to pixelate."""
    out = []
    for name, hold in (("scan_ocr.jsonl", 1.1), ("blur_ocr.jsonl", 0.6)):
        p = CACHE / rec / name
        if p.exists():
            for line in open(p):
                d = json.loads(line)
                r = rects(d["lines"])
                if r:
                    out.append((d["t"], hold, r))
    return sorted(out)


def at(rec, a, b):
    """Union of the rectangles active anywhere in [a, b)."""
    return [r for t, hold, rs in samples(rec) if t - hold < b and a < t + hold for r in rs]


@lru_cache(None)
def runs(rec):
    """Stretches of the recording where something is pixelated."""
    out = []
    for t, hold, _ in samples(rec):
        if out and t - hold <= out[-1][1] + 0.5:
            out[-1][1] = max(out[-1][1], t + hold)
        else:
            out.append([t - hold, t + hold])
    return out
