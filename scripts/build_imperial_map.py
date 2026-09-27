"""Build the authored industrial scenario from the checked-in public-domain coastlines.
Development only: pip install shapely. Runtime reads imperial-map.json, not Python.
Borders, holdings, industry levels and sea links are gameplay abstractions, not a
complete or exact reconstruction of colonial governance in 1910.
"""
import json
import re
from pathlib import Path
from shapely.geometry import Polygon, Point, box
from shapely.ops import nearest_points

ROOT = Path(__file__).resolve().parents[1]
base = json.loads((ROOT / 'public/map.json').read_text())
def project(lon, lat): return ((lon + 180) * 3.5 + 10, (83 - lat) * 4.6 + 10)
def geometry(path):
    result = Polygon()
    for ring in re.findall(r'M([^Z]+)Z', path):
        points = [tuple(map(float, xy.split(','))) for xy in ring.split('L')]
        if len(points) >= 4:
            result = result.symmetric_difference(Polygon(points).buffer(0))
    return result

def paths(g):
    parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
    result = []
    for poly in parts:
        if poly.geom_type != 'Polygon' or poly.area < .04: continue
        for ring in [poly.exterior, *poly.interiors]:
            result.append('M' + 'L'.join(f'{x:.2f},{y:.2f}' for x, y in ring.coords) + 'Z')
    return ''.join(result)

# Preserve the old province ID for one child so existing example commands remain useful.
SPLITS = {
    'england': [('england','Southern England',-.3,51.4), ('midlands','Midlands',-1.8,53.2)],
    'north-france': [('north-france','Île-de-France',2.5,49), ('normandy','Normandy',-.6,49)],
    'south-france': [('south-france','Aquitaine',-.5,44.5), ('occitania','Occitania',2.8,43.6)],
    'rhineland': [('rhineland','Rhineland',7,49.5), ('ruhr','Ruhr',7.4,51.5)],
    'prussia': [('prussia','East Prussia',17.3,54), ('brandenburg','Brandenburg',13.3,52.2)],
    'bavaria': [('bavaria','Bavaria',11.4,48.3), ('saxony','Saxony',13.4,50.8)],
    'low-countries': [('low-countries','Netherlands',5,52.4), ('belgium','Belgium',4.4,50.8)],
    'italy': [('italy','Northern Italy',10,44.5), ('south-italy','Southern Italy',15.5,40.5)],
    'balkans': [('balkans','Danube',21,46), ('serbia','Serbia',21,43.8), ('bulgaria','Bulgaria',25.5,43)],
    'ukraine': [('ukraine','Ukraine',31.5,49), ('poland','Poland',25,52)],
    'west-russia': [('west-russia','Moscow',38.5,56), ('baltic','Baltic',31,61)],
    'anatolia': [('anatolia','Western Anatolia',30.5,40), ('east-anatolia','Eastern Anatolia',39,39)],
    'east-africa': [('east-africa','East Africa',40,8), ('tanganyika','Tanganyika',35,-6)],
    'south-africa': [('south-africa','South Africa',29,-29), ('namibia','South West Africa',17,-24)],
}
regions = []
for original in base['provinces']:
    shape = geometry(original['path'])
    seeds = SPLITS.get(original['id'])
    if not seeds:
        regions.append({**original, 'geom':shape, 'neighbors':[]}); continue
    for id, name, lon, lat in seeds:
        x, y = project(lon, lat); cell = box(-2000,-2000,4000,4000)
        for other, _, olon, olat in seeds:
            if other == id: continue
            xx, yy = project(olon, olat); dx, dy = xx-x, yy-y
            length = (dx*dx+dy*dy)**.5; dx/=length; dy/=length
            mx,my=(x+xx)/2,(y+yy)/2; tx,ty=-dy*10000,dx*10000
            cell=cell.intersection(Polygon([(mx+tx,my+ty),(mx-tx,my-ty),(mx-tx-dx*20000,my-ty-dy*20000),(mx+tx-dx*20000,my+ty-dy*20000)]))
        part = shape.intersection(cell).buffer(0)
        assert not part.is_empty, id
        seedpoint = Point(x,y)
        # Keep counters inside the nearest land fragment, not over remote islands.
        if not part.contains(seedpoint):
            parts=list(part.geoms) if hasattr(part,'geoms') else [part]
            seedpoint=min(parts,key=lambda p:p.distance(seedpoint)).representative_point()
        regions.append({'id':id,'name':name,'x':round(seedpoint.x,2),'y':round(seedpoint.y,2),
                        'path':paths(part),'geom':part,'neighbors':[]})
edges={}
def connect(a,b,sea=False):
    key=tuple(sorted([a,b])); edges[key]={'from':key[0],'to':key[1],'sea':sea}
for i,a in enumerate(regions):
    for b in regions[i+1:]:
        if a['geom'].buffer(.15).intersection(b['geom']).length > 1:
            connect(a['id'],b['id'])
for edge in base['edges']:
    if edge['sea']: connect(edge['from'],edge['to'],True)
# Long routes are not teleportation: their travel time follows their map distance.
for a,b in [('england','egypt'),('egypt','north-india'),('north-india','australia'),
            ('east-canada','ireland'),('rhineland','namibia'),('namibia','tanganyika'),
            ('north-france','maghreb'),('west-africa','madagascar'),('madagascar','indochina'),
            ('west-us','philippines'),('baltic','scandinavia')]:
    connect(a,b,True)
lookup={p['id']:p for p in regions}
for a,b in edges:
    lookup[a]['neighbors'].append(b); lookup[b]['neighbors'].append(a)
seen={regions[0]['id']}
while True:
    following=seen | {n for id in seen for n in lookup[id]['neighbors']}
    if seen==following: break
    seen=following
assert len(seen)==len(regions),set(lookup)-seen
for p in regions: del p['geom']; p['neighbors'].sort()

HOMES={
    'britain':['scotland','ireland','england','midlands'],
    'france':['north-france','normandy','south-france','occitania','alpine-france'],
    'germany':['rhineland','ruhr','prussia','brandenburg','bavaria','saxony'],
    'russia':['west-russia','baltic','urals','siberia','far-east','ukraine','poland','central-asia'],
    'ottoman':['anatolia','east-anatolia','levant','mesopotamia'],
    'qing':['manchuria','north-china','south-china','mongolia','tibet'],
    'japan':['north-japan','south-japan','korea'],
    'usa':['west-us','central-us','east-us','alaska'],
}
COLONIES={
    'britain':['east-canada','north-india','australia','south-africa','egypt'],
    'france':['maghreb','west-africa','indochina','madagascar'],
    'germany':['namibia','tanganyika'], 'usa':['philippines']
}
LEVELS={'britain':3,'france':3,'germany':2,'russia':1,'ottoman':1,'qing':1,'japan':2,'usa':3}
# Units and levels are visible, capturable scenario assets, never secret national multipliers.
SPECIAL={'germany':{'ruhr':3,'rhineland':3},'russia':{'west-russia':3,'baltic':2,'ukraine':2,'urals':2,'siberia':2,'poland':2},
         'france':{'alpine-france':2},
         'ottoman':{'anatolia':2,'mesopotamia':2},'usa':{'alaska':1}}
countries=[]
for c in base['countries']:
    id=c['id']; homes=HOMES[id]; colonies=COLONIES.get(id,[])
    development={p:LEVELS[id] for p in homes}; development.update({p:(2 if id=='britain' else 1) for p in colonies}); development.update(SPECIAL.get(id,{}))
    garrisons={p:(14 if id in ['britain','ottoman'] else 12) for p in homes}
    garrisons.update({p:(14 if id=='britain' else 7) for p in colonies})
    countries.append({**c,'start':homes+colonies,'homeland':homes,'colonies':colonies,'development':development,'garrisons':garrisons})
starts=[id for c in countries for id in c['start']]
assert len(starts)==len(set(starts))
result={**base,'id':'imperial-1910-v3','rulesVersion':3,'name':'Industry & Empire · 1910',
        'notice':'1910-inspired holdings and colonial footholds. Province borders, industry and military strength are authored game abstractions, not a historical census.',
        'countries':countries,'provinces':regions,'edges':list(edges.values())}
(ROOT/'public/imperial-map.json').write_text(json.dumps(result,separators=(',',':'),ensure_ascii=False)+'\n')
print(f'Built {len(regions)} provinces; {len(edges)} links; {len(starts)} occupied starting holdings.')
for c in countries: print(c['id'],len(c['start']),'holdings',sum(c['development'].values()),'production / 20s',sum(c['garrisons'].values()),'troops')
