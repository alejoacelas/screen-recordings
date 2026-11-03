"""Write the default edits (data/edit-tracker.json, data/edit-companion.json).

Each boundary snaps to the nearest pause between words.
Usage: python3 tools/default_edit.py data/words.json data/ 3334.27
"""
import json, os, sys

WORDS, OUT_DIR, DURATION = sys.argv[1], sys.argv[2], float(sys.argv[3])
words = json.load(open(WORDS))["words"]

LANG = "Meanwhile: the language-learning app"
TRACK = "Meanwhile: the Chinese tracker"
DETOUR = "Detour: starting another project"
EXPORT = "Fighting an artifact export (another project)"

# Each plan entry: (start "m:ss", mode, label for speed-ups). A segment ends where the next starts.
VIDEOS = {
    "tracker": {
        "title": "Building a Chinese study tracker with Claude Code",
        "plan": [
            ("0:00", "normal", ""),
            ("1:40", "fast", "Meanwhile: starting the language-learning app"),
            ("4:15", "normal", ""),
            ("14:16", "fast", LANG),
            ("21:24", "normal", ""),
            ("29:52", "fast", "Copying a token, and a payment rant"),
            ("31:42", "fast", "Turning on Screen Time sharing"),
            ("32:45", "normal", ""),
            ("35:09", "fast", LANG),
            ("38:36", "fast", DETOUR),
            ("41:05", "fast", LANG),
            ("53:15", "fast", EXPORT),
            ("54:45", "fast", LANG),
            ("55:05", "normal", ""),
        ],
        "sections": [
            ("0:00", "The idea: track my Mandarin time"),
            ("4:15", "Reality check: five devices to track"),
            ("6:17", "Split the work across sessions"),
            ("9:49", "Let a model label the channels"),
            ("21:24", "What can be tracked from the Mac"),
            ("25:40", "Ask it to compare methods"),
            ("27:05", "Setup: permissions and iPhone mirroring"),
            ("32:45", "Test on the other Mac"),
            ("55:05", "Wrap-up"),
        ],
    },
    "companion": {
        "title": "Building a language-learning app with Claude Code",
        "plan": [
            ("0:00", "normal", ""),
            ("0:12", "fast", "Meanwhile: starting the Chinese tracker"),
            ("1:40", "normal", ""),
            ("4:15", "fast", TRACK),
            ("14:16", "normal", ""),
            ("21:24", "fast", TRACK),
            ("35:09", "normal", ""),
            ("38:36", "fast", DETOUR),
            ("41:05", "normal", ""),
            ("53:15", "fast", EXPORT),
            ("54:45", "normal", ""),
        ],
        "sections": [
            ("0:00", "Intro"),
            ("1:40", "The idea: an evidence-based language app"),
            ("14:16", "What does the evidence say?"),
            ("15:02", "What do I actually want?"),
            ("17:47", "The brief: German reading and pronunciation"),
            ("35:09", "A nicer reader"),
            ("37:20", "Pronunciation feedback and sign-in"),
            ("41:05", "Reading German for the first time"),
            ("45:00", "Anime clips and voice models"),
            ("49:11", "Build the whole app"),
            ("52:40", "Let it run"),
            ("54:45", "Wrap-up"),
        ],
    },
}


def sec(ms):
    m, s = ms.split(":")
    return int(m) * 60 + int(s)


def snap(t, window=4.0):
    """Move t to the middle of the widest pause between words within the window."""
    if t == 0:
        return 0.0
    best, width = t, 0.0
    for a, b in zip(words, words[1:]):
        if b["s"] < t - window or a["e"] > t + window:
            continue
        if b["s"] - a["e"] > width:
            best, width = (a["e"] + b["s"]) / 2, b["s"] - a["e"]
    return round(best, 2)


for key, video in VIDEOS.items():
    plan = video["plan"]
    starts = [snap(sec(p[0])) for p in plan] + [DURATION]
    segments = []
    for i, (_, mode, label) in enumerate(plan):
        s, e = starts[i], starts[i + 1]
        seg = {"s": s, "e": e, "mode": mode}
        if mode == "fast":
            seg.update(speed=min(60, max(4, round((e - s) / 9))), label=label, autoSpeed=True)
        segments.append(seg)
    edit = {
        "title": video["title"],
        "autoSilence": True, "silenceMin": 1.5, "silenceSpeed": 8,
        "segments": segments,
        "sections": [{"t": snap(sec(t)), "title": title} for t, title in video["sections"]],
    }
    json.dump(edit, open(os.path.join(OUT_DIR, f"edit-{key}.json"), "w"), indent=1)
    kept = sum(s["e"] - s["s"] for s in segments if s["mode"] == "normal")
    print(f"{key}: {len(segments)} segments, {kept / 60:.1f} min at normal speed before pause speed-ups")
