"""Focused v0.5 checks against a recorded position and the real HTTP server.
Not a new strategic match. Native navigation by default; explicit bridge optional.
"""
import argparse,io,json,os,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_helpers import load_bridge
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bridge',action='store_true')
    parser.add_argument('--executable',default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts',default=str(ROOT/'artifacts/ui'))
    parser.add_argument('--gif')
    args=parser.parse_args();out=Path(args.artifacts);out.mkdir(parents=True,exist_ok=True)
    report={'status':'not completed','transport':'python-http-bridge' if args.bridge else 'native-browser-http','assertions':[],'pageErrors':[],'fixture':'Recorded game at tick 480, not a new balance sample'}
    server=subprocess.Popen(['node','tests/ui-browser-server.js'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    frames=[]
    try:
        settings=json.loads(server.stdout.readline());url=settings['url'];identity=settings['identity']
        with sync_playwright() as p:
            launch={'headless':True}
            if args.executable:launch['executable_path']=args.executable
            browser=p.chromium.launch(**launch)
            context=browser.new_context(viewport={'width':1600,'height':1000})
            page=context.new_page();page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(page,url,{'coi.identity':json.dumps(identity)})
            else:
                context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');')
                page.goto(url)
            expect(page.locator('#faction-parade .insignia')).to_have_count(8)
            page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            expect(page.locator('.country-card')).to_have_count(8)
            def capture(name,hold=900):
                # Clean real DOM capture: not a mockup, no credentials or local player storage.
                page.screenshot(path=str(out/name),full_page=True)
                if args.gif:
                    page.evaluate('''() => {const label=document.createElement('div');label.id='capture-label';label.textContent='ACTUAL UI · RECORDED TEST POSITION · NOT A LIVE MATCH';label.style.cssText='position:fixed;right:10px;bottom:5px;z-index:100;background:#12252e;color:#dfcfaa;font:10px system-ui;padding:6px 9px;pointer-events:none';document.body.append(label);}''')
                    frames.append((page.screenshot(),hold));page.locator('#capture-label').evaluate('(e)=>e.remove()')
            def no_overflow():
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            page.locator('#source').select_option('england');page.locator('#destination').select_option('low-countries')
            page.locator('#europe-view').click();page.locator('#orders-tab').evaluate('(e)=>e.scrollTop=0')
            capture('01-command-europe.png');no_overflow()
            for w,h in [(1366,768),(1920,1080),(1600,1000)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(100)
                no_overflow();assert page.evaluate('document.documentElement.scrollHeight<=innerHeight+1')
                for selector in ['#map','#scoreboard','#send-army']:
                    box=page.locator(selector).bounding_box();assert box['height']>20 and box['y']+box['height']<=h+1,(selector,w,h,box)
            report['assertions'].append('Live HUD fits 1366×768, 1600×1000 and 1920×1080 without document scrolling; map, roster and commit control stay visible.')
            page.locator('[data-country-focus="germany"]').focus();page.wait_for_timeout(850)
            expect(page.locator('[data-country-focus="germany"]')).to_be_focused()
            page.keyboard.press('Enter');assert page.locator('#map').get_attribute('viewBox')!='0 0 1280 680'
            page.locator('#journal-toggle').click();expect(page.locator('#war-journal')).to_be_visible()
            expect(page.locator('#journal-toggle')).to_have_attribute('aria-expanded','true')
            capture('02-war-log.png')
            page.keyboard.press('Escape');expect(page.locator('#war-journal')).to_be_hidden();expect(page.locator('#journal-toggle')).to_be_focused()
            page.keyboard.press('j');expect(page.locator('#war-journal')).to_be_visible()
            page.locator('#journal-close').click();expect(page.locator('#war-journal')).to_be_hidden()
            report['assertions'].append('Country roster preserves keyboard focus across polling and inspects the map; War log opens by click/J and closes with Escape or Close.')
            page.locator('#source').select_option('england');page.locator('#destination').select_option('low-countries')
            page.locator('[data-order-mode="coordinate"]').click();capture('03-coordinate.png')
            page.locator('[data-order-mode="develop"]').click();page.locator('#source').select_option('scotland');capture('04-industry.png')
            page.locator('[data-tab="council"]').click();capture('05-council.png')
            page.locator('[data-tab="orders"]').click();page.locator('[data-order-mode="march"]').click();page.locator('#world-view').click()
            page.locator('#orders-tab').evaluate('(e)=>e.scrollTop=0');capture('06-command-world.png')
            # Templates with authored static symbols cannot execute arbitrary player inputs.
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            page.locator('.standing-order summary').click();expect(page.locator('#set-route')).to_be_visible()
            page.wait_for_timeout(850);assert page.locator('.standing-order').get_attribute('open') is not None
            report['assertions'].append('March/Coordinate/Develop and Council render in the same shell; recruitment disclosure remains open through refresh; SVG IDs are unique.')
            for w,h in [(1024,768),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(120);no_overflow()
                if w==390:capture('07-mobile-command.png')
            page.set_viewport_size({'width':1600,'height':1000});page.locator('#world-view').click()
            server.stdin.write('535\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==535
            expect(page.locator('#battle-signal')).to_have_attribute('data-tone','lost')
            expect(page.locator('#battle-signal')).to_contain_text('Northern India')
            expect(page.locator('#countdown-break')).to_be_visible()
            capture('11-battle-loss.png')
            page.locator('[data-dismiss-signal]').click();expect(page.locator('#battle-signal')).to_be_hidden()
            server.stdin.write('539\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==539
            expect(page.locator('#battle-signal')).to_contain_text('Line held')
            expect(page.locator('#battle-signal')).to_contain_text('16 troops')
            page.locator('#europe-view').click();capture('12-line-held.png')
            page.locator('#back').click();page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            expect(page.locator('#battle-signal')).to_be_hidden()
            report['assertions'].append('Actual recorded losses and defense trigger factual, dismissible notices; broken hold explains itself; reopening suppresses old battle popups.')
            page.set_viewport_size({'width':1500,'height':1150});page.locator('#back').click()
            page.locator('#room-name').fill('Choose your standard');page.locator('#create-form button').click()
            expect(page.locator('#faction-choices button')).to_have_count(8)
            page.locator('[data-country-seat="germany"]').click();expect(page.locator('#country-choice')).to_have_value('germany')
            expect(page.locator('[data-country-seat="germany"]')).to_have_attribute('aria-pressed','true')
            capture('08-faction-selection.png')
            page.locator('#join-form button').click();expect(page.locator('[data-country-seat="germany"]')).to_be_disabled()
            report['assertions'].append('Responsive layouts pass at 1024px, 390px and short landscape; faction standards select real seats and disable occupied countries.')
            page.locator('#back').click();page.locator('[data-room="ui-review"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
            expect(page.locator('.victory-seals .insignia')).to_have_count(3)
            capture('09-victory-review.png');page.locator('#aar-tab-replay').click()
            expect(page.locator('#replay-stage')).to_be_visible()
            page.locator('#replay-slider').fill('530');page.locator('[data-aar-map="europe"]').click();capture('10-replay.png')
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            report['assertions'].append('After-action standards identify all winning members; exact map playback keeps separate SVG IDs and no live command surface.')
            page.emulate_media(reduced_motion='reduce');assert page.evaluate('getComputedStyle(document.querySelector("#battle-signal")).animationName')=='none'
            assert not report['pageErrors'],report['pageErrors'];report['status']='passed'
            browser.close()
        if args.gif:
            from PIL import Image
            images=[Image.open(io.BytesIO(data)).convert('RGB') for data,_ in frames]
            # Same aspect ratio via a stable letterboxed capture canvas.
            result=[]
            for im in images:
                im.thumbnail((1100,820));canvas=Image.new('RGB',(1100,820),(13,27,34));canvas.paste(im,((1100-im.width)//2,(820-im.height)//2));result.append(canvas.convert('P',palette=Image.Palette.ADAPTIVE,colors=128))
            target=Path(args.gif);target.parent.mkdir(parents=True,exist_ok=True)
            result[0].save(target,save_all=True,append_images=result[1:],duration=[d for _,d in frames],loop=0,disposal=2)
            report['gif']={'path':str(target),'frames':len(result),'bytes':target.stat().st_size,'kind':'Actual interface tour of recorded state; not live play'}
    finally:
        server.terminate();server.wait(timeout=10);(out/'ui-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
