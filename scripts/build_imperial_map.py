"""Build the authored industrial scenario from Natural Earth public-domain boundaries.
Development only: pip install geopandas shapely>=2.1
Usage: python scripts/build_imperial_map.py /path/to/ne_10m_admin_1_states_provinces.zip
Every Natural Earth state/province is assigned whole to one game province, so province
borders follow real administrative lines instead of straight cuts. Borders, holdings,
industry levels and sea links are gameplay abstractions, not a complete or exact
reconstruction of colonial governance in 1910.
"""
import json
import sys
from pathlib import Path
import geopandas as gpd
import shapely
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
base = json.loads((ROOT / 'public/map.json').read_text())
previous = {p['id']: p for p in json.loads((ROOT / 'public/imperial-map.json').read_text())['provinces']}
def project(lon, lat): return ((lon + 180) * 3.5 + 10, (83 - lat) * 4.6 + 10)
def unproject(x, y): return ((x - 10) / 3.5 - 180, 83 - (y - 10) / 4.6)

# id, label, longitude, latitude. IDs are part of the public API.
SEEDS = [
('alaska','Alaska',-150,63),('west-canada','Western Canada',-115,57),('east-canada','Eastern Canada',-78,52),
('west-us','Pacific States',-118,40),('central-us','Great Plains',-99,40),('east-us','Atlantic States',-80,37),
('mexico','Mexico',-104,24),('central-america','Central America',-87,14),('caribbean','Caribbean',-72,8),
('andes','Andes',-75,-12),('amazonia','Amazonia',-60,-5),('brazil','Brazil',-45,-15),('patagonia','Patagonia',-66,-40),
('scotland','Scotland',-4,57),('ireland','Ireland',-8,53),('england','Southern England',-1.2,50.2),('midlands','Midlands',-1.8,53),
('iberia','Iberia',-4,40),('north-france','Île-de-France',2.5,49),('normandy','Normandy',-.6,48.5),
('south-france','Aquitaine',-.5,44.5),('occitania','Occitania',2.8,43.6),('alpine-france','Alpine France',6,45.5),
('low-countries','Netherlands',5.5,52.4),('belgium','Belgium',4.6,50.6),('rhineland','Rhineland',7.5,49.6),('ruhr','Ruhr',7.6,51.6),
('prussia','East Prussia',19,54),('brandenburg','Brandenburg',13.3,52.6),('bavaria','Bavaria',11.4,48.5),('saxony','Saxony',14,51),
('italy','Northern Italy',10,44.8),('south-italy','Southern Italy',15.5,40.5),('scandinavia','Scandinavia',15,62),
('balkans','Danube',18,47.5),('serbia','Serbia',20,43.5),('bulgaria','Bulgaria',25.5,42),
('ukraine','Ukraine',32,48.5),('poland','Poland',24,53),
('maghreb','Maghreb',2,33),('egypt','Egypt',30,24),('west-africa','West Africa',-8,12),('sahara','Sahara',8,22),
('sahel','Sahel',13,11),('congo','Congo',21,-2),('east-africa','East Africa',40,7),('tanganyika','Tanganyika',35,-6),
('angola','Angola',19,-13),('south-africa','South Africa',27,-28),('namibia','South West Africa',18,-22),('madagascar','Madagascar',47,-19),
('west-russia','Moscow',40,55),('baltic','Baltic',30,62),('urals','Urals',62,58),('siberia','Siberia',98,62),('far-east','Russian Far East',145,61),
('anatolia','Western Anatolia',30.5,39.5),('east-anatolia','Eastern Anatolia',41,39.5),('levant','Levant',37,33),('mesopotamia','Mesopotamia',44,33),
('arabia','Arabia',45,22),('persia','Persia',54,32),('central-asia','Central Asia',66,44),('afghanistan','Afghanistan',67,31),
('north-india','Northern India',80,26),('south-india','Southern India',78,14),
('manchuria','Manchuria',126,46),('north-china','Northern China',114,36),('south-china','Southern China',112,26),
('tibet','Tibet',88,35),('mongolia','Mongolia',103,46),('korea','Korea',127.5,37.5),('north-japan','Northern Japan',141,40),('south-japan','Southern Japan',133,34),
('indochina','Indochina',101,17),('east-indies','East Indies',115,-2),('philippines','Philippines',122,12),
('australia','Australia',134,-25),('new-zealand','New Zealand',173,-41)]
seeds = {id: (lon, lat) for id, _, lon, lat in SEEDS}
names = {id: name for id, name, _, _ in SEEDS}

# Natural Earth adm0_a3 -> candidate game provinces; each state goes to its nearest candidate seed.
COUNTRY = {
 'CAN':'west-canada east-canada', 'SPM':'east-canada', 'USA':'alaska west-us central-us east-us',
 'MEX':'mexico', 'GTM BLZ SLV HND NIC CRI PAN':'central-america',
 'CUB HTI DOM JAM PRI BHS TCA CYM VGB VIR AIA ATG KNA DMA LCA VCT GRD BRB TTO ABW CUW SXM MAF BLM MSR BMU COL VEN GUY SUR':'caribbean',
 'ECU PER BOL':'andes', 'CHL':'andes patagonia', 'ARG FLK':'patagonia', 'BRA':'amazonia brazil', 'PRY URY':'brazil',
 'IRL':'ireland', 'IMN WLS':'midlands', 'SCT':'scotland', 'NIR':'ireland', 'ENG':'england midlands', 'GGY JEY':'normandy',
 'ESP PRT AND GIB':'iberia', 'FRA':'north-france normandy south-france occitania alpine-france', 'MCO':'alpine-france',
 'CHE LIE':'alpine-france', 'NLD':'low-countries', 'BEL LUX':'belgium',
 'DEU':'rhineland ruhr prussia brandenburg bavaria saxony', 'POL':'poland',
 'ITA':'italy south-italy', 'SMR':'italy', 'VAT MLT':'south-italy',
 'NOR SWE DNK ISL GRL FRO':'scandinavia', 'FIN EST LVA':'baltic', 'LTU BLR':'poland',
 'AUT CZE SVK HUN SVN':'balkans', 'HRV BIH SRB MNE KOS MKD ALB':'serbia', 'ROU':'balkans bulgaria', 'BGR':'bulgaria', 'GRC':'bulgaria',
 'UKR MDA':'ukraine', 'RUS':'west-russia baltic urals siberia far-east ukraine',
 'TUR CYP CYN':'anatolia east-anatolia', 'GEO ARM AZE':'east-anatolia', 'SYR LBN ISR PSX JOR':'levant', 'IRQ KWT':'mesopotamia',
 'SAU YEM OMN ARE QAT BHR':'arabia', 'IRN':'persia', 'AFG':'afghanistan', 'PAK':'afghanistan north-india',
 'KAZ UZB TKM KGZ TJK':'central-asia', 'MNG':'mongolia', 'CHN':'manchuria north-china south-china tibet mongolia',
 'TWN HKG MAC':'south-china', 'PRK KOR':'korea', 'JPN':'north-japan south-japan',
 'IND':'north-india south-india', 'BGD NPL BTN':'north-india', 'LKA MDV':'south-india',
 'MMR THA LAO KHM VNM SGP':'indochina', 'MYS':'indochina east-indies', 'IDN BRN TLS PNG SLB':'east-indies', 'PHL':'philippines',
 'AUS':'australia', 'NZL':'new-zealand',
 'MAR TUN':'maghreb', 'DZA':'maghreb sahara', 'SAH':'maghreb', 'LBY':'maghreb sahara egypt', 'EGY SDN':'egypt',
 'MRT SEN GMB GNB GIN SLE LBR CIV GHA TGO BEN BFA CPV':'west-africa', 'MLI':'west-africa sahara', 'NER':'sahara sahel',
 'NGA TCD':'sahel', 'CMR CAF':'sahel congo', 'GAB COG GNQ COD STP':'congo', 'AGO ZMB':'angola',
 'ETH ERI DJI SOM SOL SDS KEN UGA':'east-africa', 'TZA RWA BDI MWI':'tanganyika', 'MOZ':'tanganyika south-africa',
 'ZAF LSO SWZ ZWE':'south-africa', 'BWA':'namibia south-africa', 'NAM':'namibia', 'MDG COM MUS SYC':'madagascar',
}
COUNTRY = {code: provinces.split() for codes, provinces in COUNTRY.items() for code in codes.split()}
# Overseas departments, exclaves and 1910 partitions that should not join their modern capital's province.
ADMIN1 = {'FRA:Guyane française':'caribbean','FRA:Guadeloupe':'caribbean','FRA:Martinique':'caribbean',
          'FRA:La Réunion':'madagascar','FRA:Mayotte':'madagascar','CAN:Nunavut':'east-canada','USA:Hawaii':'west-us',
          'DZA:Adrar':'sahara','RUS:Kaliningrad':'prussia',
          'POL:Pomeranian':'prussia','POL:Warmian-Masurian':'prussia','POL:Kuyavian-Pomeranian':'prussia',
          'POL:West Pomeranian':'brandenburg','POL:Lubusz':'brandenburg','POL:Greater Poland':'brandenburg',
          'POL:Lower Silesian':'saxony','POL:Opole':'saxony','POL:Silesian':'saxony',
          'POL:Lesser Poland':'balkans','POL:Subcarpathian':'balkans'}

land = gpd.read_file(sys.argv[1])
world = box(-180, -60, 180, 83)
parts = {id: [] for id in seeds}
skipped, used = set(), set()
for code, unit, name, geom in zip(land['adm0_a3'], land['gu_a3'], land['name'], land.geometry):
    if geom is None or code == 'ATA': continue
    geom = geom.buffer(0).intersection(world)
    if geom.is_empty: continue
    key = f'{code}:{name}'; used.add(key)
    candidates = [ADMIN1[key]] if key in ADMIN1 else COUNTRY.get(unit, COUNTRY.get(code))
    if not candidates: skipped.add(code); continue
    lon, lat = geom.representative_point().coords[0]
    parts[min(candidates, key=lambda id: (seeds[id][0]-lon)**2 + (seeds[id][1]-lat)**2)].append(geom)
assert not set(ADMIN1) - used, set(ADMIN1) - used
print('Unassigned (dropped small territories):', ' '.join(sorted(skipped)))
ids = [id for id, *_ in SEEDS]
def polygons(g):
    return [p for p in (g.geoms if hasattr(g, 'geoms') else [g]) if p.geom_type == 'Polygon']
def solid(g):
    # Seams between neighbouring states leave hairline holes; fill every hole under 4 square degrees.
    return unary_union([Polygon(p.exterior, [r for r in p.interiors if Polygon(r).area > 4])
                        for p in polygons(g) if p.area >= .02])
# Simplify all provinces together so shared borders stay shared.
shapes = list(shapely.coverage_simplify([solid(unary_union(parts[id])) for id in ids], .1))
def path(g):
    result = []
    for poly in polygons(g):
        if poly.area < .08: continue  # square degrees: drop specks that would render as dust
        for ring in [poly.exterior, *poly.interiors]:
            result.append('M' + 'L'.join('%.1f,%.1f' % project(x, y) for x, y in ring.coords[:-1]) + 'Z')
    return ''.join(result)

regions = []
for id, geom in zip(ids, shapes):
    assert not geom.is_empty, id
    kept = [p for p in polygons(geom) if p.area >= .08]
    main = unary_union(kept)
    # Keep the published counter position when it is still on the province's land.
    old = previous.get(id)
    point = Point(*unproject(old['x'], old['y'])) if old else None
    if not point or not main.buffer(-.15).contains(point):
        point = Point(seeds[id])
        if not main.buffer(-.15).contains(point):
            point = min(kept, key=lambda p: p.distance(Point(seeds[id]))).representative_point()
    x, y = project(point.x, point.y)
    regions.append({'id':id,'name':names[id],'x':round(x,2),'y':round(y,2),'path':path(geom),'geom':main,'neighbors':[]})

edges = {}
def connect(a, b, sea=False):
    key = tuple(sorted([a, b])); edges[key] = {'from':key[0], 'to':key[1], 'sea':sea}
for i, a in enumerate(regions):
    for b in regions[i+1:]:
        if a['geom'].buffer(.05).intersection(b['geom']).length > .5:
            connect(a['id'], b['id'])
for edge in base['edges']:
    if edge['sea'] and tuple(sorted([edge['from'], edge['to']])) not in edges: connect(edge['from'], edge['to'], True)
# Short straits: the coarse v3 partition joined these by land; keep them playable as crossings.
# Long routes are not teleportation: their travel time follows their map distance.
for a, b in [('ireland','scotland'),('ireland','midlands'),('england','normandy'),('egypt','arabia'),('arabia','persia'),
             ('arabia','east-africa'),('maghreb','south-italy'),('serbia','south-italy'),('korea','north-china'),
             ('madagascar','tanganyika'),
             ('england','egypt'),('egypt','north-india'),('north-india','australia'),
             ('east-canada','ireland'),('rhineland','namibia'),('namibia','tanganyika'),
             ('north-france','maghreb'),('west-africa','madagascar'),('madagascar','indochina'),
             ('west-us','philippines'),('baltic','scandinavia')]:
    if (tuple(sorted([a, b]))) not in edges: connect(a, b, True)
lookup = {p['id']: p for p in regions}
for a, b in edges:
    lookup[a]['neighbors'].append(b); lookup[b]['neighbors'].append(a)
seen = {regions[0]['id']}
while True:
    following = seen | {n for id in seen for n in lookup[id]['neighbors']}
    if seen == following: break
    seen = following
assert len(seen) == len(regions), set(lookup) - seen
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
    'britain':['east-canada','west-canada','north-india','australia','south-africa','egypt'],
    'france':['maghreb','west-africa','indochina','madagascar'],
    'germany':['namibia','tanganyika'], 'usa':['philippines']
}
LEVELS={'britain':3,'france':3,'germany':2,'russia':1,'ottoman':1,'qing':1,'japan':2,'usa':3}
# Units and levels are visible, capturable scenario assets, never secret national multipliers.
SPECIAL={'germany':{'ruhr':3,'rhineland':3},'russia':{'west-russia':3,'baltic':2,'ukraine':2,'urals':2,'siberia':2,'poland':2},
         'france':{'alpine-france':2},'britain':{'west-canada':1},
         'ottoman':{'anatolia':2,'mesopotamia':2},'usa':{'alaska':1}}
# A thinly held frontier colony: Canada is one British dominion, not a second fortress.
GARRISON={'britain':{'west-canada':7}}
countries=[]
for c in base['countries']:
    id=c['id']; homes=HOMES[id]; colonies=COLONIES.get(id,[])
    development={p:LEVELS[id] for p in homes}; development.update({p:(2 if id=='britain' else 1) for p in colonies}); development.update(SPECIAL.get(id,{}))
    garrisons={p:(14 if id in ['britain','ottoman'] else 12) for p in homes}
    garrisons.update({p:(14 if id=='britain' else 7) for p in colonies}); garrisons.update(GARRISON.get(id,{}))
    countries.append({**c,'start':homes+colonies,'homeland':homes,'colonies':colonies,'development':development,'garrisons':garrisons})
starts=[id for c in countries for id in c['start']]
assert len(starts)==len(set(starts))
result={**base,'id':'imperial-1910-v4','rulesVersion':3,'name':'Industry & Empire · 1910',
        'notice':'1910-inspired holdings and colonial footholds. Province borders, industry and military strength are authored game abstractions, not a historical census.',
        'source':'Natural Earth public-domain boundaries; Council of Iron authored provinces and connections.',
        'countries':countries,'provinces':regions,'edges':list(edges.values())}
(ROOT/'public/imperial-map.json').write_text(json.dumps(result,separators=(',',':'),ensure_ascii=False)+'\n')
print(f'Built {len(regions)} provinces; {len(edges)} links; {len(starts)} occupied starting holdings; {(ROOT/"public/imperial-map.json").stat().st_size} bytes.')
for c in countries: print(c['id'],len(c['start']),'holdings',sum(c['development'].values()),'production / 20s',sum(c['garrisons'].values()),'troops')
