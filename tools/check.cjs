// Sayfa denemesi: docs/index.html'i yerel sunucudan açar; masaüstü, tablet ve telefonda, iki dilde gezer.
// Kullanım: node tools/check.cjs [ekran görüntüsü klasörü]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const DOCS = path.join(__dirname, "..", "docs");
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
// Dile bağlı olmayan, iki dilde aynı kalması doğru olan metinler: ürün adları, şirket adı, kısaltmalar, adres, sayılar
const NEUTRAL = [/^(Castle|Bazaar|Apex|Orbit)$/, /^(EN|TR)$/, /^FPGA$/, /^info@kosecapital\.com$/, /^© 2024–\d{4} Kose Capital$/, /^[\d.,]+$/];
const COUNTER = "https://kose-sayac.falling-flower-8099.workers.dev/";   // ziyaret sayacı: yalnız yayındaki alan adında çağrılır
let mock = null;                 // doluysa /castle/data/summary.json bu içeriği döndürür (canlı rakam denemesi)

function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split("?")[0]);
      if (p === "/castle/data/summary.json") { if (!mock) { r.writeHead(404); return r.end("yok"); } r.writeHead(200, { "content-type": TYPES[".json"] }); return r.end(JSON.stringify(mock)); }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) { r.writeHead(404); return r.end("yok"); }
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
  const fixed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "castle.json"), "utf8"));

  for (const [name, vp, lang] of [["masaustu", { width: 1440, height: 900 }, "en"], ["masaustu", { width: 1440, height: 900 }, "tr"], ["dizustu", { width: 1280, height: 640 }, "tr"], ["tablet", { width: 740, height: 900 }, "en"], ["telefon", { width: 390, height: 844 }, "en"], ["telefon", { width: 390, height: 844 }, "tr"], ["dar", { width: 320, height: 640 }, "tr"]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: "en-US" });
    const page = await ctx.newPage(), tag = name + "-" + lang;
    page.on("console", (m) => { if (m.type() === "error" && !/summary\.json|404/.test(m.text())) fail(tag + " konsol: " + m.text()); });
    page.on("pageerror", (e) => fail(tag + " betik: " + e.message));
    page.on("request", (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) fail(tag + " dışarıya istek: " + r.url().slice(0, 90)); });
    await page.goto(base + "?lang=" + lang, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);

    const info = await page.evaluate(() => {
      const de = document.documentElement, vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none"; };
      const wide = [...document.querySelectorAll("body *")].filter((el) => vis(el) && el.getBoundingClientRect().right > innerWidth + 1 && !el.closest("canvas")).slice(0, 5).map((el) => el.tagName + "." + el.className);
      const ink = (cv) => { const g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) n++; return n; };
      // dile bağlı olmayan görünür metinler: .en ya da .tr içinde olmayan her metin parçası
      const neutral = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(), el = n.parentElement; if (!t || el.closest("script,style,.en,.tr") || !vis(el)) continue; if (!neutral.includes(t)) neutral.push(t); }
      const logo = document.querySelector(".brand svg");
      return {
        lang: de.getAttribute("data-lang"), htmlLang: de.lang, overflow: de.scrollWidth - innerWidth, wide,
        fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
        hero: ink(document.getElementById("reel")),
        both: [...document.querySelectorAll(".en,.tr")].filter(vis).filter((el) => el.classList.contains(de.getAttribute("data-lang") === "tr" ? "en" : "tr")).length,
        h: de.scrollHeight, heroH: Math.round(document.querySelector(".hero").getBoundingClientRect().height),
        addrLines: document.getElementById("addr").getClientRects().length,
        logo: logo ? Math.round(logo.getBoundingClientRect().width) + "x" + Math.round(logo.getBoundingClientRect().height) : null,
        neutral, desc: document.querySelector('meta[name="description"]').content.slice(0, 40),
        nums: ["k-countries", "k-castles", "k-co-en", "k-co-tr", "k-asof-en", "k-asof-tr"].map((i) => document.getElementById(i).textContent),
        castle: document.getElementById("castle-link").getAttribute("href"), orbit: document.getElementById("orbit-link").getAttribute("href"),
        names: [...document.querySelectorAll("#names a")].map((a) => a.getAttribute("href")).join(""), namesBottom: Math.round(document.getElementById("names").getBoundingClientRect().bottom), ih: innerHeight, iw: innerWidth,
        lost: [...document.querySelectorAll('.nav a, #names a')].map((a) => a.getAttribute("href")).filter((h) => !document.querySelector("section" + h)),
        bar: (() => { const r = (q) => document.querySelector(q).getBoundingClientRect(), nav = document.querySelector(".nav"), shown = getComputedStyle(nav).display !== "none", L = document.getElementById("lang");
          return { clipped: L.scrollWidth > L.clientWidth + 1, right: Math.round(r("#lang").right), gaps: shown ? [Math.round(r(".nav").left - r(".brand").right), Math.round(r("#lang").left - r(".nav").right)] : null }; })(),
      };
    });
    console.log(tag, JSON.stringify({ overflow: info.overflow, heroH: info.heroH, names: info.namesBottom, h: info.h, logo: info.logo, bar: info.bar.gaps, nums: info.nums, castle: info.castle, orbit: info.orbit }));
    if (info.lang !== lang || info.htmlLang !== lang) fail(tag + " dil tutmadı");
    if (info.overflow > 0) fail(tag + " yatay taşma: " + info.overflow + "px " + info.wide.join(", "));
    if (info.hero < 50) fail(tag + " açılış görseli boş");
    if (info.both) fail(tag + " iki dil birden görünüyor");
    if (info.addrLines !== 1) fail(tag + " e-posta adresi tek satıra sığmadı");
    if (!info.logo) fail(tag + " logo yok");
    if (!info.fonts.includes("Archivo") || !info.fonts.includes("IBM Plex Mono")) fail(tag + " yazı tipi yüklenmedi: " + info.fonts);
    const stray = info.neutral.filter((t) => !NEUTRAL.some((re) => re.test(t)));
    if (stray.length) fail(tag + " dile bağlanmamış metin: " + JSON.stringify(stray));
    if (!info.desc.startsWith(lang === "tr" ? "Kose Capital dört sistem" : "Kose Capital builds and runs four")) fail(tag + " açıklama satırı dile uymuyor");
    if (info.names !== "#castle#bazaar#apex#orbit" || info.lost.length) fail(tag + " açılışta dört ürün yok ya da bir bağlantının bölümü yok: " + info.names + " " + info.lost.join(","));
    if (info.iw > 900 && info.namesBottom > info.ih) fail(tag + " açılışta dört ad ilk ekrana sığmıyor: alt kenar " + info.namesBottom + ", ekran " + info.ih);
    if (info.bar.clipped || info.bar.right > info.iw || (info.bar.gaps && Math.min(...info.bar.gaps) < 8)) fail(tag + " üst şerit sığmıyor: " + JSON.stringify(info.bar));
    if (info.nums[0] !== String(fixed.countries) || info.nums[1] !== String(fixed.castles)) fail(tag + " Castle rakamları src/castle.json ile tutmuyor");
    if (info.castle !== "/castle/?lang=" + lang) fail(tag + " Castle bağlantısı: " + info.castle);
    if (info.orbit !== "/orbit/?lang=" + lang) fail(tag + " Orbit bağlantısı: " + info.orbit);

    if (OUT) await page.screenshot({ path: path.join(OUT, tag + "-0-hero.png") });
    // dört ürün adı: üstüne gelince (ya da odaklanınca) açılıştaki görsel değişir
    for (let i = 0; i < 4; i++) {
      await page.focus('#names a[data-i="' + i + '"]'); await page.waitForTimeout(950);
      const on = await page.evaluate(() => [...document.querySelectorAll("#names a")].findIndex((a) => a.classList.contains("on")));
      if (on !== i) fail(tag + " açılışta ürün " + i + " seçilmedi");
    }
    await page.evaluate(() => document.activeElement.blur());
    // her bölüm: görsel çiziyor mu
    for (const id of ["castle", "bazaar", "apex", "orbit", "company", "contact"]) {
      await page.evaluate((i) => document.getElementById(i).scrollIntoView({ behavior: "instant", block: "start" }), id);
      await page.waitForTimeout(500);
      if (["castle", "bazaar", "apex", "orbit"].includes(id)) {
        const n = await page.evaluate((i) => { const cv = document.querySelector("#" + i + " canvas"), g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let j = 3; j < d.length; j += 4 * 97) if (d[j] > 8) k++; return k; }, id);
        if (n < 50) fail(tag + " " + id + " görseli boş");
      }
      if (OUT) await page.screenshot({ path: path.join(OUT, tag + "-" + id + ".png") });
    }
    // dil düğmesi: her şey öbür dile geçer
    const other = lang === "tr" ? "en" : "tr";
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('#lang button[data-lang="' + other + '"]');
    const now = await page.evaluate(() => { const de = document.documentElement, vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return [de.getAttribute("data-lang"), document.getElementById("castle-link").getAttribute("href"), [...document.querySelectorAll("." + (de.getAttribute("data-lang") === "tr" ? "en" : "tr"))].filter(vis).length, document.querySelector('meta[name="description"]').content.slice(0, 22), document.getElementById("orbit-link").getAttribute("href")]; });
    if (now[0] !== other || !now[1].endsWith("?lang=" + other) || now[2] !== 0 || now[4] !== "/orbit/?lang=" + other) fail(tag + " dil düğmesi çalışmadı: " + JSON.stringify(now));
    await ctx.close();
  }

  // canlı rakamlar: Castle'ın özet dosyası okununca sayfadaki rakamlar yenilenir
  mock = { asof: "2026-12-05", countries: 7, companies: 23456, castles: 9 };
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.goto(base + "?lang=tr", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
    const n = await page.evaluate(() => ["k-countries", "k-castles", "k-co-en", "k-co-tr", "k-asof-en", "k-asof-tr"].map((i) => document.getElementById(i).textContent).join("|"));
    if (n !== "7|9|23,456|23.456|5 December 2026|5 Aralık 2026") fail("canlı rakamlar yenilenmedi: " + n);
    await ctx.close(); }
  mock = { asof: "bozuk", countries: 0 };
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.goto(base, { waitUntil: "networkidle" }); await page.waitForTimeout(300);
    const n = await page.evaluate(() => document.getElementById("k-countries").textContent);
    if (n !== String(fixed.countries)) fail("bozuk özet dosyası sayfayı bozdu: " + n);
    await ctx.close(); }
  mock = null;

  // Orbit bağlantısı boşa çıkmaz: sayfa aynı sitede /orbit/ yolunda durur
  { const ctx = await browser.newContext(), r = await ctx.request.get(base + "orbit/?lang=tr"), t = r.ok() ? await r.text() : "";
    if (!t.includes("<title>Orbit · Arazinin en yeni uydu görüntüsü · Kose Capital</title>")) fail("/orbit/ sayfası yok ya da başlığı farklı (" + r.status() + ")");
    await ctx.close(); }

  // açılış kendiliğinden döner: dört ürün sırayla gelir, sonra başa döner (sayfanın saati ileri alınır)
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.clock.install(); await page.goto(base + "?lang=en", { waitUntil: "load" }); await page.clock.runFor(300);
    const seq = [];
    for (let k = 0; k < 5; k++) { await page.clock.runFor(5600); seq.push(await page.evaluate(() => [...document.querySelectorAll("#names a")].map((a, i) => (a.classList.contains("on") ? i : "")).join(""))); }
    if (seq.join(",") !== "1,2,3,0,1") fail("açılış dört ürünü sırayla göstermiyor: " + seq.join(","));
    await ctx.close(); }

  // ziyaret sayacı: yayındaki alan adında sayfa açılınca tek kayıt (s=home); yukarıdaki yerel denemelerde hiç çağrılmaz
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), hits = [], stray = [];
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));   // sayaç otomasyon tarayıcısında susar; gerçek ziyaretçi gibi görün
    await ctx.route("**/*", (route) => {
      const u = route.request().url(), m = /^https:\/\/www\.kosecapital\.com(\/[^?#]*)/.exec(u);
      if (u.startsWith(COUNTER)) { hits.push(route.request().method() + " " + u.slice(COUNTER.length)); return route.fulfill({ status: 204, body: "" }); }
      if (!m) { stray.push(u.slice(0, 90)); return route.abort("failed"); }
      let p = decodeURIComponent(m[1]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "yok" });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
    });
    const page = await ctx.newPage(); await page.goto("https://www.kosecapital.com/?lang=tr", { waitUntil: "load" }); await page.waitForTimeout(800);
    await page.click('#lang button[data-lang="en"]'); await page.waitForTimeout(300);
    console.log("sayaç " + JSON.stringify(hits));
    if (hits.length !== 1 || hits[0] !== "POST hit?t=v&s=home&p=&r=&l=tr") fail("ziyaret sayacı: tek kayıt bekleniyordu (s=home, l=tr): " + JSON.stringify(hits));
    if (stray.length) fail("yayındaki adreste başka yere istek: " + stray.join(", "));
    const links = await page.evaluate(() => ["castle-link", "orbit-link"].map((i) => document.getElementById(i).getAttribute("href")).join(" "));
    if (links !== "/castle/?lang=en /orbit/?lang=en") fail("yayındaki adreste Castle ve Orbit bağlantıları: " + links);
    await ctx.close(); }

  // Google: robots.txt, sitemap.xml ve her dil adresinin kendini asıl sayfa göstermesi (yayındaki adres taklit edilir)
  { const robots = fs.readFileSync(path.join(DOCS, "robots.txt"), "utf8"), map = fs.readFileSync(path.join(DOCS, "sitemap.xml"), "utf8"), H = "https://www.kosecapital.com/";
    if (robots !== "User-agent: *\nAllow: /\n\nSitemap: " + H + "sitemap.xml\n") fail("robots.txt: " + JSON.stringify(robots));
    const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), want = [];
    for (const p of ["", "orbit/", "castle/"]) want.push(H + p, H + p + "?lang=tr", H + p + "?lang=en");
    if (locs.join(" ") !== want.join(" ")) fail("sitemap.xml adresleri: " + locs.join(" "));
    const units = map.split("<url>").slice(1);
    units.forEach((u, i) => { const p = want[i].replace(/\?lang=\w+$/, ""), alts = [...u.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => m[1] + "=" + m[2]).join(" ");
      if (alts !== "tr=" + p + "?lang=tr en=" + p + "?lang=en x-default=" + p) fail("sitemap.xml dil bağlantıları (" + want[i] + "): " + alts); });
    if (!/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9" xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml">\n/.test(map) || !map.endsWith("</urlset>\n")) fail("sitemap.xml başı ya da sonu bozuk");
    const html = fs.readFileSync(path.join(DOCS, "index.html"), "utf8"), dm = /var DESC = \{ en: "([^"]+)",\s*tr: "([^"]+)" \}/.exec(html), D = dm ? { en: dm[1], tr: dm[2] } : null;
    if (!D) fail("sayfadaki DESC metinleri bulunamadı");
    const tm = /var TITLE = \{ en: "([^"]+)", tr: "([^"]+)" \}/.exec(html), TT = tm ? { en: tm[1], tr: tm[2] } : null;
    if (!TT || !/^Kose Capital · /.test(TT.tr) || !/^Kose Capital · /.test(TT.en)) fail("sayfadaki TITLE metinleri: " + JSON.stringify(TT));
    if (html.match(/<title>([^<]*)<\/title>/)[1] !== (TT && TT.tr)) fail("sabit sayfa başlığı Türkçe başlıkla aynı değil");
    // Google'a şirket tanımı (schema.org): ad, adres, logo, e-posta; logo dosyası sitede ve en az 112 piksel
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const org = ld.length === 1 && ld[0]["@graph"].find((x) => x["@type"] === "Organization"), web = ld.length === 1 && ld[0]["@graph"].find((x) => x["@type"] === "WebSite");
    if (!org || org.name !== "Kose Capital" || org.url !== H || org.logo !== H + "logo.png" || org.email !== "info@kosecapital.com" || !web || web.url !== H || web.publisher["@id"] !== org["@id"]) fail("şirket tanımı (ld+json): " + JSON.stringify(ld));
    const logo = fs.readFileSync(path.join(DOCS, "logo.png")); if (logo.slice(1, 4).toString() !== "PNG" || logo.readUInt32BE(16) < 112 || logo.readUInt32BE(20) < 112) fail("logo.png yok ya da 112 pikselden küçük");
    if (/<link rel="canonical"/.test(html)) fail("sabit HTML'de canonical etiketi olmamalı (bütün dilleri tek adrese bağlar)");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" }), seen = [];
    await ctx.route("**/*", (route) => {
      const u = route.request().url(), m = /^https:\/\/www\.kosecapital\.com(\/[^?#]*)/.exec(u);
      if (!m) return route.abort("failed");
      let p = decodeURIComponent(m[1]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "yok" });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
    });
    const page = await ctx.newPage();
    for (const [q, lang, canon] of [["?lang=tr", "tr", H + "?lang=tr"], ["?lang=en", "en", H + "?lang=en"], ["", "en", H], ["?utm_source=x&lang=tr", "tr", H + "?lang=tr"]]) {
      await page.goto(H + q, { waitUntil: "load" });
      const r = await page.evaluate(() => ({ c: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.href), d: document.querySelector('meta[name="description"]').content, lang: document.documentElement.lang, t: document.title }));
      seen.push(q + " → " + r.c.join(","));
      if (r.c.length !== 1 || r.c[0] !== canon) fail("asıl sayfa etiketi (" + (q || "dilsiz adres") + "): " + JSON.stringify(r.c) + ", beklenen " + canon);
      if (r.lang !== lang || r.d !== D[lang] || r.t !== (TT && TT[lang])) fail("dil, açıklama ya da başlık (" + (q || "dilsiz adres") + "): " + JSON.stringify([r.lang, r.d.slice(0, 40), r.t]));
      if (!q) { const st = html.match(/<meta name="description" content="([^"]*)">/)[1]; if (st !== D.tr + " / " + D.en) fail("sabit açıklama sayfadaki iki metinle aynı değil: " + st.slice(0, 80)); }
    }
    console.log("asıl sayfa etiketleri: " + seen.join(" | "));
    // eski sitenin adresi (/our-services): "sayfa bulunamadı" yerine ana sayfaya gider; dil eki korunur
    // eski sitenin adresleri: /our-services ve /file-share ana sayfaya, /tr Türkçe ana sayfaya (sonunda / olmayan adresi GitHub Pages kendisi / ile açar)
    for (const [from, to] of [["our-services/", H], ["our-services/?lang=tr", H + "?lang=tr"], ["file-share/", H], ["tr/", H + "?lang=tr"], ["tr/?lang=en", H + "?lang=tr"]]) {
      await page.goto(H + from, { waitUntil: "load" }); await page.waitForURL((u) => !/our-services|file-share|\/tr\//.test(String(u)), { timeout: 5000 }).catch(() => {});
      if (page.url() !== to) fail("eski adres " + from + " yönlendirmesi: " + page.url() + ", beklenen " + to);
    }
    for (const [dir, to] of [["our-services", ""], ["file-share", ""], ["tr", "?lang=tr"]]) {
      const old = fs.readFileSync(path.join(DOCS, dir, "index.html"), "utf8");
      if (!old.includes('<link rel="canonical" href="' + H + to + '">') || !old.includes('<meta http-equiv="refresh" content="0; url=/' + to + '">')) fail("eski adres sayfasının etiketleri: /" + dir);
      if (new RegExp("/" + dir + "[/<]").test(map)) fail("eski adres sitemap.xml'e girmemeli: /" + dir);
    }
    await ctx.close(); }

  // hareket azaltma: tek kare, döngü yok
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage(); await page.goto(base, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  const a = await page.evaluate(() => document.getElementById("reel").toDataURL().length); await page.waitForTimeout(700);
  const b = await page.evaluate(() => document.getElementById("reel").toDataURL().length);
  if (a !== b || a < 5000) fail("hareket azaltma: görsel duruyor olmalı (" + a + ", " + b + ")");
  await ctx.close();

  await browser.close(); srv.close();
  console.log(bad.length ? "\nsayfa denemesi TUTMADI: " + bad.length + " sorun" : "\nsayfa denemesi tamam (iki dil, masaüstü, tablet, telefon, dört görsel, logo, canlı rakamlar, sayaç, Google için adresler, hareket azaltma)");
  process.exit(bad.length ? 1 : 0);
})();
