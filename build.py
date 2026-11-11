#!/usr/bin/env python3
"""Kose Capital sitesi: src/body.html -> dist/index.html (yayın) ve dist/artifact.html (Claude önizlemesi).

Sayfa tek dosyadır. Yazı tipleri yayında siteyle birlikte sunulur (dist/fonts);
Claude önizlemesinde Google Fonts'tan yüklenir.
"""
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DIST, NM = ROOT / "src", ROOT / "dist", ROOT / "node_modules"

GOOGLE = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
          'family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500&display=swap">')

FONT_CSS = [
    (NM / "@fontsource-variable/archivo", "wdth.css"),
    (NM / "@fontsource/ibm-plex-mono", "400.css"),
    (NM / "@fontsource/ibm-plex-mono", "500.css"),
]
KEEP = ("latin", "latin-ext")           # Türkçe harfler latin-ext içinde


def font_faces():
    """@fontsource CSS dosyalarından yalnız latin ve latin-ext yüzlerini al, dosyaları dist/fonts'a kopyala."""
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


def main():
    body = (SRC / "body.html").read_text(encoding="utf-8")
    land = (SRC / "land.txt").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"[0-9a-f]{1350}", land), "land.txt bozuk"
    assert body.count("__LAND__") == 1 and "<!--__FONTLINK__-->" in body and "/*__FONTS__*/" in body
    body = body.replace("__LAND__", land)
    DIST.mkdir(exist_ok=True)

    # 1) Claude önizlemesi: gövde olduğu gibi, yazı tipleri Google Fonts'tan
    art = body.replace("<!--__FONTLINK__-->", GOOGLE).replace("/*__FONTS__*/\n", "")
    (DIST / "artifact.html").write_text(art, encoding="utf-8")

    # 2) Yayın: tam belge, yazı tipleri siteyle birlikte
    faces, files = font_faces()
    (DIST / "fonts").mkdir(exist_ok=True)
    for f in files:
        shutil.copyfile(f, DIST / "fonts" / f.name)
    cut = body.index('<header class="top">')
    head, rest = body[:cut], body[cut:]
    head = head.replace("<!--__FONTLINK__-->\n", "").replace("/*__FONTS__*/", faces)
    head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
    preload = "".join('<link rel="preload" as="font" type="font/woff2" crossorigin href="fonts/%s">\n' % f.name
                      for f in files if "latin-wdth" in f.name)
    doc = ("<!doctype html>\n<html lang=\"en\" data-lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
           "<meta name=\"description\" content=\"Kose Capital builds and runs three systems: Castle (value investing), "
           "Bazaar (AI sales) and Apex (exchange connectivity for Borsa Istanbul).\">\n"
           "<meta name=\"theme-color\" content=\"#070B09\">\n"
           + preload + head + "</head>\n<body>\n" + rest + "</body>\n</html>\n")
    (DIST / "index.html").write_text(doc, encoding="utf-8")
    print("dist/artifact.html %d bayt | dist/index.html %d bayt | yazı tipi %d dosya"
          % (len(art.encode()), len(doc.encode()), len(files)))


if __name__ == "__main__":
    main()
