"""Write the default edit (data/edit.json), snapping each boundary to the nearest pause between words."""
import json, sys

WORDS, OUT, DURATION = sys.argv[1], sys.argv[2], float(sys.argv[3])
words = json.load(open(WORDS))["words"]

# (start "m:ss", mode, label-for-speed-ups); each segment ends where the next starts.
PLAN = [
    ("0:00", "normal", ""),
    ("1:46", "fast", "Same setup for the second idea"),
    ("2:30", "normal", ""),
    ("6:55", "fast", "Writing the README and splitting the work"),
    ("9:55", "normal", ""),
    ("11:24", "fast", "Dictating the channel instructions"),
    ("12:28", "normal", ""),
    ("13:10", "fast", "Answering Claude's questions"),
    ("14:16", "normal", ""),
    ("17:47", "fast", "Dictating the German reading brief"),
    ("21:32", "normal", ""),
    ("22:55", "fast", "Approving the tracking plan"),
    ("25:39", "normal", ""),
    ("26:40", "fast", "Permissions, iPhone Screen Time and a payment rant"),
    ("33:14", "normal", ""),
    ("34:02", "fast", "Waiting on tests"),
    ("35:13", "normal", ""),
    ("36:05", "fast", "Phonetics research and a detour into another project"),
    ("41:10", "normal", ""),
    ("43:44", "fast", "Running out of German"),
    ("44:22", "normal", ""),
    ("45:45", "fast", "Dictating the anime and voice brief"),
    ("47:40", "fast", "Picking voice models"),
    ("48:41", "normal", ""),
    ("48:52", "fast", "Writing the full-app brief"),
    ("50:15", "normal", ""),
    ("50:32", "fast", "Letting the agents run"),
    ("52:40", "normal", ""),
    ("52:54", "fast", "Waiting, and fighting an artifact export"),
    ("54:48", "normal", ""),
]
SECTIONS = [
    ("0:00", "Two ideas, two Claude sessions"),
    ("1:40", "What does the evidence say?"),
    ("4:15", "Reality check: five devices to track"),
    ("9:55", "Let a model label the channels"),
    ("14:16", "What do I actually want?"),
    ("21:32", "Tracking: what's possible"),
    ("33:14", "Test on the other Mac"),
    ("35:13", "A nicer reader"),
    ("41:10", "Reading German for the first time"),
    ("45:05", "Anime clips and pronunciation feedback"),
    ("54:48", "Wrap-up"),
]


def sec(ms):
    m, s = ms.split(":")
    return int(m) * 60 + int(s)


def snap(t, window=4.0):
    """Move t to the middle of the widest pause between words within the window."""
    if t == 0:
        return 0.0
    best, width = t, 0.0
    for a, b in zip(words, words[1:]):
        gap_s, gap_e = a["e"], b["s"]
        if gap_e < t - window or gap_s > t + window:
            continue
        w = gap_e - gap_s
        if w > width:
            best, width = (gap_s + gap_e) / 2, w
    return round(best, 2)


starts = [snap(sec(p[0])) for p in PLAN] + [DURATION]
segments = []
for i, (_, mode, label) in enumerate(PLAN):
    s, e = starts[i], starts[i + 1]
    seg = {"s": s, "e": e, "mode": mode}
    if mode == "fast":
        seg.update(speed=max(4, round((e - s) / 10)), label=label)
    segments.append(seg)
edit = {
    "autoSilence": True, "silenceMin": 1.5, "silenceSpeed": 8,
    "segments": segments,
    "sections": [{"t": snap(sec(t)), "title": title} for t, title in SECTIONS],
}
json.dump(edit, open(OUT, "w"), indent=1)
kept = sum(s["e"] - s["s"] for s in segments if s["mode"] == "normal")
print(f"{len(segments)} segments, {kept / 60:.1f} min at normal speed before pause speed-ups")
