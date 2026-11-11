#!/usr/bin/env python3
"""Kose Capital logosu: KC simgesi ve yazısı, vektörel (SVG).

Simge eski logodaki fikri korur: K, sola bakan bir ok ile iki köşe üçgeninden oluşur; C yarım halkadır.
Yeni çizimde bütün eğik kenarlar 45 derecedir, kalınlıklar ve aralıklar eşittir, C okun içine oturur.
Yazı Archivo'dan (SIL Open Font License) eğriye çevrilir; SVG dosyaları yazı tipi gerektirmez.

Kullanım: python3 tools/logo.py            -> assets/ altına SVG dosyaları, src/logo.json
"""
import json
import math
import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / "node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"
INK, BONE = "#070B09", "#ECE8DC"
S2 = math.sqrt(2)


def n(v):
    return ("%.2f" % v).rstrip("0").rstrip(".") or "0"


def mark(H=96.0, T=25.0, G=11.0, tri=None, cut=0.0):
    """KC simgesi. H yükseklik, T kol kalınlığı (dik ölçü), G aralık (dik ölçü), tri köşe üçgeninin kenarı.
    Dönen: (yol, genişlik)."""
    h, t, g = H / 2, T * S2, G * S2
    L = (h - g) if tri is None else tri
    k = [  # K: iki köşe üçgeni ve sola bakan ok
        "M0 0H%sL0 %sZ" % (n(L), n(L)),
        "M0 %sL%s %sH0Z" % (n(H - L), n(L), n(H)),
        "M0 %sL%s 0H%sL%s %sL%s %sH%sZ" % (n(h), n(h), n(h + t), n(t), n(h), n(h + t), n(H), n(h)),
    ]
    R, r = h, h - T
    cx = t + S2 * (R + G)          # C, okun iç kenarına G kadar uzakta durur
    c = "M%s 0A%s %s 0 0 0 %s %sV%sA%s %s 0 0 1 %s %sZ" % (n(cx), n(R), n(R), n(cx), n(H), n(H - T), n(r), n(r), n(cx), n(T))
    if cut:                        # C'nin uçları biraz uzasın
        c = "M%s 0H%sA%s %s 0 0 0 %s %sH%sV%sH%sA%s %s 0 0 1 %s %sH%sZ" % (
            n(cx + cut), n(cx), n(R), n(R), n(cx), n(H), n(cx + cut), n(H - T), n(cx), n(r), n(r), n(cx), n(T), n(cx + cut))
    return "".join(k) + c, cx + cut


def face(wght=600, wdth=125):
    return instancer.instantiateVariableFont(TTFont(str(FONT)), {"wght": wght, "wdth": wdth})


def text(font, s, cap, tracking=0.18, x=0.0, top=0.0, kern=None):
    """Yazıyı eğriye çevirir. cap: büyük harf yüksekliği (birim), tracking: harf arası (em). Dönen: (yol, bitiş x)."""
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    size = cap / (font["OS/2"].sCapHeight / upm)
    sc, base, out = size / upm, top + cap, []
    kern = kern or {}
    for i, ch in enumerate(s):
        if ch == " ":
            x += 0.32 * size + tracking * size
            continue
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs, ntos=n)
        g.draw(TransformPen(pen, (sc, 0, 0, -sc, x, base)))
        out.append(pen.getCommands())
        x += g.width * sc + tracking * size + kern.get(s[i:i + 2], 0) * size
    return "".join(out), x - tracking * size


def svg(w, h, body, bg=None, title="Kose Capital"):
    back = '<rect width="%s" height="%s" fill="%s"/>' % (n(w), n(h), bg) if bg else ""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" role="img" aria-label="%s">%s%s</svg>\n'
            % (n(w), n(h), title, back, body))


KERN = {"TA": -0.05, "AP": -0.02, "AL": -0.01, "KO": -0.01, "PI": 0.0, "IT": 0.0}


def build(params=None, wght=600, wdth=125, tracking=0.18):
    params = params or {}
    H = 96.0
    m, mw = mark(H, **params)
    f = face(wght, wdth)
    # 1) yatay: simge + tek satır yazı
    cap = 30.0
    t1, t1w = text(f, "KOSE CAPITAL", cap, tracking, x=mw + 40, top=(H - cap) / 2, kern=KERN)
    horiz = (t1w, H, '<path d="%s%s"/>' % (m, t1))
    # 2) iki satır: simge + üstte büyük KOSE, altta CAPITAL (eski logodaki dizilim).
    #    İki satır simgeyle aynı yükseklikte bir blok oluşturur; CAPITAL'in harf arası, satır KOSE ile aynı genişliğe gelecek biçimde hesaplanır.
    c1, c2, x0 = 54.0, 24.0, mw + 30
    a, aw = text(f, "KOSE", c1, 0.05, x=x0, top=0, kern=KERN)
    _, w0 = text(f, "CAPITAL", c2, 0.0, x=x0, top=0, kern=KERN)
    size2 = c2 / (f["OS/2"].sCapHeight / f["head"].unitsPerEm)
    tr2 = (aw - w0) / (6 * size2)
    b, bw = text(f, "CAPITAL", c2, tr2, x=x0, top=H - c2, kern=KERN)
    stack = (max(aw, bw), H, '<path d="%s%s%s"/>' % (m, a, b))
    return {"mark": (mw, H, '<path d="%s"/>' % m), "horizontal": horiz, "stacked": stack, "mark_d": m, "mark_w": mw,
            "word_d": t1, "word_w": t1w}


def main():
    out = ROOT / "assets"
    out.mkdir(exist_ok=True)
    L = build()
    for name in ("mark", "horizontal", "stacked"):
        w, h, body = L[name]
        (out / ("kose-capital-%s.svg" % name)).write_text(svg(w, h, body.replace("<path ", '<path fill="%s" ' % INK)), encoding="utf-8")
        (out / ("kose-capital-%s-light.svg" % name)).write_text(svg(w, h, body.replace("<path ", '<path fill="%s" ' % BONE)), encoding="utf-8")
    # site simgesi: koyu kare üstünde açık simge
    mw, H = L["mark_w"], 96.0
    pad = 26.0
    side = max(mw, H) + 2 * pad
    icon = '<rect width="%s" height="%s" rx="%s" fill="%s"/><path fill="%s" transform="translate(%s %s)" d="%s"/>' % (
        n(side), n(side), n(side * 0.18), INK, BONE, n((side - mw) / 2), n((side - H) / 2), L["mark_d"])
    (out / "favicon.svg").write_text(svg(side, side, icon), encoding="utf-8")
    # sayfaya gömülecek üst şerit logosu
    w, h, _ = L["horizontal"]
    (ROOT / "src" / "logo.json").write_text(json.dumps({"w": round(w, 2), "h": h, "d": L["mark_d"] + L["word_d"], "icon": icon, "side": round(side, 2)}), encoding="utf-8")
    print("logo: simge %sx96, yatay %sx96, iki satır %sx96" % (n(L["mark_w"]), n(L["horizontal"][0]), n(L["stacked"][0])))


if __name__ == "__main__":
    main()
