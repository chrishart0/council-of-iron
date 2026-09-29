"""Mobile performance regression checks (docs/PERFORMANCE.md), in a real browser against the real HTTP server.

A live room with one human seat (the browser, Britain) and seven practice bots on an accelerated test clock
(the whole clock is scaled, as every browser test does; no endpoint advances time). Chromium emulates a Pixel 7
with the CPU throttled 4x. Budgets are set from the measured after-numbers with headroom; they fail on the
regressions this suite exists for: panels rebuilt on every poll, endless map animations, a busy-looping army
animation, polling while hidden, and DOM growth over a match.
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from perf_probe import INIT, window
from perf_room import start_server, busy_room, wait_tick, open_match, http

THROTTLE = 4
BUDGET = {'busy_pct': 60, 'long_task_ms': 200, 'infinite_anims': 0, 'poll_wire_kb': 15, 'node_growth': 1.25}

# Remember the World thread's rows (key, content, node); later, a row showing the same key and content must be the same node.
TAG = """() => { window.__before = new Map([...document.querySelectorAll('#comms .cx-rows > li')].map(e => [e.__key, { html: e.__html, node: e }]));
  return window.__before.size; }"""
RECREATED = """() => [...document.querySelectorAll('#comms .cx-rows > li')].filter(e => { const b = window.__before.get(e.__key);
  return b && b.html === e.__html && b.node !== e; }).length"""

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--artifacts', default='artifacts/perf'); parser.add_argument('--executable')
    args = parser.parse_args()
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
    report = {'throttle': THROTTLE, 'budget': BUDGET, 'status': 'failed'}
    server, url = start_server(2)
    try:
        me, room = busy_room(url)
        start = wait_tick(url, room, me['token'], 300)
        report['room'] = {'tick': start['tick'], 'armies': len(start['armies']), 'battles': len(start['battles']), 'wars': len(start['wars'])}
        with sync_playwright() as p:
            browser = p.chromium.launch(**({'executable_path': args.executable} if args.executable else {}))
            context, page = open_match(browser, url, me, room, p.devices['Pixel 7'], INIT)
            cdp = context.new_cdp_session(page); cdp.send('Performance.enable')
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            page.wait_for_timeout(4000)
            first = page.evaluate('() => document.getElementsByTagName("*").length')
            # 1. The map during a busy match.
            live = window(page, cdp, 12); report['map'] = live
            assert live['busy_pct'] < BUDGET['busy_pct'], ('main thread busy', live)
            assert max(live['long_tasks'] or [0]) < BUDGET['long_task_ms'], ('long task', live['long_tasks'])
            assert live['infinite_anims'] == BUDGET['infinite_anims'], ('endless animation', live)
            assert live['poll_wire_kb'] < BUDGET['poll_wire_kb'], ('observation payload on the wire', live)
            assert 0 < live['raf_per_s'] <= 12, ('army animation frame rate on a touch screen', live['raf_per_s'])
            # 2. Messages open on the World thread (the history): unchanged rows are never re-created by polling.
            page.evaluate("() => document.getElementById('comms-button').click()")
            page.evaluate("() => (document.querySelector('#comms .cx-switch [data-conv=world]') || document.querySelector('#comms .cx-list [data-conv=world]'))?.click()")
            page.wait_for_timeout(1500)
            tagged = page.evaluate(TAG)
            thread = window(page, cdp, 8); report['world_thread'] = thread
            recreated = page.evaluate(RECREATED); report['rows'] = {'tagged': tagged, 'recreated': recreated}
            assert tagged > 10 and recreated == 0, ('thread rows re-created by polling', report['rows'])
            assert thread['busy_pct'] < BUDGET['busy_pct'], ('main thread busy with Messages open', thread)
            page.evaluate("() => document.querySelector('#comms .cx-close')?.click()")
            # 3. Hidden page: no polling, no animation loop.
            page.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
              Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }""")
            page.wait_for_timeout(1500)
            hidden = window(page, cdp, 6); report['hidden'] = hidden
            assert hidden['polls'] == 0 and hidden['raf_per_s'] == 0, ('work while hidden', hidden)
            page.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
              Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }""")
            # 4. Long run: the DOM does not grow with the match (armies come and go, the history grows by rows only).
            wait_tick(url, room, me['token'], 1500)
            page.wait_for_timeout(2000)
            last = page.evaluate('() => document.getElementsByTagName("*").length')
            report['nodes'] = {'start': first, 'later': last}
            assert last < first * BUDGET['node_growth'], ('DOM growth', first, last)
            context.close()
            # 5. Nothing moves (a lobby): no animation frames at all.
            lobby = http(url, '/api/games', 'POST', {'name': 'Quiet room', 'preset': 'quick'}, me['token'])['id']
            context, page = open_match(browser, url, me, lobby, p.devices['Pixel 7'], INIT)
            cdp = context.new_cdp_session(page); cdp.send('Performance.enable')
            page.wait_for_timeout(2000)
            quiet = window(page, cdp, 4); report['lobby'] = quiet
            assert quiet['raf_per_s'] == 0, ('animation frames with nothing moving', quiet)
            browser.close()
        report['status'] = 'passed'
    finally:
        server.terminate(); server.wait(timeout=10)
        (artifacts / 'perf-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
