"""Paint the impassable-terrain textures (public/terrain/<id>.webp) from real elevation data.

    pip install numpy scipy pillow tifffile imagecodecs
    python scripts/map-source/terrain-textures.py ~/.cache/council-terrain

The data directory holds NOAA ETOPO 2022 (60 arc-second surface elevation; free to use except for navigation):
  https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif
saved as etopo60.tif. `dunes-tile.webp` beside this script is a seamless sand-sea tile (AI-generated for this game).

Each texture covers its wasteland's bounding box in public/imperial-map.json, grown by MARGIN units and rounded out
to whole units (`terrainBox` in public/atlas.js places it the same way), at PX pixels per map unit. The relief is
the real terrain under the shape: hill shading lit from the north-west over an elevation ramp in the map's muted
palette, snow above each range's snow line, and on sand the dune tile where the ground is flat. Run it again after
the map's terrain changes (tests/map-geometry.test.js checks the image sizes against the map).
"""
import json, re, sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/council-terrain').expanduser()
MAP = json.loads((ROOT / 'public/imperial-map.json').read_text())
OUT = ROOT / 'public/terrain'
PX, MARGIN = 8, 2

dem = tifffile.imread(DATA / 'etopo60.tif')  # 60 cells per degree from (-180, 90)
dunes = np.asarray(Image.open(ROOT / 'scripts/map-source/dunes-tile.webp').convert('L'), dtype=np.float32) / 255
dunes = (dunes - dunes.mean()) / dunes.std()

def hexes(stops):
    return [(e, np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255) for e, c in stops]

# Elevation ramps (metres → colour). Mountains: olive foothills to grey rock. Sand: pale erg to dark massif.
ROCK = hexes([(0, '#5b5040'), (1000, '#675a47'), (2500, '#736551'), (4000, '#7a6d5b'), (6000, '#857a6c')])
SAND = hexes([(0, '#dcc38e'), (500, '#d5b77e'), (1100, '#c3a06a'), (1800, '#a07e56'), (2800, '#86694c')])
RED = hexes([(0, '#dcb07a'), (400, '#d29d68'), (900, '#b68459')])
STEPPE = hexes([(0, '#cdbb8f'), (1000, '#c4ae80'), (1800, '#a99270'), (2600, '#8e7a60')])
ICE = hexes([(0, '#c9d8dc'), (1200, '#dbe6e8'), (2600, '#eef3f3'), (3300, '#f6f8f7')])
SNOW = np.array([0.94, 0.95, 0.93], np.float32)
STYLE = {  # ramp, vertical exaggeration, snow line (m), dune strength, shading contrast
    'alps': (ROCK, 14, 2800, 0, .9), 'himalayas': (ROCK, 6, 6000, 0, .9), 'rockies': (ROCK, 11, 3500, 0, .9), 'urals': (ROCK, 26, None, 0, .9),
    'sahara': (SAND, 30, None, .5, .62), 'empty-quarter': (SAND, 30, None, .6, .62), 'karakum': (SAND, 30, None, .5, .62),
    'outback': (RED, 40, None, .45, .62), 'gobi': (STEPPE, 26, None, .18, .62), 'greenland': (ICE, 60, None, 0, .62),
}

def ramp(e, stops):
    out = np.empty(e.shape + (3,), np.float32)
    levels = np.array([s[0] for s in stops], np.float32)
    for c in range(3): out[..., c] = np.interp(e, levels, [s[1][c] for s in stops])
    return out

def shade(e, dx, dy, z):
    """Lambertian hill shading, light from the north-west at 45°; 1 on flat ground."""
    gy, gx = np.gradient(e * z, dy, axis=0), np.gradient(e * z, axis=1) / dx[:, None]
    light = np.array([-1, -1, 1.4142]) / 2  # west, north (rows grow southward), up
    n = np.sqrt(gx ** 2 + gy ** 2 + 1)
    lit = (-gx * light[0] - gy * light[1] + light[2]) / n
    return lit / light[2], np.sqrt(gx ** 2 + gy ** 2) / z

def ring_points(path):
    return np.array([[float(v) for v in xy.split(',')] for r in re.findall(r'M([^MZ]+)Z', path) for xy in r.split('L')])

OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(1910)
for t in MAP['terrain']:
    pts = ring_points(t['path'])
    x0, y0 = int(np.floor(pts[:, 0].min())) - MARGIN, int(np.floor(pts[:, 1].min())) - MARGIN
    x1, y1 = int(np.ceil(pts[:, 0].max())) + MARGIN, int(np.ceil(pts[:, 1].max())) + MARGIN
    w, h = (x1 - x0) * PX, (y1 - y0) * PX
    xs, ys = x0 + (np.arange(w) + .5) / PX, y0 + (np.arange(h) + .5) / PX
    lon, lat = (xs - 10) / 3.5 - 180, 83 - (ys - 10) / 4.6
    rows, cols = np.meshgrid((90 - lat) * 60 - .5, (lon + 180) * 60 - .5, indexing='ij')
    e = np.maximum(map_coordinates(dem, [rows, cols], order=1, mode='nearest'), 0).astype(np.float32)
    stops, z, snowline, dune, contrast = STYLE[t['id']]
    dx = 111320 * np.cos(np.radians(lat)) / (3.5 * PX)  # metres per pixel, per row
    dy = 111320 / (4.6 * PX)
    fine, slope = shade(gaussian_filter(e, .7), dx, dy, z)
    broad, _ = shade(gaussian_filter(e, 6), dx, dy, z * 2.5)
    light = np.clip(.55 * fine + .45 * broad, .25, 1.3)
    colour = ramp(gaussian_filter(e, 2), stops)
    if snowline:  # snow above the line, thinner on steep faces
        s = np.clip((e - snowline) / 700, 0, 1) * np.clip(1.2 - slope * 1.6, 0, 1)
        colour = colour * (1 - s[..., None]) + SNOW * s[..., None]
    if dune:  # dune seas (ergs) where the ground is flat, patchy like the real ones, fading out on slopes and massifs
        def tile(size, flip):
            step = PX * size / dunes.shape[0]
            ty = (np.arange(h)[:, None] / step).astype(int) % dunes.shape[0]
            tx = (np.arange(w)[None, :] / step).astype(int) % dunes.shape[1]
            return dunes[tx, ty] if flip else dunes[ty, tx]
        erg = gaussian_filter(rng.normal(0, 1, (h, w)).astype(np.float32), PX * 9)
        erg = np.clip(.5 + erg / (erg.std() * 2.2), 0, 1)
        pattern = .6 * tile(61, False) + .4 * tile(37, True)
        flat = np.exp(-slope * 25) * np.clip(1.4 - e / 1000, 0, 1)
        colour = colour * (1 + dune * .2 * pattern * flat * erg)[..., None]
        colour = colour * (.95 + .08 * erg)[..., None]  # ergs a little paler than the gravel plains between them
    colour = colour * ((1 - contrast * .6) + contrast * light[..., None])
    colour = colour * (1 + rng.normal(0, .025, (h, w)).astype(np.float32))[..., None]  # paper grain
    img = Image.fromarray((np.clip(colour, 0, 1) * 255 + .5).astype(np.uint8))
    img.save(OUT / f"{t['id']}.webp", quality=80, method=6)
    print(f"{t['id']}: {w}x{h} px at ({x0}, {y0}), {(OUT / (t['id'] + '.webp')).stat().st_size // 1024} KiB")
