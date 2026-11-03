"""Mochi: a round cream cat with a mint headset, drawn with skia.

`draw(canvas, st)` paints one frame. Character space: head centre at (0, 0),
body about 120 units wide; the caller sets the transform.
"""
import math
import skia

OUTLINE = skia.Color(74, 52, 58)
FUR = skia.Color(255, 246, 232)
FUR_SHADE = skia.Color(246, 228, 210)
EAR_IN = skia.Color(255, 182, 193)
BLUSH = skia.Color(255, 150, 170)
MINT = skia.Color(120, 214, 196)
MINT_DARK = skia.Color(70, 170, 152)
EYE = skia.Color(58, 40, 52)
MOUTH_IN = skia.Color(200, 70, 90)
TONGUE = skia.Color(255, 140, 150)

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
TYPEFACE = skia.Typeface.MakeFromFile(FONT_PATH)


def paint(color, stroke=0.0, alpha=1.0):
    p = skia.Paint(AntiAlias=True, Color=color)
    if stroke:
        p.setStyle(skia.Paint.kStroke_Style)
        p.setStrokeWidth(stroke)
        p.setStrokeCap(skia.Paint.kRound_Cap)
        p.setStrokeJoin(skia.Paint.kRound_Join)
    if alpha < 1.0:
        p.setAlphaf(max(0.0, alpha) * (skia.Color4f.FromColor(color).fA))
    return p


def fill_and_outline(c, path, fill, width=3.2):
    c.drawPath(path, paint(fill))
    c.drawPath(path, paint(OUTLINE, width))


def ear(c, side, twitch):
    c.save()
    c.translate(side * 34, -38)
    c.scale(1.15, 1.15)
    c.rotate(side * (18 + twitch * 14))
    p = skia.Path()
    p.moveTo(-17, 10)
    p.quadTo(-12, -22, 0, -30)
    p.quadTo(12, -22, 17, 10)
    p.close()
    fill_and_outline(c, p, FUR)
    q = skia.Path()
    q.moveTo(-9, 6)
    q.quadTo(-6, -14, 0, -19)
    q.quadTo(6, -14, 9, 6)
    q.close()
    c.drawPath(q, paint(EAR_IN))
    c.restore()


def body_path(squash):
    w, h = 62 * (1 + squash * 0.04), 54 * (1 - squash * 0.04)
    return skia.Path().addOval(skia.Rect(-w, -h, w, h + 6))


def eye(c, x, st, side):
    look_x, look_y = st["look"]
    ex, ey = x + look_x * 4.5, -2 + look_y * 3.5
    kind = st["eyes"]
    blink = st["blink"]
    if kind == "happy":
        p = skia.Path()
        p.moveTo(ex - 9, ey + 3)
        p.quadTo(ex, ey - 9, ex + 9, ey + 3)
        c.drawPath(p, paint(EYE, 3.6))
        return
    if kind == "sleepy" or blink > 0.85:
        sag = 2 if kind == "sleepy" else 0
        p = skia.Path()
        p.moveTo(ex - 9, ey + 1)
        p.quadTo(ex, ey + 5 + sag, ex + 9, ey + 1)
        c.drawPath(p, paint(EYE, 3.4))
        return
    if kind == "squint":  # >  <
        p = skia.Path()
        p.moveTo(ex - 7 * side, ey - 7)
        p.lineTo(ex + 6 * side, ey)
        p.lineTo(ex - 7 * side, ey + 7)
        c.drawPath(p, paint(EYE, 3.6))
        return
    if kind == "star":
        star(c, ex, ey, 11, skia.Color(255, 196, 64), spin=st["t"] * 1.5)
        star(c, ex, ey, 11, OUTLINE, spin=st["t"] * 1.5, stroke=2.2)
        return
    if kind == "heart":
        heart(c, ex, ey + 1, 10, skia.Color(255, 92, 128))
        return
    big = 1.18 if kind == "wide" else 1.0
    rx, ry = 8.2 * big, 10.5 * big * (1 - blink)
    if kind == "half":
        ry *= 0.55
    c.drawOval(skia.Rect(ex - rx, ey - ry, ex + rx, ey + ry), paint(EYE))
    if ry > 3:
        hl = 0.6 if kind == "wide" else 1.0
        c.drawCircle(ex - 2.6 + look_x, ey - 4 * (1 - blink), 3.2 * hl, paint(skia.ColorWHITE))
        c.drawCircle(ex + 3, ey + 3.5 * (1 - blink), 1.5, paint(skia.ColorWHITE))
    if kind == "half":  # flat lid line
        c.drawLine(ex - 10, ey - ry, ex + 10, ey - ry, paint(EYE, 3))


def star(c, x, y, r, color, spin=0.0, stroke=0.0):
    p = skia.Path()
    for i in range(10):
        a = spin + i * math.pi / 5 - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.45
        (p.moveTo if i == 0 else p.lineTo)(x + rr * math.cos(a), y + rr * math.sin(a))
    p.close()
    c.drawPath(p, paint(color, stroke) if stroke else paint(color))


def sparkle(c, x, y, r, color, alpha=1.0):
    p = skia.Path()
    p.moveTo(x, y - r)
    p.quadTo(x, y, x + r, y)
    p.quadTo(x, y, x, y + r)
    p.quadTo(x, y, x - r, y)
    p.quadTo(x, y, x, y - r)
    p.close()
    c.drawPath(p, paint(color, alpha=alpha))


def heart(c, x, y, r, color, alpha=1.0, outline=True):
    p = skia.Path()
    p.moveTo(x, y + r)
    p.cubicTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.45)
    p.cubicTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r)
    p.close()
    c.drawPath(p, paint(color, alpha=alpha))
    if outline:
        c.drawPath(p, paint(OUTLINE, 2, alpha=alpha))


def mouth(c, st):
    kind = st["mouth_kind"]
    m = st["mouth"]
    y = 17
    if kind == "o":
        c.drawOval(skia.Rect(-5, y - 3, 5, y + 9), paint(MOUTH_IN))
        c.drawOval(skia.Rect(-5, y - 3, 5, y + 9), paint(OUTLINE, 2.6))
        return
    if kind == "pout":
        p = skia.Path()
        p.moveTo(-9, y + 3)
        for i in range(1, 5):
            p.lineTo(-9 + i * 4.5, y + (0 if i % 2 else 3))
        c.drawPath(p, paint(OUTLINE, 2.8))
        return
    if kind == "smile" and m < 0.15:
        m = 0.55
    if m < 0.12:  # resting cat mouth  ω
        p = skia.Path()
        p.moveTo(-9, y - 1)
        p.quadTo(-4.5, y + 6, 0, y)
        p.quadTo(4.5, y + 6, 9, y - 1)
        c.drawPath(p, paint(OUTLINE, 2.8))
        return
    w = 8 + 3 * m
    h = 3 + 13 * m
    p = skia.Path()
    p.moveTo(-w, y - 1)
    p.quadTo(0, y + 1, w, y - 1)
    p.cubicTo(w, y + h, -w, y + h, -w, y - 1)
    p.close()
    c.drawPath(p, paint(MOUTH_IN))
    c.save()
    c.clipPath(p, doAntiAlias=True)
    c.drawOval(skia.Rect(-w * 0.75, y + h * 0.45, w * 0.75, y + h * 1.25), paint(TONGUE))
    c.restore()
    c.drawPath(p, paint(OUTLINE, 2.6))


def paw(c, x, y, rot=0.0):
    c.save()
    c.translate(x, y)
    c.rotate(rot)
    r = skia.Rect(-11, -9, 11, 9)
    c.drawOval(r, paint(FUR))
    c.drawOval(r, paint(OUTLINE, 3))
    for dx in (-4.5, 0, 4.5):
        c.drawLine(dx, -9, dx, -4.5, paint(OUTLINE, 1.8))
    c.restore()


def headset(c, st):
    band = skia.Path()
    band.moveTo(-58, -8)
    band.cubicTo(-58, -78, 58, -78, 58, -8)
    c.drawPath(band, paint(OUTLINE, 9))
    c.drawPath(band, paint(MINT, 5))
    for side in (-1, 1):
        r = skia.Rect(side * 61 - 9, -20, side * 61 + 9, 8)
        rr = skia.RRect.MakeRectXY(r, 8, 8)
        c.drawRRect(rr, paint(MINT))
        c.drawRRect(rr, paint(OUTLINE, 3))
    boom = skia.Path()
    boom.moveTo(-60, 2)
    boom.quadTo(-56, 30, -30, 30)
    c.drawPath(boom, paint(OUTLINE, 6))
    c.drawPath(boom, paint(MINT_DARK, 3))
    lit = 0.35 + 0.65 * min(1.0, st["mouth"] * 2.2)
    c.drawCircle(-28, 30, 5, paint(OUTLINE))
    c.drawCircle(-28, 30, 3.2, paint(skia.Color(255, 120, 140), alpha=lit))


def draw_character(c, st):
    c.save()
    c.translate(0, st["bob"])
    c.rotate(st["tilt"])
    ear(c, -1, st["ear_l"])
    ear(c, 1, st["ear_r"])
    body = body_path(st["squash"])
    fill_and_outline(c, body, FUR)
    # soft belly shade
    c.save()
    c.clipPath(body, doAntiAlias=True)
    c.drawOval(skia.Rect(-70, 30, 70, 90), paint(FUR_SHADE))
    c.restore()
    c.drawPath(body, paint(OUTLINE, 3.2))
    headset(c, st)
    cheek = 1.0 + 0.35 * st["puff"]
    for side in (-1, 1):
        c.drawOval(skia.Rect(side * 38 - 9 * cheek, 11 - 5 * cheek, side * 38 + 9 * cheek, 11 + 5 * cheek),
                   paint(BLUSH, alpha=0.45 + 0.4 * st["blush"]))
    if st["brows"] == "angry":
        c.drawLine(-31, -17, -16, -12, paint(EYE, 3))
        c.drawLine(31, -17, 16, -12, paint(EYE, 3))
    elif st["brows"] == "worried":
        c.drawLine(-31, -12, -17, -17, paint(EYE, 2.6))
        c.drawLine(31, -12, 17, -17, paint(EYE, 2.6))
    eye(c, -24, st, -1)
    eye(c, 24, st, 1)
    mouth(c, st)
    pw = st["paws"]
    if pw == "cover":
        paw(c, -8, 20, 0.0)
        paw(c, 10, 22, 0.0)
    elif pw == "up":
        wave = math.sin(st["t"] * 14) * 18
        paw(c, -64, -18 + wave * 0.2, -30 + wave)
        paw(c, 64, -18 - wave * 0.2, 30 - wave)
    elif pw == "wave":
        wave = math.sin(st["t"] * 12) * 22
        paw(c, 22, 48, 0)
        paw(c, -66, -14, -20 + wave)
    else:
        paw(c, -22, 50 + st["paw_tap"][0], 0)
        paw(c, 22, 50 + st["paw_tap"][1], 0)
    c.restore()


def draw_fx(c, st):
    t = st["t"]
    for fx in st["fx"]:
        kind, age, a = fx["kind"], fx["age"], fx["alpha"]
        if kind == "sparkles":
            for i, (x, y, r) in enumerate([(-62, -62, 9), (66, -58, 7), (74, 18, 6), (-74, 22, 7)]):
                tw = 0.6 + 0.4 * math.sin(t * 9 + i * 1.7)
                sparkle(c, x, y, r * tw, skia.Color(255, 205, 80), a)
        elif kind == "hearts":
            for i, x in enumerate((-48, 50, 6)):
                y = -60 - ((age * 30 + i * 18) % 50)
                heart(c, x, y, 7, skia.Color(255, 110, 140), a * 0.9)
        elif kind in ("question", "bang", "zzz", "notes"):
            text = {"question": "?", "bang": "!!", "zzz": "z", "notes": "♪"}[kind]
            if kind == "zzz":
                for i in range(3):
                    ph = (age * 0.45 + i / 3) % 1.0
                    label(c, "z", 50 + ph * 30, -50 - ph * 40, 13 + ph * 9, a * min(1, (1 - ph) * 3))
            elif kind == "notes":
                for i in range(2):
                    ph = (age * 0.5 + i / 2) % 1.0
                    label(c, text, 58 + ph * 18 + i * 6, -40 - ph * 40, 18, a * min(1, (1 - ph) * 3),
                          color=MINT_DARK)
            else:
                pop = min(1.0, age * 6)
                s = 0.6 + 0.4 * pop + 0.08 * math.sin(age * 12) * (1 - min(1, age))
                label(c, text, 64, -54, 28 * s, a,
                      color=skia.Color(240, 80, 90) if kind == "bang" else skia.Color(90, 120, 230))
        elif kind == "sweat":
            y = -40 + min(age, 1.2) * 14
            drop = skia.Path()
            drop.moveTo(58, y - 12)
            drop.cubicTo(66, y, 64, y + 8, 58, y + 8)
            drop.cubicTo(52, y + 8, 50, y, 58, y - 12)
            c.drawPath(drop, paint(skia.Color(140, 200, 255), alpha=a))
            c.drawPath(drop, paint(OUTLINE, 2, alpha=a))
        elif kind == "vein":
            c.save()
            c.translate(44, -40)
            s = 1 + 0.12 * math.sin(age * 16)
            c.scale(s, s)
            v = paint(skia.Color(230, 60, 70), 3.2, alpha=a)
            for ang in (0, 90, 180, 270):
                c.save()
                c.rotate(ang)
                p = skia.Path()
                p.moveTo(3, -9)
                p.quadTo(3, -3, 9, -3)
                c.drawPath(p, v)
                c.restore()
            c.restore()


def label(c, text, x, y, size, alpha, color=OUTLINE):
    font = skia.Font(TYPEFACE, size)
    w = font.measureText(text)
    blob = skia.TextBlob.MakeFromString(text, font)
    c.drawTextBlob(blob, x - w / 2, y, paint(skia.ColorWHITE, 4, alpha=alpha))
    c.drawTextBlob(blob, x - w / 2, y, paint(color, alpha=alpha))


def draw_bubble(c, text, right_x, cy, alpha, scale):
    """Speech bubble whose tail points right, at the character."""
    if alpha <= 0:
        return
    font = skia.Font(TYPEFACE, 15)
    w = font.measureText(text)
    pad_x, h = 12, 30
    bw = w + pad_x * 2
    c.save()
    c.translate(right_x, cy)
    c.scale(scale, scale)
    rect = skia.Rect(-bw, -h / 2, 0, h / 2)
    p = skia.Path()
    p.addRRect(skia.RRect.MakeRectXY(rect, 14, 14))
    tail = skia.Path()
    tail.moveTo(-8, -4)
    tail.lineTo(10, 3)
    tail.lineTo(-10, 8)
    tail.close()
    p = skia.Op(p, tail, skia.PathOp.kUnion_PathOp)
    c.drawPath(p, paint(skia.ColorWHITE, alpha=alpha))
    c.drawPath(p, paint(OUTLINE, 2.6, alpha=alpha))
    blob = skia.TextBlob.MakeFromString(text, font)
    c.drawTextBlob(blob, -bw + pad_x, 5.5, paint(OUTLINE, alpha=alpha))
    c.restore()
