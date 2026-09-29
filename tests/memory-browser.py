"""Phone-profile memory sample for a finished match, player, spectator and repeated review open/close."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parent))
from perf_probe import INIT
from perf_room import start_server,busy_room,open_match
from browser_helpers import stop

def metrics(cdp):
    cdp.send('HeapProfiler.collectGarbage')
    items=cdp.send('Performance.getMetrics')['metrics']
    by_name={m['name']:m['value'] for m in items}
    return {'heap_mb':round(by_name['JSHeapUsedSize']/2**20,1),'dom_nodes':int(by_name['Nodes']),
            'event_listeners':int(by_name['JSEventListeners'])}

def main():
    server,url=start_server(2)
    try:
        me,room=busy_room(url)
        with sync_playwright() as p:
            browser=p.chromium.launch()
            player_context,player=open_match(browser,url,me,room,p.devices['Pixel 7'],INIT)
            player_cdp=player_context.new_cdp_session(player);player_cdp.send('Performance.enable');player_cdp.send('HeapProfiler.enable')
            spectator_context=browser.new_context(**p.devices['Pixel 7']);spectator_context.add_init_script(INIT)
            spectator=spectator_context.new_page();spectator.goto(f'{url}/?match={room}&spectate=1');spectator.wait_for_selector('#map .map-counter')
            spectator_cdp=spectator_context.new_cdp_session(spectator);spectator_cdp.send('Performance.enable');spectator_cdp.send('HeapProfiler.enable')
            player.wait_for_function("() => document.body.dataset.status === 'finished'",timeout=240000)
            player.wait_for_function("() => !document.getElementById('result').hidden")
            spectator.wait_for_function("() => document.body.dataset.status === 'finished'",timeout=30000)
            result={'room':room,'tick':player.locator('#clock').inner_text(),
                    'player':metrics(player_cdp),'spectator':metrics(spectator_cdp),'review_cycles':[]}
            for _ in range(3):
                player.locator('#aar-back').click()
                player.locator(f'#rooms [data-room="{room}"]').click()
                player.wait_for_function("() => document.body.dataset.status === 'finished' && !document.getElementById('result').hidden")
                result['review_cycles'].append(metrics(player_cdp))
            assert max(x['heap_mb'] for x in result['review_cycles'])-min(x['heap_mb'] for x in result['review_cycles'])<8,result
            assert result['player']['event_listeners']<300 and result['spectator']['event_listeners']<300,result
            print(json.dumps(result,indent=2));browser.close()
    finally:stop(server)

if __name__=='__main__':main()
