#!/usr/bin/env python3
"""Kose Capital sitesini derler.

Girdi : src/body.html (sayfa), src/land.txt (harita noktaları), src/logo.json (tools/logo.py üretir),
        src/castle.json (Castle rakamları; Castle deposundaki docs/data/summary.json'ın kopyası),
        src/site.json (alan adı), assets/ (logo, simge, paylaşım görseli)
Çıktı : docs/            yayımlanan site (GitHub Pages bu klasörü yayımlar): index.html, fonts/, favicon.svg, ...
        dist/artifact.html   Claude'daki önizleme (yazı tipleri Google Fonts'tan)

Kullanım: python3 build.py [--castle <Castle deposundaki docs/data/summary.json>]
"""
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DOCS, DIST, NM, ASSETS = ROOT / "src", ROOT / "docs", ROOT / "dist", ROOT / "node_modules", ROOT / "assets"

GOOGLE = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
          'family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500&display=swap">')
FONT_CSS = [
    (NM / "@fontsource-variable/archivo", "wdth.css"),
    (NM / "@fontsource/ibm-plex-mono", "400.css"),
    (NM / "@fontsource/ibm-plex-mono", "500.css"),
]
KEEP = ("latin", "latin-ext")           # Türkçe harfler latin-ext içinde
MONTHS = {"en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          "tr": ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]}
DESC = ("Kose Capital builds and runs three systems: Castle (value investing), Bazaar (AI sales) "
        "and Apex (exchange connectivity for Borsa Istanbul).")


def font_faces():
    """@fontsource CSS dosyalarından yalnız latin ve latin-ext yüzlerini al; dosya listesini de döndür."""
    out, files = [], []
    for pkg, name in FONT_CSS:
        css = (pkg / name).read_text(encoding="utf-8")
        for m in re.finditer(r"@font-face\s*\{.*?\}", css, re.S):
            block = m.group(0)
            woff2 = re.search(r"url\(\./files/([^)]+\.woff2)\)", block)
            if not woff2:
                continue
            fn = woff2.group(1)
            if not re.fullmatch(r"(archivo|ibm-plex-mono)-(%s)-(wdth|400|500)-normal\.woff2" % "|".join(KEEP), fn):
                continue
            files.append(pkg / "files" / fn)
            block = re.sub(r"src:.*?;", "src:url(fonts/%s) format('woff2');" % fn, block, flags=re.S)
            block = block.replace("'Archivo Variable'", "'Archivo'")
            out.append(re.sub(r"\s+", " ", block))
    return "\n".join(out), files


def castle_numbers():
    """Castle rakamları: sayfaya yazılan son değerler. Yayındaki sayfa bunları Castle'ın özet dosyasından yeniler."""
    if "--castle" in sys.argv:
        src = pathlib.Path(sys.argv[sys.argv.index("--castle") + 1])
        (SRC / "castle.json").write_text(json.dumps(json.loads(src.read_text(encoding="utf-8")), ensure_ascii=False) + "\n", encoding="utf-8")
    k = json.loads((SRC / "castle.json").read_text(encoding="utf-8"))
    y, m, d = k["asof"].split("-")
    grp = lambda n, sep: re.sub(r"\B(?=(\d{3})+(?!\d))", sep, str(n))
    return {"__K_COUNTRIES__": str(k["countries"]), "__K_CASTLES__": str(k["castles"]),
            "__K_COMPANIES_EN__": grp(k["companies"], ","), "__K_COMPANIES_TR__": grp(k["companies"], "."),
            "__K_ASOF_EN__": "%d %s %s" % (int(d), MONTHS["en"][int(m) - 1], y), "__K_ASOF_TR__": "%d %s %s" % (int(d), MONTHS["tr"][int(m) - 1], y)}


def main():
    body = (SRC / "body.html").read_text(encoding="utf-8")
    land = (SRC / "land.txt").read_text(encoding="utf-8").strip()
    logo = json.loads((SRC / "logo.json").read_text(encoding="utf-8"))
    site = json.loads((SRC / "site.json").read_text(encoding="utf-8")) if (SRC / "site.json").exists() else {}
    assert re.fullmatch(r"[0-9a-f]{1350}", land), "land.txt bozuk"
    fills = {"__LAND__": land,
             "<!--__LOGO__-->": '<svg viewBox="0 0 %s %s" aria-hidden="true" focusable="false"><path d="%s"/></svg>' % (logo["w"], logo["h"], logo["d"])}
    fills.update(castle_numbers())
    for key, val in fills.items():
        assert body.count(key) == 1, key
        body = body.replace(key, val)
    assert "<!--__FONTLINK__-->" in body and "/*__FONTS__*/" in body and "__K_" not in body

    # 1) Claude önizlemesi: gövde olduğu gibi, yazı tipleri Google Fonts'tan
    DIST.mkdir(exist_ok=True)
    art = body.replace("<!--__FONTLINK__-->", GOOGLE).replace("/*__FONTS__*/\n", "")
    (DIST / "artifact.html").write_text(art, encoding="utf-8")

    # 2) Yayın: tam belge, yazı tipleri ve simgeler siteyle birlikte
    if DOCS.exists():
        shutil.rmtree(DOCS)
    (DOCS / "fonts").mkdir(parents=True)
    faces, files = font_faces()
    for f in files:
        shutil.copyfile(f, DOCS / "fonts" / f.name)
    for name in ("favicon.svg", "apple-touch-icon.png", "og.png"):
        if (ASSETS / name).exists():
            shutil.copyfile(ASSETS / name, DOCS / name)
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    domain = site.get("domain")
    if domain:
        (DOCS / "CNAME").write_text(domain + "\n", encoding="utf-8")
    base = "https://%s/" % domain if domain else None

    cut = body.index('<header class="top">')
    head, rest = body[:cut], body[cut:]
    head = head.replace("<!--__FONTLINK__-->\n", "").replace("/*__FONTS__*/", faces)
    head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
    extra = ['<meta name="description" content="%s">' % DESC,
             '<meta name="theme-color" content="#070B09">',
             '<link rel="icon" href="favicon.svg" type="image/svg+xml">']
    if (ASSETS / "apple-touch-icon.png").exists():
        extra.append('<link rel="apple-touch-icon" href="apple-touch-icon.png">')
    extra += ['<meta property="og:type" content="website">', '<meta property="og:site_name" content="Kose Capital">',
              '<meta property="og:title" content="Kose Capital">', '<meta property="og:description" content="%s">' % DESC]
    if base:
        extra += ['<link rel="canonical" href="%s">' % base,
                  '<link rel="alternate" hreflang="en" href="%s?lang=en">' % base, '<link rel="alternate" hreflang="tr" href="%s?lang=tr">' % base,
                  '<link rel="alternate" hreflang="x-default" href="%s">' % base,
                  '<meta property="og:url" content="%s">' % base]
        if (ASSETS / "og.png").exists():
            extra += ['<meta property="og:image" content="%sog.png">' % base, '<meta property="og:image:width" content="1200">',
                      '<meta property="og:image:height" content="630">', '<meta name="twitter:card" content="summary_large_image">']
    extra += ['<link rel="preload" as="font" type="font/woff2" crossorigin href="fonts/%s">' % f.name for f in files if "latin-wdth" in f.name]
    doc = ("<!doctype html>\n<html lang=\"en\" data-lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
           + "\n".join(extra) + "\n" + head + "</head>\n<body>\n" + rest + "</body>\n</html>\n")
    (DOCS / "index.html").write_text(doc, encoding="utf-8")
    print("docs/index.html %d bayt | dist/artifact.html %d bayt | yazı tipi %d dosya | alan adı: %s"
          % (len(doc.encode()), len(art.encode()), len(files), domain or "yok"))


if __name__ == "__main__":
    main()
