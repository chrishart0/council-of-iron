"""Focused UI checks (v0.5 command table → v0.7 full-screen match) against a recorded position and the real HTTP server.
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

# v0.7 full-screen contract: the map is the viewport; floating overlays never overlap each other.
LAYOUT='''() => {
  const names={'#hud':'HUD','#menu-button':'menu button','#hud-rail':'panel buttons','#spectator-note':'spectator note','#threats':'threats',
    '#council-alert':'council alert','#battle-signal':'battle notice','#countdown-break':'countdown','#leaderboard':'leaderboard',
    '#world-feed':'world feed','#map-controls':'map controls','#command-panel':'command panel','#lobby':'lobby'};
  const boxes=[];
  for(const [selector,name] of Object.entries(names)){
    const e=document.querySelector(selector);if(!e || !e.checkVisibility())continue;
    const r=e.getBoundingClientRect();if(r.width<1 || r.height<1)continue;
    boxes.push({name,x:r.left,y:r.top,r:r.right,b:r.bottom});
  }
  const overlaps=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];
    if(a.x<b.r-.5 && b.x<a.r-.5 && a.y<b.b-.5 && b.y<a.b-.5)overlaps.push(`${a.name} × ${b.name}`);}
  const map=document.querySelector('#map').getBoundingClientRect();
  return {overlaps,visible:boxes.map(b=>b.name),outside:boxes.filter(b=>b.x<-.5 || b.y<-.5 || b.r>innerWidth+.5 || b.b>innerHeight+.5).map(b=>b.name),
    map:[map.left,map.top,map.width,map.height],viewport:[innerWidth,innerHeight],
    scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight,scrollY]};
}'''
# The March commit must be on screen, unobstructed and outside any scrolling region.
COMMIT='''() => {
  const button=document.querySelector('#send-army'),r=button.getBoundingClientRect();
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);let scroller=null;
  for(let e=button.parentElement;e;e=e.parentElement){const o=getComputedStyle(e).overflowY;if((o==='auto' || o==='scroll') && e.scrollHeight>e.clientHeight+1){scroller=e.id || e.className;break;}}
  return {visible:button.checkVisibility(),inView:r.top>=0 && r.left>=0 && r.bottom<=innerHeight+.5 && r.right<=innerWidth+.5,hit:button.contains(hit),scroller,form:button.getAttribute('form')};
}'''
layout_log=[]
# Share of the viewport where the map is not under any HTML overlay (4 px grid sample).
UNCOVERED='''() => {
  const rects=[];for(const s of ['.hud-bar','#hud-rail','#alerts>*','#leaderboard','#world-feed','#map-controls','#command-panel'])
    for(const e of document.querySelectorAll(s)){if(!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.width && r.height)rects.push(r);}
  let free=0,all=0;for(let y=2;y<innerHeight;y+=4)for(let x=2;x<innerWidth;x+=4){all++;if(!rects.some(r=>x>=r.left && x<r.right && y>=r.top && y<r.bottom))free++;}
  return free/all;
}'''
def check_layout(page,label):
    # Overlays that size around the alert stack settle in the next rendering step.
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    result=page.evaluate(LAYOUT);w,h=result['viewport']
    layout_log.append({'state':label,'visible':result['visible']})
    assert result['map']==[0,0,w,h],(label,result['map'])
    assert result['scroll'][0]<=w+1 and result['scroll'][1]<=h+1 and result['scroll'][2]==0,(label,result['scroll'])
    assert not result['overlaps'],(label,result['overlaps'])
    assert not result['outside'],(label,result['outside'])
    return result
def check_commit(page,label):
    result=page.evaluate(COMMIT)
    assert result['visible'] and result['inView'] and result['hit'] and result['scroller'] is None and result['form']=='move-form',(label,result)
def ensure_orders(page,size=None):
    if page.locator('#orders-label').get_attribute('aria-expanded')!='true':page.locator('#orders-label').click()
    for _ in range(3):
        if size is None or page.locator('#command-panel').get_attribute('data-sheet')==size:break
        page.locator('#sheet-handle').click()
    if size:expect(page.locator('#command-panel')).to_have_attribute('data-sheet',size)
def go_back(page):
    # Live rooms keep 'All rooms' in the HUD menu; the after-action review has its own home button.
    if page.locator('#menu-button').is_visible():page.locator('#menu-button').click();page.locator('#back').click()
    else:page.locator('[data-home]').first.click()

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
    go_back(page);page.locator('[data-room="ui-fixture"][data-resume]').click()
    expect(page.locator('#commander-title')).to_have_text('British Empire')
    levels=set()
    for w,h in [(1366,768),(1920,1080),(390,844)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        if w<760 and page.locator('#feed-toggle').get_attribute('aria-expanded')=='true':page.locator('#feed-toggle').click()  # the history sheet covers the camera buttons
        levels|=audit_zooms(page,'ui-fixture',f'fixture {w}',views)
    assert levels=={'far','mid','near'},levels
    assert any(a['mergedCounters'] for a in audit if '(far)' in a['view']) and any(a['mergedCounters'] for a in audit if '(mid)' in a['view']),audit
    report['mapAudit']=audit
    page.set_viewport_size({'width':1366,'height':768});page.locator('#world-view').click();page.wait_for_timeout(100)
    before=float(page.locator('#map').get_attribute('viewBox').split()[2])
    # A merged counter that is not under a floating overlay (the map runs beneath the HUD and rail).
    index=page.evaluate("()=>[...document.querySelectorAll('#map .map-cluster')].findIndex(c=>{const r=c.getBoundingClientRect();return c.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})")
    assert index>=0
    cluster=page.locator('#map .map-cluster').nth(index)
    members=cluster.get_attribute('data-cluster').split(',');cluster.click();page.wait_for_timeout(150)
    assert float(page.locator('#map').get_attribute('viewBox').split()[2])<before
    report['assertions'].append('Map LOD: country, merged and per-province counters at 1366×768, 1920×1080 and 390px; every province is counted exactly once, merged totals equal the summed public garrisons, owners never mix, visible counters never overlap, and a merged counter zooms in when clicked.')
    go_back(page);page.locator('[data-room="ui-war"][data-resume]').click()
    expect(page.locator('#map .battle-counter')).to_have_count(2)
    for w,h in [(1366,768),(390,844)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        if w<760 and page.locator('#feed-toggle').get_attribute('aria-expanded')=='true':page.locator('#feed-toggle').click()
        audit_zooms(page,'ui-war',f'war {w}',views)
    page.set_viewport_size({'width':1366,'height':768});page.locator('#europe-view').click()
    server.stdin.write('war 56\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==56
    expect(page.locator('#map .round-loss').first).to_be_attached(timeout=6000)
    capture('13-battle-round.png',600)
    report['assertions'].append('Real phased battles show a persistent attacker-vs-defender clash marker at every zoom (never merged), matching engaged armies and garrison, and flash the losses of a newly adjudicated round.')

HOSTILE_ALLIANCE='<b onclick="x()">Iron & "Pact"</b>'
BAND_COLORS='''async side=>{
  const {allianceColor}=await import('/leaderboard.js');const probe=document.createElement('i');probe.style.color=allianceColor(side);
  document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();
  return {expected,rows:[...document.querySelectorAll('#lb-rows .lb-row[data-band="active"]')].map(r=>[r.dataset.id,r.dataset.side,getComputedStyle(r).borderLeftColor]),
    feed:[...document.querySelectorAll('#feed-list [data-kind="alliance"]')].map(r=>[r.dataset.side,getComputedStyle(r).borderLeftColor])};
}'''
def relation_checks(page,server,report,capture):
    """v0.7 relations in the recorded war room: Britain (this seat) declared war on the USA at tick 0."""
    page.set_viewport_size({'width':1366,'height':768});page.wait_for_timeout(150)
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())");wars=set(state['wars'])
    at_war=lambda a,b:':'.join(sorted([a,b])) in wars
    assert 'britain:usa' in wars and len(wars)==3,wars
    chip=page.locator('#war-chip')
    expect(chip).to_have_attribute('data-state','war');expect(chip).to_have_attribute('data-enemies','usa')
    expect(chip).to_have_attribute('aria-label',re.compile('At war with United States'))
    expect(page.locator('#ally-chip')).to_have_attribute('data-state','independent')
    rows=page.locator('#lb-rows .lb-row');assert rows.count()>=5
    for i in range(rows.count()):
        row=rows.nth(i);cid=row.get_attribute('data-id')
        expected='you' if cid=='britain' else 'enemy' if at_war('britain',cid) else 'neutral'
        assert row.get_attribute('data-relation')==expected,(cid,row.get_attribute('data-relation'))
        assert row.locator('.lb-rel').text_content()==('⚔' if expected=='enemy' else '')
    check_layout(page,'1366x768 war room')
    # The Wars view: from the chip by keyboard; exactly the observation's war pairs.
    chip.focus();page.keyboard.press('Enter')
    expect(page.locator('#command-panel')).to_have_attribute('data-tab','council');expect(page.locator('#wars-view')).to_be_visible()
    expect(page.locator('#panel-title')).to_be_focused()
    fronts=page.locator('#war-list .war-front-button');shown=set()
    for i in range(fronts.count()):shown|=set(fronts.nth(i).get_attribute('data-pairs').split())
    assert shown==wars,(shown,wars)
    involved=page.locator('#war-list .war-front.involved')
    expect(involved).to_have_count(1);expect(involved).to_contain_text('United States');expect(involved).to_contain_text('since 00:00')
    before=page.locator('#map').get_attribute('viewBox');involved.locator('button').click()
    assert page.locator('#map').get_attribute('viewBox')!=before
    check_layout(page,'1366x768 wars view');capture('17-wars.png')
    page.keyboard.press('Escape')
    # Context card: the target owner's relation. A British source next to the USA, then next to France.
    board=page.evaluate("fetch('/api/games/ui-war/map').then(r=>r.json())")
    owner={p['id']:p['owner'] for p in state['provinces']}
    def border(enemy):
        for p in board['provinces']:
            if owner.get(p['id'])!='britain':continue
            for n in p['neighbors']:
                if owner.get(n)==enemy:return p['id'],n
    for enemy,relation,words in [('usa','enemy','AT WAR'),('france','neutral','NEUTRAL')]:
        src,dst=border(enemy);ensure_orders(page,'half')
        page.locator('#source').select_option(src);page.locator('#destination').select_option(dst)
        expect(page.locator('#relation-banner')).to_have_attribute('data-relation',relation);expect(page.locator('#relation-banner')).to_contain_text(words)
        ensure_orders(page,'peek');expect(page.locator('#relation-banner')).to_be_visible();check_layout(page,f'relation {relation} peek')
    page.locator('#relation-banner .relation-action').click()
    expect(page.locator('#command-panel')).to_have_attribute('data-tab','council')
    expect(page.locator('#diplomacy-target')).to_have_value('france');expect(page.locator('#declare-war')).to_be_focused()
    expect(page.locator('#relation-banner')).to_be_hidden()  # the relation line belongs to the order card only
    report['assertions'].append('Relations (recorded war room, Britain at war with the USA): the HUD war chip names exactly the viewer’s enemies; every leaderboard row’s relation marker matches the public war list; the Wars view opens from the chip by keyboard, lists exactly the observation’s war pairs, marks the one involving the viewer and focuses the map on its front; the context card states AT WAR or NEUTRAL for the target owner and links to the war council.')
    # Alliances: forming (dashed) during the notice, then active in the alliance colour; the name stays text.
    page.locator('#ally-choice').select_option('japan');page.locator('#coalition-name').fill(HOSTILE_ALLIANCE)
    page.locator('#alliance-form button').click();expect(page.locator('#offers')).to_contain_text(HOSTILE_ALLIANCE)
    server.stdin.write('ally japan\n');server.stdin.flush();assert json.loads(server.stdout.readline())['status']=='pending'
    expect(page.locator('#ally-chip')).to_have_attribute('data-state','forming',timeout=5000)
    expect(page.locator('#lb-rows .lb-row[data-id="britain"]')).to_have_attribute('data-band','forming')  # your row is always listed
    server.stdin.write('war 90\n');server.stdin.flush();json.loads(server.stdout.readline())
    ally=page.locator('#ally-chip');expect(ally).to_have_attribute('data-state','active',timeout=5000)
    expect(ally).to_have_attribute('data-allies','japan');expect(ally).to_have_attribute('aria-label',re.compile('Allied in .*Pact.* with Empire of Japan'))
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())")
    side=next(p['side'] for p in state['players'] if p['id']=='britain');assert next(p['side'] for p in state['players'] if p['id']=='japan')==side
    expect(page.locator('#lb-rows .lb-row[data-band="active"]').first).to_be_visible()
    colors=page.evaluate(BAND_COLORS,side)
    assert colors['rows'] and all(s==side and c==colors['expected'] for _,s,c in colors['rows']),colors
    assert {r[0] for r in colors['rows']}<={'britain','japan'},colors
    assert colors['feed'] and colors['feed'][-1]==[side,colors['expected']],colors
    assert page.locator('b[onclick]').count()==0
    expect(page.locator('#feed-list [data-kind="alliance"]').last).to_contain_text(HOSTILE_ALLIANCE)
    check_layout(page,'1366x768 alliance active');capture('18-alliance-relations.png')
    expect(page.locator('#map .map-effect')).to_have_count(0,timeout=6000)  # the live alliance effect ends before the effect-scope check
    report['assertions'].append('Alliances: a new coalition shows as forming (dashed) in the HUD chip and leaderboard during its notice, then active with the ally’s standard; leaderboard bands and the alliance feed row use the same colour as the shared allianceColor helper; a hostile alliance name renders only as text.')

LONG_MESSAGE=('The Atlantic Accord proposes a longer public statement to check the history column: '+'we will hold the Channel, the Low Countries and the sea lanes to the Americas together. '*4).strip()
def feed_checks(page,report):
    """World history: whole-match scrollback, pinned reply, no yank while reading, expanded-then-compact rows."""
    page.set_viewport_size({'width':1600,'height':1000})
    if page.locator('#feed-toggle').get_attribute('aria-expanded')!='true':page.locator('#feed-toggle').click()
    history=page.locator('#feed-list')
    first=history.evaluate('(l)=>{l.scrollTop=0;const f=l.firstElementChild.getBoundingClientRect(),b=l.getBoundingClientRect();return {scrollable:l.scrollHeight>l.clientHeight,shown:f.top>=b.top-1 && f.top<b.bottom,key:l.firstElementChild.dataset.feedKey}}')
    assert first['scrollable'] and first['shown'],first
    form=page.locator('#feed-form').bounding_box();panel=page.locator('#world-feed').bounding_box()
    assert abs((form['y']+form['height'])-(panel['y']+panel['height']))<=2,(form,panel)
    expect(page.locator('#feed-send')).to_be_enabled(timeout=5000)
    page.locator('#feed-text').fill(LONG_MESSAGE);page.locator('#feed-send').click()
    expect(page.locator('#feed-jump')).to_have_text('1 new ↓',timeout=5000)
    assert history.evaluate('(l)=>l.scrollTop')<5,'reader was moved'
    page.locator('#feed-jump').click();expect(page.locator('#feed-jump')).to_be_hidden()
    assert history.evaluate('(l)=>l.scrollHeight-l.scrollTop-l.clientHeight')<40
    row=page.locator('#feed-list .feed-chat').last;clamp=row.locator('.feed-clamp')
    expect(row).to_contain_text('sea lanes');expect(row).to_have_class(re.compile('feed-new'))
    measure='(e)=>({lines:Math.round(e.clientHeight/parseFloat(getComputedStyle(e).lineHeight)),clipped:e.scrollHeight>e.clientHeight+1})'
    fresh=clamp.evaluate(measure);assert fresh['lines']<=4 and fresh['clipped'],fresh
    expect(row).not_to_have_class(re.compile('feed-new'),timeout=10000)
    settled=clamp.evaluate(measure);assert settled['lines']<=2 and settled['clipped'],settled
    expect(clamp).to_have_attribute('aria-expanded','false');expect(clamp).to_have_attribute('role','button')
    clamp.click();expect(clamp).to_have_attribute('aria-expanded','true')
    full=clamp.evaluate(measure);assert not full['clipped'] and full['lines']>4,full
    clamp.focus();page.keyboard.press('Enter');expect(clamp).to_have_attribute('aria-expanded','false')
    page.keyboard.press(' ');expect(clamp).to_have_attribute('aria-expanded','true')
    assert page.locator('#world-feed img').count()==0
    report['assertions'].append('World history: older items are reachable by scrolling from the top of the match; the reply box is pinned to the column bottom; a new item while scrolled up shows “1 new ↓” instead of moving the reader; a long new message arrives clamped to ≤4 lines, shrinks to ≤2 after a few seconds, and expands/collapses by click, Enter and Space with aria-expanded.')

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
            ensure_orders(page,'half')
            page.locator('#source').select_option('england');page.locator('#destination').select_option('low-countries')
            page.locator('#europe-view').click();page.locator('#orders-tab').evaluate('(e)=>e.scrollTop=0')
            capture('01-command-europe.png');no_overflow()
            page.keyboard.press('Escape');expect(page.locator('#command-panel')).to_be_hidden()
            # v0.7 full screen: every listed viewport, player and spectator, idle / selected / drawer states.
            spectator=context.new_page();spectator.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(spectator,url);spectator.locator('[data-room="ui-fixture"][data-spectate="true"]').click()
            else:spectator.goto(url+'/?match=ui-fixture&spectate=1')
            expect(spectator.locator('#phase')).to_have_text('SPECTATING')
            shots=out/'layout';shots.mkdir(exist_ok=True)
            def feed_open(view,open):
                if (view.locator('#feed-toggle').get_attribute('aria-expanded')=='true')!=open:view.locator('#feed-toggle').click()
            for w,h in [(1920,1080),(1366,768),(1280,720),(390,844),(844,390),(768,1024)]:
                tag=f'{w}x{h}'
                for view in (page,spectator):view.set_viewport_size({'width':w,'height':h})
                feed_open(page,w>=760);page.wait_for_timeout(200)
                check_layout(page,f'{tag} player idle');page.screenshot(path=str(shots/f'{tag}-player.png'))
                coverage={'idle':round(page.evaluate(UNCOVERED),3)}
                ensure_orders(page,'half');page.locator('#source').select_option('england');page.locator('#destination').select_option('low-countries')
                expect(page.locator('#send-army')).to_contain_text('Commit')
                for size in ['half','full','peek']:
                    ensure_orders(page,size);page.wait_for_timeout(60)
                    check_layout(page,f'{tag} selected {size}');check_commit(page,f'{tag} {size}')
                    page.screenshot(path=str(shots/f'{tag}-selected-{size}.png'))
                    if size=='peek':coverage['selectedPeek']=round(page.evaluate(UNCOVERED),3)
                report.setdefault('uncoveredMap',{})[tag]=coverage
                if tag=='1366x768':assert coverage['idle']>=.65 and coverage['selectedPeek']>=.62,coverage  # overlays stay compact; the map dominates
                page.keyboard.press('Escape');expect(page.locator('#command-panel')).to_be_hidden()
                for drawer in ['council','dispatches']:
                    page.locator(f'#{drawer}-label').click();expect(page.locator(f'#{drawer}-tab')).to_be_visible()
                    check_layout(page,f'{tag} {drawer}');page.screenshot(path=str(shots/f'{tag}-{drawer}.png'))
                page.keyboard.press('Escape');expect(page.locator('#command-panel')).to_be_hidden()
                if w<760:
                    expect(page.locator('#feed-ticker')).to_be_visible()
                    feed_open(page,True);expect(page.locator('#feed-list')).to_be_visible()
                    check_layout(page,f'{tag} history sheet');page.screenshot(path=str(shots/f'{tag}-history.png'))
                    feed_open(page,False)
                else:
                    expect(page.locator('#feed-list')).to_be_visible()
                    feed_open(page,False);check_layout(page,f'{tag} history edge tab');feed_open(page,True)
                feed_open(spectator,w>=760);spectator.wait_for_timeout(150)
                check_layout(spectator,f'{tag} spectator');spectator.screenshot(path=str(shots/f'{tag}-spectator.png'))
                expect(spectator.locator('#spectator-note')).to_be_visible();expect(spectator.locator('#command-footer')).to_be_hidden()
                if w>=760:expect(spectator.locator('#feed-list')).to_be_visible()
            spectator.close()
            report['layout']=layout_log
            report['assertions'].append('Full-screen contract at 1920×1080, 1366×768, 1280×720, 390×844, 844×390 and 768×1024 for player and spectator: the map is exactly the viewport, no document scroll, and no overlapping or off-screen overlays when idle, with a selection (peek, half, full), with Council or Dispatches open, or with the history collapsed; the form-associated March commit stays visible, unobstructed and outside any scrolling region; the World history stays beside the map on wide screens and opens as a sheet on phones. At 1366×768 at least 65% of the map is uncovered with nothing selected and at least 62% with a province card peeking (actual shares in uncoveredMap).')
            page.set_viewport_size({'width':1600,'height':1000});page.wait_for_timeout(150)
            # Keyboard: a HUD button opens its drawer and moves focus in; Escape closes it and returns focus.
            page.locator('#council-label').focus();page.keyboard.press('Enter')
            expect(page.locator('#command-panel')).to_have_attribute('data-tab','council');expect(page.locator('#panel-title')).to_be_focused()
            expect(page.locator('#council-label')).to_have_attribute('aria-expanded','true')
            page.keyboard.press('Escape');expect(page.locator('#command-panel')).to_be_hidden();expect(page.locator('#council-label')).to_be_focused()
            expect(page.locator('#council-label')).to_have_attribute('aria-expanded','false')
            page.locator('#orders-label').focus();page.keyboard.press('Enter');expect(page.locator('#command-panel')).to_have_attribute('data-sheet','half')
            page.locator('#sheet-handle').focus();page.keyboard.press('ArrowUp');expect(page.locator('#command-panel')).to_have_attribute('data-sheet','full')
            page.keyboard.press('ArrowDown');page.keyboard.press('ArrowDown');expect(page.locator('#command-panel')).to_have_attribute('data-sheet','peek')
            page.keyboard.press('Escape');expect(page.locator('#command-panel')).to_be_hidden();expect(page.locator('#orders-label')).to_be_focused()
            page.locator('#menu-button').focus();page.keyboard.press('Enter');expect(page.locator('#hud-menu')).to_be_visible();expect(page.locator('#share')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#hud-menu')).to_be_hidden();expect(page.locator('#menu-button')).to_be_focused()
            report['assertions'].append('Keyboard: Council opens from its HUD button with focus moved into the panel and closes with Escape, returning focus; the order sheet resizes with arrow keys on its handle; the menu opens and closes the same way.')
            observed=page.evaluate("fetch('/api/games/ui-fixture').then(r=>r.json())")
            def expected_troops(country):
                return sum(p['troops'] for p in observed['provinces'] if p['owner']==country)+sum(a['amount'] for a in observed['armies'] if a['country']==country)
            for w,h in [(1366,768),(1920,1080)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
                expect(page.locator('#leaderboard')).to_be_visible();check_layout(page,f'{w}x{h} leaderboard')
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
            report['assertions'].append('Leaderboard heads the right rail at 1366×768 and 1920×1080 without overlapping any overlay; each row matches garrisons + armies from the public observation; Players/Alliances toggle works.')
            page.locator('#council-label').click()
            page.locator('[data-country-focus="germany"]').focus();page.wait_for_timeout(850)
            expect(page.locator('[data-country-focus="germany"]')).to_be_focused()
            page.keyboard.press('Enter');assert page.locator('#map').get_attribute('viewBox')!='0 0 1280 680'
            expect(page.locator('#command-panel')).to_have_attribute('data-tab','orders')
            page.locator('#journal-toggle').click();expect(page.locator('#war-journal')).to_be_visible()
            expect(page.locator('#journal-toggle')).to_have_attribute('aria-expanded','true')
            capture('02-war-log.png')
            page.keyboard.press('Escape');expect(page.locator('#war-journal')).to_be_hidden();expect(page.locator('#journal-toggle')).to_be_focused()
            page.keyboard.press('j');expect(page.locator('#war-journal')).to_be_visible()
            page.locator('#journal-close').click();expect(page.locator('#war-journal')).to_be_hidden()
            report['assertions'].append('Council roster preserves keyboard focus across polling and inspects the map; War log opens by click/J and closes with Escape or Close.')
            ensure_orders(page,'full');page.locator('#source').select_option('england');page.locator('#destination').select_option('low-countries')
            page.locator('[data-order-mode="coordinate"]').click();capture('03-coordinate.png')
            page.locator('[data-order-mode="develop"]').click();page.locator('#source').select_option('scotland');capture('04-industry.png')
            page.locator('#council-label').click();capture('05-council.png')
            page.locator('#orders-label').click();page.locator('[data-order-mode="march"]').click();page.locator('#world-view').click()
            page.locator('#orders-tab').evaluate('(e)=>e.scrollTop=0');capture('06-command-world.png')
            # Templates with authored static symbols cannot execute arbitrary player inputs.
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            page.locator('.standing-order summary').click();expect(page.locator('#set-route')).to_be_visible()
            page.wait_for_timeout(850);assert page.locator('.standing-order').get_attribute('open') is not None
            report['assertions'].append('March/Coordinate/Develop and Council render in the same panel; recruitment disclosure remains open through refresh; SVG IDs are unique.')
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
            check_layout(narrow,'390 leaderboard expanded')
            narrow.close()
            report['assertions'].append('At 390px the leaderboard starts as a one-line tappable strip under the HUD and expands without horizontal overflow or covering other overlays.')
            page.keyboard.press('Escape')
            for w,h in [(1024,768),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(120);no_overflow();check_layout(page,f'{w}x{h} responsive')
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
            feed_checks(page,report)
            go_back(page);page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            expect(page.locator('#battle-signal')).to_be_hidden()
            page.wait_for_timeout(900)
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
            assert page.locator('#feed-list .fresh').count()==0
            expect(page.locator('#feed-list [data-kind="major_battle"]').last).to_contain_text('Netherlands')
            report['assertions'].append('Reopening the room rebuilt the World feed without replaying banners or fresh-row flashes.')
            report['assertions'].append('Actual recorded losses and defense trigger factual, dismissible notices; broken hold explains itself; reopening suppresses old battle popups.')
            page.set_viewport_size({'width':1500,'height':1150});go_back(page)
            page.locator('#room-name').fill('Choose your standard');page.locator('#create-form button').click()
            expect(page.locator('#faction-choices button')).to_have_count(8)
            page.locator('[data-country-seat="germany"]').click();expect(page.locator('#country-choice')).to_have_value('germany')
            expect(page.locator('[data-country-seat="germany"]')).to_have_attribute('aria-pressed','true')
            capture('08-faction-selection.png')
            page.locator('#join-form button').click();expect(page.locator('[data-country-seat="germany"]')).to_be_disabled()
            report['assertions'].append('Responsive layouts pass at 1024px, 390px and short landscape; faction standards select real seats and disable occupied countries.')
            check_layout(page,'lobby 1500×1150')
            go_back(page);page.locator('[data-room="ui-review"]').click()
            expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
            expect(page.locator('.victory-seals .insignia')).to_have_count(3)
            capture('09-victory-review.png');page.locator('#aar-tab-replay').click()
            expect(page.locator('#replay-stage')).to_be_visible()
            page.locator('#replay-slider').fill('530');page.locator('[data-aar-map="europe"]').click();capture('10-replay.png')
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            report['assertions'].append('After-action standards identify all winning members; exact map playback keeps separate SVG IDs and no live command surface.')
            map_checks(page,server,report,capture)
            if not args.bridge:relation_checks(page,server,report,capture)  # dynamic module import needs native HTTP
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
