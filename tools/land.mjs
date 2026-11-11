// Dünya karalarını 3 derecelik noktalara çevirir (Bazaar görseli için). Kaynak: Natural Earth (world-atlas).
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/home/claude/castle/pipeline/');
const topojson = require('topojson-client'), d3 = require('d3-geo');
const world = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const land = topojson.feature(world, world.objects.land);
const COLS = 120, LAT0 = 75, STEP = 3, ROWS = 45; const rows = [];
let n = 0;
for (let r = 0; r < ROWS; r++) { let bits = ''; const lat = LAT0 - r * STEP;
  for (let c = 0; c < COLS; c++) { const lon = -178.5 + c * STEP; const on = d3.geoContains(land, [lon, lat]); bits += on ? '1' : '0'; if (on) n++; }
  let hex = ''; for (let i = 0; i < COLS; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16); rows.push(hex); }
fs.writeFileSync('src/land.txt', rows.join(''));
console.log('kara noktası', n, '| karakter', rows.join('').length);
