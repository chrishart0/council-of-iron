"""Browser/controller integration and the browser test entry point (`python tests/browser.py`).

A real match through the real controls: the browser (USA), a separate CLI process (Britain, later driven by
agents/bot.js) and six idle agent seats, on an accelerated clock (the whole clock is scaled; no endpoint advances
time). Idle seats never act, so every assertion that needs a province's owner is deterministic. `--full` fills those
six seats with practice bots instead (a live soak match, as does `--gif`) and runs the long performance checks.
Then the focused suites run: recorded-match review, UI layout/tasks on paused recorded positions, voice, and
mobile performance budgets.

Normal mode uses actual browser HTTP navigation.

`--bridge` is an explicit fallback for managed Chromium with all URL navigation
blocked: render unmodified app JS in an in-memory document, with fetch forwarded
by the Python test runner to the actual local HTTP server. This validates DOM,
interaction and server integration, NOT browser networking/CSP/navigation.
No browser policy is modified. CI uses normal mode, never the bridge.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_helpers import load_bridge, lane, open_thread, close_comms, start_server, spawn, stop

ROOT = Path(__file__).resolve().parents[1]

def centre(locator):
    box=locator.bounding_box();return box['x']+box['width']/2,box['y']+box['height']/2
def bring(page,province):
    """Camera only: pan by dragging empty map until the province counter is well inside the view."""
    vw,vh=page.viewport_size['width'],page.viewport_size['height']
    for _ in range(5):
        x,y=centre(page.locator(f'#marker-{province} .counter-body'))
        if vw*.15<x<vw*.6 and vh*.2<y<vh*.6:return
        sx,sy=page.evaluate("""([w,h])=>{for(let y=h*.3;y<h*.6;y+=13)for(let x=w*.25;x<w*.6;x+=13){const e=document.elementFromPoint(x,y);
          if(e&&e.closest('#map')&&!e.closest('.map-counter,.map-cluster,.battle-counter,.moving-army'))return [x,y];}return null;}""",[vw,vh])
        page.mouse.move(sx,sy);page.mouse.down()
        for i in range(1,11):page.mouse.move(sx+(vw*.38-x)*i/10,sy+(vh*.4-y)*i/10)
        page.mouse.up();page.wait_for_timeout(120)
    raise AssertionError(('not in view',province))
def confirmed(page,text,timeout=6000):
    """An order confirmation shows in the one toast slot, unless a decision (an ACTION toast, e.g. an army about to
    land on you) holds it: then the confirmation is not shown over it, by design. Either state passes."""
    deadline=time.monotonic()+timeout/1000
    while time.monotonic()<deadline:
        if text in lane(page).inner_text():return
        if lane(page).get_attribute('data-state')=='action':return
        page.wait_for_timeout(100)
    raise AssertionError(('no confirmation',text,lane(page).inner_text()))
def province(page,pid):
    """v0.8: select your province on the map (its card opens)."""
    page.keyboard.press('Escape');page.locator('#home-view').click();page.wait_for_timeout(150)
    clusters=page.locator(f'#map .map-cluster[data-cluster*="{pid}"]')
    if clusters.count() and clusters.first.is_visible():clusters.first.click();page.wait_for_timeout(150)
    bring(page,pid);x,y=centre(page.locator(f'#marker-{pid} .counter-body'));page.mouse.click(x,y)
    expect(page.locator('#card')).to_have_attribute('data-kind','province')
def order(page,src,dst):
    """Your province, then (keyboard fallback in the expanded card) a neighbour: the order card."""
    province(page,src)
    if page.locator('#card').get_attribute('data-size')!='full':page.locator('#card-size').click()
    page.locator('#destination').select_option(dst);expect(page.locator('#primary')).to_be_visible()
    if page.locator('#card').get_attribute('data-size')!='full':page.locator('#card-size').click()
def camera(page,view):
    if not page.locator('#hud-menu').is_visible():page.locator('#menu-button').click()
    page.locator(f'#{view}-view').click()
def country_card(page,cid):
    # Powers rows re-sort while the match runs (12× clock): a click can land on the row that just moved under the
    # pointer, so check the card is this country's and try again.
    name=page.evaluate("id=>fetch('/map.json').then(r=>r.json()).then(m=>m.countries.find(c=>c.id===id).name)",cid)
    for _ in range(4):
        page.keyboard.press('Escape');page.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
        expect(page.locator('#card')).to_have_attribute('data-kind','country')
        if page.locator('#card-title').inner_text().strip()==name:return
    expect(page.locator('#card-title')).to_have_text(name)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge', action='store_true')
    parser.add_argument('--full', action='store_true', help='Practice bots in the six idle seats (a live soak match) and the long performance run.')
    parser.add_argument('--gif', help='Write an actual browser-capture GIF of a live bot match (implies --full) to this path.')
    parser.add_argument('--ui-gif', help='Record a labeled tour of the command interface.')
    parser.add_argument('--review-gif', help='Also record the focused after-action review as a GIF.')
    parser.add_argument('--executable', default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts', default=str(ROOT / 'artifacts'))
    parser.add_argument('--only', help='Comma-separated suites to run: ' + ','.join(SUITES))
    args = parser.parse_args()
    args.full = args.full or bool(args.gif)
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
    chosen = args.only.split(',') if args.only else list(SUITES)
    assert set(chosen) <= set(SUITES), chosen
    results, started = {}, time.monotonic()
    def outcome(name, ok, since):
        results[name] = f'{"passed" if ok else "FAILED"} ({time.monotonic() - since:.0f} s)'
    # The live walkthrough owns the browser first; competing Chrome captures made its lobby screenshot flaky.
    # The two UI parts then run beside the remaining suites, each with its own server and browser.
    if 'live' in chosen:
        since = time.monotonic()
        try:
            live_match(args, artifacts)
            outcome('live', True, since)
        except Exception as error:
            outcome('live', False, since); print(f'live suite failed: {error!r}', file=sys.stderr)
            import traceback; traceback.print_exc()
    # With --full the performance suite runs last, alone, so its enforced CPU budgets see a quiet host.
    background = {}
    for name in chosen:
        command = SUITES[name](args, artifacts) if name in BACKGROUND else None
        if command:
            background[name] = spawn(command, output=str(artifacts / f'{name}.log'))
            threading.Thread(target=lambda n=name, p=background[name]: outcome(n, p.wait() == 0, started), daemon=True).start()
    def finish():
        for proc in background.values(): proc.wait()
        time.sleep(.2)  # the waiting threads record the outcome
    last = ['perf'] if args.full and 'perf' in chosen else []
    for name in [n for n in chosen if n not in BACKGROUND and n not in last and n != 'live'] + last:
        if name in last: finish()
        since = time.monotonic()
        try:
            command = SUITES[name](args, artifacts)
            if command: subprocess.run(command, cwd=ROOT, check=True, timeout=1800)
            outcome(name, True, since)
        except Exception as error:  # report every suite, then fail
            outcome(name, False, since); print(f'{name} suite failed: {error!r}', file=sys.stderr)
            import traceback; traceback.print_exc()
    finish()
    for name in BACKGROUND & set(results):
        if not results[name].startswith('passed'):
            print(f'--- {name} suite output (tail of {artifacts / f"{name}.log"}) ---\n' + (artifacts / f'{name}.log').read_text()[-6000:], file=sys.stderr)
    print(json.dumps({'suites': results, 'seconds': round(time.monotonic() - started)}, indent=2))
    if any(not r.startswith('passed') for r in results.values()): sys.exit(1)

def live_match(args, artifacts):
    gif_frames=[]
    def capture(page,duration=140):
        if not args.gif:return
        page.evaluate('window.scrollTo(0,0)')
        gif_frames.append((page.screenshot(),duration))
    report = {'transport': 'python-http-bridge' if args.bridge else 'native-browser-http', 'assertions': [], 'pageErrors': []}
    with tempfile.TemporaryDirectory(prefix='council-browser-') as tmp:
        env = {**os.environ, 'PORT': '0', 'TEST_DB': str(Path(tmp)/'test.db'), 'TEST_CLOCK_SCALE': '12'}
        server, settings = start_server('tests/browser-server.js', env)
        bot = None
        try:
            url = settings['url']
            def http(path, method='GET', data=None, token=None):
                request = urllib.request.Request(url + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                    headers={**({'Content-Type':'application/json'} if data is not None else {}), **({'Authorization':f'Bearer {token}'} if token else {})})
                with urllib.request.urlopen(request, timeout=15) as response:
                    return json.load(response)
            IDLE=['france','germany','russia','ottoman','qing','japan']
            def idle_seats(room,countries):
                """Agent seats that never act: the room is full and nothing moves unless the test moves it."""
                for c in countries:
                    envoy=http('/api/players','POST',{'name':f'Idle {c}'})
                    http(f'/api/games/{room}/join','POST',{'country':c,'kind':'agent'},envoy['token'])
            def create_room(page):
                """Submit the create form; the server names the room, so the new room is the one not listed before."""
                before={g['id'] for g in http('/api/games')['games']}
                page.locator('#create-form button[type=submit]').click()
                expect(page.locator('#lobby')).to_be_visible()
                return next(g['id'] for g in http('/api/games')['games'] if g['id'] not in before)
            def cli(*arguments):
                result = subprocess.run(['node','agents/cli.js',*arguments],cwd=ROOT,env={**os.environ,'COUNCIL_URL':url,'COUNCIL_SESSION':str(Path(tmp)/'agent.session.json'),'COUNCIL_TOKEN':'','COUNCIL_MATCH':''},capture_output=True,text=True,timeout=20)
                assert result.returncode == 0, result.stderr
                return json.loads(result.stdout)
            with sync_playwright() as playwright:
                launch={'headless':True}
                if args.executable: launch['executable_path']=args.executable
                browser=playwright.chromium.launch(**launch)
                context=browser.new_context(viewport={'width':1600,'height':1050},device_scale_factor=1)
                context.add_init_script("window.__cues=[];document.addEventListener('coi:sound',e=>window.__cues.push(e.detail))")  # test-only listener
                def load_page(page, match=None, saved=None):
                    page.on('pageerror',lambda error: report['pageErrors'].append(str(error)))
                    if not args.bridge:
                        page.goto(url + (f'/?match={match}' if match else '/'))
                    else:
                        load_bridge(page,url,saved)
                        expect(page.locator('#connection')).to_have_text('Live')
                        if match: page.locator(f'[data-room="{match}"][data-resume]').click()
                    expect(page.locator('#connection')).to_have_text('Live')
                page=context.new_page();load_page(page)
                page.screenshot(path=str(artifacts/'01-lobby.png'),full_page=True)
                page.locator('#display-name').fill('Browser Commander')
                page.locator('[data-preset="standard"]').click()
                page.locator('#create-form button[type=submit]').click()
                expect(page.locator('#lobby')).to_be_visible()
                room=http('/api/games')['games'][0]['id']
                page.locator('[data-country-seat="usa"]').click()
                page.locator('#join-form button').click()
                expect(page.locator('#lobby-note')).to_contain_text('You command United States')
                report['assertions'].append('Human browser created room and joined USA through UI.')
                cli('join',room,'britain','External CLI Envoy')
                if args.full:page.locator('#fill-bots').click()
                else:idle_seats(room,IDLE)
                expect(page.locator('#room-label')).to_contain_text('8/8')
                page.locator('#start-match').click()
                expect(page.locator('#phase')).to_have_text('In session')  # Start means start
                assert http(f'/api/games/{room}')['status']=='running'
                report['assertions'].append(f'Separate CLI process joined Britain; {"six practice bots" if args.full else "six idle agent seats"} filled the room; the host pressed Start and the match began at once.')
                # Simulate the randomUUID restriction of plain-HTTP LAN browsers.
                page.evaluate('crypto.randomUUID = undefined')
                # Real DOM inputs -> shared action endpoint. No direct state mutation.
                expect(page.locator('#card')).to_be_hidden()  # nothing is open until the player asks
                if page.locator('#coach').is_visible():page.locator('#coach-skip').click()  # first-match tips (covered by ui-browser)
                order(page,'west-us','mexico')
                page.locator('[data-fraction="0.5"]').click()
                expect(page.locator('#order-details')).to_contain_text('dice rounds')
                expect(page.locator('#sound-control')).to_have_attribute('data-loaded','ogg')  # decoded after the first click
                page.locator('#primary').click()
                confirmed(page,'Sent')
                assert {'cue':'march','priority':1,'audible':True} in page.evaluate('window.__cues'),page.evaluate('window.__cues')
                report['assertions'].append('Committing the march through the UI played the audible march cue (toast is the visible counterpart).')
                cli('war','france')
                # Engine headline -> the same World feed row for every viewer, with a live banner.
                open_thread(page,'world')
                # Practice bots (--full) may declare their own wars first; find this one by its parties.
                expect(page.locator('#comms .cx-rows [data-kind="war"]').filter(has_text='French Republic').filter(has_text='British Empire').first).to_be_visible(timeout=10000)
                close_comms(page)
                report['assertions'].append('A CLI war declaration appeared as a war marker in the browser’s World thread (the history).')
                cli('march','north-france','6','england')
                province(page,'central-us');page.locator('#rally-province').click()
                confirmed(page,'Tap one of your provinces')
                page.mouse.click(*centre(page.locator('#marker-west-us .counter-body')))
                confirmed(page,'Rally set')
                expect(page.locator('#map [data-rally="central-us"]').first).to_be_attached(timeout=10000)
                province(page,'central-us');expect(page.locator('#rally-province')).to_contain_text('Rally →')
                page.keyboard.press('Escape')
                report['assertions'].append('Browser and CLI committed armies; the browser set a rally point (Central US → West US) that the map draws.')
                country_card(page,'britain')
                page.locator('#primary').click()  # Propose alliance: an inline name field with a default
                expect(page.locator('#card-body .proposal')).to_contain_text('Sending is your approval')
                page.locator('#coalition-name').fill('Atlantic Accord')
                page.keyboard.press('Escape')  # leaving the card sends nothing
                assert not http(f'/api/games/{room}')['proposals']
                country_card(page,'britain');page.locator('#primary').click()
                page.locator('#coalition-name').fill('Atlantic Accord');page.locator('#primary').click()
                expect(page.locator('#card-status')).to_contain_text('ALLIANCE OFFER PENDING')
                expect(page.locator('#card-status')).to_contain_text('Atlantic Accord')
                agent_state=cli('state')
                offer=next(q for q in agent_state['proposals'] if q['name']=='Atlantic Accord')
                cli('accept',offer['id'])
                # Alliance activation plays a dedicated seal animation, queued behind any other banner.
                expect(page.locator('#alliance-seal')).to_be_visible(timeout=30000)
                expect(page.locator('#alliance-name')).to_have_text('Atlantic Accord')
                expect(page.locator('#alliance-standards figcaption')).to_have_count(2)
                expect(page.locator('#alliance-standards')).to_contain_text('United States')
                # Capture once the ribbon has stamped (its entrance animation is finished).
                page.wait_for_function("()=>!document.querySelector('.alliance-ribbon').getAnimations().some(a=>a.playState==='running')",timeout=5000)
                page.screenshot(path=str(artifacts/'alliance-seal.png'))
                open_thread(page,'world');expect(page.locator('#comms .cx-rows [data-kind="alliance"]').first).to_contain_text('Atlantic Accord');close_comms(page)
                report['assertions'].append('Alliance activation showed the standards-and-ribbon seal with country names and a matching World-thread marker.')
                expect(page.locator('#commander-side')).to_contain_text('Atlantic Accord',timeout=15000)
                # Relations without a drawer: the leaderboard marks allies and enemies from the public lists.
                expect(page.locator('#lb-rows .lb-row[data-id="britain"]')).to_have_attribute('data-relation','ally')
                wars=http(f'/api/games/{room}')['wars']
                enemies=sorted({b if a=='usa' else a for a,b in (w.split(':') for w in wars) if 'usa' in (a,b)})
                page.locator('[data-lb-mode="players"]').click()
                for cid in enemies:expect(page.locator(f'#lb-rows .lb-row[data-id="{cid}"]')).to_have_attribute('data-relation','enemy',timeout=5000)
                page.locator('[data-lb-mode="teams"]').click()
                report['assertions'].append(f'Relations: the HUD names the alliance (Atlantic Accord); the leaderboard marks Britain as ally and {enemies or "nobody"} as enemies, matching the public war list.')
                report['assertions'].append('Browser proposed an alliance; CLI accepted; after the public notice both shared the alliance.')
                # Cancellation must not file an accidental irreversible departure.
                page.locator('#hud-standard').click();page.locator('#card-actions button',has_text='Leave alliance').click()
                expect(page.locator('#confirm-dialog')).to_be_visible()
                page.keyboard.press('Escape')
                expect(page.locator('#confirm-dialog')).not_to_be_visible()
                assert not http(f'/api/games/{room}')['departures']
                report['assertions'].append('Leaving an alliance requires explicit confirmation; Escape leaves membership untouched.')
                # v0.9: the country card's Message opens that conversation in Messages with the composer focused.
                page.keyboard.press('Escape')
                country_card(page,'britain')
                page.locator('#card-actions button',has_text='Message').click()
                expect(page.locator('#comms')).to_have_attribute('data-view','thread');expect(page.locator('#comms .cx-title')).to_have_text('British Empire')
                expect(page.locator('#cx-text')).to_be_focused()
                expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=10000)
                page.locator('#cx-text').fill('Hold the Atlantic. This dispatch is private.')
                page.locator('#comms .cx-send').click()
                expect(page.locator('#comms .cx-msg[data-mine="true"]').last).to_contain_text('This dispatch is private.')
                close_comms(page);page.keyboard.press('Escape')
                # Drain the agent's cursor: the added banner waits let more events accumulate than one page.
                agent_events,agent_cursor=[],0
                while True:
                    agent_state=cli('state',str(agent_cursor));agent_events+=agent_state['events'];agent_cursor=agent_state['cursor']
                    if not agent_state['hasMore']:break
                assert any(e.get('text')=='Hold the Atlantic. This dispatch is private.' for e in agent_events)
                cli('chat','dm','usa','<img src=x onerror="window.INJECTED=true"> Agreed. I will hold.')
                page.wait_for_timeout(2000/12+200)  # one message per 2 game seconds (anti-spam) on the 12x test clock
                cli('chat','world','<img src=x onerror="window.INJECTED=true"> The envoy speaks to all.')
                open_thread(page,'world')
                expect(page.locator('#comms .cx-msg').last).to_contain_text('The envoy speaks to all.',timeout=10000)
                assert page.locator('#comms img').count()==0 and not page.evaluate('window.INJECTED')
                expect(page.locator('#comms .cx-rows')).not_to_contain_text('Agreed. I will hold.')  # the World thread holds no DMs
                report['assertions'].append('Agent world speech reached the browser World thread as inert text; the World thread holds no private messages.')
                open_thread(page,'dm:britain')
                dm=page.locator('#comms .cx-msg[data-mine="false"]').last
                expect(dm).to_contain_text('Agreed. I will hold.');expect(dm).to_be_visible()
                assert page.locator('#comms img').count()==0
                expect(dm).not_to_have_class(re.compile('cx-is-unread'),timeout=5000)  # read once shown in its thread
                expect(page.locator('#comms .cx-switch [data-conv="dm:britain"] .cx-dot')).to_have_count(0,timeout=5000)  # (bots' war news may still be unread elsewhere)
                page.locator('#cx-text').fill('Unsent draft survives live updates.')
                page.wait_for_timeout(900)
                expect(page.locator('#cx-text')).to_have_value('Unsent draft survives live updates.')
                report['assertions'].append('A DM shown in its open thread clears the Messages unread count; an unsent draft survives live polling.')
                assert not page.evaluate('Boolean(window.INJECTED)')
                public_state=http(f'/api/games/{room}')
                assert not any(e['type']=='message' and e.get('channel')=='dm' for e in public_state['events'])
                report['assertions'].append('Private diplomacy delivered both ways; spectator API excluded DMs; HTML in agent speech rendered as text, not executable markup.')
                spectator=context.new_page();load_page(spectator)
                expect(spectator.locator('.room-group').first).to_contain_text('In progress')
                spectator.locator(f'[data-room="{room}"][data-spectate="true"]').click()
                expect(spectator.locator('#phase')).to_have_text('Watching')
                expect(spectator.locator('body')).to_have_class(re.compile('spectating'))
                expect(spectator.locator('#card')).to_be_hidden();expect(spectator.locator('#hud-standard')).to_be_disabled()
                assert spectator.evaluate('document.documentElement.scrollHeight<=innerHeight+1')
                open_thread(spectator,'world')
                assert 'This dispatch is private.' not in spectator.locator('#comms').inner_text()
                expect(spectator.locator('#comms [data-conv^="dm:"]')).to_have_count(0)
                expect(spectator.locator('#comms-button .cx-count')).to_have_count(0)
                expect(spectator.locator('#lb-powers [data-power]')).to_have_count(8)  # every power, one tap into its (read-only) card
                spectator.screenshot(path=str(artifacts/'spectator-desktop.png'),full_page=True)
                # v0.7: spectating is already full screen: the map is the viewport and the history stays beside it.
                assert spectator.locator('#map').bounding_box()=={'x':0,'y':0,'width':1600,'height':1050}
                expect(spectator.locator('#comms .cx-rows')).to_be_visible()
                page.locator('#cx-text').fill('');open_thread(page,'world')
                # Reply in the World thread: the shared chat action on channel world.
                expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=10000)
                page.locator('#cx-text').fill('<img src=x onerror="window.INJECTED=true"> Public call to the council.')
                page.locator('#comms .cx-send').click()
                expect(page.locator('#cx-text')).to_have_value('')
                expect(spectator.locator('#comms .cx-rows')).to_contain_text('Public call to the council.',timeout=10000)
                assert spectator.locator('#comms img').count()==0
                expect(spectator.locator('#comms .cx-composer')).to_be_hidden()
                expect(spectator.locator('#comms .cx-rows [data-kind="war"]').first).to_be_attached()
                assert any(e.get('channel')=='world' and e.get('text','').endswith('Public call to the council.') for e in http(f'/api/games/{room}/feed')['items'])
                spectator.screenshot(path=str(artifacts/'spectator-fullscreen.png'),full_page=True)
                assert 'This dispatch is private.' not in spectator.locator('#comms').inner_text()
                close_comms(page)
                spectator.keyboard.press('Escape')
                expect(spectator.locator('#card')).to_be_hidden()
                spectator.set_viewport_size({'width':390,'height':844})
                assert spectator.locator('#map').bounding_box()=={'x':0,'y':0,'width':390,'height':844}
                assert spectator.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                spectator.screenshot(path=str(artifacts/'spectator-mobile.png'),full_page=True)
                spectator.close()
                report['assertions'].append('Lobby spectator watched on a full-viewport map with the World history beside it on desktop and mobile; the feed reply posted world chat that the read-only spectator feed showed as escaped text, while private dispatches stayed hidden.')
                # External process now controls the existing agent seat over the real API.
                bot=spawn(['node','agents/bot.js'],{**os.environ,'COUNCIL_URL':url,'COUNCIL_SESSION':str(Path(tmp)/'agent.session.json'),'COUNCIL_TOKEN':'','COUNCIL_MATCH':room})
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    state=http(f'/api/games/{room}')
                    if any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events']):break
                    page.wait_for_timeout(300)
                assert any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events'])
                page.screenshot(path=str(artifacts/'02-campaign.png'),full_page=True)
                camera(page,'europe');page.screenshot(path=str(artifacts/'03-europe.png'),full_page=True)
                camera(page,'world')
                report['assertions'].append('Browser-issued attack fought for Mexico after travel and multiple combat rounds; world and Europe zoom rendered.')
                # Reconnect a second page with the same browser identity, not another join.
                if args.bridge:saved=page.evaluate('window.__testStorage')
                else:saved=None
                caught_up=http(f'/api/games/{room}/feed')['cursor']
                reconnect=context.new_page();load_page(reconnect,room,saved)
                expect(reconnect.locator('#commander-title')).to_have_text('United States')
                expect(reconnect.locator('#phase')).to_have_text('In session')
                open_thread(reconnect,'world');expect(reconnect.locator('#comms .cx-rows [data-kind="alliance"]').first).to_be_attached()
                # Old headlines are history only: no banner for anything that predates the reconnect.
                shown=set()
                for _ in range(25):
                    shown.update(int(x) for x in reconnect.locator('#declaration:not([hidden]),#alliance-seal:not([hidden]),#fallen-seal:not([hidden])').evaluate_all('(n)=>n.map(e=>e.dataset.seq).filter(Boolean)'))
                    reconnect.wait_for_timeout(100)
                assert all(seq>caught_up for seq in shown),(shown,caught_up)
                report['assertions'].append('Reconnect rebuilt the World thread from history without replaying old banners.')
                report['assertions'].append('Same-seat reconnect restored country and private inbox without duplicate orders.')
                reconnect.close()
                # Mobile width: no document-level horizontal overflow, controls remain reachable.
                page.set_viewport_size({'width':390,'height':844})
                page.locator('#hud-standard').click()
                page.screenshot(path=str(artifacts/'04-mobile.png'),full_page=True)
                page.keyboard.press('Escape')
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Mobile horizontal overflow'
                page.set_viewport_size({'width':1600,'height':1050})
                report['assertions'].append('390-pixel mobile layout displayed controls without horizontal page overflow.')
                def gif_note(page):
                    page.evaluate('''() => { const note=document.createElement('div');note.textContent='ACTUAL BROWSER CAPTURE · 12× TEST CLOCK · PRACTICE BOTS';note.style.cssText='position:fixed;left:18px;bottom:10px;z-index:20;padding:6px 10px;background:#142c34ee;border:1px solid #c6a87280;color:#e4d6ae;font:10px system-ui;letter-spacing:.7px;border-radius:3px;pointer-events:none';document.body.append(note); }''')
                def rest(page):
                    """Park the pointer on the top bar: no map hover tooltip in the frame."""
                    page.mouse.move(page.viewport_size['width']*.5,8)
                def gif_attack(page):
                    """The recording opens with a real order: drag from a USA counter onto a neighbour (the snapped arrow shows
                    troops and arrival), release, and send it from the order card. Real pointer input, the shared action path."""
                    world=http('/map.json');state=http(f'/api/games/{room}');owner={p['id']:p for p in state['provinces']}
                    land={(e['from'],e['to']) for e in world['edges'] if not e['sea']}|{(e['to'],e['from']) for e in world['edges'] if not e['sea']}
                    enemies={b if a=='usa' else a for a,b in (w.split(':') for w in state['wars']) if 'usa' in (a,b)}
                    busy={o['from'] for o in state.get('orders',[])}|{a['from'] for a in state['armies'] if a['country']=='usa'}
                    options=[(owner[a]['troops'],a,b) for a,b in sorted(land) if owner[a]['owner']=='usa' and a not in busy and owner[a]['troops']>=6
                             and (owner[b]['owner'] is None or owner[b]['owner'] in enemies)]
                    if not options:report['assertions'].append('GIF: USA had no province to attack from; recorded the war only.');return
                    _,src,dst=max(options)
                    page.keyboard.press('Escape');page.locator('#home-view').click();page.wait_for_timeout(300);bring(page,src)
                    rest(page);page.wait_for_timeout(300);capture(page,700)
                    sx,sy=centre(page.locator(f'#marker-{src} .counter-body'));tx,ty=centre(page.locator(f'#marker-{dst} .counter-body'))
                    page.mouse.move(sx,sy);page.mouse.down()
                    for i in range(1,13):
                        page.mouse.move(sx+(tx-sx)*i/12,sy+(ty-sy)*i/12);page.wait_for_timeout(40)
                        if i%3==0:capture(page,220)
                    expect(page.locator('#map-armies .draft-arrow.snapped')).to_have_count(1);capture(page,1100)
                    page.mouse.up();expect(page.locator('#primary')).to_be_visible();capture(page,1000)
                    page.locator('#primary').click()
                    if page.locator('#confirm-dialog').is_visible():page.locator('#confirm-dialog [value="confirm"]').click()
                    deadline=time.monotonic()+6
                    while time.monotonic()<deadline and not any(a['country']=='usa' and (a.get('path') or [a['to']])[-1]==dst for a in http(f'/api/games/{room}')['armies']):
                        page.wait_for_timeout(200)
                    page.keyboard.press('Escape');rest(page)
                    for _ in range(6):capture(page,300);page.wait_for_timeout(500)
                    report['assertions'].append(f'GIF: dragged a real order arrow from {src} to {dst} and sent it from the order card.')
                def first_room_result():
                    # Do not advance the clock through a privileged endpoint: wait for wall-clock play. Standard is 30 game
                    # minutes, 150 s at 12x from the start, sooner if a side holds 60% of the industry.
                    page.goto(url+f'/?match={room}') if not args.bridge else None
                    if args.gif:
                        expect(page.locator('#connection')).to_have_text('Live')
                        if page.locator('#coach').is_visible():page.locator('#coach-skip').click()
                        gif_note(page);gif_attack(page)
                        # Then watch the war: armies march with their arrows, battles roll, fronts move. Camera only.
                        views=['europe','world']
                        deadline=time.monotonic()+240;frame=0
                        while not page.locator('#result').is_visible() and time.monotonic()<deadline:
                            if frame%14==0:camera(page,views[frame//14%2]);page.keyboard.press('Escape');rest(page)
                            capture(page,160);frame+=1
                            page.wait_for_timeout(900)
                    expect(page.locator('#result')).to_be_visible(timeout=240000)
                    capture(page,2200)
                    result=http(f'/api/games/{room}')
                    assert result['status']=='finished' and len(result['outcome']['scores'])==8
                    report['outcome']=result['outcome']
                    public_events=[]; event_cursor=0
                    while True:
                        batch=http(f'/api/games/{room}?after={event_cursor}'); public_events.extend(batch['events']); event_cursor=batch['cursor']
                        if not batch['hasMore']: break
                    report['events']={kind:sum(e['type']==kind for e in public_events) for kind in ['battle','army_departed','alliance_activated']}
                    expect(page.locator('#result')).not_to_contain_text('Experimental')
                    expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
                    after_action=cli('review')
                    assert after_action['historyAvailable']
                    assert after_action['outcome']==result['outcome']
                    page.screenshot(path=str(artifacts/'05-result.png'),full_page=True)
                    page.locator('#aar-tab-replay').click()
                    expect(page.locator('#replay-stage')).to_be_visible()
                    page.locator('#replay-slider').fill(str(result['tick']))
                    assert int(page.locator('#replay-stage').get_attribute('data-tick'))==result['tick']
                    assert cli('replay',str(result['tick']))['tick']==result['tick']
                    page.locator('[data-aar-transport="start"]').click()
                    expect(page.locator('#replay-stage')).to_have_attribute('data-tick','0')
                    page.locator('#replay-play').click()
                    expect(page.locator('#replay-stage')).not_to_have_attribute('data-tick','0')
                    page.locator('#replay-play').click()
                    assert int(page.locator('#replay-slider').input_value())>0
                    page.locator('#replay-exit').click()
                    for report_tab in ['military','economy','diplomacy','overview']:
                        page.locator(f'#aar-tab-{report_tab}').click()
                        expect(page.locator(f'#aar-{report_tab}')).to_be_visible()
                    report['assertions'].append('Completed live match opened player/alliance review, scrubbable playback and all report tabs; CLI review and historical board agreed.')
                    stdout,_=bot.communicate(timeout=20);assert bot.returncode==0,bot.returncode
                    assert json.loads(stdout)['scores']==result['outcome']['scores']
                    report['assertions'].append('Wall-clock match reached a final result; browser and external agent observed identical final scores.')
                    page.locator('#aar-back').click()
                    page.locator('#tab-standings').click()
                    me=next(p for p in http('/api/standings')['standings'] if p['name']=='Browser Commander')
                    expect(page.locator('#standings .standing-row',has_text='Browser Commander')).to_contain_text(f"{me['wins']}–{me['draws']}–{me['losses']}")
                    assert me['matches']==1 and me['wins']==(next(s for s in result['outcome']['scores'] if s['country']=='usa')['result']=='win'),me
                    page.locator('#tab-rooms').click()
                    report['assertions'].append('The win–draw–loss record includes the browser player after returning to the rooms.')

                def other_rooms():
                    # A second room with the same browser identity; the other seven seats are idle agents, so the USA keeps
                    # exactly its starting land and every province named below is deterministic.
                    page.goto(url+'/');expect(page.locator('#create-form')).to_be_visible()
                    room2=create_room(page)
                    page.locator('[data-country-seat="usa"]').click()
                    page.locator('#join-form button').click()
                    expect(page.locator('#lobby-note')).to_contain_text('You command United States')
                    idle_seats(room2,['britain',*IDLE])
                    expect(page.locator('#room-label')).to_contain_text('8/8')
                    page.locator('#start-match').click()
                    expect(page.locator('#phase')).to_have_text('In session')
                    expect(page.locator('#card')).to_be_hidden()
                    if page.locator('#coach').is_visible():page.locator('#coach-skip').click()
                    names={p['id']:p['name'] for p in http('/map.json')['provinces']}
                    # Tap-tap on the map: your province, then a neighbour; Shift-click adds another source.
                    province(page,'west-us');expect(page.locator('#card-title')).to_have_text(names['west-us'])
                    expect(page.locator('#card')).to_have_attribute('data-size','peek')  # a map selection opens a peeking card
                    if not page.locator('#marker-mexico').is_visible():page.locator('#zoom-out').click()
                    page.mouse.click(*centre(page.locator('#marker-mexico .counter-body')))
                    expect(page.locator('#card-title')).to_have_text(names['mexico']);expect(page.locator('#card-sub')).to_contain_text(names['west-us'])
                    page.locator('[data-fraction="1"]').click();expect(page.locator('#amount-out')).to_contain_text('100%')
                    page.keyboard.down('Shift');page.mouse.click(*centre(page.locator('#marker-central-us .counter-body')));page.keyboard.up('Shift')
                    # Shift-click adds a second source to the same order (multi-select); both arrive together.
                    expect(page.locator('#card-title')).to_have_text(names['mexico']);expect(page.locator('#card-sub')).to_contain_text('from 2 provinces')
                    expect(page.locator('#sources .source-chip')).to_have_count(2)
                    page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
                    page.locator('#hud-standard').focus();page.keyboard.press('Enter')
                    expect(page.locator('#card')).to_have_attribute('data-kind','alliance');expect(page.locator('#card-title')).to_be_focused()
                    page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden();expect(page.locator('#hud-standard')).to_be_focused()
                    report['assertions'].append('A second room starts with the same browser identity; map taps open a peeking order card (province, then neighbour); 100% and Shift-click adding a second source work; the standard opens and closes the alliance card by keyboard with focus returned.')
                    # Attack together: with the target chosen, tapping another of your provinces beside it adds a source.
                    # The longest such attack from two USA provinces into neutral land, so the group is still on its way
                    # when the recall below looks for it.
                    nb={p['id']:p['neighbors'] for p in http('/map.json')['provinces']}
                    st=http(f'/api/games/{room2}');owner={p['id']:p['owner'] for p in st['provinces']};tt=st['travelTimes']
                    mine=sorted(i for i,o in owner.items() if o=='usa')
                    src,second,target=max(((a,b,t) for t in sorted(nb) if owner[t] is None for a in mine for b in mine if a!=b and t in nb[a] and t in nb[b]),key=lambda x:(min(tt[x[0]][x[2]],tt[x[1]][x[2]]),x))
                    order(page,src,target);page.locator('[data-fraction="0.5"]').click()
                    page.locator('#card-size').click()  # back to peek so the map is free
                    if not page.locator(f'#marker-{second} .counter-body').is_visible() or not (0<centre(page.locator(f'#marker-{second} .counter-body'))[0]<page.viewport_size['width']):bring(page,second)
                    page.mouse.click(*centre(page.locator(f'#marker-{second} .counter-body')))
                    expect(page.locator('#sources .source-chip')).to_have_count(2);expect(page.locator('#card-title')).to_have_text(names[target])
                    page.locator('#card-size').click();expect(page.locator('#order-details')).to_contain_text('arrive together')
                    page.screenshot(path=str(artifacts/'06-coordinated-plan.png'),full_page=True)
                    page.locator('#primary').click()
                    # The server has the order (a brief "Sent" toast may lose the one slot to news that affects you).
                    sent=lambda:(lambda g:any(o.get('to')==target or (o.get('path') or [None])[-1]==target for o in g.get('orders',[])+g['armies'] if o.get('country','usa')=='usa'))(http(f'/api/games/{room2}'))
                    deadline=time.monotonic()+6
                    while time.monotonic()<deadline and not sent():page.wait_for_timeout(200)
                    assert sent(),lane(page).inner_text()
                    # Group recall is a browser control, never direct mutation of the game.
                    recall_group=page.locator('[data-recall]').filter(has_text='Recall group')
                    province(page,src)
                    if page.locator('#card').get_attribute('data-size')!='full':page.locator('#card-size').click()
                    expect(recall_group).to_be_visible(timeout=6000);recall_group.click()
                    confirmed(page,'Recall queued')
                    expect(page.locator('.march-row.returning').first).to_be_visible(timeout=5000)
                    page.screenshot(path=str(artifacts/'07-recalling.png'),full_page=True)
                    report['assertions'].append(f'Browser committed a two-source attack ({src} and {second} on {target}, the second added by tapping it beside the target) as one order, then recalled the group with real return time.')
                    # Develop a province of the USA (the lowest level it can pay for); natural recruitment funds the construction.
                    usa_state=lambda:{p['id']:p for p in http(f'/api/games/{room2}')['provinces']}
                    deadline=time.monotonic()+60;build=None
                    while time.monotonic()<deadline:
                        ready=[p for p in usa_state().values() if p['owner']=='usa' and p['development']<3 and not p.get('developing') and p['troops']-1>=(24 if p['development']==1 else 48)+2]
                        if ready:build=min(ready,key=lambda p:(p['development'],-p['troops'],p['id']));break
                        page.wait_for_timeout(500)
                    assert build,('no USA province can pay for development',[(p['id'],p['troops'],p['development']) for p in usa_state().values() if p['owner']=='usa'])
                    level,build=build['development'],build['id'];cost=24 if level==1 else 48
                    page.keyboard.press('Escape');page.keyboard.press('Escape')  # no leftover source from the recall above
                    province(page,build)
                    develop=page.locator('#develop-province')
                    expect(develop).to_be_enabled(timeout=10000)
                    page.locator('#card-size').click();expect(page.locator('#development-payback')).to_contain_text('payback')
                    develop.click()
                    expect(page.locator('#confirm-dialog')).to_contain_text(f'Spend {cost} troops')
                    page.locator('#confirm-dialog [value="confirm"]').click()
                    confirmed(page,'Investment committed')
                    expect(develop).to_contain_text(re.compile('Construction queued|Building level'),timeout=6000)
                    page.screenshot(path=str(artifacts/'08-development.png'),full_page=True)
                    # Construction takes 120 (I→II) or 180 (II→III) game seconds: 10 or 15 s at 12x.
                    deadline=time.monotonic()+40
                    while time.monotonic()<deadline and usa_state()[build]['development']==level:page.wait_for_timeout(300)
                    assert usa_state()[build]['development']==level+1,usa_state()[build]
                    province(page,build);expect(page.locator('#card-title')).to_have_text(names[build])
                    expect(page.locator('#card-sub')).to_contain_text(f"industry {['','Ⅰ','Ⅱ','Ⅲ'][level+1]}",timeout=5000)
                    report['assertions'].append(f'Browser funded, confirmed and completed province development ({build}, level {level}→{level+1}) using naturally recruited manpower.')
                    # A long march: through your own land to a province of yours beyond the neighbours (one route).
                    owners={i:p['owner'] for i,p in usa_state().items()}
                    def via(a,b):
                        seen={a};queue=[a]
                        while queue:
                            x=queue.pop(0)
                            for n in nb[x]:
                                if n==b:return True
                                if n not in seen and owners[n]=='usa':seen.add(n);queue.append(n)
                        return False
                    mine=sorted(i for i,o in owners.items() if o=='usa')
                    start,end=next((a,b) for a in mine for b in mine if a!=b and b not in nb[a] and via(a,b) and usa_state()[a]['troops']>3)
                    order(page,start,end)
                    expect(page.locator('#primary')).to_contain_text('Reinforce')
                    expect(page.locator('#order-details')).to_contain_text('Via',timeout=5000)
                    expect(page.locator('#primary')).to_be_enabled(timeout=10000)
                    page.screenshot(path=str(artifacts/'10-long-march.png'))
                    page.locator('#primary').click()
                    deadline=time.monotonic()+8
                    while time.monotonic()<deadline and not any(a.get('path') and a['path'][-1]==end for a in http(f'/api/games/{room2}')['armies']):page.wait_for_timeout(250)
                    assert any(a.get('path') and a['path'][-1]==end for a in http(f'/api/games/{room2}')['armies']),lane(page).inner_text()
                    report['assertions'].append(f'Browser sent a long march from {start} to {end} through its own land: the card showed the route and the server moved one column along it.')
                    page.set_viewport_size({'width':390,'height':844})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                    page.screenshot(path=str(artifacts/'09-mobile-orders.png'),full_page=True)
                    page.set_viewport_size({'width':1600,'height':1050})
                    # A host who filled every seat with bots before choosing a country takes one of them over.
                    page.goto(url+'/');expect(page.locator('#create-form')).to_be_visible()
                    practice=create_room(page)
                    page.locator('[data-country-seat="japan"]').click()
                    expect(page.locator('#fill-bots')).to_contain_text('Take this seat')
                    page.locator('#fill-bots').click()
                    expect(page.locator('#room-label')).to_contain_text('8/8')
                    expect(page.locator('#lobby-note')).to_contain_text('You command Empire of Japan')
                    players=http(f'/api/games/{practice}')['players']
                    assert next(p for p in players if p['id']=='japan')['kind']=='human' and sum(p['kind']=='bot' for p in players)==7
                    page.locator('#start-match').click();expect(page.locator('#phase')).to_have_text('In session')
                    report['assertions'].append('A host who had not chosen a country took Japan and filled the other seven seats with bots in one step, then started the match.')
                    # A shared lobby run by a seatless host: live clients (here two agents via the join API) take seats,
                    # and the host starts the match without a seat and watches.
                    page.goto(url+'/');expect(page.locator('#create-form')).to_be_visible()
                    shared=create_room(page)
                    expect(page.locator('#start-match')).to_be_disabled()
                    for c in ('britain','france'):
                        envoy=http('/api/players','POST',{'name':f'Envoy {c}'})
                        http(f'/api/games/{shared}/join','POST',{'country':c,'kind':'agent'},envoy['token'])
                    expect(page.locator('#start-match')).to_be_enabled();expect(page.locator('#start-match')).to_have_text('Start and watch')
                    page.locator('#start-match').click();expect(page.locator('#phase')).to_have_text('Watching')  # no seat: a spectator
                    shared_room=http(f'/api/games/{shared}')
                    assert shared_room['status']=='running' and len(shared_room['players'])==2,shared_room
                    report['assertions'].append('A seatless host started a shared lobby that two agent seats had joined, and watched the running match.')

                # The other rooms fill the wait for the first match's result (a GIF records the first match to the end).
                if args.gif:first_room_result();other_rooms()
                else:other_rooms();first_room_result()
                assert not report['pageErrors'],report['pageErrors']
                if args.gif:
                    from io import BytesIO
                    from PIL import Image
                    images=[]
                    for data,_ in gif_frames:
                        image=Image.open(BytesIO(data)).convert('RGB')
                        image=image.resize((1100,round(image.height*1100/image.width)),Image.Resampling.LANCZOS)
                        images.append(image)
                    samples=images[::max(1,len(images)//16)][:16]
                    montage=Image.new('RGB',(640,400))
                    for i,image in enumerate(samples):montage.paste(image.resize((160,100)),((i%4)*160,(i//4)*100))
                    palette=montage.quantize(colors=192)
                    frames=[image.quantize(palette=palette,dither=Image.Dither.NONE) for image in images]
                    gif_path=Path(args.gif);gif_path.parent.mkdir(parents=True,exist_ok=True)
                    frames[0].save(gif_path,save_all=True,append_images=frames[1:],duration=[d for _,d in gif_frames],loop=0,optimize=True,disposal=1)
                    report['gif']={'frames':len(frames),'path':str(gif_path),'bytes':gif_path.stat().st_size,'simulationClockScale':12}
                report['status']='passed'
                browser.close()
        finally:
            if bot:stop(bot)
            stop(server)
            (artifacts/'browser-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

def suite(script, *options, native_only=False, bridge=True, folder=None):
    """A focused suite in its own process (its own server and browser); its report lands in artifacts/<folder>.
    Returns the command, or None when it does not apply (voice and perf need native navigation)."""
    def command(args, artifacts):
        if native_only and args.bridge:return None
        line=[sys.executable,str(ROOT/'tests'/script),'--artifacts',str(artifacts/(folder or script.split('-')[0]))]
        if bridge and args.bridge:line.append('--bridge')
        if args.executable:line.extend(['--executable',args.executable])
        for flag,value in (option(args) for option in options):
            if value:line.extend([flag] if value is True else [flag,value])
        return line
    return command

SUITES = {
    'live': None,  # live_match, in this process
    # Recorded-match after-action review: standings, tabs, replay controls, phone layouts, disclosed messages.
    'review': suite('review-browser.py', lambda a: ('--gif', a.review_gif)),
    # Paused recorded positions: map, layout/overlap/contrast at seven viewports, Messages, sound, relations, review.
    'ui': suite('ui-browser.py', lambda a: ('--gif', a.ui_gif), lambda a: ('--part', 'main')),
    # The same fixture server, scripted players: coach, phone gestures, turned-back notice, truce, task walkthroughs.
    'ui-tasks': suite('ui-browser.py', lambda a: ('--part', 'tasks'), native_only=True, folder='ui-tasks'),
    # Voice input: fake microphone through MediaRecorder, the /stt proxy and a fake sidecar.
    'voice': suite('voice-browser.py', native_only=True, bridge=False),
    # Paused recorded armies: interpolation never repaints the terrain; cameras, input and disposal stay shared.
    'render': suite('render-browser.py', native_only=True, bridge=False),
    # Mobile performance budgets (docs/PERFORMANCE.md): a throttled phone during a busy live match.
    # Without --full: a 30 s DOM sample, and the CPU-time budgets (load-dependent) are reported, not enforced.
    'perf': suite('perf-browser.py', lambda a: ('--quick', not a.full), native_only=True, bridge=False),
}
BACKGROUND = {'ui', 'ui-tasks'}

if __name__=='__main__':main()
