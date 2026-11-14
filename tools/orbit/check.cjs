// Orbit sayfa denemesi: docs/orbit/ sayfasını yerel sunucudan açar. Sayfanın dışarıya yaptığı istekleri yakalar ve
// yerel örnek veriyle yanıtlar: uydu kataloğu (Earth Search) ve görüntü dosyaları (COG). Alanın sınırı dosyadan
// (KML, KMZ, GeoJSON), yapıştırılan metinden ya da konumdan gelir; sayfa parsel servisine (TKGM) istek yapmaz,
// yaparsa deneme tutmaz. Örnek görüntüler gerçek Sentinel-2 karelerinin koordinat düzenindedir; önce bir kez üretilir:
//   python3 tools/orbit/fixtures.py        (pip: rasterio numpy pyproj)
// Kullanım: node tools/orbit/check.cjs [ekran görüntüsü klasörü]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");

const DOCS = path.join(__dirname, "..", "..", "docs"), FX = path.join(__dirname, "fx"), OUT = process.argv[2] || null;
if (!fs.existsSync(path.join(FX, "utm_ref.json"))) { console.error("Örnek görüntüler yok. Önce: python3 tools/orbit/fixtures.py"); process.exit(2); }
const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, "sample.json"), "utf8")), RING = SAMPLE.geometry.coordinates[0];   // örnek alan: kendi çizdiğimiz çokgen
const S3 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/";
const TYPES = { ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
// Sayfanın dışarıda konuşabileceği yerler; başka bir adrese (TKGM dahil) istek giderse deneme tutmaz.
// Ziyaret sayacı bu listede yoktur: yalnız yayındaki alan adında çağrılır, o da ayrı bir senaryoda denenir.
const LIVE = "https://www.kosecapital.com/", COUNTER = "https://kose-sayac.falling-flower-8099.workers.dev/";
const ALLOWED = /^https:\/\/(earth-search\.aws\.element84\.com|sentinel-cogs\.s3\.us-west-2\.amazonaws\.com)\//;

// [kayıt adı, zaman, sahnedeki bulut, kare, veri yok %, dosya takımı]: 14 Kasım 2026'da gerçek katalogdan alınan geçişler
const ITEMS = [
  ["S2B_35SQB_20261114_0_L2A", "2026-11-14T08:59:54.806000Z", 92.276222, "35SQB", 0, { SCL: "35SQB_cloud_SCL", TCI: "35SQB_after_TCI" }],
  ["S2B_36STG_20261114_0_L2A", "2026-11-14T08:59:53.233000Z", 96.795624, "36STG", 3.996122, { SCL: "36STG_cloud_SCL" }],
  ["S2A_35SQB_20261111_0_L2A", "2026-11-11T08:59:56.447000Z", 90.006262, "35SQB", 38.954288, { SCL: "35SQB_cloud_SCL" }],
  ["S2A_36STG_20261111_1_L2A", "2026-11-11T08:59:55.502000Z", 84.690613, "36STG", 32.529485, { SCL: "36STG_cloud_SCL" }],
  ["S2B_35SQB_20261111_1_L2A", "2026-11-11T08:49:57.697000Z", 91.301072, "35SQB", 54.792482, { SCL: "35SQB_cloud_SCL" }],
  ["S2B_36STG_20261111_0_L2A", "2026-11-11T08:49:56.980000Z", 82.08887, "36STG", 26.469257, { SCL: "36STG_cloud_SCL" }],
  ["S2C_35SQB_20261109_0_L2A", "2026-11-09T08:59:50.799000Z", 11.6, "35SQB", 0, { SCL: "35SQB_nodata_SCL" }],
  ["S2C_36STG_20261109_0_L2A", "2026-11-09T08:59:49.226000Z", 3.4, "36STG", 4.0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI", B04: "36STG_after_B04", B08: "36STG_after_B08" }],
  ["S2A_35SQB_20261108_0_L2A", "2026-11-08T08:50:03.177000Z", 0.2, "35SQB", 20, { SCL: "35SQB_after_SCL", TCI: "35SQB_after_TCI", B04: "35SQB_after_B04", B08: "35SQB_after_B08" }],
  ["S2A_36STG_20261108_0_L2A", "2026-11-08T08:50:02.469000Z", 0.1, "36STG", 28, { SCL: "36STG_partly_SCL" }],
  ["S2C_35SQB_20261106_0_L2A", "2026-11-06T08:49:52.841000Z", 19.0, "35SQB", 50, {}],
  ["S2C_36STG_20261106_0_L2A", "2026-11-06T08:49:52.121000Z", 13.5, "36STG", 25, {}],
  ["S2B_35SQB_20261104_0_L2A", "2026-11-04T08:59:55.125000Z", 85.0, "35SQB", 0, { SCL: "35SQB_cloud_SCL" }],
  ["S2B_36STG_20261104_0_L2A", "2026-11-04T08:59:53.548000Z", 79.3, "36STG", 4, { SCL: "36STG_cloud_SCL" }],
  // daha eski sayfa
  ["S2B_35SQB_20261025_1_L2A", "2026-10-25T08:59:49.477000Z", 0.3, "35SQB", 0, { SCL: "35SQB_after_SCL", TCI: "35SQB_after_TCI" }],
  ["S2C_35SQB_20261020_0_L2A", "2026-10-20T08:59:54.531000Z", 0.2, "35SQB", 0, { SCL: "35SQB_after_SCL", TCI: "35SQB_after_TCI" }],
  // bir yıl önce (uydurma kayıtlar)
  ["S2C_35SQB_20251113_0_L2A", "2025-11-13T08:49:58.000000Z", 35.0, "35SQB", 0, { SCL: "35SQB_cloud_SCL" }],
  ["S2B_35SQB_20251110_0_L2A", "2025-11-10T08:59:52.000000Z", 2.5, "35SQB", 0, { SCL: "35SQB_before_SCL", TCI: "35SQB_before_TCI", B04: "35SQB_before_B04", B08: "35SQB_before_B08" }],
  ["S2B_36STG_20251110_0_L2A", "2025-11-10T08:59:50.500000Z", 3.1, "36STG", 40, {}],
  ["S2A_35SQB_20251105_0_L2A", "2025-11-05T08:50:01.000000Z", 85.0, "35SQB", 0, { SCL: "35SQB_cloud_SCL" }],
];
const TILE = { "35SQB": [32635, 699960, "35/S/QB"], "36STG": [32636, 199980, "36/S/TG"] };
function href(it, file) { const d = new Date(it[1]); return S3 + TILE[it[3]][2] + "/" + d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1) + "/" + it[0] + "/" + file + ".tif"; }
function feature(it) {
  const [epsg, ox] = TILE[it[3]], t10 = [10, 0, ox, 0, -10, 4200000], t20 = [20, 0, ox, 0, -20, 4200000], cog = "image/tiff; application=geotiff; profile=cloud-optimized";
  const refl = (f) => ({ href: href(it, f), type: cog, "proj:shape": [10980, 10980], "proj:transform": t10, "raster:bands": [{ nodata: 0, data_type: "uint16", spatial_resolution: 10, scale: 0.0001, offset: -0.1 }] });
  return { stac_version: "1.0.0", id: it[0], collection: "sentinel-2-l2a", type: "Feature",
    properties: { datetime: it[1], "eo:cloud_cover": it[2], "grid:code": "MGRS-" + it[3], "proj:epsg": epsg, platform: "sentinel-2" + it[0][2].toLowerCase(), "s2:nodata_pixel_percentage": it[4] },
    assets: { visual: { href: href(it, "TCI"), type: cog, "proj:shape": [10980, 10980], "proj:transform": t10, "raster:bands": [{ nodata: 0, data_type: "uint8", spatial_resolution: 10 }] },
      scl: { href: href(it, "SCL"), type: cog, "proj:shape": [5490, 5490], "proj:transform": t20 }, red: refl("B04"), nir: refl("B08") } };
}
const FILES = {};
for (const it of ITEMS) for (const k of Object.keys(it[5])) FILES[href(it, k)] = fs.readFileSync(path.join(FX, it[5][k] + ".tif"));
const BAND = fs.readFileSync(path.join(FX, "36STG_after_TCI_band.tif"));
// Denemede yüklenen sınır dosyaları: örnek alanın çokgeninden üretilir.
const ATTR = { "İl": "Burdur", "İlçe": "Bucak", "Mahalle/Köy": "Deneme", "Ada": "101", "Parsel": "7", "Alan": "13.528,70", "Nitelik": "Tarla", "Pafta": "M24" };
const coords = (ring, sep) => ring.map((c) => c[0] + "," + (sep || "") + c[1] + "," + (sep || "") + "0").join(" ");
const kml = (o) => '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>' + (o.name || "") + "</name>" +
  (o.attr ? "<ExtendedData>" + Object.keys(o.attr).map((k) => '<Data name="' + k + '"><value>' + o.attr[k] + "</value></Data>").join("") + "</ExtendedData>" : "") + (o.desc ? "<description><![CDATA[" + o.desc + "]]></description>" : "") +
  (o.point ? "<Point><coordinates>30.1296,37.7575,0</coordinates></Point>" : "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + coords(o.ring || RING, o.sep) + "</coordinates></LinearRing></outerBoundaryIs>" +
    (o.hole ? "<innerBoundaryIs><LinearRing><coordinates>" + coords(o.hole) + "</coordinates></LinearRing></innerBoundaryIs>" : "") + "</Polygon>") + "</Placemark></Document></kml>";
function zip(name, data, method) {     // tek dosyalı ZIP (KMZ böyledir): method 8 sıkıştırılmış, 0 düz
  const raw = Buffer.from(data), body = method === 8 ? zlib.deflateRawSync(raw) : raw, crc = zlib.crc32 ? zlib.crc32(raw) : 0, n = Buffer.from(name);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + body.length, 16);
  return Buffer.concat([lh, n, body, ch, n, end]);
}
const shift = (ring, dx, dy, k) => ring.map((c) => [+(30.12955 + (c[0] - 30.12955) * (k || 1) + dx).toFixed(6), +(37.7575 + (c[1] - 37.7575) * (k || 1) + dy).toFixed(6)]);
const CORS = { "access-control-allow-origin": "*" };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) { r.writeHead(404); return r.end("yok"); }
      r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

(async () => {
  const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch();
  const bad = [], fail = (m) => { bad.push(m); console.log("  HATA: " + m); }, ok = (c, m) => { if (!c) fail(m); };
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, "orbit-" + name + ".png") }); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function open(opt) {
    const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: opt.dsf || 1, isMobile: !!opt.mobile, hasTouch: !!opt.mobile, locale: opt.locale || "tr-TR" });
    if (opt.live) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));   // sayaç otomasyon tarayıcısında susar; gerçek ziyaretçi gibi görün
    const page = await ctx.newPage(), log = { errors: [], urls: [], bytes: 0, ranges: 0, stray: [], hits: [] };
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) log.errors.push("konsol: " + m.text()); });
    page.on("pageerror", (e) => log.errors.push("betik: " + e.message));
    await ctx.route("**/*", (route) => {
      const req = route.request(), u = req.url();
      if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      if (opt.live && u.startsWith(LIVE)) {                                         // yayındaki adres: dosyalar docs/ klasöründen
        let p = decodeURIComponent(u.slice(LIVE.length - 1).split(/[?#]/)[0]); if (p.endsWith("/")) p += "index.html";
        const f = path.join(DOCS, p);
        if (!f.startsWith(DOCS) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "yok" });
        return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
      }
      if (opt.live && u.startsWith(COUNTER)) { log.hits.push(req.method() + " " + u.slice(COUNTER.length)); return route.fulfill({ status: 204, body: "" }); }
      log.urls.push(u);
      if (!ALLOWED.test(u)) { log.stray.push(u); return route.abort("failed"); }
      const json = (status, body) => route.fulfill({ status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS), body: JSON.stringify(body) });
      if (u.startsWith("https://earth-search.aws.element84.com/v1/search")) {
        if (opt.stac === "down") return route.abort("failed");
        const q = new URL(u).searchParams, dt = q.get("datetime"), limit = +(q.get("limit") || 10);
        if (opt.fields400 && q.get("fields")) return json(400, { code: "BadRequest" });
        let list = ITEMS.slice();
        if (dt) { const [a, b] = dt.split("/"); list = list.filter((it) => new Date(it[1]) >= new Date(a) && new Date(it[1]) <= new Date(b)); }
        else list = list.filter((it) => it[1] >= "2026-11-01");                     // ilk sayfa: en yeni geçişler
        list.sort((x, y) => (x[1] < y[1] ? 1 : -1));
        const feats = list.slice(0, limit).map(feature);
        if (opt.noAssets) feats.forEach((f) => { delete f.assets; });
        return json(200, { type: "FeatureCollection", stac_version: "1.0.0", stac_extensions: [], context: { limit, matched: list.length, returned: feats.length }, numberMatched: list.length, numberReturned: feats.length, features: feats, links: [] });
      }
      if (u.startsWith("https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/")) {
        const it = ITEMS.find((x) => x[0] === decodeURIComponent(u.split("/").pop()));
        return it ? json(200, feature(it)) : json(404, {});
      }
      if (u.startsWith(S3)) {
        const buf = opt.bandTci && /S2C_36STG_20261109_0_L2A\/TCI\.tif$/.test(u) ? BAND : FILES[u], m = /bytes=(\d+)-(\d+)/.exec(req.headers().range || "");
        if (!buf) return route.fulfill({ status: 404, headers: CORS, body: "yok" });
        if (!m) return route.fulfill({ status: 200, headers: CORS, body: buf });
        const a = +m[1], b = Math.min(+m[2], buf.length - 1), part = buf.subarray(a, b + 1);
        log.bytes += part.length; log.ranges++;
        // Gerçek sunucu Content-Range başlığını sayfaya göstermeyebilir; en kötü durum denenir (expose yok).
        return route.fulfill({ status: 206, headers: Object.assign({ "content-type": "image/tiff", "content-range": `bytes ${a}-${b}/${buf.length}`, "accept-ranges": "bytes" }, CORS), body: Buffer.from(part) });
      }
      return route.abort("failed");
    });
    await page.goto((opt.live ? LIVE : base) + "orbit/" + (opt.lang ? "?lang=" + opt.lang : ""), { waitUntil: "load" });
    return { ctx, page, log };
  }
  const state = (page) => page.evaluate(() => {
    const s = window.__orbit.st, t = (id) => document.querySelector(id).textContent.trim();
    return { after: s.after && s.after.scene ? s.after.item.id : null, before: s.before && s.before.scene ? s.before.item.id : null, nd: s.nd,
      hAfter: t("#h-after"), sAfter: t("#s-after"), hBefore: t("#h-before"), sBefore: t("#s-before"), log: [...document.querySelectorAll("#log div")].map((d) => d.textContent),
      rows: [...document.querySelectorAll("#rows tr")].map((r) => [...r.children].slice(0, 4).map((c) => c.textContent.trim()).join(" | ")),
      msg: [...document.querySelectorAll("#in-msg, #loc-msg")].filter((m) => !m.hidden).map((m) => m.textContent).join(" "), single: document.querySelector("#stage").classList.contains("single"), polys: s.parcel ? s.parcel.polys.length : 0, area: s.parcel ? Math.round(window.__orbit.polyArea(s.parcel)) : 0, src: s.parcel ? s.parcel.src.kind : "",
      info: [...document.querySelectorAll("#info dt")].map((d) => d.textContent + ": " + d.nextSibling.textContent), score: [t("#nd-b"), t("#nd-a"), t("#nd-d"), t("#nd-t")],
      overflow: document.documentElement.scrollWidth - innerWidth, diag: t("#diag") };
  });
  const settled = (page, need) => page.waitForFunction((need) => { const s = window.__orbit.st; return s.after && s.after.scene && (!need || (s.before && s.before.scene && s.nd.a !== undefined && s.nd.b !== undefined)) && document.querySelector("#busy").hidden; }, need, { timeout: 30000 });
  const loadFile = (page, name, data) => page.setInputFiles("#file", { name, mimeType: "application/octet-stream", buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  const failed = (page, q) => page.waitForFunction((q) => !document.querySelector(q).hidden, q || "#in-msg", { timeout: 8000 }).then(() => page.$eval(q || "#in-msg", (m) => m.textContent + (m.getBoundingClientRect().bottom <= innerHeight && m.getBoundingClientRect().top >= 58 ? "" : " [ekranın dışında ya da üst şeridin altında]")));
  const rowButton = (page, date, i) => page.evaluate(([date, i]) => [...document.querySelectorAll("#rows tr")].find((r) => r.textContent.includes(date)).querySelectorAll("button")[i].click(), [date, i]);
  // Sınır çizgisinin görüntüye oturması: parselin kenarından 7,1 m'den (10 m'lik pikselin yarı köşegeni) uzak her tuval pikseli doğru renkte olmalı.
  const align = (page, id, slot, want) => page.evaluate(([id, slot, want]) => {
    const P = window.__orbit, s = P.st, f = s.frame, N = P.CFG.N, d = document.querySelector(id).getContext("2d").getImageData(0, 0, N, N).data;
    const ring = s.parcel.polys[0][0].map((c) => f.toXY(c[0], c[1]));
    const inside = (x, y) => { let k = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
    const dist = (x, y) => { let m = 1e9; for (let i = 0; i < ring.length - 1; i++) { const a = ring[i], b = ring[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy))); m = Math.min(m, Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy)); } return m; };
    let inOk = 0, inBad = 0, outOk = 0, outBad = 0;
    for (let v = 0; v < N; v += 2) for (let u = 0; u < N; u += 2) {
      const x = (u + 0.5) / N * 2 * f.H - f.H, y = f.H - (v + 0.5) / N * 2 * f.H, o = (v * N + u) * 4;
      if (dist(x, y) < 7.1) continue;
      const is = Math.abs(d[o] - want[0]) < 3 && Math.abs(d[o + 1] - want[1]) < 3 && Math.abs(d[o + 2] - want[2]) < 3;
      if (inside(x, y)) { if (is) inOk++; else inBad++; } else { if (is) outBad++; else outOk++; }
    }
    // yön işareti: merkezin 150 m kuzeyi ve doğusu
    const mu = Math.floor((150 + f.H) / (2 * f.H) * N), mv = Math.floor((f.H - 150) / (2 * f.H) * N), mo = (mv * N + mu) * 4;
    return { item: s[slot].item.id, epsg: s[slot].item.epsg, inOk, inBad, outOk, outBad, marker: mu >= 0 && mu < N && mv >= 0 && mv < N ? [d[mo], d[mo + 1], d[mo + 2]] : null, H: f.H };
  }, [id, slot, want]);
  const SOIL = [247, 208, 156], GREEN = [78, 208, 78];       // örnek görüntülerde parselin içi: sonra toprak, önce yeşil (parlaklık 1,3 ile)
  const fits = (r) => r.inBad === 0 && r.outBad === 0;

  // 0) koordinat hesabı: pyproj ile üretilmiş noktalar. Sayfada parsel servisinin adresi geçmez; örnek alan sample.json ile aynıdır.
  { const { ctx, page } = await open({ stac: "down" });
    const ref = JSON.parse(fs.readFileSync(path.join(FX, "utm_ref.json"), "utf8"));
    const worst = await page.evaluate((ref) => { let w = 0; for (const r of ref) { const p = window.__orbit.utm(r[0], r[1], r[2], false); w = Math.max(w, Math.hypot(p[0] - r[3], p[1] - r[4])); } return w; }, ref);
    console.log("koordinat: " + ref.length + " nokta, en büyük fark " + (worst * 1000).toFixed(4) + " mm"); ok(worst < 0.001, "UTM hesabı pyproj'dan sapıyor: " + worst + " m");
    const html = fs.readFileSync(path.join(DOCS, "orbit", "index.html"), "utf8");
    ok(!/cbsapi|cbsservis|megsis/i.test(html), "sayfada parsel servisinin (TKGM) adresi geçiyor"); ok((html.match(/tkgm\.gov\.tr/g) || []).length === 2 && !/fetch\([^)]*tkgm/.test(html), "TKGM yalnız iki dildeki bağlantıda geçmeli");
    ok(JSON.stringify(await page.evaluate(() => window.__orbit.SAMPLE[0][0])) === JSON.stringify(RING), "sayfadaki örnek alan tools/orbit/sample.json ile aynı değil");
    await ctx.close(); }

  // 1) asıl akış: KML dosyası yüklenir (parselin öznitelikleriyle), en yeni açık görüntü, bir yıl öncesi, yeşillik puanı
  { const { ctx, page, log } = await open({ lang: "tr" });
    await page.evaluate(() => document.fonts.ready);
    const head = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, home: document.querySelector("#home").getAttribute("href"), logo: !!document.querySelector(".brand svg path"),
      desc: document.querySelector('meta[name="description"]').content.slice(0, 22), icon: document.querySelector('link[rel="icon"]').getAttribute("href"), canon: (document.querySelector('link[rel="canonical"]') || {}).href || "",
      old: ["#il", "#ilce", "#mah", "#ada", "#parsel", "#tkgm-msg", "#tkgm-link"].filter((q) => document.querySelector(q)).join(","), empty: !document.querySelector("#empty").hidden, how: document.querySelector("#how a").getAttribute("href"),
      fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")).filter((v, i, a) => a.indexOf(v) === i) }));
    console.log("masaüstü-tr " + JSON.stringify(head));
    ok(head.title === "Orbit · Kose Capital" && head.lang === "tr" && head.home === "../?lang=tr" && head.logo, "başlık, dil, ana sayfa bağlantısı ya da logo");
    ok(head.desc.startsWith("Orbit, Türkiye'deki") && head.icon === "../favicon.svg", "açıklama satırı ya da site simgesi"); ok(/\/orbit\/$/.test(head.canon), "canonical adresi: " + head.canon);
    ok(head.fonts.includes("Archivo") && head.fonts.includes("IBM Plex Mono"), "yazı tipi yüklenmedi: " + head.fonts);
    ok(!head.old && head.empty && head.how === "https://parselsorgu.tkgm.gov.tr/", "eski parsel formu duruyor ya da açılış boş değil: " + JSON.stringify(head));
    await shot(page, "1a-bos");
    await loadFile(page, "ornek-parsel.kml", kml({ name: "Deneme-101/7", attr: ATTR })); await settled(page, true);
    const s = await state(page);
    console.log("  " + JSON.stringify({ after: s.after, before: s.before, nd: s.nd, hAfter: s.hAfter, sAfter: s.sAfter, hBefore: s.hBefore, overflow: s.overflow, istek: log.ranges, kB: Math.round(log.bytes / 1024), alan: s.area }));
    console.log("  " + s.info.join(" | "));
    ok(s.after === "S2C_36STG_20261109_0_L2A", "en yeni açık görüntü yanlış: " + s.after); ok(s.before === "S2B_35SQB_20251110_0_L2A", "önceki görüntü yanlış: " + s.before);
    ok(s.hAfter === "9 Kasım 2026" && s.hBefore === "10 Kasım 2025", "tarih başlıkları: " + s.hAfter + " / " + s.hBefore);
    ok(Math.abs(s.nd.b - 0.8) < 0.01 && Math.abs(s.nd.a - 0.0909) < 0.01, "yeşillik puanı: " + JSON.stringify(s.nd));
    ok(s.rows[0].includes("bulutlu") && s.rows[1].includes("bulutlu") && s.rows[3].includes("açık"), "satır durumları: " + s.rows.slice(0, 4).join(" / ")); ok(!s.single, "karşılaştırma açılmadı"); ok(s.overflow <= 0, "yatay taşma");
    const want = ["Yer: Burdur · Bucak · Deneme", "Ada / parsel: 101 / 7", "Yüzölçümü: 13.528,70 m² (13,5 dönüm)", "Nitelik: Tarla", "Pafta: M24", "Kaynak: dosya: ornek-parsel.kml", "Merkez: 37.75750, 30.12955"];
    ok(want.every((w) => s.info.includes(w)) && s.info.includes("Sınırdan hesap: 13.546 m² (13,5 dönüm)"), "alan bilgisi: " + s.info.join(" ; "));
    ok(Math.abs(s.area - 13546) < 40 && s.polys === 1 && s.src === "file", "çokgen ya da hesaplanan yüzölçümü: " + s.area);
    ok(/alan: Burdur · Bucak · Deneme · 101\/7 · dosya: ornek-parsel\.kml \(KML\) · 1 çokgen, 5 köşe/.test(s.diag) && /katalog: \d+ kayıt/.test(s.diag) && /görüntü parçası/.test(s.diag) && /yeşillik: 0\.091/.test(s.diag), "tanı bilgisi eksik: " + s.diag.slice(0, 300));
    await shot(page, "1b-sonuc");
    // piksel görünümünde hizalama (yumuşatma kapalı): iki ayrı kare, iki ayrı UTM dilimi
    await page.click('#smooth button[data-s="0"]');
    const a = await align(page, "#cv-after", "after", SOIL), b = await align(page, "#cv-before", "before", GREEN);
    console.log("  hizalama sonra " + JSON.stringify(a)); console.log("  hizalama önce  " + JSON.stringify(b));
    for (const [n, r] of [["sonra", a], ["önce", b]]) { ok(fits(r) && r.inOk > 500, "sınır " + n + " görüntüsüne oturmuyor: " + JSON.stringify(r)); ok(r.marker && r.marker.every((c) => c === 255), "yön işareti " + n + " görüntüsünde yerinde değil: " + r.marker); }
    for (const z of ["near", "wide"]) {
      await page.click('#zoom button[data-z="' + z + '"]');
      await page.waitForFunction((z) => { const s = window.__orbit.st, fit = (x) => x && x.scene && Math.abs(x.scene.A.a * 720 * x.scene.mpp - 2 * s.frame.H) < 2; return s.zoom === z && fit(s.after) && fit(s.before); }, z); await wait(150);
      const r = await align(page, "#cv-after", "after", SOIL), r2 = await align(page, "#cv-before", "before", GREEN);
      ok(fits(r) && fits(r2), z + " yakınlıkta hizalama bozuk: " + JSON.stringify(r)); await shot(page, "1c-" + z);
    }
    await page.click('#zoom button[data-z="mid"]'); await page.click('#smooth button[data-s="1"]'); await wait(400);
    // karşılaştırma çizgisi: sürükleme
    await page.evaluate(() => document.querySelector("#stage").scrollIntoView({ block: "center" }));
    const box = await (await page.$("#stage")).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6, { steps: 4 }); await page.mouse.up();
    const sp = await page.$eval("#stage", (e) => parseFloat(e.style.getPropertyValue("--split"))); ok(Math.abs(sp - 25) < 2, "çizgi sürüklenmedi: " + sp);
    // satırdan seçim: 8 Kasım (35. dilimdeki kare), 6 Kasım (dosya yok), 14 Kasım (bulutlu ama gösterilir)
    await rowButton(page, "8 Kasım", 1); await page.waitForFunction(() => window.__orbit.st.after.item.id === "S2A_35SQB_20261108_0_L2A" && window.__orbit.st.nd.a !== undefined);
    await rowButton(page, "6 Kasım", 1); await page.waitForFunction(() => /6 Kasım/.test(document.querySelector("#log").textContent) && /okunamadı/.test(document.querySelector("#log").textContent));
    const s2 = await state(page); ok(s2.hAfter === "8 Kasım 2026", "satırdan seçim tutmadı"); ok(/okunamadı/.test(s2.rows.find((r) => r.includes("6 Kasım"))), "okunamayan geçiş işaretlenmedi");
    await rowButton(page, "14 Kasım", 1); await page.waitForFunction(() => /14 Kasım/.test(document.querySelector("#log").textContent) && document.querySelector("#busy").hidden);
    const s3 = await state(page); ok(s3.hAfter === "14 Kasım 2026" && /bulutlu %100/.test(s3.sAfter) && /"Sonra" görüntüsü/.test(s3.log.slice(-1)[0]), "bulutlu geçiş elle seçilince gösterilmedi: " + s3.sAfter);
    await rowButton(page, "8 Kasım", 1); await page.waitForFunction(() => window.__orbit.st.after.item.id === "S2A_35SQB_20261108_0_L2A" && document.querySelector("#busy").hidden);
    // önceki tarih seçimi: 3 ay önce (örnek veride yok) ve daha eski geçişler
    await page.selectOption("#pre", "91"); await page.waitForFunction(() => /bulunamadı/.test(document.querySelector("#log").textContent));
    ok((await state(page)).single, "önceki görüntü yokken tek görüntü görünümüne dönmedi");
    const n0 = (await state(page)).rows.length; await page.click("#older"); await page.waitForFunction((n) => document.querySelectorAll("#rows tr").length > n, n0);
    // dil: İngilizce. Görünen her şey İngilizce olmalı (dosyadan gelen yer adları ve nitelikler veri olduğu için olduğu gibi kalır).
    await page.click('#lang button[data-lang="en"]'); const en = await state(page);
    console.log("  EN: " + en.hAfter + " | " + en.sAfter + " | " + en.rows[0] + " | " + en.info.join(" | "));
    ok(en.hAfter === "8 November 2026" && /cloudy 100%/.test(en.rows[0]) && /92%/.test(en.rows[0]), "İngilizce metinler: " + en.rows[0]);
    ok(["Place: Burdur · Bucak · Deneme", "Block / parcel: 101 / 7", "Source: file: ornek-parsel.kml", "Centre: 37.75750, 30.12955"].every((w) => en.info.includes(w)) && en.info.includes("From the boundary: 13,546 m² (13.5 dönüm)"), "İngilizce alan bilgisi: " + en.info.join(" ; "));
    const mix = await page.evaluate(() => {
      const vis = (e) => e.getClientRects().length > 0, de = document.documentElement;
      const ui = ["#h-after", "#s-after", "#h-before", "#s-before", "#rows", "#log", "#tag-a", "#tag-b", "#nd-t", "#diag"].map((i) => document.querySelector(i).textContent).join(" ") + " " + [...document.querySelectorAll("#info dt, #info a, #rows button, #pre option")].map((e) => e.textContent).join(" ");
      return { tr: [...document.querySelectorAll(".tr")].filter(vis).length, lang: de.lang, home: document.querySelector("#home").getAttribute("href"), desc: document.querySelector('meta[name="description"]').content.slice(0, 11),
        words: (ui.match(/Önce|Sonra|bulutlu|açık|kapsam|okunamadı|gün önce|bugün|dün|Kasım|Ekim|Yüzölçümü|Nitelik|Mevkii|Pafta|Sınırdan|Kaynak|Merkez|Karşılaştır|Haritalar|piksel|kayıt|yeşillik|katalog|çokgen|köşe|dosya:|ay önce|yıl önce|Tarih seç/g) || []).filter((v, i, a) => a.indexOf(v) === i) };
    });
    ok(mix.tr === 0 && mix.lang === "en" && mix.home === "../?lang=en" && mix.desc === "Orbit shows", "dil düğmesi: " + JSON.stringify(mix)); ok(!mix.words.length, "İngilizcede Türkçe arayüz sözcüğü kaldı: " + mix.words.join(", "));
    await shot(page, "1d-en");
    // yeniden açılış: son alan ve dil kendiliğinden gelir
    await page.reload({ waitUntil: "load" }); await settled(page, true); const re = await state(page);
    ok(re.after === "S2C_36STG_20261109_0_L2A" && re.hAfter === "9 November 2026" && re.info.includes("Place: Burdur · Bucak · Deneme"), "yeniden açılışta son alan ya da dil gelmedi: " + re.hAfter);
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }

  // 2) sınırın başka biçimleri: GeoJSON (tek kayıt, çok kayıt, yalın çokgen), yapıştırma, KMZ, delikli ve kapanmamış KML, sürükle bırak
  { const { ctx, page, log } = await open({ lang: "tr" });
    const api = { ilAd: "Burdur", ilceAd: "Bucak", mahalleAd: "Deneme", adaNo: "0", parselNo: "42", alan: "13.528,70", nitelik: "Tarla", mevkii: "Örnek", pafta: "M24", ozet: "Deneme-0/42", mahalleId: 1 };
    await loadFile(page, "kayit.geojson", JSON.stringify({ type: "Feature", geometry: SAMPLE.geometry, properties: api })); await settled(page, true);
    let s = await state(page); ok(s.info.includes("Yer: Burdur · Bucak · Deneme") && s.info.includes("Ada / parsel: 0 / 42") && s.info.includes("Mevkii: Örnek") && s.info.includes("Kaynak: dosya: kayit.geojson") && /\(GeoJSON\)/.test(s.diag), "GeoJSON kaydı: " + s.info.join(" ; "));
    const two = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "A" }, geometry: SAMPLE.geometry }, { type: "Feature", properties: { name: "B" }, geometry: { type: "MultiPolygon", coordinates: [[shift(RING, 0.003, 0.0005, 0.5)]] } }, { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [30.13, 37.757] } }] };
    await loadFile(page, "iki-alan.json", JSON.stringify(two)); await settled(page, false); s = await state(page);
    ok(s.polys === 2 && s.info.includes("Ad: iki-alan") && Math.abs(s.area - 13546 * 1.25) < 60, "çok kayıtlı GeoJSON: " + s.polys + " çokgen, " + s.area + " m², " + s.info.join(" ; "));
    await page.evaluate(() => { document.querySelector("#how").open = true; }); await page.fill("#paste", JSON.stringify(SAMPLE.geometry)); await page.click("#use-paste"); await settled(page, true); s = await state(page);
    ok(s.src === "paste" && s.info.includes("Kaynak: yapıştırılan metin") && s.after === "S2C_36STG_20261109_0_L2A", "yapıştırılan yalın çokgen: " + s.info.join(" ; ")); await shot(page, "2-yapistir");
    await loadFile(page, "google-earth.kmz", zip("doc.kml", kml({ name: "Çizdiğim alan" }), 8)); await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "google-earth.kmz"); await settled(page, true); s = await state(page);
    ok(s.info.includes("Ad: Çizdiğim alan") && Math.abs(s.area - 13546) < 40 && /\(KML\)/.test(s.diag), "KMZ (sıkıştırılmış): " + s.info.join(" ; "));
    await loadFile(page, "duz.kmz", zip("icerik/alan.kml", kml({ name: "Düz" }), 0)); await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "duz.kmz"); ok((await state(page)).info.includes("Ad: Düz"), "KMZ (sıkıştırılmamış)");
    // delikli, halkası kapanmamış, virgülden sonra boşluklu KML; öznitelikler açıklamadaki tablodan
    const open5 = RING.slice(0, 5), hole = shift(RING, 0, 0, 0.4);
    await loadFile(page, "delikli.kml", kml({ name: "", ring: open5, sep: " ", hole, desc: "<table><tr><td>İl:</td><td>Burdur</td></tr><tr><td>Parsel</td><td>9</td></tr></table>Nitelik: Bağ<br>Mevkii: Tepe" }));
    await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "delikli.kml"); await settled(page, true); s = await state(page);
    ok(Math.abs(s.area - 13546 * 0.84) < 50 && s.info.includes("Yer: Burdur") && s.info.includes("Ada / parsel: 0 / 9") && s.info.includes("Nitelik: Bağ") && s.info.includes("Mevkii: Tepe"), "delikli KML: " + s.area + " m², " + s.info.join(" ; "));
    ok(Math.abs(s.nd.a - 0.0909) < 0.02, "delikli alanda yeşillik puanı: " + JSON.stringify(s.nd));
    // kapalı çizgi de alan sayılır: KML'de LineString, GeoJSON'da LineString
    await loadFile(page, "cizgi.kml", '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Çizgi</name><LineString><coordinates>' + coords(RING) + "</coordinates></LineString></Placemark></kml>");
    await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "cizgi.kml"); s = await state(page); ok(s.info.includes("Ad: Çizgi") && Math.abs(s.area - 13546) < 40, "kapalı çizgili KML: " + s.info.join(" ; "));
    await loadFile(page, "kapali-cizgi.geojson", JSON.stringify({ type: "Feature", properties: { ad: "Halka" }, geometry: { type: "LineString", coordinates: RING } }));
    await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "kapali-cizgi.geojson"); s = await state(page); ok(s.info.includes("Ad: Halka") && s.polys === 1, "kapalı çizgili GeoJSON: " + s.info.join(" ; "));
    // sürükle bırak
    await page.evaluate((text) => { const dt = new DataTransfer(); dt.items.add(new File([text], "birakilan.kml", { type: "application/vnd.google-earth.kml+xml" })); window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); }, kml({ name: "Bırakılan" }));
    await page.waitForFunction(() => window.__orbit.st.parcel && window.__orbit.st.parcel.src.name === "birakilan.kml"); ok((await state(page)).info.includes("Ad: Bırakılan"), "sürükle bırak");
    // okunamayan dosyalar: uyarı çıkar, ekrandaki alan değişmez
    const big = [[30, 37], [30.4, 37], [30.4, 37.4], [30, 37.4], [30, 37]], tiny = [[30.1296, 37.7575], [30.12963, 37.7575], [30.12963, 37.75753], [30.1296, 37.75753], [30.1296, 37.7575]];
    for (const [name, data, re] of [["not.txt", "bu bir sınır dosyası değil", /okunamadı/], ["bozuk.kml", "<kml><Placemark><Polygon>", /okunamadı/], ["nokta.kml", kml({ name: "Nokta", point: true }), /kapalı bir alan yok/],
      ["cizgi.geojson", JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: RING.slice(0, 4) } }), /kapalı bir alan yok/],
      ["itrf.geojson", JSON.stringify({ type: "Polygon", coordinates: [[[512345.1, 4180000.2], [512445.1, 4180000.2], [512445.1, 4180100.2], [512345.1, 4180000.2]]] }), /enlem ve boylam değil/],
      ["il.geojson", JSON.stringify({ type: "Polygon", coordinates: [big] }), /çok büyük/], ["minik.geojson", JSON.stringify({ type: "Polygon", coordinates: [tiny] }), /çok küçük/],
      ["bos.kmz", zip("resim.png", "x", 0), /KMZ dosyası açılamadı/], ["dev.kml", Buffer.alloc(5 * 1024 * 1024 + 10, 32), /çok büyük \(5 MB/]]) {
      await page.evaluate(() => { document.querySelector("#in-msg").hidden = true; scrollTo(0, 600); }); await loadFile(page, name, data);
      const m = await failed(page).catch(() => ""); ok(re.test(m) && !/ekranın dışında/.test(m), name + " için uyarı: " + JSON.stringify(m)); ok((await state(page)).info.includes("Ad: Bırakılan"), name + " ekrandaki alanı bozdu");
    }
    await shot(page, "2-uyari");
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }
  console.log("sınır biçimleri: GeoJSON, yapıştırma, KMZ, delikli KML, sürükle bırak, okunamayan dosyalar tamam");

  // 3) konum: koordinat ya da Google Haritalar bağlantısı; çevresinde seçilen boyda kare
  { const { ctx, page, log } = await open({ lang: "tr" });
    const cases = [["37.7575, 30.1296", [37.7575, 30.1296]], ["37.7575 30.1296", [37.7575, 30.1296]], ["(37.7575,30.1296)", [37.7575, 30.1296]], ["37,7575 30,1296", [37.7575, 30.1296]], ["37,7575, 30,1296", [37.7575, 30.1296]], ["37.7575°, 30.1296°", [37.7575, 30.1296]],
      ["37°45'27.0\"N 30°07'46.6\"E", [37.7575, 30.12961]], ["37°45'27\"K 30°07'46,6\"D", [37.7575, 30.12961]], ["37.7575° K, 30.1296° D", [37.7575, 30.1296]], ["33°52'S 151°12'E", [-33.86667, 151.2]],
      ["https://www.google.com/maps/@37.7575,30.1296,17z", [37.7575, 30.1296]], ["https://www.google.com/maps/place/Burdur/@37.70,30.20,12z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d37.7575!4d30.1296", [37.7575, 30.1296]],
      ["https://www.google.com/maps?q=37.7575,30.1296", [37.7575, 30.1296]], ["https://www.google.com/maps/search/?api=1&query=37.7575%2C30.1296", [37.7575, 30.1296]], ["https://maps.google.com/?ll=37.7575,30.1296&z=16", [37.7575, 30.1296]],
      ["https://maps.app.goo.gl/AbCdEf123", "shortlink"], ["Burdur Merkez", "loc"], ["", "loc"], ["95, 30", "loc"], ["37.7575", "loc"], ["https://www.google.com/maps/place/Burdur", "loc"]];
    const got = await page.evaluate((cases) => cases.map((c) => { try { const r = window.__orbit.parseLoc(c[0]); return [+r[0].toFixed(5), +r[1].toFixed(5)]; } catch (e) { return e.message; } }), cases);
    cases.forEach((c, i) => ok(JSON.stringify(got[i]) === JSON.stringify(c[1]), "konum okuma: " + JSON.stringify(c[0]) + " -> " + JSON.stringify(got[i])));
    await page.fill("#loc", "burası neresi"); await page.click("#go"); const lm = await failed(page, "#loc-msg").catch(() => ""); ok(/Konum anlaşılamadı/.test(lm) && !/ekranın dışında/.test(lm), "anlaşılmayan konum uyarısı: " + lm);
    await page.fill("#loc", "https://maps.app.goo.gl/AbCdEf123"); await page.click("#go"); await page.waitForFunction(() => /Kısa bağlantı/.test(document.querySelector("#loc-msg").textContent)).catch(() => fail("kısa bağlantı uyarısı çıkmadı"));
    ok(!(await state(page)).src, "hatalı konum bir alan açtı");
    await page.fill("#loc", "37.7575, 30.12955"); await page.press("#loc", "Enter"); await settled(page, true); let s = await state(page);
    console.log("konum: " + s.info.join(" | "));
    ok(s.src === "loc" && s.after === "S2C_36STG_20261109_0_L2A" && s.msg === "" && ["Yüzölçümü: 40.000 m² (40,0 dönüm)", "Kaynak: konum; kenarı 200 m olan kare", "Merkez: 37.75750, 30.12955"].every((w) => s.info.includes(w)) && !s.info.some((x) => /^Ad:/.test(x)), "konumla alan: " + s.info.join(" ; "));
    ok(typeof s.nd.a === "number" && s.nd.a > 0.09 && s.nd.a < 0.26, "karenin yeşillik puanı örnek alanla zeminin arasında olmalı: " + JSON.stringify(s.nd));
    await page.click('#smooth button[data-s="0"]'); const sq = await page.evaluate(() => { const P = window.__orbit, f = P.st.frame, r = P.st.parcel.polys[0][0].map((c) => f.toXY(c[0], c[1])); return r.map((p) => [Math.round(p[0]), Math.round(p[1])]); });
    ok(JSON.stringify(sq) === JSON.stringify([[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]]), "kare 200 m değil: " + JSON.stringify(sq)); await shot(page, "3-konum");
    await page.selectOption("#size", "500"); await page.waitForFunction(() => window.__orbit.st.parcel.src.side === 500); await settled(page, true); s = await state(page);
    ok(s.info.includes("Yüzölçümü: 250.000 m² (250,0 dönüm)") && s.info.includes("Kaynak: konum; kenarı 500 m olan kare") && s.after === "S2C_36STG_20261109_0_L2A", "kenar değişince alan yenilenmedi: " + s.info.join(" ; "));
    await page.click('#lang button[data-lang="en"]'); s = await state(page); ok(s.info.includes("Source: location; a square 500 m on a side") && s.info.includes("Area: 250,000 m² (250.0 dönüm)"), "İngilizce konum bilgisi: " + s.info.join(" ; "));
    await page.reload({ waitUntil: "load" }); await settled(page, true); const back = await page.evaluate(() => [document.querySelector("#loc").value, document.querySelector("#size").value, window.__orbit.st.parcel.src.kind]);
    ok(back.join("|") === "37.75750, 30.12955|500|loc", "yeniden açılışta konum geri gelmedi: " + back.join("|"));
    // büyük alan: görüntü penceresi sınırlı kalır (5 km'lik kare)
    const H = await page.evaluate(() => { const P = window.__orbit, a = P.squareArea(37.7575, 30.12955, 5000), big = P.squareArea(37.7575, 30.12955, 10000); let over = ""; try { P.squareArea(37.7575, 30.12955, 10200); } catch (e) { over = e.message; }
      return [["near", "mid", "wide"].map((z) => Math.round(P.makeFrame(a, z).H)).join(","), Math.round(P.makeFrame(big, "wide").H), over].join("|"); });
    ok(H === "3000,3000,3000|5750|toolarge", "büyük alanda pencere sınırı: " + H);
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }
  console.log("konum: koordinat biçimleri, Google Haritalar bağlantıları, kare, kenar değişimi tamam");

  // 4) eski sürümün tarayıcıda bıraktıkları temizlenir; örnek alan; süzgeçsiz katalog yanıtı, katalog kapalı, bant düzenli dosya
  { const { ctx, page, log } = await open({ lang: "tr" });
    await page.evaluate(() => { localStorage.setItem("kc.orbit.il", "[1]"); localStorage.setItem("kc.orbit.ilce.37", "[1]"); localStorage.setItem("kc.orbit.mah.277", "[1]");
      localStorage.setItem("kc.orbit.last", JSON.stringify({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[30.1, 37.7], [30.101, 37.7], [30.101, 37.701], [30.1, 37.7]]] }, properties: { ilAd: "X" } })); });
    await page.reload({ waitUntil: "load" }); await wait(300);
    const left = await page.evaluate(() => [Object.keys(localStorage).filter((k) => /^kc\.orbit\./.test(k)).join(","), !!window.__orbit.st.parcel]);
    ok(left[0] === "" && !left[1], "eski sürümün kayıtları temizlenmedi: " + JSON.stringify(left));
    await page.click("#sample"); await settled(page, true); const s = await state(page);
    ok(s.src === "sample" && s.info.includes("Ad: Örnek alan (Burdur)") && s.info.includes("Kaynak: örnek") && s.after === "S2C_36STG_20261109_0_L2A", "örnek alan: " + s.info.join(" ; "));
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol: " + log.errors.join(";")); await ctx.close(); }
  for (const v of [{ fields400: true }, { noAssets: true }]) { const { ctx, page, log } = await open(Object.assign({ lang: "tr" }, v));
    await page.click("#sample"); await settled(page, true); const s = await state(page); ok(s.after === "S2C_36STG_20261109_0_L2A" && s.before === "S2B_35SQB_20251110_0_L2A", "katalog yedek yolu tutmadı " + JSON.stringify(v)); ok(!log.errors.length, "konsol: " + log.errors.join(";")); await ctx.close(); }
  { const { ctx, page } = await open({ lang: "tr", stac: "down" });
    await page.click("#sample"); await page.waitForFunction(() => /ulaşılamadı/.test(document.querySelector("#log").textContent)); await ctx.close(); }
  { const { ctx, page, log } = await open({ lang: "tr", bandTci: true });
    await page.click("#sample"); await settled(page, true); await page.click('#smooth button[data-s="0"]');
    const r = await align(page, "#cv-after", "after", SOIL); ok(fits(r) && r.inOk > 500 && r.marker.every((c) => c === 255), "bant düzenli dosyada hizalama bozuk: " + JSON.stringify(r)); ok(!log.errors.length, "konsol: " + log.errors.join(";")); await ctx.close(); }
  console.log("eski kayıtların temizliği, örnek alan, katalog yedekleri, katalog kapalı, bant düzenli dosya tamam");

  // 5) dizüstü: görüntü ilk ekrana sığar. Telefon ve dar ekran: taşma yok.
  { const { ctx, page } = await open({ lang: "tr", viewport: { width: 1366, height: 700 } });
    await page.click("#sample"); await settled(page, true); await page.evaluate(() => scrollTo(0, 0)); await wait(250);
    const b = await (await page.$("#stage")).boundingBox(); ok(b.y + b.height <= 700, "dizüstünde görüntü ilk ekrana sığmıyor: alt kenar " + Math.round(b.y + b.height)); await shot(page, "5-dizustu"); await ctx.close(); }
  for (const [name, w, lang] of [["telefon", 390, "en"], ["telefon", 390, "tr"], ["dar", 320, "tr"]]) { const { ctx, page, log } = await open({ lang, viewport: { width: w, height: 844 }, dsf: 2, mobile: true });
    await page.evaluate(() => { document.querySelector("#how").open = true; }); await wait(100); const o0 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(o0 <= 0, name + " ekranında giriş kutusu taşıyor (" + lang + "): " + o0); await shot(page, "5-" + name + "-" + lang + "-giris");
    await page.tap("#sample"); await settled(page, true); await wait(700); const s = await state(page);
    console.log(name + "-" + lang + ": taşma " + s.overflow + " | " + s.hAfter + " | " + s.hBefore); ok(s.overflow <= 0, name + " ekranında yatay taşma (" + lang + "): " + s.overflow); ok(!log.errors.length, "konsol: " + log.errors.join(";"));
    const fit = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { lang: Math.round(r("#lang").right), w: innerWidth, gap: Math.round(r("#tag-a").left - r("#tag-b").right), app: getComputedStyle(document.querySelector(".app")).display }; });
    ok(fit.lang <= fit.w && fit.gap >= 0 && fit.app !== "none", name + " ekranında üst şerit ya da tarih etiketleri sığmıyor (" + lang + "): " + JSON.stringify(fit));
    await shot(page, "5-" + name + "-" + lang); await page.evaluate(() => document.querySelector("#passes").scrollIntoView()); await shot(page, "5-" + name + "-" + lang + "-gecisler"); await ctx.close(); }

  // 6) ziyaret sayacı: yayındaki adreste sayfa açılınca tek kayıt (s=orbit). Alan açmak ya da dil değiştirmek yeni kayıt üretmez;
  //    hangi alana bakıldığı gönderilmez. Yerel adreste hiç çağrılmaz (çağrılsaydı yukarıdaki senaryolar "izin verilmeyen adres" diye tutmazdı).
  { const { ctx, page, log } = await open({ lang: "tr", live: true });
    await page.click("#sample"); await settled(page, true); await page.click('#lang button[data-lang="en"]'); await wait(300);
    console.log("sayaç " + JSON.stringify(log.hits));
    ok(log.hits.length === 1 && log.hits[0] === "POST hit?t=v&s=orbit&p=&r=&l=tr", "ziyaret sayacı: tek kayıt bekleniyordu (s=orbit, l=tr): " + JSON.stringify(log.hits));
    ok(!log.stray.length, "yayındaki adreste izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol: " + log.errors.join(";")); await ctx.close(); }

  await browser.close(); srv.close();
  console.log(bad.length ? "\nOrbit denemesi TUTMADI: " + bad.length + " sorun\n- " + bad.join("\n- ") : "\nOrbit denemesi tamam (koordinat, dosya ve konumla alan, akış, hizalama, iki dil, yedek yollar, masaüstü, telefon, sayaç)");
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
