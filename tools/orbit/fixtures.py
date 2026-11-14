"""Orbit sayfa denemesi için sahte Sentinel-2 dosyaları üretir: tools/orbit/fx/ (depoya girmez).
Kullanım: python3 tools/orbit/fixtures.py   (pip: rasterio numpy pyproj)
 Koordinat düzeni gerçek karelerle aynıdır
(35SQB: EPSG:32635, köşe 699960/4200000; 36STG: EPSG:32636, köşe 199980/4200000; 10980x10980, 10 m).
Örnek alanın (tools/orbit/sample.json) içine düşen pikseller ayrı renkte boyanır; böylece sayfadaki sınır çizgisinin doğru yere
oturup oturmadığı ekran görüntüsünden ve piksel sayımından denetlenir."""
import json, os, sys, numpy as np, rasterio
from rasterio.transform import Affine
from rasterio.windows import Window
from rasterio.features import rasterize
from rasterio.shutil import copy as rio_copy
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "fx")
TILES = {"35SQB": (32635, 699960.0, 4200000.0), "36STG": (32636, 199980.0, 4200000.0)}
parcel = json.load(open(os.path.join(HERE, "sample.json"), encoding="utf-8"))      # örnek alan: kendi çizdiğimiz çokgen
ring = parcel["geometry"]["coordinates"][0]
lon0 = (min(c[0] for c in ring) + max(c[0] for c in ring)) / 2
lat0 = (min(c[1] for c in ring) + max(c[1] for c in ring)) / 2

def region(tile, res, half_m=1500):
    epsg, ox, oy = TILES[tile]
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    cx, cy = tr.transform(lon0, lat0)
    col0 = int((cx - half_m - ox) // res); row0 = int((oy - (cy + half_m)) // res)
    n = int(2 * half_m / res)
    T = Affine(res, 0, ox + col0 * res, 0, -res, oy - row0 * res)       # pencerenin kendi dönüşümü
    poly = {"type": "Polygon", "coordinates": [[tr.transform(x, y) for x, y in ring]]}
    inside = rasterize([(poly, 1)], out_shape=(n, n), transform=T, fill=0, dtype="uint8").astype(bool)   # piksel merkezi kuralı
    # yön işareti: alanın merkezinin 150 m kuzeyi ve 150 m doğusunda 40x40 m beyaz kare
    yy, xx = np.mgrid[0:n, 0:n]
    px = T.c + (xx + 0.5) * res; py = T.f - (yy + 0.5) * res
    # kareyi gerçek kuzey/doğuya göre yerleştir (UTM ızgarası birkaç derece döner): işaretin merkezi enlem-boylamdan hesaplanır
    mlon = lon0 + 150 / (111320 * np.cos(np.radians(lat0))); mlat = lat0 + 150 / 110950
    mx, my = tr.transform(mlon, mlat)
    marker = (np.abs(px - mx) <= 20) & (np.abs(py - my) <= 20)
    return epsg, ox, oy, col0, row0, n, inside, marker, xx, yy

def write(tile, name, res, dtype, bands, paint):
    epsg, ox, oy, col0, row0, n, inside, marker, xx, yy = region(tile, res)
    size = int(109800 / res)
    tmp = os.path.join(OUT, "_tmp.tif"); dst = os.path.join(OUT, name)
    prof = dict(driver="GTiff", width=size, height=size, count=bands, dtype=dtype, crs=f"EPSG:{epsg}", transform=Affine(res, 0, ox, 0, -res, oy),
                tiled=True, blockxsize=1024, blockysize=1024, compress="deflate", nodata=0, sparse_ok=True)
    with rasterio.open(tmp, "w", **prof) as ds:
        arr = paint(n, inside, marker, xx, yy)
        ds.write(arr.astype(dtype), window=Window(col0, row0, n, n))
    rio_copy(tmp, dst, driver="COG", compress="DEFLATE", predictor="YES", blocksize=1024, overview_resampling="nearest")
    os.remove(tmp)
    print(name, os.path.getsize(dst) // 1024, "KB", "inside px:", int(inside.sum()))

def fields(n, xx, yy, seed):
    """80 m'lik tarlalardan oluşan zemin."""
    rng = np.random.default_rng(seed); k = 8
    pal = np.array([[92, 120, 70], [120, 104, 78], [78, 104, 62], [140, 122, 92], [104, 112, 84]], dtype=np.uint8)
    idx = rng.integers(0, len(pal), size=(n // k + 2, n // k + 2))
    base = pal[idx[yy // k, xx // k]]
    return np.moveaxis(base, -1, 0).copy()

def tci(kind, seed):
    def paint(n, inside, marker, xx, yy):
        a = fields(n, xx, yy, seed)
        col = (60, 160, 60) if kind == "before" else (190, 160, 120)       # önce: yeşil tarla, sonra: açılmış toprak
        for b in range(3): a[b][inside] = col[b]; a[b][marker] = 250
        return a
    return paint
def refl(kind, band):
    def paint(n, inside, marker, xx, yy):
        veg = {"red": 0.05, "nir": 0.45}; soil = {"red": 0.25, "nir": 0.30}; bg = {"red": 0.15, "nir": 0.25}
        v = np.full((n, n), bg[band]); v[inside] = (veg if kind == "before" else soil)[band]
        return np.round((v + 0.1) / 0.0001)[None]                           # DN = (yansıtma + 0,1) / 0,0001
    return paint
def scl(value):
    def paint(n, inside, marker, xx, yy): return np.full((1, n, n), value)
    return paint

os.makedirs(OUT, exist_ok=True)
for tile, kind, seed in [("36STG", "after", 1), ("35SQB", "after", 2), ("35SQB", "before", 3)]:
    tag = f"{tile}_{kind}"
    write(tile, f"{tag}_TCI.tif", 10, "uint8", 3, tci(kind, seed))
    write(tile, f"{tag}_B04.tif", 10, "uint16", 1, refl(kind, "red"))
    write(tile, f"{tag}_B08.tif", 10, "uint16", 1, refl(kind, "nir"))
    write(tile, f"{tag}_SCL.tif", 20, "uint8", 1, scl(4))
for tile in ("35SQB", "36STG"):
    write(tile, f"{tile}_cloud_SCL.tif", 20, "uint8", 1, scl(9))
write("35SQB", "35SQB_nodata_SCL.tif", 20, "uint8", 1, scl(0))
# kısmen bulutlu: alanın çevresinin yaklaşık üçte biri bulut
def part(n, inside, marker, xx, yy):
    a = np.full((1, n, n), 4); a[0][:, : n // 2 - 1] = 8; return a
write("36STG", "36STG_partly_SCL.tif", 20, "uint8", 1, part)

# gerçek dosya bant bant yazılmış olabilir: aynı içerik INTERLEAVE=BAND ile
def bandil(src, dst):
    with rasterio.open(os.path.join(OUT, src)) as a:
        prof = a.profile.copy(); prof.update(driver="GTiff", interleave="band", tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=2, sparse_ok=True)
        with rasterio.open(os.path.join(OUT, dst), "w", **prof) as b:
            for _, w in a.block_windows(1):
                d = a.read(window=w)
                if d.any(): b.write(d, window=w)
    print(dst, os.path.getsize(os.path.join(OUT, dst)) // 1024, "KB")
bandil("36STG_after_TCI.tif", "36STG_after_TCI_band.tif")

# koordinat hesabının denetimi için pyproj ile üretilmiş noktalar: [boylam, enlem, dilim, doğu, kuzey]
import random
random.seed(7); ref = []
for zone in (35, 36, 37, 38):
    tr = Transformer.from_crs(4326, 32600 + zone, always_xy=True); cm = zone * 6 - 183
    for _ in range(250):
        lon = cm + random.uniform(-4.2, 4.2); lat = random.uniform(35.5, 42.5)
        e, n = tr.transform(lon, lat); ref.append([lon, lat, zone, e, n])
for zone in (35, 36):
    tr = Transformer.from_crs(4326, 32600 + zone, always_xy=True)
    for lon, lat in ring:
        e, n = tr.transform(lon, lat); ref.append([lon, lat, zone, e, n])
json.dump(ref, open(os.path.join(OUT, "utm_ref.json"), "w"))
print("utm_ref.json", len(ref), "nokta")
