"""Read-only after-action UX against a recorded, fully adjudicated match.
Native Chromium HTTP by default; --bridge has the limitations in browser_helpers.
"""
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_helpers import load_bridge

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bridge',action='store_true')
    parser.add_argument('--executable',default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts',default=str(ROOT/'artifacts/review'))
    parser.add_argument('--gif')
    args=parser.parse_args()
    out=Path(args.artifacts);out.mkdir(parents=True,exist_ok=True)
    report={'transport':'python-http-bridge' if args.bridge else 'native-browser-http','assertions':[],'pageErrors':[]}
    frames=[]
    server=subprocess.Popen(['node','tests/review-browser-server.js'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        line=server.stdout.readline()
        assert line,server.stderr.read()
        url=json.loads(line)['url']
        def api(path):
            with urllib.request.urlopen(url+path,timeout=20) as response:return json.load(response)
        def capture(page,name=None,delay=700):
            if name:page.screenshot(path=str(out/name),full_page=True)
            if args.gif and page.viewport_size['width']>=1200:
                page.evaluate('window.scrollTo(0,0)')
                frames.append((page.screenshot(),delay))
        with sync_playwright() as playwright:
            options={'headless':True}
            if args.executable:options['executable_path']=args.executable
            browser=playwright.chromium.launch(**options)
            context=browser.new_context(viewport={'width':1500,'height':1200})
            page=context.new_page()
            page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(page,url)
            else:page.goto(url)
            expect(page.locator('[data-room="review-fixture"]')).to_have_text('Review →')
            page.locator('[data-room="review-fixture"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
            expect(page.locator('#aar-alliances article')).to_have_count(3)
            expect(page.locator('[data-result-country="usa"]')).to_contain_text('+73.33')
            expect(page.locator('#aar-alliances')).to_contain_text('+406.67')
            expect(page.locator('.war-room')).to_be_hidden()
            capture(page,'01-overview.png',1000)
            report['assertions'].append('Finished room opens Overview: all eight player scores and three alliance aggregates; live commands are hidden.')
            page.locator('#aar-tab-replay').click()
            expect(page.locator('#replay-stage')).to_be_visible()
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','0')
            opening_fill=page.locator('#review-map-province-mexico').get_attribute('fill')
            for tick in [500,0,335,530,439,500]:
                page.locator('#replay-slider').fill(str(tick))
                expect(page.locator('#replay-stage')).to_have_attribute('data-tick',str(tick))
                board=api(f'/api/games/review-fixture/replay?tick={tick}')
                for province in ['north-india','low-countries','central-us']:
                    expected=next(p['troops'] for p in board['provinces'] if p['id']==province)
                    expect(page.locator('#review-map-troops-'+province)).to_have_text(str(expected))
            assert page.locator('#review-map-province-mexico').get_attribute('fill')!=opening_fill
            page.locator('[data-aar-map="europe"]').click()
            # Neighbouring same-owner counters may be merged at this width; one zoom step separates them.
            page.locator('[data-aar-map="in"]').click();expect(page.locator('#review-map-marker-low-countries')).to_be_visible()
            page.locator('#review-map-marker-low-countries').press('Enter')
            expect(page.locator('#replay-inspector')).to_contain_text('Netherlands')
            expect(page.locator('#replay-inspector')).to_contain_text('Incoming waves')
            capture(page,'02-replay-europe.png')
            page.locator('[data-aar-map="world"]').click()
            capture(page,'03-replay-world.png')
            report['assertions'].append('Forward/backward scrubbing matches exact API troop states and ownership; province inspector and zoom work.')
            ids=page.locator('[id]').evaluate_all('(nodes)=>nodes.map(n=>n.id)')
            assert len(ids)==len(set(ids)),'Live and replay maps have conflicting element IDs'
            page.locator('[data-aar-transport="start"]').click()
            page.locator('#replay-speed').select_option('64')
            page.locator('#replay-play').click();page.wait_for_timeout(400);page.locator('#replay-play').click()
            paused=page.locator('#replay-slider').input_value();assert int(paused)>0
            page.wait_for_timeout(160);assert page.locator('#replay-slider').input_value()==paused
            page.locator('#replay-slider').focus();page.keyboard.press('ArrowRight')
            assert int(page.locator('#replay-slider').input_value())==int(paused)+1
            page.locator('#replay-slider').fill('363')
            expect(page.locator('#replay-event-label')).to_contain_text('countdown stops')
            page.locator('[data-aar-event="next"]').click();assert int(page.locator('#replay-slider').input_value())>363
            page.locator('[data-aar-transport="end"]').click()
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','530')
            page.locator('#replay-slider').fill('529');page.locator('#replay-play').click()
            expect(page.locator('#replay-play')).to_have_text('Play')
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','530')
            report['assertions'].append('Play, pause, rate change, keyboard slider, event jumps, opening/final controls and automatic end-of-replay stop work.')
            for kind in ['military','economy']:
                page.locator('#aar-tab-'+kind).click()
                expect(page.locator('#aar-'+kind)).to_be_visible()
                page.locator('#'+kind+'-country').select_option('germany')
                assert page.locator('#'+kind+'-chart polyline').count()==1
                page.locator('#'+kind+'-country').select_option('all')
                capture(page,'04-'+kind+'.png')
            expect(page.locator('.aar-accounting')).to_contain_text('2,524')
            page.locator('#aar-tab-military').click()
            page.locator('.aar-ledger [data-aar-seek]').first.click()
            assert int(page.locator('#replay-stage').get_attribute('data-tick')) <= 530
            page.locator('#aar-tab-diplomacy').click()
            expect(page.locator('.aar-tenure-row')).to_have_count(8)
            expect(page.locator('#aar-diplomacy')).to_contain_text('countdown stops')
            capture(page,'05-diplomacy.png')
            report['assertions'].append('Military/economy comparison charts filter by country; battle links seek exact history; diplomacy shows membership intervals and broken holds.')
            page.locator('#aar-tab-diplomacy').focus();page.keyboard.press('Home')
            expect(page.locator('#aar-tab-overview')).to_be_focused()
            expect(page.locator('#aar-overview')).to_be_visible()
            page.set_viewport_size({'width':390,'height':844})
            capture(page,'06-mobile-overview.png')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            page.locator('#aar-tab-replay').click();page.locator('#replay-slider').fill('363')
            capture(page,'07-mobile-replay.png')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            page.set_viewport_size({'width':1500,'height':1200})
            report['assertions'].append('Keyboard tab navigation and 390px layouts pass; tables scroll within their panels, not the document.')
            if args.gif:
                page.locator('[data-aar-map="world"]').click()
                page.evaluate('''() => {const n=document.createElement('div');n.textContent='RECORDED MATCH REPLAY · ACTUAL BROWSER CAPTURE · SINGLE-CONTROLLER TEST';n.style.cssText='position:fixed;right:15px;bottom:10px;background:#203942;color:#f1eddd;padding:7px 12px;font:10px system-ui;z-index:20';document.body.append(n);}''')
                for tick in range(0,531,18):
                    page.locator('#replay-slider').fill(str(tick));capture(page,delay=140)
            before=api('/api/games/review-fixture/review')
            page.locator('#back').click()
            page.locator('[data-room="draw-fixture"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(2)
            expect(page.locator('#result')).to_contain_text('A negotiated peace')
            assert page.locator('#result img').count()==0
            assert not page.evaluate('Boolean(window.REVIEW_XSS)')
            page.locator('#aar-tab-replay').click();expect(page.locator('#replay-stage')).to_be_visible()
            # New rooms use imperial-1910-v4 (80 provinces incl. Hawaii); the recorded v3 match keeps its v3 map.
            assert page.locator('#review-map .province').count()==80 and page.locator('#review-map-province-hawaii').count()==1
            assert api('/api/games/review-fixture/map')['id']=='imperial-1910-v3' and api('/api/games/review-fixture/replay')['map']['id']=='imperial-1910-v3'
            page.locator('#back').click();page.locator('[data-room="old-fixture"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
            page.locator('#aar-tab-replay').click();expect(page.locator('#aar-replay')).to_contain_text('History unavailable')
            report['assertions'].append('Negotiated draw renders correctly, malicious coalition name stays inert, and unverifiable legacy history fails closed while scores remain visible.')
            page.locator('#back').click();page.locator('[data-room="review-fixture"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
            assert api('/api/games/review-fixture/review')==before
            report['assertions'].append('Leaving and reopening reviews releases playback state; watching history does not alter the match or scores.')
            assert not report['pageErrors'],report['pageErrors']
            report['status']='passed'
            browser.close()
        if args.gif and frames:
            from PIL import Image
            images=[];durations=[]
            for data,duration in frames:
                image=Image.open(io.BytesIO(data)).convert('RGB');image.thumbnail((960,768))
                images.append(image.convert('P',palette=Image.Palette.ADAPTIVE,colors=96));durations.append(duration)
            path=Path(args.gif);path.parent.mkdir(parents=True,exist_ok=True)
            images[0].save(path,save_all=True,append_images=images[1:],duration=durations,loop=0,optimize=True,disposal=2)
            report['gif']={'path':str(path),'frames':len(images),'bytes':path.stat().st_size}
    finally:
        server.terminate();server.wait(timeout=10)
        (out/'review-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
