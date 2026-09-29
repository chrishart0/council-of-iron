"""A live, accelerated room for performance runs: real HTTP server (tests/browser-server.js), one human seat
(Britain, the browser) and seven practice bots. Test-only helpers; no game endpoint is added."""
import json, os, time, urllib.request
from pathlib import Path
import browser_helpers
ROOT = Path(__file__).resolve().parents[1]

def http(url, path, method='GET', data=None, token=None):
    req = urllib.request.Request(url + path, method=method, data=json.dumps(data).encode() if data is not None else None,
        headers={**({'Authorization': f'Bearer {token}'} if token else {}), **({'Content-Type': 'application/json'} if data is not None else {})})
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read())

def start_server(clock_scale=1):
    env = {**os.environ, 'PORT': '0', 'TEST_CLOCK_SCALE': str(clock_scale)}
    proc, settings = browser_helpers.start_server('tests/browser-server.js', env)
    return proc, settings['url']

def busy_room(url, preset='quick'):
    me = http(url, '/api/players', 'POST', {'name': 'Perf Probe'})
    room = http(url, '/api/games', 'POST', {'name': 'Perf room', 'preset': preset}, me['token'])['id']
    http(url, f'/api/games/{room}/join', 'POST', {'country': 'britain', 'kind': 'human'}, me['token'])
    http(url, f'/api/games/{room}/bots', 'POST', {}, me['token'])
    http(url, f'/api/games/{room}/start', 'POST', {}, me['token'])
    return me, room

def wait_tick(url, room, token, tick, limit=600):
    end = time.time() + limit
    while time.time() < end:
        s = http(url, f'/api/games/{room}?after=999999999', token=token)
        if s['tick'] >= tick or s['status'] != 'running': return s
        time.sleep(1)
    raise TimeoutError(tick)

def open_match(browser, url, me, room, device, init_script):
    context = browser.new_context(**device)
    context.add_init_script(f"localStorage.setItem('coi.identity', {json.dumps(json.dumps(me))}); localStorage.setItem('coi.coach','done');")
    context.add_init_script(init_script)
    page = context.new_page()
    page.goto(f'{url}/?match={room}')
    page.wait_for_selector('#map .map-counter', state='attached')
    return context, page
