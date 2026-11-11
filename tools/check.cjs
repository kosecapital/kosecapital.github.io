// Sayfa denemesi: dist/index.html'i yerel sunucudan açar; masaüstü ve telefonda, iki dilde gezer.
// Kullanım: node tools/check.cjs [ekran görüntüsü klasörü]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(DIST, p);
      if (!f.startsWith(DIST) || !fs.existsSync(f)) { r.writeHead(404); return r.end("yok"); }
      r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

(async () => {
  const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch();
  const bad = [];
  const fail = (m) => { bad.push(m); console.log("  HATA: " + m); };
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const [name, vp, lang] of [["masaustu", { width: 1440, height: 900 }, "en"], ["masaustu", { width: 1440, height: 900 }, "tr"], ["dizustu", { width: 1280, height: 640 }, "tr"], ["telefon", { width: 390, height: 844 }, "en"], ["telefon", { width: 390, height: 844 }, "tr"], ["dar", { width: 320, height: 640 }, "tr"]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: "en-US" });
    const page = await ctx.newPage(), tag = name + "-" + lang;
    page.on("console", (m) => { if (m.type() === "error") fail(tag + " konsol: " + m.text()); });
    page.on("pageerror", (e) => fail(tag + " betik: " + e.message));
    await page.goto(base + "?lang=" + lang, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);

    const info = await page.evaluate(() => {
      const de = document.documentElement, vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none"; };
      const wide = [...document.querySelectorAll("body *")].filter((el) => vis(el) && el.getBoundingClientRect().right > innerWidth + 1 && !el.closest("canvas")).slice(0, 5).map((el) => el.tagName + "." + el.className);
      const ink = (cv) => { const g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) n++; return n; };
      return {
        lang: de.getAttribute("data-lang"), overflow: de.scrollWidth - innerWidth, wide,
        fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
        hero: ink(document.getElementById("reel")),
        both: [...document.querySelectorAll(".en,.tr")].filter(vis).filter((el) => el.classList.contains(de.getAttribute("data-lang") === "tr" ? "en" : "tr")).length,
        h: de.scrollHeight, heroH: Math.round(document.querySelector(".hero").getBoundingClientRect().height),
        addrLines: document.getElementById("addr").getClientRects().length, addrW: Math.round(document.getElementById("addr").getBoundingClientRect().width),
      };
    });
    console.log(tag, JSON.stringify(info));
    if (info.lang !== lang) fail(tag + " dil tutmadı");
    if (info.overflow > 0) fail(tag + " yatay taşma: " + info.overflow + "px " + info.wide.join(", "));
    if (info.hero < 50) fail(tag + " açılış görseli boş");
    if (info.both) fail(tag + " iki dil birden görünüyor");
    if (info.addrLines !== 1) fail(tag + " e-posta adresi tek satıra sığmadı");
    if (!info.fonts.includes("Archivo") || !info.fonts.includes("IBM Plex Mono")) fail(tag + " yazı tipi yüklenmedi: " + info.fonts);

    if (OUT) await page.screenshot({ path: path.join(OUT, tag + "-0-hero.png") });
    // üç ürün adı: üstüne gelince (ya da odaklanınca) açılıştaki görsel değişir
    for (let i = 0; i < 3; i++) {
      await page.focus('#names a[data-i="' + i + '"]'); await page.waitForTimeout(950);
      const on = await page.evaluate(() => [...document.querySelectorAll("#names a")].findIndex((a) => a.classList.contains("on")));
      if (on !== i) fail(tag + " açılışta ürün " + i + " seçilmedi");
      if (OUT && name !== "dar") await page.screenshot({ path: path.join(OUT, tag + "-0-hero-" + i + ".png") });
    }
    await page.evaluate(() => document.activeElement.blur());
    // her bölüm: görsel çiziyor mu, metin görselin altında kalmıyor mu
    for (const id of ["castle", "bazaar", "apex", "company", "contact"]) {
      await page.evaluate((i) => document.getElementById(i).scrollIntoView({ behavior: "instant", block: "start" }), id);
      await page.waitForTimeout(500);
      if (["castle", "bazaar", "apex"].includes(id)) {
        const n = await page.evaluate((i) => { const cv = document.querySelector("#" + i + " canvas"), g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let j = 3; j < d.length; j += 4 * 97) if (d[j] > 8) k++; return k; }, id);
        if (n < 50) fail(tag + " " + id + " görseli boş");
      }
      if (OUT) await page.screenshot({ path: path.join(OUT, tag + "-" + id + ".png") });
    }
    // dil düğmesi
    const other = lang === "tr" ? "en" : "tr";
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('#lang button[data-lang="' + other + '"]');
    const now = await page.evaluate(() => [document.documentElement.getAttribute("data-lang"), document.getElementById("castle-link").href]);
    if (now[0] !== other || !now[1].endsWith("?lang=" + other)) fail(tag + " dil düğmesi çalışmadı");
    await ctx.close();
  }

  // hareket azaltma: tek kare, döngü yok
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage(); await page.goto(base, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  const a = await page.evaluate(() => document.getElementById("reel").toDataURL().length); await page.waitForTimeout(700);
  const b = await page.evaluate(() => document.getElementById("reel").toDataURL().length);
  if (a !== b || a < 5000) fail("hareket azaltma: görsel duruyor olmalı (" + a + ", " + b + ")");
  await ctx.close();

  await browser.close(); srv.close();
  console.log(bad.length ? "\nsayfa denemesi TUTMADI: " + bad.length + " sorun" : "\nsayfa denemesi tamam (iki dil, masaüstü, telefon, üç görsel, hareket azaltma)");
  process.exit(bad.length ? 1 : 0);
})();
