"""One-time authoring tool. Runtime uses the committed map, never Python.
Usage: python scripts/build_map.py /path/to/naturalearth_lowres.shp
Requires geopandas and shapely. Coastlines: Natural Earth, public domain.
Provinces are fictional nearest-seed partitions, NOT historical borders.
"""
import json
import sys
from pathlib import Path
import geopandas as gpd
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union

# id, label, longitude, latitude. IDs are part of the public API.
SEEDS = [
('alaska','Alaska',-150,63),('west-canada','Western Canada',-120,57),('east-canada','Eastern Canada',-80,54),
('west-us','Pacific States',-120,39),('central-us','Great Plains',-101,39),('east-us','Atlantic States',-80,37),
('mexico','Mexico',-104,24),('central-america','Central America',-87,14),('caribbean','Caribbean',-72,20),
('andes','Andes',-75,-12),('amazonia','Amazonia',-63,-5),('brazil','Brazil',-45,-15),('patagonia','Patagonia',-66,-40),
('scotland','Scotland',-4,57),('ireland','Ireland',-8,53),('england','England',-1,52),
('iberia','Iberia',-5,40),('north-france','Northern France',1,49),('south-france','Southern France',1,44),('alpine-france','Alpine France',6,45),
('low-countries','Low Countries',5,52),('rhineland','Rhineland',7,50),('prussia','Prussia',14,53),('bavaria','Bavaria',12,48),
('italy','Italy',13,42),('scandinavia','Scandinavia',17,63),('balkans','Balkans',23,44),('ukraine','Ukraine',32,49),
('maghreb','Maghreb',2,32),('egypt','Egypt',30,28),('west-africa','West Africa',-10,10),('sahara','Sahara',6,23),
('sahel','Sahel',15,12),('congo','Congo',24,-3),('east-africa','East Africa',39,6),('angola','Angola',18,-17),
('south-africa','Southern Africa',26,-29),('madagascar','Madagascar',47,-20),
('west-russia','Western Russia',42,58),('urals','Urals',65,60),('siberia','Siberia',98,62),('far-east','Russian Far East',145,61),
('anatolia','Anatolia',34,40),('levant','Levant',36,33),('mesopotamia','Mesopotamia',45,34),('arabia','Arabia',45,22),
('persia','Persia',55,32),('central-asia','Central Asia',67,45),('afghanistan','Afghanistan',68,33),
('north-india','Northern India',78,26),('south-india','Southern India',78,14),
('manchuria','Manchuria',127,46),('north-china','Northern China',115,37),('south-china','Southern China',113,25),
('tibet','Tibet',89,32),('mongolia','Mongolia',103,46),('korea','Korea',128,38),('north-japan','Northern Japan',141,42),('south-japan','Southern Japan',135,34),
('indochina','Indochina',102,17),('east-indies','East Indies',118,-4),('philippines','Philippines',123,12),
('australia','Australia',134,-25),('new-zealand','New Zealand',173,-41)]
COUNTRIES = [
('britain','British Empire','#bc6b52',['scotland','ireland','england']),
('france','French Republic','#668dac',['north-france','south-france','alpine-france']),
('germany','German Empire','#8e8b7d',['rhineland','prussia','bavaria']),
('russia','Russian Empire','#859361',['west-russia','urals','siberia']),
('ottoman','Ottoman Empire','#c49a53',['anatolia','levant','mesopotamia']),
('qing','Qing Empire','#ba9c65',['manchuria','north-china','south-china']),
('japan','Empire of Japan','#ab7890',['north-japan','south-japan','korea']),
('usa','United States','#6d9f96',['west-us','central-us','east-us'])]
SEA = [('ireland','england'),('ireland','north-france'),('england','north-france'),('england','low-countries'),
('scotland','scandinavia'),('scotland','east-canada'),('east-us','england'),('east-us','caribbean'),('caribbean','central-america'),('caribbean','brazil'),
('iberia','maghreb'),('italy','maghreb'),('italy','egypt'),('balkans','anatolia'),('south-japan','korea'),('north-japan','far-east'),
('south-japan','philippines'),('south-china','philippines'),('indochina','east-indies'),('east-indies','australia'),
('east-indies','philippines'),('australia','new-zealand'),('east-africa','madagascar'),('south-africa','madagascar'),
('west-us','south-japan'),('alaska','far-east'),('brazil','west-africa')]

def project(x,y): return ((x+180)*3.5+10, (83-y)*4.6+10)

def path(g):
    parts = list(g.geoms) if hasattr(g,'geoms') else [g]
    paths=[]
    for p in parts:
        if p.geom_type != 'Polygon' or p.area < .09: continue
        for ring in [p.exterior, *p.interiors]:
            pts=[project(x,y) for x,y in ring.coords]
            paths.append('M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in pts)+'Z')
    return ''.join(paths)

land = gpd.read_file(sys.argv[1])
land = unary_union([g for name,g in zip(land['name'],land.geometry) if name!='Antarctica']).intersection(box(-180,-60,180,83)).simplify(.18,preserve_topology=True)
regions=[]
for id,name,x,y in SEEDS:
    cell=box(-180,-60,180,83)
    # Intersect the nearer half-plane for each other seed.
    for _,_,xx,yy in SEEDS:
        if x==xx and y==yy: continue
        dx,dy=xx-x,yy-y; length=(dx*dx+dy*dy)**.5; dx/=length;dy/=length
        mx,my=(x+xx)/2,(y+yy)/2; tx,ty=-dy*1000,dx*1000
        hp=Polygon([(mx+tx,my+ty),(mx-tx,my-ty),(mx-tx-dx*2000,my-ty-dy*2000),(mx+tx-dx*2000,my+ty-dy*2000)])
        cell=cell.intersection(hp)
    geom=cell.intersection(land)
    assert not geom.is_empty,id
    # Name anchors matter more than a distant island's area (e.g. Greenland).
    parts=list(geom.geoms) if hasattr(geom,'geoms') else [geom]
    local=min(parts,key=lambda p:p.distance(Point(x,y)))
    marker=local.representative_point(); px,py=project(marker.x,marker.y)
    regions.append({'id':id,'name':name,'x':round(px,1),'y':round(py,1),'path':path(geom),'geom':geom,'neighbors':[]})
edges={}
def connect(a,b,sea):
    key=tuple(sorted([a,b])); edges[key]={'from':key[0],'to':key[1],'sea':sea}
for i,a in enumerate(regions):
    for b in regions[i+1:]:
        if a['geom'].buffer(.025).intersection(b['geom']).length > .15:
            connect(a['id'],b['id'],False)
for a,b in SEA: connect(a,b,True)
for a,b in edges:
    next(r for r in regions if r['id']==a)['neighbors'].append(b)
    next(r for r in regions if r['id']==b)['neighbors'].append(a)
seen={regions[0]['id']}
while True:
    more=seen|{n for r in regions if r['id'] in seen for n in r['neighbors']}
    if more==seen: break
    seen=more
assert len(regions)==64
assert len(seen)==64, set(r['id'] for r in regions)-seen
for r in regions: del r['geom']; r['neighbors'].sort()
result={'name':'The World, Reimagined · 1910','width':1280,'height':680,'notice':'Real coastlines; fictional province borders and equalized starting holdings. Not a historical political map.',
 'source':'Natural Earth public-domain coastlines; Council of Iron authored partitions and connections.',
 'countries':[{'id':i,'name':n,'color':c,'start':s} for i,n,c,s in COUNTRIES], 'provinces':regions,'edges':list(edges.values())}
Path('public/map.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
print('Built',len(regions),'provinces,',len(edges),'edges; connected; bytes',Path('public/map.json').stat().st_size)
