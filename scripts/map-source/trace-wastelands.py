"""Trace the impassable terrain (wastelands) of the published map from Natural Earth physical regions.

    pip install pyshp shapely
    python scripts/map-source/trace-wastelands.py ~/.cache/council-terrain   # writes scripts/map-source/wastelands.json

The data directory holds two public-domain Natural Earth downloads, unzipped into folders of the same name:
  https://naciscdn.org/naturalearth/10m/physical/ne_10m_geography_regions_polys.zip
  https://naciscdn.org/naturalearth/50m/physical/ne_50m_rivers_lake_centerlines.zip

Each wasteland is a named Natural Earth region (the Sahara, the Alps, the Himalayas and Karakoram, the Rocky
Mountains, the Urals, the Gobi, the Rub' al Khali, the Western Desert of Australia) projected to map units
(x = (lon + 180) * 3.5 + 10, y = (83 - lat) * 4.6 + 10). A few authored edits keep the v7 adjacency exactly:
- the Alps reach the sea at Menton and leave a gap in the Rhine valley (Southern France still borders the Danube);
- the Himalayas cover the whole India-Tibet border and leave the Wakhan open (Afghanistan still borders Tibet);
- the Urals run from the Kara Sea to the Kazakh steppe, and the Russian land west of them joins Moscow;
- the Sahara leaves the Nile valley and delta to Egypt and an Atlantic coastal road between the Maghreb and West
  Africa, reaches the sea on the Libyan coast (so the Maghreb and the Sahel stay apart) and stops at the Sudanese Sahel.
Where a region meets the coast it is carried a little out to sea, so its edge never runs along a coastline.
Greenland's ice cap (the island less a coastal rim) and the Karakum (an authored outline) have no Natural Earth region.
scripts/build-imperial-v6.js cuts these polygons out of the provinces; this script only writes source data.
"""
import json, re, sys
from pathlib import Path

import shapefile
from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points, transform, unary_union

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/council-terrain').expanduser()
SOURCE = json.loads((ROOT / 'scripts/map-source/imperial-v5-provinces.json').read_text())
OUT = ROOT / 'scripts/map-source/wastelands.json'

def rings(path):
    return [[tuple(map(float, xy.split(','))) for xy in r[1:-1].split('L')] for r in re.findall(r'M[^MZ]+Z', path)]

def area_of(path):
    g = None
    for r in rings(path):
        p = make_valid(Polygon(r))
        g = p if g is None else g.symmetric_difference(p)
    return make_valid(g)

def project(g):
    return transform(lambda x, y, z=None: ((x + 180) * 3.5 + 10, (83 - y) * 4.6 + 10), g)

members = {p['id']: area_of(p['path']) for p in SOURCE['provinces']}
build = (ROOT / 'scripts/build-imperial-v6.js').read_text()
group = {}
for m in re.finditer(r"\['([a-z-]+)', '[^']+', '[a-z-]+', \[([^\]]+)\]\]", build):
    for member in re.findall(r"'([a-z-]+)'", m.group(2)): group[member] = m.group(1)
land = unary_union(list(members.values()))
provinces = {}
for member, g in members.items(): provinces.setdefault(group[member], []).append(g)
provinces = {k: unary_union(v) for k, v in provinces.items()}

def border(a, b):
    return provinces[a].boundary.intersection(provinces[b].buffer(.08))

regions = shapefile.Reader(str(DATA / 'ne_10m_geography_regions_polys/ne_10m_geography_regions_polys.shp'), encoding='utf-8', encodingErrors='replace')
named = {}
for record, s in zip(regions.records(), regions.shapes()):
    named.setdefault(record.as_dict()['NAME'].upper(), []).append(make_valid(shape(s.__geo_interface__)))
region = lambda *names: project(unary_union([g for n in names for g in named[n]]))
rivers = shapefile.Reader(str(DATA / 'rivers/ne_50m_rivers_lake_centerlines.shp'), encoding='utf-8', encodingErrors='replace')
nile = unary_union([project(shape(s.__geo_interface__)) for record, s in zip(rivers.records(), rivers.shapes()) if 'Nile' in (record.as_dict().get('name') or '')])

def out_to_sea(g, reach=4):
    """g plus the sea within `reach` of it, kept a unit clear of any land outside g."""
    others = land.difference(g)
    return unary_union([g, g.buffer(reach).difference(land).difference(others.buffer(1))]).buffer(.3).buffer(-.3)

shapes = {}
shapes['alps'] = unary_union([region('ALPS').buffer(.5), border('italy', 'south-france').buffer(1.4)]) \
    .difference(box(667, 168, 680, 175.6))  # the Rhine valley: Southern France keeps its border with the Danube
shapes['himalayas'] = unary_union([region('HIMALAYAS', 'KARAKORAM RA.').buffer(.6), border('india', 'tibet').buffer(2.2)]) \
    .difference(border('afghanistan', 'tibet').buffer(1.5))  # the Wakhan: Afghanistan keeps its border with Tibet
coast = land.boundary.intersection(box(850, 65, 885, 80))
north = nearest_points(coast, Point(873, 79))[0]
south = nearest_points(border('siberia', 'central-asia'), Point(840.5, 154.5))[0]
shapes['urals'] = unary_union([region('URAL MOUNTAINS').buffer(.5), LineString([(873, 79), (north.x, north.y)]).buffer(1.6),
                               LineString([(840.5, 154.5), (south.x, south.y + 1.5)]).buffer(1.8)])
atlantic_road = land.boundary.intersection(box(560, 245, 603, 330)).buffer(6).intersection(land)
nile_valley = unary_union([nile.buffer(2.6), Point(749.5, 252).buffer(6.5)])  # the valley, and the delta round Cairo
shapes['sahara'] = unary_union([
    region('SAHARA').buffer(.5),
    unary_union([members['sahara'], members['egypt']]).intersection(box(600, 236, 744, 262)),  # the Libyan coast
    border('maghreb', 'sahel').buffer(1.5),
]).difference(nile_valley).difference(atlantic_road).difference(box(700, 322, 800, 400))  # the Sudanese Sahel
shapes['rockies'] = region('ROCKY MOUNTAINS')
shapes['gobi'] = region('GOBI DESERT')
shapes['empty-quarter'] = region('RUB’ AL KHALI').buffer(.3)
shapes['outback'] = region('GREAT SANDY DESERT', 'GIBSON DESERT', 'GREAT VICTORIA DESERT').buffer(7).buffer(-6)  # one sweep of sand

def polygons(g, tolerance=.25, smallest=5):
    """Outer rings, simplified, on a 0.1 grid offset by 0.005: never on a source vertex (a 0.01 grid)."""
    parts = [p for p in getattr(g, 'geoms', [g]) if p.area >= smallest]
    out = []
    for p in sorted(parts, key=lambda p: -p.area):
        ring = Polygon(p.exterior).simplify(tolerance, preserve_topology=True).exterior.coords[:-1]
        out.append([[round(round(x, 1) + .005, 3), round(round(y, 1) + .005, 3)] for x, y in ring])
    return out

# The Russian land west of the Urals joins Moscow: every piece of the v5 `urals` member left west of the range.
urals = out_to_sea(shapes['urals'])
west = [p for p in members['urals'].difference(urals).geoms if p.centroid.x < 858 and p.area < 3000]
# Greenland's ice: the island (not Iceland) at least 3.5 units from its coast. The Karakum: an authored outline.
greenland = max(members['scandinavia'].intersection(box(400, 5, 610, 125)).geoms, key=lambda p: p.area)
shapes['greenland'] = greenland.buffer(-3.5)
shapes['karakum'] = members['central-asia'].buffer(-2.5).intersection(Polygon([(828, 195), (851, 193), (866, 197), (876, 206), (872, 222), (850, 226), (832, 218)]))
names = {'alps': ('Alps', 'mountains'), 'himalayas': ('Himalayas', 'mountains'), 'urals': ('Urals', 'mountains'),
         'rockies': ('Rocky Mountains', 'mountains'), 'sahara': ('Sahara', 'desert'), 'empty-quarter': ('Empty Quarter', 'desert'),
         'gobi': ('Gobi', 'desert'), 'outback': ('Western Desert', 'desert'), 'karakum': ('Karakum', 'desert'),
         'greenland': ('Greenland Ice Cap', 'ice')}
out = {'note': 'Generated by scripts/map-source/trace-wastelands.py from Natural Earth physical regions (public domain). Map units.',
       'wastelands': [], 'reassign': [{'member': 'urals', 'province': 'west-russia', 'polygons': polygons(unary_union(west).buffer(1.2), .4, 1)}]}
for id, (name, kind) in names.items():
    inland = id in ('greenland', 'karakum')  # holes well inside their province
    out['wastelands'].append({'id': id, 'name': name, 'terrain': kind, 'polygons': polygons(shapes[id] if inland else out_to_sea(shapes[id]))})
OUT.write_text(json.dumps(out, separators=(',', ':')) + '\n')
print(f'wrote {OUT.relative_to(ROOT)}: ' + ', '.join(f"{w['id']} {sum(len(p) for p in w['polygons'])} points" for w in out['wastelands']))
