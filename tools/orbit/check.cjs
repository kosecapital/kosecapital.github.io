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
  // "Ne zaman değişti?" çizelgesi için (uydurma kayıtlar): alanın içi 9 Haziran'a kadar yeşil, 24 Haziran'dan sonra toprak.
  // 7 Şubat'ta her yer daha parlak (mevsim farkı gibi); 8 Ocak ve 19 Haziran bulutlu; 10 Nisan'ın dosyaları yok (okunamaz).
  ["S2C_36STG_20261010_0_L2A", "2026-10-10T08:59:49.000000Z", 2.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI" }],
  ["S2B_36STG_20260910_0_L2A", "2026-09-10T08:59:49.000000Z", 1.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI" }],
  ["S2C_36STG_20260809_0_L2A", "2026-08-09T08:59:49.000000Z", 3.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI", B04: "36STG_after_B04", B08: "36STG_after_B08" }],
  ["S2B_36STG_20260710_0_L2A", "2026-07-10T08:59:49.000000Z", 2.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI" }],
  ["S2C_36STG_20260629_0_L2A", "2026-06-29T08:59:49.000000Z", 4.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI" }],
  ["S2B_36STG_20260624_0_L2A", "2026-06-24T08:59:49.000000Z", 5.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_after_TCI" }],
  ["S2C_36STG_20260619_0_L2A", "2026-06-19T08:59:49.000000Z", 20.0, "36STG", 0, { SCL: "36STG_cloud_SCL" }],
  ["S2B_36STG_20260614_0_L2A", "2026-06-14T08:59:49.000000Z", 3.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
  ["S2C_36STG_20260609_0_L2A", "2026-06-09T08:59:49.000000Z", 2.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
  ["S2B_36STG_20260511_0_L2A", "2026-05-11T08:59:49.000000Z", 6.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
  ["S2B_36STG_20260410_0_L2A", "2026-04-10T08:59:49.000000Z", 5.0, "36STG", 0, {}],
  ["S2C_36STG_20260312_0_L2A", "2026-03-12T08:59:49.000000Z", 8.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
  ["S2B_36STG_20260207_0_L2A", "2026-02-07T08:59:49.000000Z", 6.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_season_TCI" }],
  ["S2C_36STG_20260113_0_L2A", "2026-01-13T08:59:49.000000Z", 5.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
  ["S2B_36STG_20260108_0_L2A", "2026-01-08T08:59:49.000000Z", 30.0, "36STG", 0, { SCL: "36STG_cloud_SCL" }],
  ["S2C_36STG_20251210_0_L2A", "2025-12-10T08:59:49.000000Z", 4.0, "36STG", 0, { SCL: "36STG_after_SCL", TCI: "36STG_green_TCI" }],
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
    if (opt.clip) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    if (opt.share) await ctx.addInitScript(() => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; });   // telefonun paylaşım menüsü yerine
    const page = await ctx.newPage(), log = { errors: [], urls: [], bytes: 0, ranges: 0, stray: [], hits: [] };
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) log.errors.push("konsol: " + m.text()); });
    page.on("pageerror", (e) => log.errors.push("betik: " + e.message));
    await ctx.route("**/*", async (route) => {
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
      if (opt.slow) await new Promise((r) => setTimeout(r, opt.slow));
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
    await page.goto((opt.live ? LIVE : base) + "orbit/" + (opt.lang ? "?lang=" + opt.lang : "") + (opt.hash || ""), { waitUntil: "load" });
    return { ctx, page, log };
  }
  const state = (page) => page.evaluate(() => {
    const s = window.__orbit.st, t = (id) => document.querySelector(id).textContent.trim();
    return { after: s.after && s.after.scene ? s.after.item.id : null, before: s.before && s.before.scene ? s.before.item.id : null, nd: s.nd,
      hAfter: t("#h-after"), sAfter: t("#s-after"), hBefore: t("#h-before"), sBefore: t("#s-before"), log: [...document.querySelectorAll("#log div")].map((d) => d.textContent),
      rows: [...document.querySelectorAll("#rows tr")].map((r) => [...r.children].slice(0, 4).map((c) => c.textContent.trim()).join(" | ")),
      msg: [...document.querySelectorAll("#in-msg, #loc-msg")].filter((m) => !m.hidden).map((m) => m.textContent).join(" "), single: document.querySelector("#stage").classList.contains("single"), polys: s.parcel ? s.parcel.polys.length : 0, area: s.parcel ? Math.round(window.__orbit.polyArea(s.parcel)) : 0, src: s.parcel ? s.parcel.src.kind : "",
      info: [...document.querySelectorAll("#info dt")].map((d) => d.textContent + ": " + d.nextSibling.textContent), score: [t("#nd-b"), t("#nd-a"), t("#nd-d"), t("#nd-t")],
      overflow: document.documentElement.scrollWidth - innerWidth, diag: t("#diag"), hash: decodeURIComponent(location.hash), chosen: !document.querySelector("#pinned").hidden,
      newest: [...document.querySelectorAll(".head.after .new")].some((e) => e.getClientRects().length > 0), share: !document.querySelector("#share").hidden, shMsg: t("#sh-msg") };
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
    await page.selectOption("#pre", "91"); await page.waitForFunction(() => { const b = window.__orbit.st.before; return b && b.scene && b.item.id === "S2C_36STG_20260809_0_L2A" && window.__orbit.st.nd.b !== undefined; }).catch(() => fail("3 ay önce: 9 Ağustos 2026 görüntüsü gelmedi"));
    await page.selectOption("#pre", "730"); await page.waitForFunction(() => /bulunamadı/.test(document.querySelector("#log").textContent));
    ok((await state(page)).single, "önceki görüntü yokken tek görüntü görünümüne dönmedi");
    const one = await page.evaluate(() => { const c = window.__orbit.exportCanvas(); return [c.width, c.height, window.__orbit.exportName()].join("|"); });
    ok(one === "776|1044|orbit-burdur-bucak-deneme-101-7-20261108.png", "tek görüntülü indirilen görsel: " + one);
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

  // ---- çizelgenin durumu ----
  const tlWait = (page) => page.waitForFunction(() => { const t = window.__orbit.tl; return t.slots.length > 0 && !t.busy; }, null, { timeout: 60000 });
  const tlState = (page) => page.evaluate(() => {
    const P = window.__orbit, t = P.tl, q = (s) => document.querySelector(s), txt = (s) => q(s).textContent.trim(), cells = [...document.querySelectorAll("#tl-strip .tl-cell")];
    const px = (cv, x, y) => [...cv.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3);
    // Küçük görüntü alana yakın çerçeveye (kenarı 240 m) kırpılmış olmalı: merkezden 30 m uzaktaki dört nokta alanın içinde, 100 m uzaktaki iki köşe dışında kalır.
    const crop = (cv) => { const mid = px(cv, 72, 72).join(); return [[54, 72], [90, 72], [72, 54], [72, 90]].every((c) => px(cv, c[0], c[1]).join() === mid) && [[12, 132], [132, 12]].every((c) => px(cv, c[0], c[1]).join() !== mid); };
    const chart = q("#tl-chart"), cd = chart.width && !q("#tl-body").hidden ? chart.getContext("2d").getImageData(0, 0, chart.width, chart.height).data : [];
    const near = (o, c) => Math.abs(cd[o] - c[0]) < 6 && Math.abs(cd[o + 1] - c[1]) < 6 && Math.abs(cd[o + 2] - c[2]) < 6 && cd[o + 3] > 200;
    let pink = 0, gray = 0; for (let o = 0; o < cd.length; o += 4) { if (near(o, [255, 120, 190])) pink++; else if (near(o, [107, 118, 111])) gray++; }
    return { n: t.slots.length, busy: t.busy, days: t.days,
      slots: t.slots.map((sl, i) => ({ state: sl.state, id: sl.s ? sl.s.item.id : null, i: sl.d && sl.d.i != null ? +sl.d.i.toFixed(2) : null, o: sl.d && sl.d.o != null ? +sl.d.o.toFixed(2) : null,
        label: cells[i] ? cells[i].querySelector(".d").textContent : "", ph: cells[i] && cells[i].querySelector(".ph") ? cells[i].querySelector(".ph").textContent : "",
        mid: cells[i] && cells[i].querySelector("canvas") ? px(cells[i].querySelector("canvas"), 72, 72) : null, crop: cells[i] && cells[i].querySelector("canvas") ? crop(cells[i].querySelector("canvas")) : null, mark: cells[i] ? (cells[i].classList.contains("is-a") ? "a" : "") + (cells[i].classList.contains("is-b") ? "b" : "") : "" })),
      pick: t.pick ? [t.pick.a, t.pick.b] : null, state: txt("#tl-state"), find: q("#tl-find").hidden ? "" : txt("#tl-find-t"), acts: !q("#tl-find").hidden && !q("#tl-acts").hidden, zoom: !q("#tl-find").hidden && !q("#tl-acts").hidden && !q("#tl-zoom").hidden, read: txt("#tl-read"),
      rows: [...document.querySelectorAll("#tl-rows tr")].map((r) => [...r.children].map((c) => c.textContent).join(" | ")), pressed: [...document.querySelectorAll("#tl-span button")].map((b) => b.getAttribute("aria-pressed") + (b.disabled ? "!" : "")).join(","),
      stop: !q("#tl-stop").hidden, body: !q("#tl-body").hidden, shown: !q("#tl").hidden, axis: [...document.querySelectorAll("#tl-axis span")].map((e) => e.textContent), pink, gray, aria: chart.getAttribute("aria-label") || "",
      scroll: [Math.round(q("#tl-scroll").scrollLeft), q("#tl-scroll").scrollWidth, q("#tl-scroll").clientWidth], bytes: P.net.bytes, cogs: P.cogs.size, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const ids = (t) => t.slots.map((x) => (x.id ? x.id.slice(10, 18) : x.state)).join(" ");
  const SEASON = [109, 239, 109];        // "mevsim" görüntüsünde alanın içi (parlaklık 1,3 ile)

  // 7) paylaşım: alan adresin # bölümüne yazılır; bağlantıyı açan aynı alanı ve aynı iki tarihi görür. İndirilen görsel.
  { const { ctx, page, log } = await open({ lang: "tr", clip: true });
    // çokgenlerin yazılıp okunması (delikli, çok parçalı, eksi koordinatlı), özniteliklerin gidiş dönüşü, bozuk bağlantılar
    const rt = await page.evaluate(() => {
      const P = window.__orbit, sq = (x, y, d) => [[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]];
      const polys = [[sq(-70.6512345678, -33.4512345678, 0.001), sq(-70.6512345678, -33.4512345678, 0.0003)], [sq(-70.6472, -33.4489, 0.0005)]];
      const props = { ilAd: "Şanlıurfa", ilceAd: "Viranşehir", mahalleAd: "Yukarı Köy & Çiftlik #2", adaNo: "0", parselNo: "12", alan: "1.234,56", nitelik: "Tarla + Bağ", mevkii: "Dere=Kenarı / 100%", pafta: "N41-b" };
      const a = P.normArea(polys, props, { kind: "file", name: "x.kml" }), f = P.fragOf(a, false), b = P.areaOfFrag("#" + f).area;
      let worst = 0; a.polys.forEach((poly, i) => poly.forEach((r, j) => r.forEach((c, k) => { const d = b.polys[i][j][k]; worst = Math.max(worst, Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1])); })));
      const bad = []; for (const t of ["#s=!!!", "#s=AAAA", "#s=A", "#s=gA", "#k=1_2", "#k=95_30_200", "#k=37_30_99999", "#k=a_b_c", "#s=" + P.encPolys([[sq(30, 37, 0.2)]]), "#s=" + P.encPolys([[sq(30, 37, 0.000001)]])]) { try { P.areaOfFrag(t); bad.push(t.slice(0, 12)); } catch (e) {} }
      const named = P.areaOfFrag("#" + P.fragOf(P.normArea([[sq(30, 37, 0.001)]], {}, { kind: "file", name: "Çizdiğim alan.kmz" }), false)).area.props.ad;
      return { worst, rings: b.polys.map((p) => p.length).join(","), props: JSON.stringify(b.props) === JSON.stringify(props), src: b.src.kind, len: f.length, safe: /^[A-Za-z0-9._%&=+*-]+$/.test(f), bad, named,
        none: P.areaOfFrag("#") === null && P.areaOfFrag("#foo=1") === null, area: [Math.round(P.polyArea(a)), Math.round(P.polyArea(b))].join("=") };
    });
    console.log("bağlantı birimi " + JSON.stringify(rt));
    ok(rt.worst < 1e-7 && rt.rings === "2,1" && rt.props && rt.src === "link" && rt.safe && rt.none && rt.named === "Çizdiğim alan", "çokgen ya da öznitelik gidiş dönüşü: " + JSON.stringify(rt)); ok(!rt.bad.length, "bozuk bağlantı kabul edildi: " + rt.bad.join(" "));
    await loadFile(page, "ornek-parsel.kml", kml({ name: "Deneme-101/7", attr: ATTR })); await settled(page, true);
    let s = await state(page);
    ok(/^#s=[\w.-]+&il=Burdur&ilce=Bucak&mah=Deneme&ada=101&parsel=7&alan=13\.528,70&nitelik=Tarla&pafta=M24&ad=Deneme-101\/7$/.test(s.hash), "adres çubuğu alanı taşımıyor ya da tarih yazıyor: " + s.hash);
    ok(s.share && s.newest && !s.chosen && (await page.evaluate(() => document.querySelector("#sh-send").hidden)), "paylaşım satırı, 'en yeni' etiketi ya da Paylaş düğmesi (bu tarayıcıda paylaşım menüsü yok): " + JSON.stringify([s.share, s.newest, s.chosen]));
    await page.click("#sh-copy"); await page.waitForFunction(() => /kopyalandı/.test(document.querySelector("#sh-msg").textContent)).catch(() => fail("bağlantı kopyalanmadı: " + JSON.stringify(s.shMsg)));
    const link = await page.evaluate(() => navigator.clipboard.readText()), frag = link.slice(link.indexOf("#"));
    console.log("bağlantı (" + link.length + " karakter): " + decodeURIComponent(link).replace(base, "…/"));
    ok(link.startsWith(base + "orbit/#s=") && /&sonra=20261109C&once=20251110B$/.test(link) && !/lang=/.test(link) && link.length < 400, "kopyalanan bağlantı: " + link);
    // indirilen görsel: dosya adı, boyut, iki görüntünün ortası, sınır çizgisi, logo, alt satırlar
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#sh-png")]), png = fs.readFileSync(await dl.path());
    console.log("indirilen görsel: " + dl.suggestedFilename() + " " + png.readUInt32BE(16) + "x" + png.readUInt32BE(20) + " " + Math.round(png.length / 1024) + " KB");
    ok(dl.suggestedFilename() === "orbit-burdur-bucak-deneme-101-7-20251110-20261109.png" && png.slice(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1512 && png.readUInt32BE(20) === 1076, "indirilen görselin adı ya da boyutu: " + dl.suggestedFilename());
    ok(/Görüntü indirildi: orbit-burdur/.test((await state(page)).shMsg), "indirme bilgisi yazmadı"); if (OUT) fs.writeFileSync(path.join(OUT, "orbit-7-indirilen.png"), png);
    const ex = await page.evaluate(() => { const cv = window.__orbit.exportCanvas(), w = cv.width, d = cv.getContext("2d").getImageData(0, 0, w, cv.height).data, at = (x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
      let pink = 0, logo = 0, text = 0, name = 0;
      for (let y = 252; y < 972; y++) for (let x = 28; x < 1484; x++) { const o = (y * w + x) * 4; if (d[o] === 255 && d[o + 1] === 120 && d[o + 2] === 190) pink++; }
      for (let y = 28; y < 58; y++) for (let x = 28; x < 220; x++) { const o = (y * w + x) * 4; if (d[o] > 200 && d[o + 1] > 200 && d[o + 2] > 180) logo++; }
      for (let y = 80; y < 120; y++) for (let x = 28; x < 700; x++) { const o = (y * w + x) * 4; if (d[o] > 200 && d[o + 1] > 200 && d[o + 2] > 180) name++; }
      for (let y = 980; y < 1076; y++) for (let x = 28; x < 1484; x++) { const o = (y * w + x) * 4; if (d[o] > 110) text++; }
      return { left: at(28 + 360, 252 + 360), right: at(28 + 720 + 16 + 360, 252 + 360), pink, logo, name, text, bg: at(5, 5) }; });
    console.log("  görselin içi " + JSON.stringify(ex));
    ok(JSON.stringify(ex.left) === JSON.stringify(GREEN) && JSON.stringify(ex.right) === JSON.stringify(SOIL), "indirilen görselde önce solda (yeşil), sonra sağda (toprak) olmalı: " + JSON.stringify([ex.left, ex.right]));
    ok(ex.pink > 300 && ex.logo > 150 && ex.name > 400 && ex.text > 300 && ex.bg.join() === "7,11,9", "indirilen görselde sınır çizgisi, logo, ad ya da alt satırlar eksik: " + JSON.stringify(ex));
    // bağlantı yeni bir tarayıcıda: aynı alan, aynı iki tarih, aynı bilgiler; sınır görüntüye oturur
    const o2 = await open({ lang: "tr", hash: frag }); await settled(o2.page, true); let r = await state(o2.page);
    console.log("bağlantıyla açılış: " + r.after + " / " + r.before + " | " + r.info.join(" | "));
    ok(r.after === s.after && r.before === s.before && r.area === s.area && r.src === "link" && r.polys === 1, "bağlantı aynı alanı ya da aynı tarihleri açmadı: " + JSON.stringify([r.after, r.before, r.area, r.src]));
    ok(["Yer: Burdur · Bucak · Deneme", "Ada / parsel: 101 / 7", "Yüzölçümü: 13.528,70 m² (13,5 dönüm)", "Nitelik: Tarla", "Pafta: M24", "Sınırdan hesap: 13.546 m² (13,5 dönüm)", "Kaynak: paylaşılan bağlantı", "Merkez: 37.75750, 30.12955"].every((w) => r.info.includes(w)), "bağlantıyla açılan alanın bilgisi: " + r.info.join(" ; "));
    ok(r.chosen && !r.newest && /&sonra=20261109C&once=20251110B$/.test(r.hash), "tarihli bağlantıda 'belirli bir tarih' satırı, etiket ya da adres: " + JSON.stringify([r.chosen, r.newest, r.hash.slice(-40)]));
    const same = await o2.page.evaluate((ring) => { const got = window.__orbit.st.parcel.polys[0][0]; return Math.max(...ring.map((c, i) => Math.max(Math.abs(c[0] - got[i][0]), Math.abs(c[1] - got[i][1])))); }, RING);
    await o2.page.click('#smooth button[data-s="0"]'); const al = await align(o2.page, "#cv-after", "after", SOIL), al2 = await align(o2.page, "#cv-before", "before", GREEN);
    ok(same < 1e-7 && fits(al) && fits(al2) && al.inOk > 500, "bağlantıdaki sınır dosyadakiyle aynı değil ya da görüntüye oturmuyor: " + same + " " + JSON.stringify(al)); await shot(o2.page, "7-baglanti");
    // "En yeni görüntüyü göster": tarihler bırakılır, adres yalnız alanı taşır
    await o2.page.click("#newest"); await o2.page.waitForFunction(() => document.querySelector("#pinned").hidden && window.__orbit.st.pin === null).catch(() => fail("'En yeni görüntüyü göster' satırı kaldırmadı")); await settled(o2.page, true); r = await state(o2.page);
    ok(r.after === "S2C_36STG_20261109_0_L2A" && r.before === "S2B_35SQB_20251110_0_L2A" && r.newest && !r.chosen && !/sonra=|once=/.test(r.hash) && /^#s=/.test(r.hash), "en yeni görüntüye dönüş: " + JSON.stringify([r.after, r.before, r.newest, r.chosen, r.hash.slice(-30)]));
    // aynı sekmeye başka bir tarihli bağlantı: 8 Kasım (listede) ve 20 Ekim (listede yok, katalogdan bulunur), yakın görünüm; yeniden yüklenince aynı kalır
    await o2.page.evaluate((h) => { location.hash = h; }, frag.replace(/&sonra=.*$/, "&sonra=20261108A&once=20261020C&z=near"));
    const dated = () => o2.page.waitForFunction(() => { const s = window.__orbit.st; return s.after && s.after.scene && s.after.item.id === "S2A_35SQB_20261108_0_L2A" && s.before && s.before.scene && s.before.item.id === "S2C_35SQB_20261020_0_L2A" && document.querySelector("#busy").hidden; }, null, { timeout: 30000 });
    await dated().catch(() => fail("aynı sekmede açılan tarihli bağlantı gelmedi")); r = await state(o2.page);
    ok(r.chosen && !r.newest && /&sonra=20261108A&once=20261020C&z=near$/.test(r.hash) && r.hAfter === "8 Kasım 2026" && r.hBefore === "20 Ekim 2026" && (await o2.page.evaluate(() => window.__orbit.st.zoom + "|" + document.querySelector('#zoom button[data-z="near"]').getAttribute("aria-pressed"))) === "near|true", "tarihli bağlantı (8 Kasım, 20 Ekim, yakın): " + JSON.stringify([r.hAfter, r.hBefore, r.hash.slice(-44)]));
    await o2.page.reload({ waitUntil: "load" }); await dated().catch(() => fail("yeniden yüklenince tarihli bağlantı değişti")); r = await state(o2.page); ok(r.chosen && /&sonra=20261108A&once=20261020C&z=near$/.test(r.hash), "yeniden yüklenince adres: " + r.hash.slice(-44));
    // tarihli görünümde elle başka geçiş seçilirse adres onu izler
    await rowButton(o2.page, "9 Kasım", 1); await o2.page.waitForFunction(() => window.__orbit.st.after.item.id === "S2C_36STG_20261109_0_L2A" && document.querySelector("#busy").hidden); r = await state(o2.page);
    ok(/&sonra=20261109C&once=20261020C&z=near$/.test(r.hash), "tarihli görünümde elle seçilen geçiş adrese yazılmadı: " + r.hash.slice(-44));
    ok(!o2.log.stray.length && !o2.log.errors.length, "bağlantıyla açılışta izin verilmeyen istek ya da konsol hatası: " + o2.log.stray.concat(o2.log.errors).join(" ; ")); await o2.ctx.close();
    // bağlantıdaki tarih katalogda yoksa: en yeni görüntü, her zamanki önceki tarih; adresten tarih düşer
    const o3 = await open({ lang: "tr", hash: "#ornek=1&sonra=20200101A&once=20190101A" }); await settled(o3.page, true); r = await state(o3.page);
    ok(r.src === "sample" && r.after === "S2C_36STG_20261109_0_L2A" && r.before === "S2B_35SQB_20251110_0_L2A" && r.newest && !r.chosen && r.hash === "#ornek=1" && /bağlantıdaki tarih açılamadı: 20200101A/.test(r.diag), "bağlantıdaki tarih yokken: " + JSON.stringify([r.after, r.before, r.newest, r.chosen, r.hash]));
    // yalnız "önce" tarihi bulunamazsa: "sonra" bağlantıdaki gibi, "önce" her zamanki arama
    await o3.page.evaluate(() => { location.hash = "#ornek=1&sonra=20261108A&once=20190101A"; }); await o3.page.waitForFunction(() => { const s = window.__orbit.st; return s.after && s.after.scene && s.after.item.id === "S2A_35SQB_20261108_0_L2A" && s.before && s.before.scene && s.nd.b !== undefined && document.querySelector("#busy").hidden; }, null, { timeout: 30000 }).catch(() => fail("yalnız 'önce' tarihi olmayan bağlantı"));
    r = await state(o3.page); ok(r.before === "S2B_35SQB_20251110_0_L2A" && r.chosen && /bağlantıdaki tarih açılamadı: 20190101A/.test(r.diag) && r.hash === "#ornek=1&sonra=20261108A&once=20251110B", "yalnız 'önce' tarihi yokken: " + JSON.stringify([r.before, r.chosen, r.hash])); await o3.ctx.close();
    // konum bağlantısı (İngilizce) ve bozuk bağlantı
    const o4 = await open({ lang: "en", hash: "#k=37.7575_30.12955_500" }); await settled(o4.page, true); r = await state(o4.page);
    const form = await o4.page.evaluate(() => [document.querySelector("#loc").value, document.querySelector("#size").value].join("|"));
    ok(r.src === "loc" && r.info.includes("Source: location; a square 500 m on a side") && r.info.includes("Area: 250,000 m² (250.0 dönüm)") && form === "37.75750, 30.12955|500" && r.hash === "#k=37.7575_30.12955_500" && r.newest && !r.chosen, "konum bağlantısı: " + JSON.stringify([r.src, form, r.hash, r.info]));
    await o4.page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("izin yok")); });        // pano kapalıysa bağlantı kutuda gösterilir
    await o4.page.click("#sh-copy"); await wait(300); r = await state(o4.page); ok(/^Could not copy\. Select the link in the box below/.test(r.shMsg), "İngilizce kopyalama bilgisi: " + r.shMsg);
    ok((await o4.page.evaluate(() => { const b = document.querySelector("#sh-link"); return b.hidden ? "" : b.value; })).endsWith("#k=37.7575_30.12955_500&sonra=20261109C&once=20251110B"), "pano izni yokken bağlantı kutuda gösterilmedi"); await shot(o4.page, "7-kopyalanamadi"); await o4.ctx.close();
    const o5 = await open({ lang: "tr", hash: "#s=bozuk!!&il=X" }); await wait(500); r = await state(o5.page);
    ok(/Bağlantıdaki alan okunamadı/.test(r.msg) && !r.src && !o5.log.urls.length, "bozuk bağlantı uyarısı: " + JSON.stringify(r.msg)); await o5.ctx.close();
    // paylaşım menüsü olan tarayıcı (telefon): başlık, metin ve bağlantı menüye gider
    const o6 = await open({ lang: "en", share: true, hash: "#ornek=1" }); await settled(o6.page, true); await o6.page.click("#sh-send"); const sh = await o6.page.evaluate(() => window.__shared);
    console.log("paylaşım menüsü " + JSON.stringify(sh));
    ok(sh.length === 1 && sh[0].title === "Orbit · Sample area (Burdur)" && sh[0].text === "Sample area (Burdur): satellite images from 10 November 2025 and 9 November 2026" && sh[0].url === base + "orbit/#ornek=1&sonra=20261109C&once=20251110B", "paylaşım menüsüne giden: " + JSON.stringify(sh)); await o6.ctx.close();
    // yayındaki adreste bağlantıyla açılış: sayaç yine tek kayıt, alan hiçbir isteğe yazılmaz
    const o7 = await open({ lang: "tr", live: true, hash: frag }); await settled(o7.page, true);
    const leak = o7.log.urls.filter((u) => /Burdur|Bucak|Deneme|il=|parsel=|[#&?]s=/.test(decodeURIComponent(u)));
    ok(o7.log.hits.length === 1 && o7.log.hits[0] === "POST hit?t=v&s=orbit&p=&r=&l=tr" && !leak.length && (await state(o7.page)).src === "link", "bağlantıyla açılınca sayaç ya da sızan alan bilgisi: " + JSON.stringify(o7.log.hits) + " " + leak.join(" ")); await o7.ctx.close();
    // bağlantıya sığmayan sınır: adres boş kalır, düğme nedenini söyler
    const many = []; for (let i = 0; i < 1500; i++) { const a = i / 1500 * 2 * Math.PI, rr = 0.0009 + 0.0002 * Math.sin(i * 0.7); many.push([+(30.1296 + rr * Math.cos(a)).toFixed(7), +(37.7575 + rr * 0.8 * Math.sin(a)).toFixed(7)]); } many.push(many[0]);
    await loadFile(page, "ayrintili.geojson", JSON.stringify({ type: "Polygon", coordinates: [many] })); await page.waitForFunction(() => window.__orbit.st.parcel.src.name === "ayrintili.geojson"); await settled(page, false);
    await page.click("#sh-copy"); await page.waitForFunction(() => /sığmayacak kadar ayrıntılı/.test(document.querySelector("#sh-msg").textContent)).catch(() => fail("ayrıntılı sınırda uyarı çıkmadı"));
    s = await state(page); ok(s.hash === "" && (await page.evaluate(() => window.__orbit.shareLink())) === null, "bağlantıya sığmayan sınırda adres boş kalmalı: " + s.hash.slice(0, 40));
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }
  console.log("paylaşım: bağlantı gidiş dönüşü, tarihli bağlantı, konum ve örnek bağlantısı, bozuk bağlantı, paylaşım menüsü, indirilen görsel tamam");

  // 8) "Ne zaman değişti?" çizelgesi: son bir yıl, aralığa yakından bakma, küçük görüntüden açma, durdurma, İngilizce, telefon
  { const { ctx, page, log } = await open({ lang: "tr" });
    ok(!(await tlState(page)).shown, "çizelge, görüntü gelmeden görünüyor");
    await page.click("#sample"); await settled(page, true);
    let t = await tlState(page); ok(t.shown && !t.body && t.pressed === "false,false,false" && !t.stop, "çizelge kutusu açılışta: " + JSON.stringify([t.shown, t.body, t.pressed]));
    const tci = (id) => log.urls.filter((u) => u.includes(id + "/TCI")).length, n0 = tci("S2B_35SQB_20251110_0_L2A");
    await page.evaluate(() => document.querySelector("#tl").scrollIntoView()); await page.click('#tl-span button[data-d="365"]');
    t = await tlState(page); ok(t.busy && t.stop && t.pressed === "true!,false!,false!" && t.n === 13 && /^\d+ \/ 13 tarihe bakıldı · .* indirildi…$/.test(t.state), "çizelge kurulurken: " + JSON.stringify([t.busy, t.stop, t.pressed, t.n, t.state]));
    await tlWait(page); t = await tlState(page);
    console.log("çizelge (1 yıl): " + ids(t) + " | " + t.state); console.log("  içi " + t.slots.map((x) => x.i).join(" ") + " | çevresi " + t.slots.map((x) => x.o).join(" ") + " | eksen " + t.axis.join(" ") + " | pembe " + t.pink + " gri " + t.gray);
    ok(ids(t) === "20251110 20251210 20260113 20260207 20260312 err 20260511 20260609 20260710 20260809 20260910 20261010 20261109", "çizelgenin seçtiği görüntüler: " + ids(t));
    ok(/^12 açık görüntü · 10 Kasım 2025 – 9 Kasım 2026 · [\d.,]+ (KB|MB) indirildi$/.test(t.state) && t.pressed === "true,false,false" && !t.stop && !t.busy, "çizelge bitince durum satırı: " + t.state + " " + t.pressed);
    const g = (k) => t.slots[k], green = [1, 2, 4, 6, 7], soil = [8, 9, 10, 11, 12];
    ok(green.every((k) => g(k).i > 19 && g(k).i < 25.5 && g(k).o < 2.5 && JSON.stringify(g(k).mid) === JSON.stringify(GREEN)), "yeşil görüntülerde fark ya da küçük görüntü: " + JSON.stringify(green.map((k) => [g(k).i, g(k).o, g(k).mid])));
    ok(soil.every((k) => g(k).i === 0 && g(k).o === 0 && JSON.stringify(g(k).mid) === JSON.stringify(SOIL)), "toprak görüntülerde fark sıfır olmalı: " + JSON.stringify(soil.map((k) => [g(k).i, g(k).o, g(k).mid])));
    ok(g(3).i > 17 && g(3).i < 23 && g(3).o > 8.4 && g(3).o < 11.5 && JSON.stringify(g(3).mid) === JSON.stringify(SEASON), "mevsim görüntüsünde çevre de değişmeli: " + JSON.stringify([g(3).i, g(3).o, g(3).mid]));
    ok(g(0).i > 17 && g(0).i < 25.5 && g(0).o > 1 && g(0).mark === "b" && g(12).mark === "a" && tci("S2B_35SQB_20251110_0_L2A") === n0, "ekrandaki 'Önce' görüntüsü çizelgede yeniden indirilmemeli ve işaretli olmalı: " + JSON.stringify([g(0).i, g(0).o, g(0).mark, g(12).mark, n0, tci("S2B_35SQB_20251110_0_L2A")]));
    ok(t.slots.every((x) => x.crop !== false), "küçük görüntüler alanın çevresine kırpılmamış: " + t.slots.map((x) => x.crop).join(" "));
    ok(g(5).ph === "okunamadı" && g(5).label === "10 Nis 2026" && g(1).label === "10 Ara 2025" && g(12).label === "9 Kas 2026", "sıradaki etiketler: " + JSON.stringify([g(5).ph, g(5).label, g(1).label, g(12).label]));
    ok(JSON.stringify(t.pick) === "[7,8]" && /^Alanın içi, çevresinden farklı olarak en çok bu aralıkta değişti: 9 Haziran 2026 – 10 Temmuz 2026\. Alanın içi: %2\d,\d → %0,0\. Çevresi: %\d,\d → %0,0\.$/.test(t.find) && t.acts && t.zoom, "en büyük değişimin aralığı: " + JSON.stringify(t.pick) + " " + t.find);
    ok(t.axis.join(" ") === "%0 %10 %20 %30" && t.pink > 300 && t.gray > 300 && /12 görüntünün son görüntüden farkı/.test(t.aria), "çizgi grafik: " + JSON.stringify([t.axis, t.pink, t.gray, t.aria]));
    ok(t.rows.length === 12 && /^10 Kasım 2025 \| Sentinel-2B \| %\d\d,\d \| %\d+,\d$/.test(t.rows[0]) && t.rows[11] === "9 Kasım 2026 | Sentinel-2C | %0,0 | %0,0", "tablo görünümü: " + t.rows[0] + " … " + t.rows[11]);
    ok(t.bytes === log.bytes && t.bytes > 0, "indirilen veri sayacı ağdaki miktarla aynı değil: " + t.bytes + " / " + log.bytes); ok(t.cogs <= 40, "açık dosya sayısı sınırı aşıldı: " + t.cogs); ok(t.overflow <= 0, "çizelge yatay taşma yaptı: " + t.overflow);
    await shot(page, "8a-cizelge");
    // imleç: grafikte bir sütunun üstüne gelince o günün iki değeri de yazar
    const cx = await page.evaluate(() => { const c = document.querySelectorAll("#tl-strip .tl-cell")[3].getBoundingClientRect(), k = document.querySelector("#tl-chart").getBoundingClientRect(); return [c.left + c.width / 2, k.top + k.height / 2]; });
    await page.mouse.move(cx[0], cx[1]); t = await tlState(page); ok(/^7 Şubat 2026 · Sentinel-2B%\d\d,\d alanın içi%\d+,\d çevresi$/.test(t.read), "imleçle okunan değerler: " + t.read); await shot(page, "8b-imlec");
    // küçük görüntüye basınca o tarih "Önce" olur; görüntü yeniden indirilmez; sınır yerine oturur
    const n1 = tci("S2C_36STG_20260609_0_L2A"); await page.click("#tl-strip .tl-cell:nth-child(8)");
    await page.waitForFunction(() => { const s = window.__orbit.st; return s.before && s.before.scene && s.before.item.id === "S2C_36STG_20260609_0_L2A" && s.nd.b !== undefined; }).catch(() => fail("küçük görüntü 'Önce' olarak açılmadı"));
    let s = await state(page); t = await tlState(page);
    ok(tci("S2C_36STG_20260609_0_L2A") === n1 && s.hBefore === "9 Haziran 2026" && /"Önce" görüntüsü: 9 Haziran 2026/.test(s.log.slice(-1)[0]) && t.slots[7].mark === "b" && t.slots[0].mark === "", "küçük görüntüden açış: " + JSON.stringify([n1, tci("S2C_36STG_20260609_0_L2A"), s.hBefore, s.log.slice(-1)[0], t.slots[7].mark]));
    await page.click('#smooth button[data-s="0"]'); const al = await align(page, "#cv-before", "before", GREEN); ok(fits(al) && al.inOk > 500, "çizelgeden açılan görüntüde sınır oturmuyor: " + JSON.stringify(al)); await page.click('#smooth button[data-s="1"]');
    // "Bu iki tarihi karşılaştır": iki yana o iki tarih gelir; ekrandaki en yeni görüntü değildir, paylaşım bağlantısı bu tarihleri taşır
    await page.click("#tl-cmp"); await page.waitForFunction(() => { const s = window.__orbit.st; return s.after && s.after.item.id === "S2B_36STG_20260710_0_L2A" && s.before && s.before.item.id === "S2C_36STG_20260609_0_L2A" && s.nd.a !== undefined && document.querySelector("#busy").hidden; }).catch(() => fail("'Bu iki tarihi karşılaştır' iki görüntüyü açmadı"));
    s = await state(page); t = await tlState(page);
    ok(s.chosen && !s.newest && s.hAfter === "10 Temmuz 2026" && s.hash === "#ornek=1" && (await page.evaluate(() => window.__orbit.shareLink())).endsWith("#ornek=1&sonra=20260710B&once=20260609C") && t.slots[8].mark === "a" && t.slots[7].mark === "b", "iki tarihin karşılaştırması: " + JSON.stringify([s.chosen, s.newest, s.hAfter, s.hash, t.slots[8].mark]));
    await page.evaluate(() => scrollTo(0, 0)); await wait(200); await shot(page, "8c-karsilastir");
    // "Bu aralığa yakından bak": 9 Haziran ile 10 Temmuz arasındaki geçişler
    await page.evaluate(() => document.querySelector("#tl").scrollIntoView()); await page.click("#tl-zoom"); await tlWait(page); t = await tlState(page);
    console.log("çizelge (aralık): " + ids(t) + " | " + t.state + " | " + t.find);
    ok(ids(t) === "20260609 20260614 none 20260624 20260629 none 20260710" && JSON.stringify(t.pick) === "[1,3]" && /14 Haziran 2026 – 24 Haziran 2026/.test(t.find) && t.acts && !t.zoom && t.pressed === "false,false,false", "aralığa yakından bakış: " + ids(t) + " " + JSON.stringify(t.pick) + " " + t.find);
    ok(/^5 açık görüntü · 9 Haziran 2026 – 10 Temmuz 2026 · .* indirildi · açık görüntüsü olmayan tarih: 2$/.test(t.state) && t.slots[0].mark === "b" && t.slots[6].mark === "a", "aralık bitince durum satırı: " + t.state); await shot(page, "8d-aralik");
    // İngilizce: görünen her şey İngilizce
    await page.click('#lang button[data-lang="en"]'); t = await tlState(page);
    const tlText = await page.evaluate(() => document.querySelector("#tl").innerText + " " + [...document.querySelectorAll("#tl-strip button")].map((b) => b.getAttribute("aria-label")).join(" ") + " " + document.querySelector("#tl-chart").getAttribute("aria-label") + " " + document.querySelector("#share").innerText + " " + document.querySelector("#pinned").innerText);
    const trWords = (tlText.match(/Kas|Haz|Tem|Ağu|Eyl|Eki|Oca|Şub|Nis|indirildi|bakıldı|görüntü|Görüntü|Alanın|alanın|evresi|Durdur|Tablo|Tarih|Uydu|Fark|fark|Bağlantı|Paylaş|Önce|Sonra|olarak|yakından|karşılaştır|En yeni|bakıyorsun|Son /g) || []).filter((v, i, a) => a.indexOf(v) === i);
    ok(!trWords.length, "çizelgede ya da paylaşım satırında İngilizcede Türkçe sözcük kaldı: " + trWords.join(", "));
    ok(/^Clear images: 5 · 9 June 2026 – 10 July 2026 · [\d.,]+ (KB|MB) downloaded · dates with no clear image: 2$/.test(t.state) && /^Unlike its surroundings, the inside of the area changed most in this interval: 14 June 2026 – 24 June 2026\. Inside the area: 2\d\.\d% → 0\.0%\. Around it: \d\.\d% → 0\.0%\.$/.test(t.find) && t.slots[1].label === "14 Jun 2026" && t.slots[2].ph === "no clear image" && t.axis[1] === "10%", "İngilizce çizelge: " + t.state + " | " + t.find + " | " + t.slots[1].label + " | " + t.axis.join(" "));
    await shot(page, "8e-en"); await page.click('#lang button[data-lang="tr"]');
    // son 5 yıl: on bir tarih, altı ayda bir; çoğunda görüntü yok
    await page.click("#newest"); await page.waitForFunction(() => { const s = window.__orbit.st; return s.after && s.after.item.id === "S2C_36STG_20261109_0_L2A" && document.querySelector("#pinned").hidden && document.querySelector("#busy").hidden; }).catch(() => fail("çizelgeden sonra en yeni görüntüye dönülmedi"));
    await page.click('#tl-span button[data-d="1826"]'); await tlWait(page); t = await tlState(page); console.log("çizelge (5 yıl): " + ids(t) + " | " + t.state);
    ok(t.n === 11 && ids(t) === "none none none none none none none none 20251110 20260511 20261109" && t.pressed === "false,false,true" && t.slots[0].label === "9 Kas 2021", "son 5 yıl: " + ids(t) + " " + t.slots[0].label);
    // alan değişince çizelge sıfırlanır
    await page.click("#sample"); await settled(page, true); t = await tlState(page); ok(t.n === 0 && !t.body && t.shown && t.pressed === "false,false,false" && t.state === "", "alan değişince çizelge sıfırlanmadı: " + JSON.stringify([t.n, t.body, t.pressed, t.state]));
    ok(!log.stray.length, "izin verilmeyen adrese istek: " + log.stray.join(", ")); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }
  // durdurma: ağ yavaşken "Durdur" kalan tarihleri bırakır; sonradan gelen yanıtlar ekranı değiştirmez
  { const { ctx, page, log } = await open({ lang: "tr", hash: "#ornek=1", slow: 250 }); await settled(page, true);
    await page.click('#tl-span button[data-d="365"]'); await wait(700); await page.click("#tl-stop"); let t = await tlState(page); const snap = ids(t);
    ok(!t.busy && !t.stop && /^Durduruldu\. \d+ açık görüntü · /.test(t.state) && t.slots.some((x) => x.state === "skip" && x.ph === "bakılmadı") && t.pressed === "true,false,false", "durdurma: " + snap + " | " + t.state);
    await wait(2500); t = await tlState(page); ok(ids(t) === snap && !t.busy, "durdurulduktan sonra çizelge değişti: " + snap + " -> " + ids(t)); ok(!log.errors.length, "konsol hataları: " + log.errors.join(" ; ")); await ctx.close(); }
  // telefon: sıra kendi içinde kayar, sayfa taşmaz; en yeni görüntü görünür
  for (const lang of ["tr", "en"]) { const { ctx, page, log } = await open({ lang, hash: "#ornek=1", viewport: { width: 390, height: 844 }, dsf: 2, mobile: true }); await settled(page, true);
    const o0 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(o0 <= 0, "telefonda paylaşım satırı taşıyor (" + lang + "): " + o0);
    await page.evaluate(() => document.querySelector("#tl").scrollIntoView()); await page.tap('#tl-span button[data-d="365"]'); await tlWait(page); await wait(300); const t = await tlState(page);
    ok(t.overflow <= 0 && t.scroll[1] > t.scroll[2] + 300 && t.scroll[0] + t.scroll[2] >= t.scroll[1] - 2, "telefonda çizelge (" + lang + "): taşma " + t.overflow + ", kaydırma " + t.scroll.join("/")); ok(!log.errors.length, "konsol: " + log.errors.join(";"));
    await shot(page, "8f-telefon-" + lang); await page.evaluate(() => document.querySelector("#share").scrollIntoView({ block: "center" })); await shot(page, "8f-telefon-" + lang + "-paylas"); await ctx.close(); }
  console.log("çizelge: son bir yıl, mevsim ve bulut, aralığa yakından bakış, küçük görüntüden açış, durdurma, İngilizce, son 5 yıl, telefon tamam");

  await browser.close(); srv.close();
  console.log(bad.length ? "\nOrbit denemesi TUTMADI: " + bad.length + " sorun\n- " + bad.join("\n- ") : "\nOrbit denemesi tamam (koordinat, dosya ve konumla alan, akış, hizalama, iki dil, yedek yollar, masaüstü, telefon, sayaç, paylaşım bağlantısı, indirilen görsel, çizelge)");
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
