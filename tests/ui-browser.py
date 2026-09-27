"""Focused v0.5 checks against a recorded position and the real HTTP server.
Not a new strategic match. Native navigation by default; explicit bridge optional.
"""
import argparse,io,json,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_helpers import load_bridge
ROOT=Path(__file__).resolve().parents[1]

# Reads what the live map actually shows and compares it with the public room state.
MAP_AUDIT='''async room => {
  const state=await (await fetch(`/api/games/${room}`)).json();
  const svg=document.querySelector('#map'),box=svg.getBoundingClientRect(),troops=new Map(state.provinces.map(p=>[p.id,p]));
  const shown=e=>getComputedStyle(e).display!=='none' && e.getBoundingClientRect().width>0;
  const units=[];
  for(const e of svg.querySelectorAll('.map-counter,.battle-counter')){
    if(!shown(e))continue;
    const body=e.querySelector('.counter-body,.battle-body').getBoundingClientRect();
    const members=e.dataset.cluster?e.dataset.cluster.split(','):[e.dataset.province];
    units.push({members,total:e.dataset.cluster?Number(e.dataset.total):e.classList.contains('battle-counter')?Number(e.dataset.defend):Number(e.querySelector('.counter-value').textContent),
      owners:[...new Set(members.map(id=>troops.get(id).owner||null))],battle:e.classList.contains('battle-counter'),
      rect:{x:body.x,y:body.y,w:body.width,h:body.height},onScreen:body.right>box.left&&body.left<box.right&&body.bottom>box.top&&body.top<box.bottom});
  }
  const count=new Map();for(const u of units)for(const id of u.members)count.set(id,(count.get(id)||0)+1);
  const overlaps=[];
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i].rect,b=units[j].rect;
    if(units[i].onScreen&&units[j].onScreen&&a.x<b.x+b.w-.5&&b.x<a.x+a.w-.5&&a.y<b.y+b.h-.5&&b.y<a.y+a.h-.5)overlaps.push(units[i].members[0]+'/'+units[j].members[0]);}
  const engaged=id=>state.armies.filter(a=>a.engaged&&a.to===id).reduce((n,a)=>n+a.amount,0);
  return {lod:svg.dataset.lod,clusters:units.filter(u=>u.members.length>1).length,
    badSums:units.filter(u=>u.total!==u.members.reduce((n,id)=>n+troops.get(id).troops,0)).map(u=>u.members.join()),
    mixedOwners:units.filter(u=>u.owners.length>1).map(u=>u.members.join()),
    missing:state.provinces.filter(p=>count.get(p.id)!==1).map(p=>p.id),overlaps,
    battles:state.battles.map(b=>b.province),
    battleMarks:units.filter(u=>u.battle).map(u=>({id:u.members[0],attack:Number(svg.querySelector(`.battle-counter[data-province="${u.members[0]}"]`).dataset.attack),expected:engaged(u.members[0])})),
    mergedBattles:units.filter(u=>u.members.length>1&&u.members.some(id=>state.battles.some(b=>b.province===id))).length};
}'''

audit=[]
def audit_zooms(page,room,label,views):
    levels=set()
    for name,steps in views:
        page.locator('#world-view' if name=='world' else '#europe-view').click()
        for _ in range(steps):page.locator('#zoom-out').click()
        page.wait_for_timeout(120)
        result=page.evaluate(MAP_AUDIT,room);levels.add(result['lod'])
        where=f'{label} {name}+{steps} ({result["lod"]})'
        audit.append({'view':where,'mergedCounters':result['clusters'],'battleMarkers':len(result['battleMarks'])})
        assert not result['badSums'],(where,result['badSums'])
        assert not result['mixedOwners'],(where,result['mixedOwners'])
        assert not result['missing'],(where,result['missing'])
        assert not result['overlaps'],(where,result['overlaps'])
        assert result['mergedBattles']==0,where
        assert sorted(m['id'] for m in result['battleMarks'])==sorted(result['battles']),(where,result)
        assert all(m['attack']==m['expected'] and m['attack']>0 for m in result['battleMarks']),(where,result['battleMarks'])
    return levels

def map_checks(page,server,report,capture):
    views=[('world',0),('europe',0),('europe',1),('europe',2),('europe',3)]
    page.locator('#back').click();page.locator('[data-room="ui-fixture"][data-resume]').click()
    expect(page.locator('#commander-title')).to_have_text('British Empire')
    levels=set()
    for w,h in [(1366,768),(1920,1080),(390,844)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        levels|=audit_zooms(page,'ui-fixture',f'fixture {w}',views)
    assert levels=={'far','mid','near'},levels
    assert any(a['mergedCounters'] for a in audit if '(far)' in a['view']) and any(a['mergedCounters'] for a in audit if '(mid)' in a['view']),audit
    report['mapAudit']=audit
    page.set_viewport_size({'width':1366,'height':768});page.locator('#world-view').click();page.wait_for_timeout(100)
    before=float(page.locator('#map').get_attribute('viewBox').split()[2])
    cluster=page.locator('#map .map-cluster').first
    members=cluster.get_attribute('data-cluster').split(',');cluster.click();page.wait_for_timeout(150)
    assert float(page.locator('#map').get_attribute('viewBox').split()[2])<before
    report['assertions'].append('Map LOD: country, merged and per-province counters at 1366×768, 1920×1080 and 390px; every province is counted exactly once, merged totals equal the summed public garrisons, owners never mix, visible counters never overlap, and a merged counter zooms in when clicked.')
    page.locator('#back').click();page.locator('[data-room="ui-war"][data-resume]').click()
    expect(page.locator('#map .battle-counter')).to_have_count(2)
    for w,h in [(1366,768),(390,844)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        audit_zooms(page,'ui-war',f'war {w}',views)
    page.set_viewport_size({'width':1366,'height':768});page.locator('#europe-view').click()
    server.stdin.write('war 56\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==56
    expect(page.locator('#map .round-loss').first).to_be_attached(timeout=6000)
    capture('13-battle-round.png',600)
    report['assertions'].append('Real phased battles show a persistent attacker-vs-defender clash marker at every zoom (never merged), matching engaged armies and garrison, and flash the losses of a newly adjudicated round.')

EFFECT_CHECK='''async () => {
  const {Atlas,MAP_EFFECTS}=await import('/atlas.js');
  const map=await (await fetch('/map.json')).json(),state=await (await fetch('/api/games/ui-war')).json();
  const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:640px;height:340px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='effect-test-map';svg.setAttribute('viewBox','0 0 1280 680');svg.style.cssText='width:640px;height:340px';
  host.append(svg);document.body.append(host);
  const atlas=new Atlas(svg,map,()=>{});atlas.update(state,null,null);
  const good=[['industry_up',{province:'ruhr',level:3}],['industry_down',{province:'ruhr',level:2}],['captured',{province:'alpine-france',owner:'germany'}],
    ['alliance',{countries:['britain','france']}],['war',{from:['germany'],to:['france']}],['peace',{from:['usa'],to:['japan']}],['eliminated',{country:'qing'}]];
  const bad=[[],['nope',{}],['industry_up'],['industry_up',null],['industry_up',{province:'atlantis'}],['captured',{province:'ruhr',owner:'<b>x</b>'}],
    ['alliance',{countries:'britain'}],['alliance',{countries:['britain']}],['war',{from:['x'],to:['y']}],['peace',{from:null,to:[{}]}],['eliminated',{country:{}}],['eliminated',{country:'atlantis'}]];
  const accepted=good.map(([k,d])=>atlas.effect(k,d));
  let threw=false,rejected=[];
  try{rejected=bad.map(args=>atlas.effect(...args));}catch(e){threw=true;}
  const effects=[...svg.querySelectorAll('.map-effect')];
  const result={kinds:[...MAP_EFFECTS],accepted,rejected,threw,count:effects.length,
    hidden:svg.querySelector('.map-effects').getAttribute('aria-hidden'),
    ids:[...svg.querySelectorAll('.map-effects [id]')].length,
    leaked:document.querySelectorAll('#map .map-effect').length,
    still:effects.every(e=>e.classList.contains('still')),
    animations:[...svg.querySelectorAll('.map-effect *')].map(e=>getComputedStyle(e).animationName).filter(n=>n!=='none').length};
  atlas.destroy();host.remove();return result;
}'''

def effect_checks(page,report):
    result=page.evaluate(EFFECT_CHECK)
    assert result['kinds']==['industry_up','industry_down','captured','alliance','war','peace','eliminated'],result
    assert all(result['accepted']),result;assert not any(result['rejected']),result;assert not result['threw']
    assert result['count']>=7 and result['hidden']=='true' and result['ids']==0 and result['leaked']==0,result
    assert result['still'] and result['animations']==0,result
    report['assertions'].append('atlas.effect exposes the supported kinds, draws aria-hidden effects inside its own map instance only, returns false for unknown kinds/ids/malformed data without throwing, and is a static highlight under reduced motion.')

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
            # Catch-up: the World feed shows history but nothing flashes or announces itself.
            expect(page.locator('#world-feed')).to_be_visible()
            expect(page.locator('#feed-list [data-kind="major_battle"]').first).to_be_visible()
            assert page.locator('#feed-list .feed-headline').count()>=10
            assert page.locator('#feed-list .fresh').count()==0
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
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
            def overlaps(a,b):
                return not (a['x']+a['width']<=b['x'] or b['x']+b['width']<=a['x'] or a['y']+a['height']<=b['y'] or b['y']+b['height']<=a['y'])
            observed=page.evaluate("fetch('/api/games/ui-fixture').then(r=>r.json())")
            def expected_troops(country):
                return sum(p['troops'] for p in observed['provinces'] if p['owner']==country)+sum(a['amount'] for a in observed['armies'] if a['country']==country)
            for w,h in [(1366,768),(1920,1080)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
                expect(page.locator('#leaderboard')).to_be_visible()
                board=page.locator('#leaderboard').bounding_box();map_box=page.locator('#map').bounding_box()
                assert board['x']>=map_box['x'] and board['x']+board['width']<=map_box['x']+map_box['width']+1,(board,map_box)
                for other in ['#world-feed','.command-panel','#command-footer','#threats']:
                    if page.locator(other).is_visible():assert not overlaps(board,page.locator(other).bounding_box()),(other,w,h)
                rows=page.locator('#lb-rows .lb-row')
                assert rows.count()>=5
                for i in range(rows.count()):
                    row=rows.nth(i);country=row.get_attribute('data-id')
                    assert int(row.get_attribute('data-troops'))==expected_troops(country),country
                    assert int(row.get_attribute('data-provinces'))==sum(1 for p in observed['provinces'] if p['owner']==country)
            expect(page.locator('#lb-rows .lb-row.you')).to_contain_text('Britain')
            page.locator('[data-lb-mode="alliances"]').click()
            expect(page.locator('#lb-rows .lb-row').first).to_contain_text('Atlantic Accord')
            page.screenshot(path=str(out/'14-leaderboard-alliances.png'))
            page.locator('[data-lb-mode="players"]').click()
            page.screenshot(path=str(out/'15-leaderboard-1920.png'))
            report['assertions'].append('Leaderboard stays inside the map at 1366×768 and 1920×1080, clear of the feed, notices and dock; each row matches garrisons + armies from the public observation; Players/Alliances toggle works.')
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
            narrow=context.new_page();narrow.set_viewport_size({'width':390,'height':844})
            if args.bridge:load_bridge(narrow,url,{'coi.identity':json.dumps(identity)})
            else:narrow.goto(url)
            narrow.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(narrow.locator('#leaderboard')).to_have_class(re.compile('collapsed'))
            expect(narrow.locator('#lb-summary')).to_contain_text('You #')
            assert narrow.locator('#leaderboard').bounding_box()['height']<=44
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            narrow.screenshot(path=str(out/'16-leaderboard-390-collapsed.png'),full_page=True)
            narrow.locator('#lb-toggle').click();expect(narrow.locator('#lb-rows')).to_be_visible()
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            narrow.close()
            report['assertions'].append('At 390px the leaderboard starts as a one-line tappable strip under the map and expands without horizontal overflow.')
            for w,h in [(1024,768),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(120);no_overflow()
                if w==390:capture('07-mobile-command.png')
            page.set_viewport_size({'width':1600,'height':1000});page.locator('#world-view').click()
            server.stdin.write('535\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==535
            expect(page.locator('#declaration')).to_contain_text('Major battle at Northern India',timeout=5000)
            expect(page.locator('#declaration')).to_contain_text('troops lost')
            expect(page.locator('#feed-list .fresh[data-kind="major_battle"]').last).to_contain_text('Northern India')
            page.screenshot(path=str(out/'13-major-battle-banner.png'))
            report['assertions'].append('A live recorded major battle (casualties above max(20, 3% of all troops)) raised one banner and a fresh feed row.')
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
            page.wait_for_timeout(900)
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
            assert page.locator('#feed-list .fresh').count()==0
            expect(page.locator('#feed-list [data-kind="major_battle"]').last).to_contain_text('Netherlands')
            report['assertions'].append('Reopening the room rebuilt the World feed without replaying banners or fresh-row flashes.')
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
            map_checks(page,server,report,capture)
            page.emulate_media(reduced_motion='reduce');assert page.evaluate('getComputedStyle(document.querySelector("#battle-signal")).animationName')=='none'
            if not args.bridge:effect_checks(page,report)  # dynamic module import needs native HTTP
            for selector in ['#declaration','#alliance-seal','.alliance-ribbon','#fallen-seal','.fallen-strike']:
                assert page.evaluate(f'getComputedStyle(document.querySelector("{selector}")).animationName')=='none',selector
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
