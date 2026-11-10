"""Build out/scenes.json for the scene review page: every scene of the both-apps cuts, how each cut treats it,
and where it starts in each rendered video."""
import json
import render as R

LADDER = ["both-short", "both-medium", "both-faithful", "both-realtime"]
MODES = ["skip", "fast", "real"]
LABEL = {"both-short": "Short", "both-medium": "Medium", "both-faithful": "Faithful", "both-realtime": "Real time",
         "skip": "Skip", "fast": "Fast-forward", "real": "Real time"}
DESC = {"both-short": "Tight highlights at real speed; the rest of each scene squeezed into a few seconds; other projects are a card.",
        "both-medium": "Same highlights; the rest plays at about 6× so you see the work happening; other projects are a card.",
        "both-faithful": "Wider highlights; the rest at about 6×; other projects play as a labelled time-lapse.",
        "both-realtime": "Every minute of both apps at real speed, only silences sped up; other projects as a time-lapse."}


def summarise(items):
    real = [i for i in items if i["kind"] == "clip" and i["speed"] <= 1.05]
    out = {"dur": round(sum(map(R.dur, items)), 1),
           "real": round(sum(map(R.dur, real)), 1),
           "fast": round(sum(R.dur(i) for i in items if i["kind"] == "clip" and i["speed"] > 1.05), 1),
           "src_fast": round(sum(i["e"] - i["s"] for i in items if i["kind"] == "clip" and i["speed"] > 1.05), 1),
           "card": any(i["kind"] == "card" for i in items),
           "heard": [[i["s"], i["e"]] for i in items if i["kind"] == "clip" and i["audio"]]}
    out["map"] = [[i["s"], i["e"], i["speed"], round(R.dur(i), 2)] if i["kind"] == "clip" else [None, None, 0, i["dur"]]
                  for i in items]
    sp = sorted({round(i["speed"]) for i in items if i["kind"] == "clip" and i["speed"] > 1.05})
    out["speeds"] = sp
    return out


def by_scene(items):
    d = {}
    for it in items:
        if "scene" in it:
            d.setdefault(it["scene"], []).append(it)
    return d


def main():
    base = R.VERSIONS[LADDER[0]]
    plans = {v: by_scene(R.plan(v)) for v in LADDER}
    for m in MODES:
        R.VERSIONS["_tmp"] = dict(base, picks={sc["id"]: m for sc in R.scenes(base)})
        plans[m] = by_scene(R.plan("_tmp"))
    starts = {}
    for v in LADDER:
        p = R.OUT / f"{v}.json"
        if p.exists():
            for it in json.load(open(p))["items"]:
                if "scene" in it:
                    starts.setdefault(v, {}).setdefault(it["scene"], it["start"])
    segs = {r: [s for s in json.load(open(R.CACHE / r / "words.json"))["segments"]
                if s["t"].strip() and not R.HALLUCINATIONS.search(s["t"].strip())] for r in R.RECS}
    scenes = []
    for sc in R.scenes(base):
        rec, s, e = sc["rec"], sc["entries"][0]["s"], sc["entries"][-1]["e"]
        en = sc["entries"][0]
        title = en.get("chapter") if sc["kind"] == "main" else "Meanwhile: " + ", ".join(R.describe_run(sc["entries"]))
        scenes.append({
            "id": sc["id"], "kind": sc["kind"], "rec": rec, "s": s, "e": e,
            "proj": en["proj"] if sc["kind"] == "main" else "other",
            "title": title or "", "clock": f"{R.clock(rec, s)}–{R.clock(rec, e)}",
            "say": [[round(g["s"], 1), round(g["e"], 1), g["t"].strip()] for g in segs[rec] if s <= g["s"] < e],
            "cells": {k: summarise(plans[k].get(sc["id"], [])) for k in LADDER + MODES},
            "starts": {v: starts.get(v, {}).get(sc["id"]) for v in LADDER},
        })
    totals = {v: round(sum(R.dur(i) for i in R.plan(v)), 1) for v in LADDER}
    fixed = totals[LADDER[0]] - sum(sc["cells"][LADDER[0]]["dur"] for sc in scenes)  # title and lunch cards
    json.dump({"ladder": [{"name": v, "label": LABEL[v], "desc": DESC[v], "total": totals[v],
                           "rendered": (R.OUT / f"{v}.mp4").exists()} for v in LADDER],
               "modes": [{"name": m, "label": LABEL[m]} for m in MODES], "fixed": round(fixed, 1),
               "scenes": scenes}, open(R.OUT / "scenes.json", "w"))
    print(len(scenes), "scenes", totals)


if __name__ == "__main__":
    main()
