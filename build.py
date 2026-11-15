#!/usr/bin/env python3
"""Kose Capital sitesini derler.

Girdi : src/body.html (sayfa), src/land.txt (harita noktaları), src/logo.json (tools/logo.py üretir),
        src/castle.json (Castle rakamları; Castle deposundaki docs/data/summary.json'ın kopyası),
        src/site.json (alan adı), assets/ (logo, simge, paylaşım görseli),
        src/orbit.html (Orbit uygulaması), node_modules/geotiff (Orbit'in görüntü dosyası okuyucusu)
Çıktı : docs/            yayımlanan site (GitHub Pages bu klasörü yayımlar): index.html, fonts/, favicon.svg, ...
        docs/orbit/index.html   Orbit uygulaması (tek dosya; yazı tipleri ../fonts/ klasöründen)
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
# Sayfanın kendi <head> bölümü. Tarayıcıda dil seçilince betik açıklamayı (ve Orbit'te başlığı) o dile çevirir;
# betik çalıştırmayan paylaşım önizlemeleri (WhatsApp, LinkedIn) ise bu sabit metni gösterir: önce Türkçe, sonra İngilizce.
# Metinler sayfadakilerle aynı olmalı (src/body.html DESC, src/orbit.html desc ve title); denemeler bunu karşılaştırır.
DESC_TR = ("Kose Capital dört sistem kurar ve işletir: Castle (değer yatırımı), Bazaar (yapay zekâyla satış), "
           "Apex (Borsa İstanbul için borsa bağlantısı) ve Orbit (Türkiye'deki arazilerin uydu görüntüsü).")
DESC_EN = ("Kose Capital builds and runs four systems: Castle (value investing), Bazaar (AI sales), "
           "Apex (exchange connectivity for Borsa Istanbul) and Orbit (satellite imagery of land in Türkiye).")
DESC = DESC_TR + " / " + DESC_EN
ORBIT_TR = ("Türkiye'deki bir arsanın, tarlanın ya da arazinin en yeni bulutsuz uydu görüntüsü. Eski bir tarihle karşılaştır, ne zaman değiştiğini gör. Ücretsiz, kayıt gerekmez.")
ORBIT_EN = ("The latest cloud-free satellite image of a plot, field or piece of land in Türkiye. Compare it with an earlier date and see when it changed. Free, no sign-up.")
ORBIT_DESC = ORBIT_TR + " / " + ORBIT_EN
ORBIT_OG = "Orbit · Arazinin en yeni uydu görüntüsü / The latest satellite image of a piece of land"
# Google'a sayfaların listesi. Castle ayrı depodadır ama aynı alan adında (/castle/) durur; dili de adresteki ?lang= ile seçer.
PAGES = ["", "orbit/", "castle/"]


def canonical(url):
    """Her dil adresi kendini asıl sayfa olarak gösterir: /?lang=tr Türkçe, /?lang=en İngilizce, / tarayıcının dili.
    Sayfa tek dosya olduğundan etiket betikle yazılır. Sabit bir etiket bütün dilleri dile bakmayan adrese bağlardı;
    Google da o zaman Türkçe sürümü ayrı bir sayfa olarak dizine almazdı. Google'ın önerdiği gibi etiket sabit HTML'de hiç yoktur."""
    return ('<script>(function(){var m=/[?&]lang=(tr|en)\\b/.exec(location.search),k=document.createElement("link");'
            'k.rel="canonical";k.href="%s"+(m?"?lang="+m[1]:"");document.head.appendChild(k);})();</script>' % url)


def seo_files(base):
    """robots.txt ve sitemap.xml: her sayfa üç adresiyle (Türkçe, İngilizce, tarayıcının dili) ve birbirine bağlı."""
    (DOCS / "robots.txt").write_text("User-agent: *\nAllow: /\n\nSitemap: %ssitemap.xml\n" % base, encoding="utf-8")
    rows = []
    for page in PAGES:
        url = base + page
        alts = "".join('\n    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (h, u)
                       for h, u in (("tr", url + "?lang=tr"), ("en", url + "?lang=en"), ("x-default", url)))
        for loc in (url, url + "?lang=tr", url + "?lang=en"):
            rows.append("  <url>\n    <loc>%s</loc>%s\n  </url>" % (loc, alts))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
           + "\n".join(rows) + "\n</urlset>\n")
    (DOCS / "sitemap.xml").write_text(xml, encoding="utf-8")
    return len(rows)


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


def build_orbit(logo_svg, faces, files, base):
    """Orbit uygulaması: src/orbit.html -> docs/orbit/index.html. Yazı tipleri ana sayfanınkilerdir (../fonts/);
    görüntü dosyası okuyucusu (geotiff.js) sayfaya gömülür, böylece sayfa dışarıdan kitaplık yüklemez."""
    page = (SRC / "orbit.html").read_text(encoding="utf-8")
    pkg = NM / "geotiff"
    meta = json.loads((pkg / "package.json").read_text(encoding="utf-8"))
    lib = (pkg / "dist-browser" / "geotiff.js").read_text(encoding="utf-8")
    lib = re.sub(r"//# sourceMappingURL=.*$", "", lib, flags=re.M).replace("</script", "<\\/script").replace("<!--", "<\\!--")
    deps = []
    for name in sorted(meta.get("dependencies", {})):
        d = json.loads((NM / name / "package.json").read_text(encoding="utf-8"))
        deps.append("%s %s (%s)" % (name, d.get("version", "?"), d.get("license", "?")))
    notice = ("/*\ngeotiff.js %s\n\n%s\nBu derleme şu paketleri de içerir: %s.\n*/\n"
              % (meta["version"], (pkg / "LICENSE").read_text(encoding="utf-8").strip().replace("*/", "* /"), ", ".join(deps)))
    head = ['<meta name="description" content="%s">' % ORBIT_DESC, '<meta name="theme-color" content="#070B09">',
            '<link rel="icon" href="../favicon.svg" type="image/svg+xml">']
    if (ASSETS / "apple-touch-icon.png").exists():
        head.append('<link rel="apple-touch-icon" href="../apple-touch-icon.png">')
    head += ['<meta property="og:type" content="website">', '<meta property="og:site_name" content="Kose Capital">',
             '<meta property="og:title" content="%s">' % ORBIT_OG, '<meta property="og:description" content="%s">' % ORBIT_DESC]
    if base:
        url = base + "orbit/"
        head += [canonical(url),
                 '<link rel="alternate" hreflang="en" href="%s?lang=en">' % url, '<link rel="alternate" hreflang="tr" href="%s?lang=tr">' % url,
                 '<link rel="alternate" hreflang="x-default" href="%s">' % url, '<meta property="og:url" content="%s">' % url]
        if (ASSETS / "og.png").exists():
            head += ['<meta property="og:image" content="%sog.png">' % base, '<meta property="og:image:width" content="1200">',
                     '<meta property="og:image:height" content="630">', '<meta name="twitter:card" content="summary_large_image">']
    head += ['<link rel="preload" as="font" type="font/woff2" crossorigin href="../fonts/%s">' % f.name for f in files if "latin-wdth" in f.name]
    fills = {"<!--__HEAD__-->": "\n".join(head), "/*__FONTS__*/": faces.replace("url(fonts/", "url(../fonts/"),
             "<!--__LOGO__-->": logo_svg, "/*__GEOTIFF__*/": notice + lib}
    for key, val in fills.items():
        assert page.count(key) == 1, key
        page = page.replace(key, val)
    (DOCS / "orbit").mkdir(parents=True, exist_ok=True)
    (DOCS / "orbit" / "index.html").write_text(page, encoding="utf-8")
    return len(page.encode()), meta["version"]


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
    for f in sorted((SRC / "verify").glob("*")) if (SRC / "verify").is_dir() else []:     # Search Console ve Bing doğrulama dosyaları: sitenin köküne
        shutil.copyfile(f, DOCS / f.name)
    domain = site.get("domain")
    if domain:
        (DOCS / "CNAME").write_text(domain, encoding="utf-8")      # GitHub'ın yazdığı dosyayla bayt bayt aynı: sonda satır sonu yok
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
        extra += [canonical(base),
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
    orbit_size, geotiff = build_orbit(fills["<!--__LOGO__-->"], faces, files, base)
    urls = seo_files(base) if base else 0
    print("docs/index.html %d bayt | dist/artifact.html %d bayt | yazı tipi %d dosya | alan adı: %s"
          % (len(doc.encode()), len(art.encode()), len(files), domain or "yok"))
    print("docs/orbit/index.html %d bayt | geotiff %s | sitemap.xml %d adres" % (orbit_size, geotiff, urls))


if __name__ == "__main__":
    main()
