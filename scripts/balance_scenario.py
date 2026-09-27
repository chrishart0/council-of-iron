"""Reproduce a retained development candidate without duplicating the coastline asset.
Usage: python scripts/balance_scenario.py CASE OUTPUT.json
"""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
if len(sys.argv) != 3:
    raise SystemExit(__doc__)
fixtures = json.loads((root / 'tests/industrial-cases.json').read_text())
if sys.argv[1] not in fixtures:
    raise SystemExit('Unknown case; choose ' + ', '.join(fixtures))
case = fixtures[sys.argv[1]]
data = json.loads((root / 'public/imperial-map.json').read_text())
for key, changes in [('countries', 'countryChanges'), ('provinces', 'provinceChanges')]:
    for item in data[key]:
        item.update(case[changes].get(item['id'], {}))
if 'edges' in case:
    data['edges'] = case['edges']
content = (json.dumps(data, separators=(',', ':'), ensure_ascii=case['ensureAscii']) + '\n').encode()
assert hashlib.sha256(content).hexdigest() == case['sha256'], 'Base geometry or fixture changed.'
output = Path(sys.argv[2]); output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(content)
print(sys.argv[1], case['sha256'], output)
