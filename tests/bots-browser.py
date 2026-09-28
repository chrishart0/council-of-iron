"""Actual lobby controls and traditional-bot DMs; no direct game-state mutation."""
import argparse, json, os, subprocess, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_helpers import load_bridge
ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bridge', action='store_true')
    parser.add_argument('--executable', default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts', default=str(ROOT/'artifacts/bots'))
    args = parser.parse_args(); out = Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
    report = {'status':'not completed', 'transport':'python-http-bridge' if args.bridge else 'native-browser-http', 'assertions':[], 'pageErrors':[], 'clock':'test-stepped, not a latency test'}
    server = subprocess.Popen(['node','tests/bots-browser-server.js'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        url = json.loads(server.stdout.readline())['url']
        def http(path):
            with urllib.request.urlopen(url+path, timeout=15) as response: return json.load(response)
        def step(n):
            server.stdin.write(f'{n}\n'); server.stdin.flush()
            assert json.loads(server.stdout.readline())['stepped'] == n
        with sync_playwright() as p:
            launch = {'headless':True}
            if args.executable: launch['executable_path'] = args.executable
            browser = p.chromium.launch(**launch)
            page = browser.new_page(viewport={'width':1600,'height':1000})
            page.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
            if args.bridge: load_bridge(page, url)
            else: page.goto(url)
            expect(page.locator('#connection')).to_have_text('Live')
            page.locator('#display-name').fill('Human Commander')
            page.locator('#room-name').fill('A council of rivals')
            page.locator('#create-form button').click()
            expect(page.locator('#lobby')).to_be_visible()
            room = http('/api/games')['games'][0]['id']
            page.locator('#country-choice').select_option('usa')
            page.locator('#join-form button').click()
            expect(page.locator('#lobby-note')).to_contain_text('You command United States')
            page.locator('#bot-seat').select_option('germany')
            page.locator('#bot-difficulty').select_option('hard')
            page.locator('#bot-personality').select_option('builder')
            page.locator('#fill-bots').click()
            expect(page.locator('#bot-roster')).to_contain_text('Hard · Industrialist')
            g = http(f'/api/games/{room}'); military_before = g['provinces']
            assert next(x for x in g['players'] if x['id']=='germany')['bot'] == {'difficulty':'hard','personality':'builder'}
            page.locator('#bot-seat').select_option('germany')
            expect(page.locator('#bot-difficulty')).to_have_value('hard')
            expect(page.locator('#bot-personality')).to_have_value('builder')
            page.locator('#bot-difficulty').select_option('easy')
            page.locator('#bot-personality').select_option('diplomat')
            expect(page.locator('#fill-bots')).to_have_text('Update commander')
            page.locator('#fill-bots').click()
            expect(page.locator('#bot-roster')).to_contain_text('Easy · Diplomat')
            assert http(f'/api/games/{room}')['provinces'] == military_before
            report['assertions'].append('Host adds a Hard Industrialist to one country and reconfigures it as Easy Diplomat through real controls; assets remain identical.')
            page.locator('#bot-seat').select_option('')
            page.locator('#bot-difficulty').select_option('standard')
            page.locator('#bot-personality').select_option('mixed')
            page.locator('#fill-bots').click()
            expect(page.locator('#room-label')).to_contain_text('8/8')
            g = http(f'/api/games/{room}')
            assert len([x for x in g['players'] if x.get('bot')]) == 7
            assert next(x for x in g['players'] if x['id']=='germany')['bot']['difficulty'] == 'easy'
            assert all(x['bot']['personality'] != 'mixed' for x in g['players'] if x.get('bot'))
            assert not page.locator('#bot-seat option[value="usa"]').count()
            page.screenshot(path=str(out/'01-bot-lobby.png'), full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            page.locator('#bot-seat').scroll_into_view_if_needed()
            page.screenshot(path=str(out/'02-mobile-bot-lobby.png'), full_page=True)
            page.set_viewport_size({'width':1600,'height':1000})
            report['assertions'].append('Fill empty seats preserves existing settings and human seats, resolves visible mixed doctrines, and fits a 390-pixel lobby.')
            page.locator('#start-match').click()
            expect(page.locator('#opening-form')).to_be_visible()
            page.locator('#leader-name').fill('President Hart')
            page.locator('#opening-message').fill('We come to compete with the computer commanders.')
            page.locator('#opening-form button').click()
            expect(page.locator('#phase')).to_have_text('IN SESSION')
            expect(page.locator('#lobby')).to_be_hidden()
            page.locator('[data-tab="dispatches"]').click()
            page.locator('#channel').select_option('dm')
            page.locator('#recipient').select_option('germany')
            expect(page.locator('#bot-chat-hint')).to_be_visible()
            expect(page.locator('#bot-chat-hint')).to_contain_text('/status')
            page.locator('[data-bot-draft="/status"]').click()
            expect(page.locator('#chat-text')).to_have_value('/status')
            assert not any(e.get('type')=='message' and e.get('text')=='/status' for e in http(f'/api/games/{room}')['events'])
            page.locator('#chat-form button[type=submit]').click()
            expect(page.locator('#chat-text')).to_have_value('')
            step(55)
            expect(page.locator('#messages')).to_contain_text('provinces', timeout=10000)
            assert not any(e.get('type')=='message' and e.get('channel')=='dm' for e in http(f'/api/games/{room}')['events'])
            page.screenshot(path=str(out/'03-bot-dispatch.png'), full_page=True)
            report['assertions'].append('Started bots answer the human’s supported /status DM through the same chat API; draft buttons do not send until approved, and controls describe limited language support; public spectator data excludes DMs.')
            page.locator('#chat-text').fill('/attack north-france')
            page.locator('#chat-form button[type=submit]').click()
            expect(page.locator('#chat-text')).to_have_value('')
            step(75)
            expect(page.locator('#messages')).to_contain_text('formal allies', timeout=10000)
            page.locator('#channel').select_option('world')
            expect(page.locator('#bot-chat-hint')).to_be_hidden()
            report['assertions'].append('A non-ally cannot issue tactical requests to a traditional bot; reply explains the formal-alliance requirement.')
            assert not report['pageErrors'], report['pageErrors']
            report['status'] = 'passed'; browser.close()
    finally:
        server.terminate(); server.wait(timeout=15)
        (out/'bots-browser-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))

if __name__=='__main__': main()
