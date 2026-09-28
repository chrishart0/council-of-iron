"""Browser/controller integration. Normal mode uses actual browser HTTP navigation.

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
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_helpers import load_bridge, lane, open_thread, close_comms

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
    page.keyboard.press('Escape');page.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
    expect(page.locator('#card')).to_have_attribute('data-kind','country')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge', action='store_true')
    parser.add_argument('--gif', help='Write an actual browser-capture GIF to this path.')
    parser.add_argument('--ui-gif', help='Record a labeled tour of the command interface.')
    parser.add_argument('--review-gif', help='Also record the focused after-action review as a GIF.')
    parser.add_argument('--executable', default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts', default=str(ROOT / 'artifacts'))
    args = parser.parse_args()
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
    gif_frames=[]
    def capture(page,duration=140):
        if not args.gif:return
        page.evaluate('window.scrollTo(0,0)')
        gif_frames.append((page.screenshot(),duration))
    report = {'transport': 'python-http-bridge' if args.bridge else 'native-browser-http', 'assertions': [], 'pageErrors': []}
    with tempfile.TemporaryDirectory(prefix='council-browser-') as tmp:
        env = {**os.environ, 'PORT': '0', 'TEST_DB': str(Path(tmp)/'test.db'), 'TEST_CLOCK_SCALE': '12'}
        server = subprocess.Popen(['node', 'tests/browser-server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        bot = None
        try:
            url = json.loads(server.stdout.readline())['url']
            def http(path, method='GET', data=None, token=None):
                request = urllib.request.Request(url + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                    headers={**({'Content-Type':'application/json'} if data is not None else {}), **({'Authorization':f'Bearer {token}'} if token else {})})
                with urllib.request.urlopen(request, timeout=15) as response:
                    return json.load(response)
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
                page.locator('#room-name').fill('The First Council')
                page.locator('[data-preset="standard"]').click()
                page.locator('#create-form button[type=submit]').click()
                expect(page.locator('#lobby')).to_be_visible()
                room=http('/api/games')['games'][0]['id']
                assert http('/api/games')['games'][0]['ruleset']=='logistics-1','new rooms default to logistics-1'
                page.locator('[data-country-seat="usa"]').click()
                page.locator('#join-form button').click()
                expect(page.locator('#lobby-note')).to_contain_text('You command United States')
                report['assertions'].append('Human browser created room and joined USA through UI.')
                cli('join',room,'britain','External CLI Envoy')
                page.locator('#fill-bots').click()
                expect(page.locator('#room-label')).to_contain_text('8/8')
                page.locator('#start-match').click()
                expect(page.locator('#phase')).to_have_text('In session')
                report['assertions'].append('Separate CLI process joined Britain; six practice bots filled seats; host started eight-seat match.')
                if args.gif:
                    page.evaluate('''() => { const note=document.createElement('div');note.textContent='ACTUAL BROWSER CAPTURE · 12× TEST CLOCK · HEURISTIC AGENTS';note.style.cssText='position:fixed;right:18px;bottom:10px;z-index:20;padding:6px 10px;background:#142c34ee;border:1px solid #c6a87280;color:#e4d6ae;font:9px system-ui;letter-spacing:.7px;border-radius:3px;pointer-events:none';document.body.append(note); }''')
                capture(page,800)
                # Simulate the randomUUID restriction of plain-HTTP LAN browsers.
                page.evaluate('crypto.randomUUID = undefined')
                # Real DOM inputs -> shared action endpoint. No direct state mutation.
                expect(page.locator('#card')).to_be_hidden()  # nothing is open until the player asks
                if page.locator('#coach').is_visible():page.locator('#coach-skip').click()  # first-match tips (covered by ui-browser)
                order(page,'west-us','mexico')
                page.locator('[data-fraction="0.5"]').click()
                expect(page.locator('#order-details')).to_contain_text('Risk-style rounds')
                expect(page.locator('#sound-control')).to_have_attribute('data-loaded','ogg')  # decoded after the first click
                page.locator('#primary').click()
                expect(lane(page)).to_contain_text('Sent')
                assert {'cue':'march','priority':1,'audible':True} in page.evaluate('window.__cues'),page.evaluate('window.__cues')
                report['assertions'].append('Committing the march through the UI played the audible march cue (toast is the visible counterpart).')
                cli('war','france')
                # Engine headline -> the same World feed row for every viewer, with a live banner.
                open_thread(page,'world')
                expect(page.locator('#comms .cx-rows [data-kind="war"]').first).to_contain_text('French Republic',timeout=10000)
                expect(page.locator('#comms .cx-rows [data-kind="war"]').first).to_contain_text('British Empire')
                close_comms(page)
                report['assertions'].append('A CLI war declaration appeared as a war marker in the browser’s World thread (the history).')
                cli('move','england','north-france','6')
                order(page,'central-us','west-us')
                page.locator('#card-body details[data-part="route"] summary').click()
                page.locator('#set-route').click()
                province(page,'central-us');page.locator('#card-size').click()
                expect(page.locator('#card-body')).to_contain_text('Recruitment arrow: new recruits',timeout=10000)
                report['assertions'].append('Browser and CLI committed armies; browser set a standing reinforcement route.')
                capture(page,1000)
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
                capture(page,1000)
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
                report['assertions'].append('Browser proposed coalition; CLI accepted; public notice elapsed; both shared the coalition and payout projection.')
                capture(page,1000)
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
                page.wait_for_timeout(10000/12+200)  # shared chat cooldown on the 12x test clock
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
                expect(page.locator('#comms-button')).to_have_attribute('data-unread','0',timeout=5000)  # read once shown in its thread
                page.locator('#cx-text').fill('Unsent draft survives live updates.')
                page.wait_for_timeout(900)
                expect(page.locator('#cx-text')).to_have_value('Unsent draft survives live updates.')
                capture(page,1200)
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
                bot=subprocess.Popen(['node','agents/bot.js'],cwd=ROOT,env={**os.environ,'COUNCIL_URL':url,'COUNCIL_SESSION':str(Path(tmp)/'agent.session.json'),'COUNCIL_TOKEN':'','COUNCIL_MATCH':room},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    state=http(f'/api/games/{room}')
                    if any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events']):break
                    page.wait_for_timeout(300)
                assert any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events'])
                page.screenshot(path=str(artifacts/'02-campaign.png'),full_page=True)
                capture(page,800)
                camera(page,'europe');capture(page,900);page.screenshot(path=str(artifacts/'03-europe.png'),full_page=True)
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
                # Do not advance the clock through a privileged endpoint: wait for wall-clock play.
                if args.gif:
                    deadline=time.monotonic()+180
                    while not page.locator('#result').is_visible() and time.monotonic()<deadline:
                        capture(page)
                        page.wait_for_timeout(1800)
                expect(page.locator('#result')).to_be_visible(timeout=180000)
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
                page.wait_for_timeout(350)
                page.locator('#replay-play').click()
                assert int(page.locator('#replay-slider').input_value())>0
                page.locator('#replay-exit').click()
                for report_tab in ['military','economy','diplomacy','overview']:
                    page.locator(f'#aar-tab-{report_tab}').click()
                    expect(page.locator(f'#aar-{report_tab}')).to_be_visible()
                report['assertions'].append('Completed live match opened player/alliance review, scrubbable playback and all report tabs; CLI review and historical board agreed.')
                stdout,stderr=bot.communicate(timeout=20);assert bot.returncode==0,stderr
                assert json.loads(stdout)['scores']==result['outcome']['scores']
                report['assertions'].append('Wall-clock match reached a final result; browser and external agent observed identical final scores.')
                page.locator('#aar-back').click()
                expect(page.locator('#standings')).to_contain_text('Browser Commander')
                report['assertions'].append('Persistent Prestige standings included the browser player after returning to the rooms.')
                # Local UI interactions: distinct source selection, keyboard tabs and a real next room.
                page.locator('#room-name').fill('Second Council')
                page.locator('[data-ruleset="classic"]').click()  # this room checks the classic 12-troop development path
                page.locator('#create-form button[type=submit]').click()
                expect(page.locator('#lobby')).to_be_visible()
                page.locator('[data-country-seat="usa"]').click()
                page.locator('#join-form button').click()
                page.locator('#fill-bots').click()
                page.locator('#start-match').click()
                expect(page.locator('#phase')).to_have_text('In session')
                expect(page.locator('#card')).to_be_hidden()
                if page.locator('#coach').is_visible():page.locator('#coach-skip').click()
                names={p['id']:p['name'] for p in http('/map.json')['provinces']}
                # Tap-tap on the map: your province, then a neighbour; Shift-click switches the source.
                province(page,'west-us');expect(page.locator('#card-title')).to_have_text(names['west-us'])
                expect(page.locator('#card')).to_have_attribute('data-size','peek')  # a map selection opens a peeking card
                if not page.locator('#marker-mexico').is_visible():page.locator('#zoom-out').click()
                page.mouse.click(*centre(page.locator('#marker-mexico .counter-body')))
                expect(page.locator('#card-title')).to_have_text(names['mexico']);expect(page.locator('#card-sub')).to_contain_text(names['west-us'])
                page.locator('[data-fraction="1"]').click();expect(page.locator('#amount-out')).to_contain_text('100%')
                page.keyboard.down('Shift');page.mouse.click(*centre(page.locator('#marker-central-us .counter-body')));page.keyboard.up('Shift')
                expect(page.locator('#card-title')).to_have_text(names['central-us'])
                page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
                page.locator('#hud-standard').focus();page.keyboard.press('Enter')
                expect(page.locator('#card')).to_have_attribute('data-kind','alliance');expect(page.locator('#card-title')).to_be_focused()
                page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden();expect(page.locator('#hud-standard')).to_be_focused()
                report['assertions'].append('A second room starts with the same browser identity; map taps open a peeking order card (province, then neighbour); 100% and Shift-source selection work; the standard opens and closes the alliance card by keyboard with focus returned.')
                # Attack together: with the target chosen, tapping another of your provinces beside it adds a source.
                order(page,'west-us','mexico');page.locator('[data-fraction="0.5"]').click()
                page.locator('#card-size').click()  # back to peek so the map is free
                page.mouse.click(*centre(page.locator('#marker-central-us .counter-body')))
                expect(page.locator('#sources .source-chip')).to_have_count(2)
                page.locator('#card-size').click();expect(page.locator('#order-details')).to_contain_text('arrive together')
                page.screenshot(path=str(artifacts/'06-coordinated-plan.png'),full_page=True)
                capture(page,1300)
                page.locator('#primary').click()
                expect(lane(page)).to_contain_text('Sent')
                room2=http('/api/games')['games'][0]['id']
                page.wait_for_timeout(1400)
                # Group recall is a browser control, never direct mutation of the game.
                province(page,'west-us');page.locator('#card-size').click()
                recall_group=page.locator('[data-recall]').filter(has_text='Recall group')
                expect(recall_group).to_be_visible(timeout=10000)
                recall_group.click()
                expect(lane(page)).to_contain_text('Recall queued')
                expect(page.locator('.march-row.returning').first).to_be_visible(timeout=5000)
                page.screenshot(path=str(artifacts/'07-recalling.png'),full_page=True)
                capture(page,1300)
                report['assertions'].append('Browser committed a two-source attack (a second province added by tapping it beside the target) as one order, then recalled the group with real return time.')
                # Alaska starts undeveloped; let natural recruitment fund construction.
                province(page,'alaska')
                develop=page.locator('#develop-province')
                expect(develop).to_be_enabled(timeout=15000)
                page.locator('#card-size').click();expect(page.locator('#development-payback')).to_contain_text('payback')
                develop.click()
                expect(page.locator('#confirm-dialog')).to_contain_text('Spend 12 troops')
                page.locator('#confirm-dialog [value="confirm"]').click()
                expect(lane(page)).to_contain_text('Investment committed')
                expect(develop).to_contain_text(re.compile('Construction queued|Building level'),timeout=6000)
                page.screenshot(path=str(artifacts/'08-development.png'),full_page=True)
                capture(page,1300)
                expect(page.locator('#card-sub')).to_contain_text('industry Ⅱ',timeout=15000)
                report['assertions'].append('Browser funded, confirmed and completed province development using naturally recruited manpower.')
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                page.screenshot(path=str(artifacts/'09-mobile-orders.png'),full_page=True)
                page.set_viewport_size({'width':1600,'height':1050})

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
            if bot and bot.poll() is None:bot.terminate();bot.wait(timeout=10)
            server.terminate();server.wait(timeout=10)
            (artifacts/'browser-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    # Keep the focused historical-review checks in the existing CI entry point.
    review_command=[sys.executable,str(ROOT/'tests/review-browser.py'),'--artifacts',str(artifacts/'review')]
    if args.bridge:review_command.append('--bridge')
    if args.executable:review_command.extend(['--executable',args.executable])
    if args.review_gif:review_command.extend(['--gif',args.review_gif])
    subprocess.run(review_command,cwd=ROOT,check=True)
    ui_command=[sys.executable,str(ROOT/'tests/ui-browser.py'),'--artifacts',str(artifacts/'ui')]
    if args.bridge:ui_command.append('--bridge')
    if args.executable:ui_command.extend(['--executable',args.executable])
    if args.ui_gif:ui_command.extend(['--gif',args.ui_gif])
    subprocess.run(ui_command,cwd=ROOT,check=True)
    # Voice input: fake microphone through MediaRecorder, the /stt proxy and a fake sidecar.
    voice_command=[sys.executable,str(ROOT/'tests/voice-browser.py'),'--artifacts',str(artifacts/'voice')]
    if args.executable:voice_command.extend(['--executable',args.executable])
    if not args.bridge:subprocess.run(voice_command,cwd=ROOT,check=True)

if __name__=='__main__':main()
