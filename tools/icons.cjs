// Logo ve simge PNG'leri: assets/ altındaki SVG'lerden üretilir.
// Kullanım: node tools/icons.cjs   (önce: python3 tools/logo.py)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const A = path.join(__dirname, "..", "assets");
const svg = (n) => fs.readFileSync(path.join(A, n), "utf8");
const page = (inner, bg) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${bg || "transparent"}}body{display:flex;align-items:center;justify-content:center}svg{display:block}</style>${inner}`;
const sized = (s, w) => s.replace("<svg ", `<svg width="${w}" `);

(async () => {
  const b = await chromium.launch();
  const shot = async (html, w, h, out, transparent) => {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
    await p.setContent(html); await p.screenshot({ path: path.join(A, out), omitBackground: !!transparent }); await p.context().close();
  };
  const ratio = (s) => { const v = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return +v[2] / +v[1]; };
  // site simgeleri
  await shot(page(sized(svg("kose-capital-mark-light.svg"), 118), "#070B09"), 180, 180, "apple-touch-icon.png");
  await shot(page(sized(svg("kose-capital-stacked-light.svg"), 640), "#070B09"), 1200, 630, "og.png");
  // logo dosyaları (saydam zemin)
  fs.mkdirSync(path.join(A, "png"), { recursive: true });
  for (const [name, w] of [["horizontal", 2400], ["stacked", 2000], ["mark", 1200]]) for (const tone of ["", "-light"]) {
    const s = svg(`kose-capital-${name}${tone}.svg`), h = Math.round(w * ratio(s));
    await shot(page(sized(s, w)), w, h, `png/kose-capital-${name}${tone}.png`, true);
  }
  await b.close(); console.log("simgeler ve logo PNG'leri hazır");
})();
