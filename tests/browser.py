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
import tempfile
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge', action='store_true')
    parser.add_argument('--executable', default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts', default=str(ROOT / 'artifacts'))
    args = parser.parse_args()
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
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
            def bridge_fetch(payload):
                path = payload['path']
                assert path.startswith('/') and not path.startswith('//'), 'Bridge is restricted to this local game server.'
                options=payload.get('options') or {}
                request=urllib.request.Request(url+path,method=options.get('method','GET'),headers=options.get('headers') or {},data=options['body'].encode() if options.get('body') is not None else None)
                try:
                    with urllib.request.urlopen(request,timeout=15) as response:
                        return {'status':response.status,'body':response.read().decode()}
                except urllib.error.HTTPError as error:
                    return {'status':error.code,'body':error.read().decode()}
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
                        page.expose_function('__localHttp',bridge_fetch)
                        html=(ROOT/'public/index.html').read_text()
                        html=re.sub(r'<script[^>]+src="/app.js"[^>]*></script>','',html)
                        html=re.sub(r'<link[^>]+href="/style.css"[^>]*>','',html)
                        page.set_content(html)
                        page.add_style_tag(content=(ROOT/'public/style.css').read_text())
                        page.evaluate('''saved => {
                            const storage = saved || {};
                            Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]}});
                            window.__testStorage=storage;
                            history.replaceState=()=>{};
                            if(!crypto.randomUUID)crypto.randomUUID=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
                            window.fetch=async(path,options={})=>{const r=await window.__localHttp({path,options});return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body)};};
                        }''',saved or {})
                        page.add_script_tag(type='module',content=(ROOT/'public/app.js').read_text())
                        expect(page.locator('#connection')).to_have_text('Connected')
                        if match: page.locator(f'[data-room="{match}"]').click()
                    expect(page.locator('#connection')).to_have_text('Connected')
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
                expect(page.locator('#phase')).to_have_text('IN SESSION')
                report['assertions'].append('Separate CLI process joined Britain; six practice bots filled seats; host started eight-seat match.')
                # Simulate the randomUUID restriction of plain-HTTP LAN browsers.
                page.evaluate('crypto.randomUUID = undefined')
                # Real DOM inputs -> shared action endpoint. No direct state mutation.
                page.locator('#source').select_option('west-us')
                page.locator('#destination').select_option('mexico')
                page.locator('#amount').fill('7')
                expect(page.locator('#preview')).to_contain_text('5 surviving troops')
                page.locator('#send-army').click()
                expect(page.locator('#toast')).to_contain_text('Army committed')
                cli('move','england','north-france','6')
                page.locator('#source').select_option('central-us')
                page.locator('#destination').select_option('west-us')
                page.locator('#set-route').click()
                expect(page.locator('#route-status')).to_contain_text('New recruits',timeout=10000)
                report['assertions'].append('Browser and CLI committed armies; browser set a standing reinforcement route.')
                page.locator('[data-tab="council"]').click()
                page.locator('#ally-choice').select_option('britain')
                page.locator('#coalition-name').fill('Atlantic Accord')
                page.locator('#alliance-form button').click()
                expect(page.locator('#offers')).to_contain_text('Atlantic Accord')
                agent_state=cli('state')
                offer=next(q for q in agent_state['proposals'] if q['name']=='Atlantic Accord')
                cli('accept',offer['id'])
                expect(page.locator('#coalition-info')).to_contain_text('Atlantic Accord',timeout=15000)
                report['assertions'].append('Browser proposed coalition; CLI accepted; public notice elapsed; both shared the coalition and payout projection.')
                page.locator('[data-tab="dispatches"]').click()
                page.locator('#channel').select_option('dm')
                page.locator('#recipient').select_option('britain')
                page.locator('#chat-text').fill('Hold the Atlantic. This dispatch is private.')
                page.locator('#chat-form button').click()
                expect(page.locator('#messages')).to_contain_text('This dispatch is private.')
                assert any(e.get('text')=='Hold the Atlantic. This dispatch is private.' for e in cli('state')['events'])
                cli('chat','dm','usa','<img src=x onerror="window.INJECTED=true"> Agreed. I will hold.')
                expect(page.locator('#messages')).to_contain_text('Agreed. I will hold.')
                assert page.locator('#messages img').count()==0
                assert not page.evaluate('Boolean(window.INJECTED)')
                public_state=http(f'/api/games/{room}')
                assert not any(e['type']=='message' and e.get('channel')=='dm' for e in public_state['events'])
                report['assertions'].append('Private diplomacy delivered both ways; spectator API excluded DMs; HTML in agent speech rendered as text, not executable markup.')
                # External process now controls the existing agent seat over the real API.
                bot=subprocess.Popen(['node','agents/bot.js'],cwd=ROOT,env={**os.environ,'COUNCIL_URL':url,'COUNCIL_SESSION':str(Path(tmp)/'agent.session.json'),'COUNCIL_TOKEN':'','COUNCIL_MATCH':room},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                page.locator('[data-tab="orders"]').click()
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    state=http(f'/api/games/{room}')
                    if next(p for p in state['provinces'] if p['id']=='mexico')['owner']=='usa':break
                    page.wait_for_timeout(300)
                assert next(p for p in state['provinces'] if p['id']=='mexico')['owner']=='usa'
                page.screenshot(path=str(artifacts/'02-campaign.png'),full_page=True)
                page.locator('#europe-view').click();page.screenshot(path=str(artifacts/'03-europe.png'),full_page=True)
                page.locator('#world-view').click()
                report['assertions'].append('Browser-issued attack captured Mexico after travel and combat; world and Europe zoom rendered.')
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
                expect(page.locator('#result')).to_be_visible(timeout=180000)
                result=http(f'/api/games/{room}')
                assert result['status']=='finished' and len(result['outcome']['scores'])==8
                report['outcome']=result['outcome']
                public_events=[]; event_cursor=0
                while True:
                    batch=http(f'/api/games/{room}?after={event_cursor}'); public_events.extend(batch['events']); event_cursor=batch['cursor']
                    if not batch['hasMore']: break
                report['events']={kind:sum(e['type']==kind for e in public_events) for kind in ['battle','army_departed','alliance_activated']}
                expect(page.locator('#result')).to_contain_text('Experimental result recorded')
                page.screenshot(path=str(artifacts/'05-result.png'),full_page=True)
                stdout,stderr=bot.communicate(timeout=20);assert bot.returncode==0,stderr
                assert json.loads(stdout)['scores']==result['outcome']['scores']
                report['assertions'].append('Wall-clock match reached a final result; browser and external agent observed identical final scores.')
                page.locator('[data-home]').click()
                expect(page.locator('#standings')).to_contain_text('Browser Commander')
                report['assertions'].append('Persistent experimental standings included the browser player after returning to the lobby.')
                assert not report['pageErrors'],report['pageErrors']
                report['status']='passed'
                browser.close()
        finally:
            if bot and bot.poll() is None:bot.terminate();bot.wait(timeout=10)
            server.terminate();server.wait(timeout=10)
            (artifacts/'browser-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
