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
# Anchored-region audit: visible [data-region] boxes inside #result never overlap (>4 px), leave the viewport, or scroll the page.
AUDIT='''() => {const b=[];for(const e of document.querySelectorAll('#result [data-region]')){if(!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)continue;b.push([e.dataset.region,r.left,r.top,r.right,r.bottom]);}
const o=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const x=b[i],y=b[j];if(x[1]<y[3]-4&&y[1]<x[3]-4&&x[2]<y[4]-4&&y[2]<x[4]-4)o.push(x[0]+' x '+y[0]);}
const d=document.scrollingElement;return {overlaps:o,outside:b.filter(x=>x[1]<-4||x[2]<-4||x[3]>innerWidth+4||x[4]>innerHeight+4).map(x=>x[0]),scroll:d.scrollWidth>innerWidth+1||d.scrollHeight>innerHeight+1||scrollY>0,regions:b.map(x=>x[0])};}'''

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
            expect(page.locator('[data-room="review-fixture"]')).to_contain_text('Review')
            page.locator('[data-room="review-fixture"]').click()
            expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
            expect(page.locator('#aar-standings tr[data-result-alliance]')).to_have_count(3)
            outcome=api('/api/games/review-fixture/review')
            winner=next(a for a in outcome['alliances'] if a['won'])
            for p in outcome['players']:
                row=page.locator(f'[data-result-country="{p["country"]}"]')
                expect(row).to_contain_text({'win':'Won','loss':'Lost','draw':'Draw'}[p['result']]);expect(row.locator('td').nth(1)).to_have_text(str(p['industry']))
            first=page.locator('#aar-standings tr[data-result-alliance]').first
            expect(first).to_have_attribute('data-result-alliance',winner['id']);expect(first).to_contain_text('Victor');expect(first.locator('td').nth(1)).to_have_text(str(winner['economy']))
            expect(page.locator('.v-title h1')).to_contain_text('Victory for the Atlantic Accord')
            # The report covers the finished match: no live command surface is reachable under it.
            assert page.evaluate('''() => { const r=document.querySelector('#result').getBoundingClientRect(); return r.width>=innerWidth-1 && r.height>=innerHeight-1 && document.querySelector('#result').contains(document.elementFromPoint(innerWidth/2, innerHeight/2)); }''')
            assert page.locator('#result [data-act], #result #primary, #result .cx-composer').count()==0
            capture(page,'01-overview.png',1000)
            report['assertions'].append('Finished room opens the after-action report: all eight players (win or loss, final industry) grouped under three alliances, the winning alliance first; the report covers every live command surface.')
            page.locator('#aar-tab-replay').click()
            expect(page.locator('#replay-stage')).to_be_visible()
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','0')
            opening_fill=page.locator('#review-map-province-mexico').get_attribute('fill')
            for tick in [500,0,335,553,463,500]:
                page.locator('#replay-slider').fill(str(tick))
                expect(page.locator('#replay-stage')).to_have_attribute('data-tick',str(tick))
                board=api(f'/api/games/review-fixture/replay?tick={tick}')
                for province in ['india','low-countries','central-us']:
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
            page.locator('#replay-speed [data-speed="64"]').click()
            page.locator('#replay-play').click();page.wait_for_timeout(400);page.locator('#replay-play').click()
            paused=page.locator('#replay-slider').input_value();assert int(paused)>0
            page.wait_for_timeout(160);assert page.locator('#replay-slider').input_value()==paused
            page.locator('#replay-slider').focus();page.keyboard.press('ArrowRight')
            assert int(page.locator('#replay-slider').input_value())==int(paused)+1
            page.locator('#replay-slider').fill('463')
            expect(page.locator('#replay-event-label')).to_contain_text('victory countdown')
            page.locator('[data-aar-event="next"]').click();assert int(page.locator('#replay-slider').input_value())>463
            page.locator('[data-aar-transport="end"]').click()
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','553')
            page.locator('#replay-slider').fill('552');page.locator('#replay-play').click()
            expect(page.locator('#replay-play')).to_have_attribute('aria-label','Play replay')
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','553')
            report['assertions'].append('Play, pause, rate change, keyboard slider, event jumps, opening/final controls and automatic end-of-replay stop work.')
            page.locator('#replay-exit').click()
            for kind in ['military','economy']:
                page.locator('#aar-tab-'+kind).click()
                expect(page.locator('#aar-'+kind)).to_be_visible()
                page.locator(f'[data-chart="{kind}"][data-compare="germany"]').click()
                assert page.locator('#'+kind+'-chart polyline').count()==1
                page.locator(f'[data-chart="{kind}"][data-compare="all"]').click()
                capture(page,'04-'+kind+'.png')
            expect(page.locator('.aar-accounting')).to_contain_text('2,584')
            page.locator('#aar-tab-military').click()
            page.locator('.aar-ledger [data-aar-seek]').first.click()
            assert int(page.locator('#replay-stage').get_attribute('data-tick')) <= 553
            page.locator('#replay-exit').click()
            page.locator('#aar-tab-diplomacy').click()
            expect(page.locator('#aar-diplomacy')).to_contain_text('victory countdown')
            capture(page,'05-diplomacy.png')
            report['assertions'].append('Military/economy comparison charts filter by country; battle links seek exact history; diplomacy lists the turning points including the victory countdown.')
            page.locator('#aar-tab-diplomacy').focus();page.keyboard.press('Home')
            expect(page.locator('#aar-tab-overview')).to_be_focused()
            expect(page.locator('#aar-overview')).to_be_visible()
            page.set_viewport_size({'width':390,'height':844})
            capture(page,'06-mobile-overview.png')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            page.locator('#aar-tab-replay').click();page.locator('#replay-slider').fill('463')
            capture(page,'07-mobile-replay.png')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            page.locator('#replay-exit').click()
            for size in [(1920,1080),(1536,864),(1440,900),(1366,768),(1280,800),(390,844),(844,390)]:
                page.set_viewport_size({'width':size[0],'height':size[1]})
                for view,control in [('replay','#aar-tab-replay'),('report','#replay-exit')]:
                    page.locator(control).click();page.wait_for_timeout(150);audit=page.evaluate(AUDIT)
                    assert not audit['overlaps'] and not audit['outside'] and not audit['scroll'],(size,view,audit)
                    if size in [(1536,864),(390,844)]:page.screenshot(path=str(out/f'08-{view}-{size[0]}x{size[1]}.png'))
            page.set_viewport_size({'width':1500,'height':1200})
            report['assertions'].append('Keyboard tab navigation passes; report and replay regions never overlap, leave the viewport or scroll the page at 1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 390×844 and 844×390.')
            if args.gif:
                page.locator('#aar-tab-replay').click();page.locator('[data-aar-map="world"]').click()
                page.evaluate('''() => {const n=document.createElement('div');n.textContent='RECORDED MATCH REPLAY · ACTUAL BROWSER CAPTURE · SINGLE-CONTROLLER TEST';n.style.cssText='position:fixed;right:15px;bottom:10px;background:#203942;color:#f1eddd;padding:7px 12px;font:10px system-ui;z-index:20';document.body.append(n);}''')
                for tick in range(0,554,18):
                    page.locator('#replay-slider').fill(str(tick));capture(page,delay=140)
                page.locator('#replay-exit').click()
            before=api('/api/games/review-fixture/review')
            page.locator('#aar-back').click()
            page.locator('[data-room="draw-fixture"]').click()
            expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(4)
            expect(page.locator('#result')).to_contain_text('The council ends in a draw')
            expect(page.locator('#aar-standings .pr')).to_have_text(['Draw']*4)
            assert page.locator('#result img').count()==0
            assert not page.evaluate('Boolean(window.REVIEW_XSS)')
            page.locator('#aar-tab-replay').click();expect(page.locator('#replay-stage')).to_be_visible()
            # The recorded fixture is replayed on the published board (imperial-1910-v6, 59 provinces incl. Hawaii).
            assert page.locator('#review-map .province').count()==59 and page.locator('#review-map-province-hawaii').count()==1
            assert api('/api/games/review-fixture/map')['id']=='imperial-1910-v6' and api('/api/games/review-fixture/replay')['map']['id']=='imperial-1910-v6'
            page.locator('#replay-exit').click();page.locator('#aar-back').click();page.locator('[data-room="old-fixture"]').click()
            expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
            page.locator('#aar-tab-replay').click();expect(page.locator('#aar-replay')).to_contain_text('History unavailable')
            report['assertions'].append('A drawn match (equal industry at the deadline) renders as a draw for every seat, a malicious alliance name stays inert, and a match without its recorded opening fails closed while results remain visible.')
            page.locator('#replay-exit').click();page.locator('#aar-back').click();page.locator('[data-room="review-fixture"]').click()
            expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
            assert api('/api/games/review-fixture/review')==before
            report['assertions'].append('Leaving and reopening reviews releases playback state; watching history does not alter the match or scores.')
            page.locator('#aar-back').click();page.locator('[data-room="wire-fixture"]').click()
            page.locator('#aar-tab-diplomacy').click()
            expect(page.locator('#wire-messages .wire-letter')).to_have_count(3)
            expect(page.locator('#wire-messages')).to_contain_text('The public pair can talk.')
            assert 'PRIVATE LINE' not in page.locator('#aar-diplomacy').inner_text()
            assert page.locator('#aar-diplomacy img').count()==0 and not page.evaluate('Boolean(window.REVIEW_XSS)')
            page.locator('[data-wire-thread="world"]').click()
            expect(page.locator('#wire-messages .wire-letter')).to_have_count(1)
            page.locator('#wire-search').fill('no match');expect(page.locator('#wire-messages')).to_contain_text('No disclosed messages')
            page.locator('#wire-search').fill('Public terms');expect(page.locator('#wire-messages .wire-letter')).to_have_count(1)
            page.locator('#wire-messages [data-aar-seek]').click()
            expect(page.locator('#replay-stage')).to_have_attribute('data-tick','0')
            page.locator('#replay-exit').click()
            for size in [(1366,768),(390,844)]:
                page.set_viewport_size({'width':size[0],'height':size[1]});page.locator('#aar-tab-diplomacy').click();page.wait_for_timeout(150)
                audit=page.evaluate(AUDIT);assert not audit['overlaps'] and not audit['outside'] and not audit['scroll'],(size,audit)
                capture(page,f'09-wire-{size[0]}x{size[1]}.png')
            page.set_viewport_size({'width':1500,'height':1200})
            report['assertions'].append('Disclosed public-AI messages (world, a DM between two public seats, all-public alliance chat) filter by conversation and search, jump to the exact replay time, stay inert under hostile text, keep private seats private, and fit 1366×768 and 390×844.')
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
