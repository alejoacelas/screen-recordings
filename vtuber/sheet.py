"""Render one tile per expression so the character design can be reviewed."""
import sys
import skia
from character import draw_character, draw_fx, draw_bubble

BASE = dict(t=1.0, bob=0, tilt=0, ear_l=0, ear_r=0, squash=0, puff=0, blush=0, brows=None,
            eyes="normal", blink=0, look=(0, 0), mouth=0, mouth_kind="normal", paws=None,
            paw_tap=(0, 0), fx=[])
POSES = {
    "idle": {},
    "talk": dict(mouth=0.8),
    "happy": dict(eyes="happy", mouth_kind="smile", blush=1, paws="up",
                  fx=[dict(kind="sparkles", age=0.5, alpha=1)]),
    "oops": dict(eyes="wide", paws="cover", blush=1, fx=[dict(kind="bang", age=0.5, alpha=1)]),
    "confused": dict(tilt=-12, brows="worried", fx=[dict(kind="question", age=0.5, alpha=1)]),
    "grumpy": dict(eyes="squint", mouth_kind="pout", puff=1, brows="angry",
                   fx=[dict(kind="vein", age=0.3, alpha=1)]),
    "sleepy": dict(eyes="sleepy", tilt=8, fx=[dict(kind="zzz", age=0.8, alpha=1)]),
    "stars": dict(eyes="star", mouth_kind="smile", blush=1, fx=[dict(kind="sparkles", age=0.5, alpha=1)]),
    "love": dict(eyes="heart", mouth_kind="smile", blush=1, fx=[dict(kind="hearts", age=0.5, alpha=1)]),
    "sweat": dict(eyes="half", brows="worried", mouth_kind="pout", fx=[dict(kind="sweat", age=0.6, alpha=1)]),
    "shock": dict(eyes="wide", mouth_kind="o", fx=[dict(kind="bang", age=0.5, alpha=1)]),
    "wave": dict(paws="wave", mouth=0.5, eyes="happy"),
}
tw, th, s = 200, 200, 1.1
surf = skia.Surface(tw * 4, th * 3)
c = surf.getCanvas()
c.clear(skia.Color(40, 40, 46))
for i, (name, over) in enumerate(POSES.items()):
    st = dict(BASE, **over)
    c.save()
    c.translate((i % 4) * tw + tw / 2, (i // 4) * th + th / 2 + 10)
    c.scale(s, s)
    draw_character(c, st)
    draw_fx(c, st)
    c.restore()
draw_bubble(c, "Guten Morgen!", tw * 4 - 120, 20, 1, 1)
surf.makeImageSnapshot().save(sys.argv[1], skia.kPNG)
