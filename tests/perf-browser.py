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
from browser_helpers import stop

THROTTLE = 4
BUDGET = {'busy_pct': 60, 'long_task_ms': 200, 'infinite_anims': 0, 'poll_wire_kb': 15, 'node_growth': 1.25,
          'heap_growth_mb': 16}

# Compare each list update: continuously present, unchanged rows retain their nodes. Temporary threat rows and
# their minute separators may disappear and later return; an eight-second before/after snapshot mislabels that.
TAG = """() => {
  const list = document.querySelector('#comms .cx-rows');
  const read = () => new Map([...list.children].map(e => [e.__key, { html: e.__html, node: e }]));
  const watch = window.__threadWatch = { rows: read(), recreated: 0, keys: [] };
  watch.observer = new MutationObserver(() => {
    const next = read();
    for (const [key, e] of next) { const b = watch.rows.get(key);
      if (b && b.html === e.html && b.node !== e.node) { watch.recreated++; watch.keys.push(key); }
    }
    watch.rows = next;
  });
  watch.observer.observe(list, { childList: true }); return watch.rows.size;
}"""
RECREATED = """() => { const w = window.__threadWatch; w.observer.disconnect(); w.rows.clear(); return w.recreated; }"""

def check_row_watch(browser):
    """The probe catches an unchanged replacement and permits a temporary row to leave and return."""
    page = browser.new_page()
    try:
        page.set_content('<div id="comms"><ul class="cx-rows"></ul></div>')
        page.evaluate("""() => { window.__makeRow = key => {
          const e = document.createElement('li'); e.__key = key; e.__html = key; e.textContent = key; return e;
        }; document.querySelector('.cx-rows').append(__makeRow('message'), __makeRow('separator')); }""")
        assert page.evaluate(TAG) == 2
        page.evaluate("""async () => {
          document.querySelector('.cx-rows').firstChild.replaceWith(__makeRow('message'));
          await new Promise(r => setTimeout(r, 0));
        }""")
        assert page.evaluate(RECREATED) == 1, 'row probe missed an unchanged replacement'
        assert page.evaluate(TAG) == 2
        page.evaluate("""async () => {
          const list = document.querySelector('.cx-rows'); list.lastChild.remove();
          await new Promise(r => setTimeout(r, 0)); list.append(__makeRow('separator'));
          await new Promise(r => setTimeout(r, 0));
        }""")
        assert page.evaluate(RECREATED) == 0, 'row probe confused a temporary separator with a retained row'
    finally:
        page.close()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--artifacts', default='artifacts/perf'); parser.add_argument('--executable')
    parser.add_argument('--quick', action='store_true', help='Sample DOM growth for 30 s instead of until 25:00, and report the '
        'CPU-time budgets (busy share, long tasks) without failing: they depend on the load of the host.')
    args = parser.parse_args()
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
    report = {'throttle': THROTTLE, 'budget': BUDGET, 'status': 'failed'}
    def timing(ok, what):
        if ok: return
        if not args.quick: raise AssertionError(what)
        report.setdefault('timingOverBudget', []).append(what); print('over the CPU-time budget (not enforced with --quick):', what, file=sys.stderr)
    server, url = start_server(2)
    try:
        me, room = busy_room(url)
        start = wait_tick(url, room, me['token'], 300)
        report['room'] = {'tick': start['tick'], 'armies': len(start['armies']), 'battles': len(start['battles']), 'wars': len(start['wars'])}
        with sync_playwright() as p:
            browser = p.chromium.launch(**({'executable_path': args.executable} if args.executable else {}))
            check_row_watch(browser); report['rowWatchSelfTest'] = 'passed'
            context, page = open_match(browser, url, me, room, p.devices['Pixel 7'], INIT)
            cdp = context.new_cdp_session(page); cdp.send('Performance.enable')
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            page.wait_for_timeout(4000)
            cdp.send('HeapProfiler.enable');cdp.send('HeapProfiler.collectGarbage')
            heap_start=cdp.send('Performance.getMetrics')['metrics']
            heap_start=next(m['value'] for m in heap_start if m['name']=='JSHeapUsedSize')/2**20
            first = page.evaluate('() => document.getElementsByTagName("*").length')
            # 1. The map during a busy match.
            live = window(page, cdp, 12); report['map'] = live
            timing(live['busy_pct'] < BUDGET['busy_pct'], ('main thread busy', live))
            timing(max(live['long_tasks'] or [0]) < BUDGET['long_task_ms'], ('long task', live['long_tasks']))
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
            if recreated:
                report['rows']['recreatedKeys'] = page.evaluate("() => window.__threadWatch.keys")
            assert tagged > 10 and recreated == 0, ('thread rows re-created by polling', report['rows'])
            timing(thread['busy_pct'] < BUDGET['busy_pct'], ('main thread busy with Messages open', thread))
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
            # Sampled while the match runs (a win may end it early; the after-action report is a different screen):
            # until 25:00, or for 30 s with --quick.
            last = first
            for _ in range(15 if args.quick else 180):
                s = page.evaluate('() => ({ status: document.body.dataset.status, nodes: document.getElementsByTagName("*").length, tick: document.getElementById("clock").textContent })')
                if s['status'] != 'running' or s['tick'] >= '30:00': break
                last = max(last, s['nodes']); page.wait_for_timeout(2000)
            report['nodes'] = {'start': first, 'maxWhileRunning': last, 'until': s['tick']}
            assert last < first * BUDGET['node_growth'], ('DOM growth', first, last)
            cdp.send('HeapProfiler.collectGarbage')
            metrics=cdp.send('Performance.getMetrics')['metrics']
            heap_end=next(m['value'] for m in metrics if m['name']=='JSHeapUsedSize')/2**20
            listeners=next(m['value'] for m in metrics if m['name']=='JSEventListeners')
            report['long_match_memory']={'heap_start_mb':round(heap_start,1),'heap_end_mb':round(heap_end,1),
                'heap_growth_mb':round(heap_end-heap_start,1),'dom_nodes':s['nodes'],'event_listeners':listeners,'game_clock':s['tick']}
            assert heap_end-heap_start < BUDGET['heap_growth_mb'], ('browser heap growth', report['long_match_memory'])
            assert listeners < 300, ('browser event listeners grew without a bound', report['long_match_memory'])
            if not args.quick:
                if s['status'] != 'finished':
                    page.wait_for_function("() => document.body.dataset.status === 'finished'",timeout=120000)
                review_heaps=[]
                page.locator('#aar-back').click()
                page.wait_for_selector(f'#rooms [data-room="{room}"]')
                for _ in range(3):
                    page.locator(f'#rooms [data-room="{room}"]').click()
                    page.wait_for_function("() => document.body.dataset.status === 'finished' && !document.getElementById('result').hidden")
                    page.wait_for_timeout(100)
                    page.locator('#aar-back').click()
                    page.wait_for_selector(f'#rooms [data-room="{room}"]')
                    cdp.send('HeapProfiler.collectGarbage')
                    values=cdp.send('Performance.getMetrics')['metrics']
                    review_heaps.append(round(next(m['value'] for m in values if m['name']=='JSHeapUsedSize')/2**20,1))
                report['review_open_close_heap_mb']=review_heaps
                assert max(review_heaps)-min(review_heaps)<8, ('review open/close retained heap',review_heaps)
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
        stop(server)
        (artifacts / 'perf-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
