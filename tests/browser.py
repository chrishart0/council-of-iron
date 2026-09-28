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
from browser_helpers import load_bridge

ROOT = Path(__file__).resolve().parents[1]

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
            def cli_events():
                # Busy opponents can produce more than one event page before a DM.
                events=[]; cursor=0
                while True:
                    view=cli('state',str(cursor)); events.extend(view['events']); cursor=view['cursor']
                    if not view['hasMore']: return events
            with sync_playwright() as playwright:
                launch={'headless':True}
                if args.executable: launch['executable_path']=args.executable
                browser=playwright.chromium.launch(**launch)
                context=browser.new_context(viewport={'width':1600,'height':1050},device_scale_factor=1)
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
                page.locator('#preset').select_option('standard')
                page.locator('#create-form button').click()
                expect(page.locator('#lobby')).to_be_visible()
                room=http('/api/games')['games'][0]['id']
                page.locator('#country-choice').select_option('usa')
                page.locator('#join-form button').click()
                expect(page.locator('#lobby-note')).to_contain_text('You command United States')
                report['assertions'].append('Human browser created room and joined USA through UI.')
                cli('join',room,'britain','External CLI Envoy')
                page.locator('#fill-bots').click()
                expect(page.locator('#room-label')).to_contain_text('8/8')
                page.locator('#start-match').click()
                expect(page.locator('#phase')).to_have_text('OPENING COUNCIL')
                page.locator('#leader-name').fill('President Meridian')
                page.locator('#opening-message').fill('The republic enters the council with open eyes and steady resolve.')
                page.locator('#opening-form button').click()
                cli('opening','Envoy Ash','Britain comes to listen, bargain, and stand by its allies.')
                expect(page.locator('#phase')).to_have_text('IN SESSION')
                report['assertions'].append('Separate CLI process joined Britain; six practice bots filled seats; host started eight-seat match.')
                if args.gif:
                    page.evaluate('''() => { const note=document.createElement('div');note.textContent='ACTUAL BROWSER CAPTURE · 12× TEST CLOCK · HEURISTIC AGENTS';note.style.cssText='position:fixed;right:18px;bottom:10px;z-index:20;padding:6px 10px;background:#142c34ee;border:1px solid #c6a87280;color:#e4d6ae;font:9px system-ui;letter-spacing:.7px;border-radius:3px;pointer-events:none';document.body.append(note); }''')
                capture(page,800)
                # Simulate the randomUUID restriction of plain-HTTP LAN browsers.
                page.evaluate('crypto.randomUUID = undefined')
                # Real DOM inputs -> shared action endpoint. No direct state mutation.
                page.locator('#source').select_option('west-us')
                page.locator('#destination').select_option('mexico')
                page.locator('#amount').fill('7')
                expect(page.locator('#preview')).to_contain_text('Risk-style rounds')
                page.locator('#send-army').click()
                expect(page.locator('#toast')).to_contain_text('Army committed')
                cli('war','france')
                cli('move','england','north-france','6')
                page.locator('#source').select_option('central-us')
                page.locator('#destination').select_option('west-us')
                page.locator('.standing-order summary').click()
                page.locator('#set-route').click()
                expect(page.locator('#route-status')).to_contain_text('New recruits',timeout=10000)
                report['assertions'].append('Browser and CLI committed armies; browser set a standing reinforcement route.')
                capture(page,1000)
                page.locator('[data-tab="council"]').click()
                page.locator('#ally-choice').select_option('britain')
                page.locator('#coalition-name').fill('Atlantic Accord')
                page.locator('#alliance-form button').click()
                expect(page.locator('#offers')).to_contain_text('Atlantic Accord')
                capture(page,1000)
                agent_state=cli('state')
                offer=next(q for q in agent_state['proposals'] if q['name']=='Atlantic Accord')
                cli('accept',offer['id'])
                expect(page.locator('#coalition-info')).to_contain_text('Atlantic Accord',timeout=15000)
                report['assertions'].append('Browser proposed coalition; CLI accepted; public notice elapsed; both shared the coalition and payout projection.')
                capture(page,1000)
                # Cancellation must not file an accidental irreversible departure.
                page.locator('#leave-alliance').click()
                expect(page.locator('#confirm-dialog')).to_be_visible()
                page.keyboard.press('Escape')
                expect(page.locator('#confirm-dialog')).not_to_be_visible()
                assert not any(d['country']=='usa' for d in http(f'/api/games/{room}')['departures'])
                report['assertions'].append('Leaving an alliance requires explicit confirmation; Escape leaves membership untouched.')
                page.locator('[data-tab="dispatches"]').click()
                page.locator('#channel').select_option('dm')
                page.locator('#recipient').select_option('britain')
                page.locator('#chat-text').fill('Hold the Atlantic. This dispatch is private.')
                page.locator('#chat-form button[type=submit]').click()
                expect(page.locator('#messages')).to_contain_text('This dispatch is private.')
                assert any(e.get('text')=='Hold the Atlantic. This dispatch is private.' for e in cli_events())
                cli('chat','dm','usa','<img src=x onerror="window.INJECTED=true"> Agreed. I will hold.')
                expect(page.locator('#messages')).to_contain_text('Agreed. I will hold.')
                assert page.locator('#messages img').count()==0
                expect(page.locator('#unread')).to_have_text('')
                page.locator('#chat-text').fill('Unsent draft survives live updates.')
                page.wait_for_timeout(900)
                expect(page.locator('#chat-text')).to_have_value('Unsent draft survives live updates.')
                capture(page,1200)
                report['assertions'].append('Reading the wire clears the unread badge; an unsent draft survives live polling.')
                assert not page.evaluate('Boolean(window.INJECTED)')
                public_state=http(f'/api/games/{room}')
                assert not any(e['type']=='message' and e.get('channel')=='dm' for e in public_state['events'])
                report['assertions'].append('Private diplomacy delivered both ways; spectator API excluded DMs; HTML in agent speech rendered as text, not executable markup.')
                spectator=context.new_page();load_page(spectator)
                expect(spectator.locator('.room-group').first).to_contain_text('Games in progress')
                spectator.locator(f'[data-room="{room}"][data-spectate="true"]').click()
                expect(spectator.locator('#phase')).to_have_text('SPECTATING')
                expect(spectator.locator('#spectator-note')).to_be_visible()
                expect(spectator.locator('#move-form')).to_be_hidden()
                expect(spectator.locator('#command-footer')).to_be_hidden()
                assert spectator.evaluate('document.documentElement.scrollHeight<=innerHeight+1')
                spectator.locator('[data-tab="dispatches"]').click()
                assert 'This dispatch is private.' not in spectator.locator('#messages').inner_text()
                expect(spectator.locator('#scoreboard .country-card')).to_have_count(8)
                spectator.screenshot(path=str(artifacts/'spectator-desktop.png'),full_page=True)
                spectator.locator('#spectator-fullscreen').click()
                expect(spectator.locator('body')).to_have_class(re.compile('spectator-map-fullscreen'))
                assert spectator.locator('.war-room').bounding_box()['height'] >= 1049
                page.locator('#channel').select_option('world')
                expect(page.locator('#chat-form button[type=submit]')).to_be_enabled(timeout=10000)
                page.locator('#chat-text').fill('<img src=x onerror="window.INJECTED=true"> Public call to the council.')
                page.locator('#chat-form button[type=submit]').click()
                expect(spectator.locator('#spectator-bubbles')).to_contain_text('Public call to the council.',timeout=10000)
                assert spectator.locator('#spectator-bubbles img').count()==0
                spectator.screenshot(path=str(artifacts/'spectator-fullscreen.png'),full_page=True)
                assert 'This dispatch is private.' not in spectator.locator('#spectator-bubbles').inner_text()
                spectator.keyboard.press('Escape')
                expect(spectator.locator('body')).not_to_have_class(re.compile('spectator-map-fullscreen'))
                spectator.set_viewport_size({'width':390,'height':844})
                spectator.locator('#spectator-fullscreen').click()
                assert spectator.locator('.war-room').bounding_box()['height'] >= 843
                assert spectator.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                spectator.screenshot(path=str(artifacts/'spectator-mobile.png'),full_page=True)
                spectator.close()
                report['assertions'].append('Lobby spectator opened a full-viewport map on desktop and mobile; new world chat appeared as escaped bubbles, while private dispatches stayed hidden.')
                # External process now controls the existing agent seat over the real API.
                bot=subprocess.Popen(['node','agents/bot.js'],cwd=ROOT,env={**os.environ,'COUNCIL_URL':url,'COUNCIL_SESSION':str(Path(tmp)/'agent.session.json'),'COUNCIL_TOKEN':'','COUNCIL_MATCH':room},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                page.locator('[data-tab="orders"]').click()
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    state=http(f'/api/games/{room}')
                    if any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events']):break
                    page.wait_for_timeout(300)
                assert any(e['type']=='battle' and e.get('province')=='mexico' for e in state['events'])
                page.screenshot(path=str(artifacts/'02-campaign.png'),full_page=True)
                capture(page,800)
                page.locator('#europe-view').click();capture(page,900);page.screenshot(path=str(artifacts/'03-europe.png'),full_page=True)
                page.locator('#world-view').click()
                report['assertions'].append('Browser-issued attack fought for Mexico after travel and multiple combat rounds; world and Europe zoom rendered.')
                # Reconnect a second page with the same browser identity, not another join.
                if args.bridge:saved=page.evaluate('window.__testStorage')
                else:saved=None
                reconnect=context.new_page();load_page(reconnect,room,saved)
                expect(reconnect.locator('#commander-title')).to_have_text('United States')
                expect(reconnect.locator('#phase')).to_have_text('IN SESSION')
                report['assertions'].append('Same-seat reconnect restored country and private inbox without duplicate orders.')
                reconnect.close()
                # Mobile width: no document-level horizontal overflow, controls remain reachable.
                page.set_viewport_size({'width':390,'height':844})
                page.locator('[data-tab="council"]').click()
                page.screenshot(path=str(artifacts/'04-mobile.png'),full_page=True)
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
                expect(page.locator('#result')).to_contain_text('Experimental result recorded')
                expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
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
                for report_tab in ['military','economy','diplomacy','overview']:
                    page.locator(f'#aar-tab-{report_tab}').click()
                    expect(page.locator(f'#aar-{report_tab}')).to_be_visible()
                report['assertions'].append('Completed live match opened player/alliance review, scrubbable playback and all report tabs; CLI review and historical board agreed.')
                stdout,stderr=bot.communicate(timeout=20);assert bot.returncode==0,stderr
                assert json.loads(stdout)['scores']==result['outcome']['scores']
                report['assertions'].append('Wall-clock match reached a final result; browser and external agent observed identical final scores.')
                page.locator('[data-home]').click()
                identity=json.loads(page.evaluate('localStorage.getItem("coi.identity")'))
                saved_result=http('/api/me',token=identity['token'])['history']
                assert any(row['game_id']==room for row in saved_result)
                if result['outcome']['draw']:
                    expect(page.locator('#standings')).to_contain_text('No decisive matches recorded')
                    report['assertions'].append('Draw persisted in personal history without contaminating decisive-match standings.')
                else:
                    expect(page.locator('#standings')).to_contain_text('Browser Commander')
                    report['assertions'].append('Persistent experimental standings included the browser player after returning to the lobby.')
                # Local UI interactions: distinct source selection, keyboard tabs and a real next room.
                page.locator('#room-name').fill('Second Council')
                page.locator('#create-form button').click()
                expect(page.locator('#lobby')).to_be_visible()
                page.locator('#country-choice').select_option('usa')
                page.locator('#join-form button').click()
                room2=http('/api/games')['games'][0]['id']
                cli('join',room2,'germany','External CLI Envoy')
                page.locator('#start-match').click()
                expect(page.locator('#phase')).to_have_text('OPENING COUNCIL')
                page.locator('#leader-name').fill('President Meridian')
                page.locator('#opening-message').fill('A second council meets under the republic’s watch.')
                page.locator('#opening-form button').click()
                cli('opening','Envoy Ash','Germany attends this second council.')
                expect(page.locator('#phase')).to_have_text('IN SESSION')
                page.locator('#marker-west-us').click()
                expect(page.locator('#source')).to_have_value('west-us')
                page.locator('[data-fraction="1"]').click()
                expected_amount=int(page.locator('#amount').get_attribute('max'))
                expect(page.locator('#amount')).to_have_value(str(expected_amount))
                page.locator('#marker-mexico').click()
                expect(page.locator('#destination')).to_have_value('mexico')
                page.locator('#marker-central-us').click(modifiers=['Shift'])
                expect(page.locator('#source')).to_have_value('central-us')
                expect(page.locator('#destination')).to_have_value('')
                page.locator('#orders-label').focus()
                page.keyboard.press('ArrowRight')
                expect(page.locator('#council-label')).to_be_focused()
                expect(page.locator('#council-label')).to_have_attribute('aria-selected','true')
                report['assertions'].append('A second room starts with the same browser identity; map targeting, Max, Shift-source selection and keyboard tabs work.')
                page.locator('[data-tab="orders"]').click()
                page.locator('#source').select_option('west-us')
                page.locator('#destination').select_option('mexico')
                page.locator('[data-order-mode=coordinate]').click()
                page.locator('#group-percent').select_option('50')
                page.locator('[data-attack-source="central-us"]').check()
                page.locator('#coordinate-preview').click()
                expect(page.locator('#attack-plan')).to_contain_text('Shared arrival')
                page.screenshot(path=str(artifacts/'06-coordinated-plan.png'),full_page=True)
                capture(page,1300)
                page.locator('#coordinate-commit').click()
                expect(page.locator('#toast')).to_contain_text('Coordinated attack committed')
                page.wait_for_timeout(1400)
                # Group recall is a browser control, never direct mutation of the game.
                recall_group=page.locator('[data-recall]').filter(has_text='Recall group')
                expect(recall_group).to_be_visible(timeout=10000)
                recall_group.click()
                expect(page.locator('#toast')).to_contain_text('Recall queued')
                expect(page.locator('.march-row.returning').first).to_be_visible(timeout=5000)
                page.screenshot(path=str(artifacts/'07-recalling.png'),full_page=True)
                capture(page,1300)
                report['assertions'].append('Browser previewed and committed a two-source synchronized attack, then recalled the group with real return time.')
                # Alaska starts undeveloped; let natural recruitment fund construction.
                page.locator('[data-order-mode=develop]').click()
                page.locator('#source').select_option('alaska')
                expect(page.locator('#development-panel')).to_be_visible()
                expect(page.locator('#develop-province')).to_be_enabled(timeout=30000)
                expect(page.locator('#development-payback')).to_contain_text('payback')
                page.locator('#develop-province').click()
                expect(page.locator('#confirm-dialog')).to_contain_text('Spend 20 troops')
                page.locator('#confirm-dialog [value="confirm"]').click()
                expect(page.locator('#toast')).to_contain_text('Investment committed')
                expect(page.locator('#development-status')).to_contain_text('completes in',timeout=6000)
                page.screenshot(path=str(artifacts/'08-development.png'),full_page=True)
                capture(page,1300)
                expect(page.locator('#industry-level')).to_contain_text('Ⅱ',timeout=18000)
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
    bot_command=[sys.executable,str(ROOT/'tests/bots-browser.py'),'--artifacts',str(artifacts/'bots')]
    if args.bridge:bot_command.append('--bridge')
    if args.executable:bot_command.extend(['--executable',args.executable])
    subprocess.run(bot_command,cwd=ROOT,check=True)

if __name__=='__main__':main()
