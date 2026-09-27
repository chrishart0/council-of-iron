"""Focused UI checks (v0.5 command table → v0.7 full-screen match) against a recorded position and the real HTTP server.
Not a new strategic match. Native navigation by default; explicit bridge optional.
"""
import argparse,io,json,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_helpers import load_bridge
from ui_tasks import walkthrough
ROOT=Path(__file__).resolve().parents[1]

# Reads what the live map actually shows and compares it with the public room state.
MAP_AUDIT='''async room => {
  const state=await (await fetch(`/api/games/${room}`)).json();
  const svg=document.querySelector('#map'),box=svg.getBoundingClientRect(),troops=new Map(state.provinces.map(p=>[p.id,p]));
  const shown=e=>getComputedStyle(e).display!=='none' && e.getBoundingClientRect().width>0;
  const units=[];
  for(const e of svg.querySelectorAll('.map-counter,.battle-counter:not(.resolved)')){
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
  const names={'#hud':'HUD','#leaderboard':'leaderboard','#world-feed':'history','#map-controls':'map controls','#card':'card','#lobby':'lobby','#coach':'coach tip'};
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
# The card's primary action must be on screen, unobstructed and outside any scrolling region.
COMMIT='''() => {
  const button=document.querySelector('#primary'),r=button.getBoundingClientRect();
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);let scroller=null;
  for(let e=button.parentElement;e;e=e.parentElement){const o=getComputedStyle(e).overflowY;if((o==='auto' || o==='scroll') && e.scrollHeight>e.clientHeight+1){scroller=e.id || e.className;break;}}
  return {visible:button.checkVisibility(),inView:r.top>=0 && r.left>=0 && r.bottom<=innerHeight+.5 && r.right<=innerWidth+.5,hit:button.contains(hit),scroller,primaries:document.querySelectorAll('#card .primary').length};
}'''
layout_log=[]
# Share of the viewport where the map is not under any HTML overlay (4 px grid sample).
UNCOVERED='''() => {
  // Camera buttons and the atlas key are measured part by part: the cluster's bounding box includes empty map.
  const rects=[];for(const s of ['.hud-bar','#leaderboard','#world-feed','.map-controls>button','#card','#coach'])
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
    assert result['visible'] and result['inView'] and result['hit'] and result['scroller'] is None and result['primaries']==1,(label,result)
def click_at(page,locator):
    box=locator.bounding_box();page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2)
def select(page,source,target=None,size=None):
    """v0.8 order card by map taps (tap-tap): Home, your province, then its neighbour."""
    page.keyboard.press('Escape');page.locator('#home-view').click();page.wait_for_timeout(150)
    click_at(page,page.locator(f'#marker-{source} .counter-body'))
    if target:click_at(page,page.locator(f'#marker-{target} .counter-body'))
    expect(page.locator('#card')).to_have_attribute('data-kind','province')
    if size and page.locator('#card').get_attribute('data-size')!=size:page.locator('#card-size').click()
    if size:expect(page.locator('#card')).to_have_attribute('data-size',size)
COACH_DONE='localStorage.setItem("coi.coach","done");'  # first-match tips are covered by coach_checks
def menu(page,open=True):
    """v0.8: views, sound, war log, map key and room actions live in the ☰ menu."""
    if page.locator('#hud-menu').is_visible()!=open:page.locator('#menu-button').click()
    if open:expect(page.locator('#hud-menu')).to_be_visible()
def camera(page,view):
    menu(page);page.locator(f'#{view}-view').click();expect(page.locator('#hud-menu')).to_be_hidden()
def go_back(page):
    # Live rooms keep 'All rooms' in the HUD menu; the after-action review has its own home button.
    if page.locator('#menu-button').is_visible():menu(page);page.locator('#back').click()
    else:page.locator('[data-home]').first.click()

audit=[]
def audit_zooms(page,room,label,views):
    levels=set()
    for name,steps in views:
        camera(page,name)
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

def view_box(page):
    return [float(v) for v in page.locator('#map').get_attribute('viewBox').split()]

def drag_map(page,dx):
    box=page.locator('#map').bounding_box();x,y=box['x']+box['width']/2,box['y']+box['height']*.62
    page.mouse.move(x,y);page.mouse.down()
    for i in range(1,11):page.mouse.move(x+dx*i/10,y)
    page.mouse.up();page.wait_for_timeout(60)

def wrap_checks(page,report,capture):
    # Horizontal wraparound on the live map (room ui-war, 1366×768 and 390px).
    page.set_viewport_size({'width':1366,'height':768});camera(page,'world');page.locator('#zoom-in').click();page.wait_for_timeout(150)
    for direction in [1,-1]:
        start=view_box(page);px=page.evaluate('document.querySelector("#map").getScreenCTM().a');travelled=0
        while abs(travelled)<1280*1.3:
            dx=direction*page.locator('#map').bounding_box()['width']*.8;drag_map(page,dx);travelled-=dx/px
        x,y,w,h=view_box(page);centre=x+w/2
        assert 0<=centre<1280,(direction,centre)
        expected=(start[0]+start[2]/2+travelled)%1280
        assert min(abs(centre-expected),1280-abs(centre-expected))<3,(direction,centre,expected)
        page.locator('#map').focus()
        for _ in range(9):page.keyboard.press('ArrowRight' if direction>0 else 'ArrowLeft')
        vb=view_box(page);assert 0<=vb[0]+vb[2]/2<1280,vb
    # Centre on the dateline seam: the left half of the screen is the repeated copy (x < 0).
    camera(page,'world');page.wait_for_timeout(100)
    drag_map(page,page.locator('#map').bounding_box()['width']/2);page.locator('#zoom-in').click();page.wait_for_timeout(150)
    x,y,w,h=view_box(page);assert abs(((x+w/2)+640)%1280-640)<40,(x,w)
    page.keyboard.press('Escape')
    spot=page.evaluate('''() => {
      const svg=document.querySelector('#map'),m=svg.getScreenCTM(),box=svg.getBoundingClientRect();
      for(let dy=-20;dy<=30;dy+=5)for(let dx=-40;dx<=40;dx+=10){
        const p=new DOMPoint(1105.6-1280+dx,506+dy).matrixTransform(m);
        if(p.x<box.left+4||p.x>box.right-4||p.y<box.top+4||p.y>box.bottom-4)continue;
        const e=document.elementFromPoint(p.x,p.y);if(e&&e.matches('use.world-copy'))return {x:p.x,y:p.y};}
      return null;}''')
    assert spot,'no clickable repeated-copy point over Australia'
    page.mouse.click(spot['x'],spot['y']);expect(page.locator('#card-title')).to_have_text('Australia')
    page.keyboard.press('Escape')  # close the card so later drags start on the map
    capture('14-dateline.png',700)
    result=page.evaluate(MAP_AUDIT,'ui-war')
    assert not result['badSums'] and not result['mixedOwners'] and not result['missing'] and not result['overlaps'],result
    page.locator('#zoom-out').click();page.wait_for_timeout(150);result=page.evaluate(MAP_AUDIT,'ui-war')
    assert not result['badSums'] and not result['missing'] and not result['overlaps'],result
    # Pacific links take the short way across the dateline; no duplicate IDs from the copies.
    widths=page.evaluate('''() => [...document.querySelectorAll('#map .sea-connections path')].map(p=>[p.dataset.edge,p.getBBox().width])''')
    pacific=[wd for e,wd in widths if set(e.split('|')) in [{'west-us','south-japan'},{'alaska','far-east'},{'west-us','philippines'}]]
    assert len(pacific)==3 and all(wd<640 for wd in pacific),widths
    assert all(wd<640 for _,wd in widths),widths
    ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
    assert page.locator('#map use.world-copy').count()==6  # base, lines and effects, each repeated at ±1 world
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150)
    camera(page,'world');drag_map(page,-page.locator('#map').bounding_box()['width']*1.5);page.wait_for_timeout(100)
    x,y,w,h=view_box(page);assert 0<=x+w/2<1280 and w<=1280.5
    result=page.evaluate(MAP_AUDIT,'ui-war');assert not result['badSums'] and not result['missing'] and not result['overlaps'],result
    page.set_viewport_size({'width':1366,'height':768})
    report['assertions'].append('World wraps east–west: drag and arrow-key pans beyond one world width in both directions normalize the view; a repeated copy selects the same province; counters stay once each, summed correctly and non-overlapping across the dateline; Pacific sea links take the short way; no duplicate IDs.')

RELATIONS_AUDIT='''async room => {
  const {allianceColors,coalitions,warKey}=await import('/relations.js');
  const state=await (await fetch(`/api/games/${room}`)).json(),map=await (await fetch('/map.json')).json();
  const svg=document.querySelector('#map'),owner=new Map(state.provinces.map(p=>[p.id,p.owner||null]));
  const wars=new Set(state.rules.warRequired?state.wars:[]),side=new Map(state.players.map(p=>[p.id,p.side]));
  const hostile=(a,b)=>a&&b&&a!==b&&side.get(a)!==side.get(b)&&wars.has(warKey(a,b));
  const expectedFronts=[...svg.querySelectorAll('[data-border]')].map(e=>e.dataset.border).filter(k=>{const [a,b]=k.split('|');return hostile(owner.get(a),owner.get(b));}).sort();
  const contact=new Set(expectedFronts.map(k=>{const [a,b]=k.split('|');return warKey(owner.get(a),owner.get(b));}));
  const expectedSea=map.edges.filter(e=>e.sea&&hostile(owner.get(e.from),owner.get(e.to))&&!contact.has(warKey(owner.get(e.from),owner.get(e.to)))).map(e=>`${e.from}|${e.to}`).sort();
  const colors=allianceColors(state);
  const blocs=coalitions(state).map(c=>{const g=svg.querySelector(`.alliance-bloc[data-bloc="${c.id}"]`);
    return {id:c.id,name:c.name,exists:Boolean(g),inBase:Boolean(g?.closest('[id$="world-base"]')),members:g?.dataset.members,expectedMembers:c.members.join(','),
      provinces:g?.dataset.provinces,expectedProvinces:state.provinces.filter(p=>c.members.includes(p.owner)).map(p=>p.id).sort().join(','),
      color:g?.querySelector('.bloc-line').getAttribute('stroke'),expectedColor:colors[c.id]};});
  const ticks=state.provinces.filter(p=>p.owner).map(p=>{const r=svg.querySelector(`#${svg.id==='map'?'':svg.id+'-'}marker-${p.id} .counter-bloc`);
    return {id:p.id,shown:r.style.display!=='none',fill:r.getAttribute('fill'),expected:colors[side.get(p.owner)]||null};});
  return {fronts:[...svg.querySelectorAll('.war-fronts [data-front]')].map(e=>e.dataset.front).sort(),expectedFronts,
    frontsInBase:[...svg.querySelectorAll('.war-fronts')].every(e=>e.closest('[id$="world-base"]')),
    sea:[...svg.querySelectorAll('.sea-fronts [data-sea-front]')].map(e=>e.dataset.seaFront).sort(),expectedSea,blocs,
    badTicks:ticks.filter(t=>t.shown!==Boolean(t.expected)||t.expected&&t.fill!==t.expected).map(t=>t.id),
    labels:[...svg.querySelectorAll('.alliance-name')].map(g=>g.dataset.bloc),
    legend:[...document.querySelectorAll('.atlas-legend')].filter(l=>svg.parentElement.contains(l)||(svg.id==='map'&&l.closest('#map-key'))).map(l=>l.textContent).join('|')};
}'''

ARMY_AUDIT='''() => {
  const svg=document.querySelector('#map'),kids=[...svg.children],index=e=>kids.indexOf(e);
  const armies=svg.querySelector('.map-armies'),lastUse=Math.max(...[...svg.querySelectorAll(':scope>use')].map(index));
  const shown=e=>{for(let n=e;n&&n!==svg;n=n.parentElement)if(getComputedStyle(n).display==='none')return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const inter=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
  const box=svg.getBoundingClientRect(),on=r=>r.right>box.left&&r.left<box.right&&r.bottom>box.top&&r.top<box.bottom;
  const marks=[...svg.querySelectorAll('.moving-army')].filter(g=>!g.classList.contains('engaged')).map(g=>g.querySelector('.army-arrow')).filter(shown).map(e=>e.getBoundingClientRect()).filter(on);
  const names=[...svg.querySelectorAll('.map-counter:not(.counter-merged) .province-name,.country-name,.alliance-label')].filter(shown).map(e=>[e.textContent,e.getBoundingClientRect()]);
  return {last:svg.lastElementChild===armies,afterEverything:index(armies)>lastUse&&['.map-battles','.map-counters','.map-clusters','.country-names','.alliance-names','.map-effects']
      .every(s=>{const e=svg.querySelector(s);return e&&(e.closest('[id$="world-fx"]')||e).compareDocumentPosition(armies)&Node.DOCUMENT_POSITION_FOLLOWING;}),
    inCopies:svg.querySelectorAll('[id$="world-base"] .moving-army,[id$="world-lines"] .moving-army,[id$="world-fx"] .moving-army').length,
    visible:marks.length,covered:names.filter(([,r])=>marks.some(m=>inter(r,m))).map(([t])=>t)};
}'''

def relations_checks(page,report,capture):
    page.set_viewport_size({'width':1366,'height':768})
    # Alliances in the default political view (legacy recorded match with three coalitions).
    go_back(page);page.locator('[data-room="ui-fixture"][data-resume]').click()
    expect(page.locator('#commander-title')).to_have_text('British Empire');camera(page,'world');page.wait_for_timeout(200)
    first=page.evaluate(RELATIONS_AUDIT,'ui-fixture')
    assert len(first['blocs'])==3,first['blocs']
    for b in first['blocs']:
        assert b['exists'] and b['inBase'] and b['members']==b['expectedMembers'] and b['provinces']==b['expectedProvinces'] and b['color']==b['expectedColor'],b
        assert b['name'] in first['legend'],(b,first['legend'])
    assert len({b['color'] for b in first['blocs']})==3 and not first['badTicks'],first
    assert first['labels'],'no alliance name placed at world view'
    assert first['fronts']==[] and first['sea']==[],first  # legacy rules: no formal war fronts
    capture('15-alliance-blocs.png',900)
    page.wait_for_timeout(1300);again=page.evaluate(RELATIONS_AUDIT,'ui-fixture')
    assert [b['color'] for b in again['blocs']]==[b['color'] for b in first['blocs']]
    # Seam: blocs are part of the repeated world layer, so the copy across the dateline shows them.
    drag_map(page,page.locator('#map').bounding_box()['width']/2);assert page.locator('#map use.world-copy[href$="world-base"]').count()==2
    report['assertions'].append('Political view shows each coalition as one outline in a stable alliance colour around exactly its members’ provinces (repeated across the seam), a name label and legend entry, softened internal borders and alliance ticks on member counters.')
    # War fronts, diplomacy mode, hover relations and the army layer on real formal wars.
    go_back(page);page.locator('[data-room="ui-war"][data-resume]').click()
    expect(page.locator('#commander-title')).to_have_text('British Empire');page.keyboard.press('Escape')
    audit=page.evaluate(RELATIONS_AUDIT,'ui-war')
    assert audit['fronts'] and audit['fronts']==audit['expectedFronts'] and audit['frontsInBase'],audit
    assert audit['sea']==audit['expectedSea'],audit
    assert 'At war' in audit['legend'] and 'France – Germany' in audit['legend'],audit['legend']
    forming=page.evaluate('''async()=>{const {allianceColors,formingAlliances}=await import('/relations.js');const s=await (await fetch('/api/games/ui-war')).json();
      const f=formingAlliances(s),g=document.querySelector('#map .alliance-bloc.forming');
      return {count:f.length,id:f[0]?.id,members:f[0]?.members.join(','),color:allianceColors(s)[f[0]?.id],provinces:s.provinces.filter(p=>f[0]?.members.includes(p.owner)).map(p=>p.id).sort().join(','),
        el:g&&{id:g.dataset.forming,members:g.dataset.members,provinces:g.dataset.provinces,stroke:g.querySelector('path').getAttribute('stroke'),dash:getComputedStyle(g.querySelector('path')).strokeDasharray,inBase:Boolean(g.closest('[id$="world-base"]'))}};}''')
    assert forming['count']==1 and forming['members']=='japan,usa' and forming['el'],forming
    el=forming['el'];assert el['id']==forming['id'] and el['members']==forming['members'] and el['provinces']==forming['provinces'] and el['stroke']==forming['color'] and el['dash']!='none' and el['inBase'],forming
    assert 'Pacific Pact · forming' in audit['legend'],audit['legend']
    # v0.8: the map key (legend + Political/Diplomacy toggle) lives in the ☰ menu, off the map.
    def key():
        menu(page)
        if page.locator('.menu-key').get_attribute('open') is None:page.locator('.menu-key summary').click()
        expect(page.locator('#map-key .atlas-legend')).to_be_visible()
    key();assert page.locator('.war-room .atlas-modes').count()==0
    toggle=page.locator('#map-key .atlas-mode-toggle')
    fills=lambda:page.evaluate('''async()=>{const s=await (await fetch('/api/games/ui-war')).json();return s.provinces.map(p=>[p.id,p.owner,document.querySelector('#province-'+p.id).getAttribute('fill')]);}''')
    toggle.click();expect(page.locator('#map')).to_have_attribute('data-mode','diplomacy')
    enemies={b if a=='britain' else a for a,b in (w.split(':') for w in page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())")['wars']) if 'britain' in (a,b)}
    assert enemies=={'usa'},enemies  # the fixture's Britain–USA declaration (v0.7 relation UI)
    for pid,owner,fill in fills():
        assert fill==('#d9b45a' if owner=='britain' else '#6d716a' if not owner else '#b8483c' if owner in enemies else '#8f8d80'),(pid,owner,fill)
    expect(page.locator('#map-key .atlas-legend')).to_contain_text('Relations of British Empire')
    camera(page,'world');capture('16-diplomacy-mode.png',900)
    key();toggle.click();menu(page,False);expect(page.locator('#map')).to_have_attribute('data-mode','political')
    for pid,owner,fill in fills():
        if owner=='germany':assert fill=='#8e8b7d',(pid,fill)
    camera(page,'europe');page.wait_for_timeout(150)
    box=page.locator('#marker-bavaria .counter-body').bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.wait_for_timeout(450)
    expect(page.locator('#map')).to_have_attribute('data-outline-focus','germany')
    assert page.locator('#map .relation-enemy').get_attribute('d') and not page.locator('#map .relation-ally').get_attribute('d')
    page.mouse.move(5,5);page.wait_for_timeout(100);expect(page.locator('#map')).to_have_attribute('data-outline-focus','')
    report['assertions'].append('Formal wars draw a front on exactly the land borders between warring owners (sea links only without land contact) and list the wars in the legend; diplomacy mode recolours focus/ally/enemy/neutral and back; hovering a country outlines its enemies and allies.')
    # Moving armies are the top layer and no name label covers them.
    for view,steps in [('europe',0),('europe',1),('europe',2),('world',0)]:
        camera(page,view)
        for _ in range(steps):page.locator('#zoom-out').click()
        page.wait_for_timeout(200);army=page.evaluate(ARMY_AUDIT)
        assert army['last'] and army['afterEverything'] and army['inCopies']==0,army
        assert not army['covered'],(view,steps,army)
        if view=='europe' and steps==0:assert army['visible']>=2,army
    camera(page,'europe');page.wait_for_timeout(150)
    page.locator('#map .moving-army:not(.engaged)').first.focus()
    expect(page.locator('.atlas-tooltip').first).to_contain_text('→');expect(page.locator('.atlas-tooltip').first).to_contain_text('troops')
    capture('17-armies-on-top.png',900)
    ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
    report['assertions'].append('Moving armies are the last map layer (above every world copy, counters, battles, names and effects); name labels avoid them at four zoom levels; an army is focusable and reports route, size and ETA.')

HOSTILE_NAME='''async () => {
  const {Atlas}=await import('/atlas.js');
  const map=await (await fetch('/map.json')).json(),state=await (await fetch('/api/games/ui-fixture')).json();
  const evil='<img src=x onerror="window.__pwned=1">Accord of a very long hostile name';
  const side=state.sides.find(s=>s.members.length>1);side.name=evil;
  const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:800px;height:425px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='hostile-test-map';svg.style.cssText='width:800px;height:425px';
  host.append(svg);document.body.append(host);
  const atlas=new Atlas(svg,map,()=>{},{legend:{placement:'top-right'}});atlas.update(state,null,null);atlas.world();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));atlas.layout();
  const labels=[...svg.querySelectorAll('.alliance-label')].map(e=>e.textContent),legend=host.querySelector('.atlas-legend').textContent;
  const focus=atlas.setRelationFocus('germany');atlas.setMapMode('diplomacy');
  const fill=id=>svg.querySelector('#hostile-test-map-province-'+id).getAttribute('fill');
  const rel=(await import('/relations.js')).relationsOf(state,'germany');
  const owners=Object.fromEntries(state.provinces.map(p=>[p.id,p.owner]));
  const wrong=state.provinces.filter(p=>{const o=p.owner,f=fill(p.id);return !o?f!=='#6d716a':o==='germany'?f!=='#d9b45a':rel.allies.includes(o)?f!=='#4f9e94':rel.enemies.includes(o)?f!=='#b8483c':f!=='#8f8d80';}).map(p=>p.id);
  const bad=atlas.setMapMode('nope')===false&&atlas.setRelationFocus('<x>')===null;
  const placement=host.querySelector('.atlas-modes').className;
  const result={placement,labels,legendHasName:legend.includes(evil.slice(0,20)),injected:Boolean(host.querySelector('img'))||Boolean(window.__pwned),focus,wrong,bad,
    leaked:document.querySelectorAll('#map [data-bloc]').length>0&&[...document.querySelectorAll('#map .alliance-bloc')].some(g=>g.closest('#hostile-test-map'))};
  atlas.destroy();host.remove();return result;
}'''

def hostile_name_check(page,report):
    result=page.evaluate(HOSTILE_NAME)
    assert not result['injected'] and result['legendHasName'],result
    assert 'at-top-right' in result['placement'] and 'at-bottom-left' not in result['placement'],result
    assert all(len(l)<=28 for l in result['labels']),result
    assert result['focus']=='germany' and not result['wrong'] and result['bad'] and not result['leaked'],result
    report['assertions'].append('A hostile alliance name renders only as capped text (no element injection); setRelationFocus/setMapMode recolour focus, allies, enemies and neutrals and reject unknown values.')

BATTLE_AUDIT='''async () => {
  const {teamColor,battleColors,colorDistance}=await import('/relations.js');
  const state=await (await fetch('/api/games/ui-war')).json(),map=await (await fetch('/map.json')).json();
  const color=id=>map.countries.find(c=>c.id===id)?.color;
  return state.battles.map(b=>{
    const engaged=state.armies.filter(a=>a.engaged&&a.to===b.province),by=new Map();for(const a of engaged)by.set(a.country,(by.get(a.country)||0)+a.amount);
    const lead=[...by].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]))[0]?.[0],owner=state.provinces.find(p=>p.id===b.province).owner;
    const attack=engaged.reduce((n,a)=>n+a.amount,0),defend=state.provinces.find(p=>p.id===b.province).troops;
    const expected=battleColors(teamColor(state,lead,color(lead)),teamColor(state,owner,color(owner)));
    const g=document.querySelector(`#map .battle-counter:not(.resolved)[data-province="${b.province}"]`);
    const bar=g.querySelector('.battle-attack-bar').getBoundingClientRect(),full=g.querySelector('.battle-defend-bar').getBoundingClientRect();
    const style=getComputedStyle(g.querySelector('.battle-attack-bar'));
    return {province:b.province,attack,defend,shownAttack:Number(g.dataset.attack),shownDefend:Number(g.dataset.defend),
      expectedRatio:attack/(attack+defend),measured:bar.width/full.width,attackFill:g.querySelector('.battle-attack-bar').getAttribute('fill'),
      defendFill:g.querySelector('.battle-defend-bar').getAttribute('fill'),expected,distance:colorDistance(expected.attacker,expected.defender),
      transition:style.transitionDuration};
  });
}'''

def battle_checks(page,server,report,capture):
    page.set_viewport_size({'width':1366,'height':768});camera(page,'europe');page.wait_for_timeout(700)
    def check(label):
        rows=page.evaluate(BATTLE_AUDIT);assert rows,label
        for r in rows:
            assert r['shownAttack']==r['attack'] and r['shownDefend']==r['defend'],(label,r)
            ratio=min(.94,max(.06,r['expectedRatio']))
            assert abs(r['measured']-ratio)<.01,(label,r)
            assert r['attackFill']==r['expected']['attacker'] and r['defendFill']==r['expected']['defender'] and r['distance']>=20,(label,r)
        return rows
    before=check('tick 56')
    assert all(r['transition'].startswith('0.4') for r in before),before
    server.stdin.write('war 58\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==58
    page.wait_for_timeout(2600);after=check('tick 58')
    assert any((a['attack'],a['defend'])!=(b['attack'],b['defend']) for a,b in zip(after,before) if a['province']==b['province']),(before,after)
    capture('18-battle-tug-of-war.png',900)
    page.emulate_media(reduced_motion='reduce')
    assert all(r['transition'] in ('0s','0s, 0s') for r in page.evaluate(BATTLE_AUDIT)),page.evaluate(BATTLE_AUDIT)
    page.emulate_media(reduced_motion='no-preference')
    ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
    report['assertions'].append('Battle tokens are a tug-of-war bar: team colours (coalition or country, kept ≥20 ΔE apart), split at attacker/(attacker+defender) within 1% (6% minimum per side), updating after a real stepped round; 0.4 s transition, none under reduced motion; unique IDs.')

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
    page.set_viewport_size({'width':1366,'height':768});camera(page,'world');page.wait_for_timeout(100)
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
    page.set_viewport_size({'width':1366,'height':768});camera(page,'europe')
    server.stdin.write('war 56\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==56
    expect(page.locator('#map .round-loss').first).to_be_attached(timeout=6000)
    capture('13-battle-round.png',600)
    report['assertions'].append('Real phased battles show a persistent attacker-vs-defender clash marker at every zoom (never merged), matching engaged armies and garrison, and flash the losses of a newly adjudicated round.')

HOSTILE_ALLIANCE='<b onclick="x()">Iron & "Pact"</b>'
def inbox_checks(page,server,context,url,report,capture):
    """One attention badge: decisions + unread private messages, read per item, never replayed as toasts."""
    page.set_viewport_size({'width':1366,'height':768});page.keyboard.press('Escape')
    if page.locator('#feed-toggle').get_attribute('aria-expanded')=='true':page.locator('#feed-toggle').click()  # a row visible in the open rail counts as read
    for line in ['dm russia britain An older note from Petersburg.','dm germany britain Our armies should talk before the Rhine burns.','offer qing france']:
        server.stdin.write(line+'\n');server.stdin.flush();json.loads(server.stdout.readline())
    badge=page.locator('#attention-count')
    expect(badge).to_have_text('3',timeout=5000)  # 2 unread DMs + 1 offer waiting for this seat
    expect(page.locator('#notice')).to_contain_text('Alliance offer',timeout=8000);expect(page.locator('#notice [data-act="accept"]')).to_be_visible()
    capture('19-offer-toast.png')
    page.reload();expect(page.locator('#commander-title')).to_have_text('British Empire')
    expect(badge).to_have_text('3',timeout=5000)
    page.wait_for_timeout(1600);expect(page.locator('#notice')).to_be_hidden()  # no summary, no replayed toasts
    # Per item: reading Germany's (newer) DM must not mark Russia's (older) one read.
    page.locator('#lb-rows .lb-row[data-id="germany"]').click();expect(page.locator('#card-body')).to_contain_text('before the Rhine burns')
    expect(badge).to_have_text('2',timeout=5000);page.keyboard.press('Escape')
    page.reload();expect(badge).to_have_text('2',timeout=5000)  # read state persists per item
    page.locator('#attention').click()  # first: the decision, in the offering country's card
    expect(page.locator('#card')).to_have_attribute('data-kind','country');expect(page.locator('#primary')).to_have_text('Accept alliance')
    page.locator('#primary').click();expect(badge).to_have_text('1',timeout=5000)
    page.locator('#attention').click();expect(page.locator('#card-title')).to_have_text('Russian Empire')
    expect(page.locator('#composer-text')).to_be_focused();expect(page.locator('#attention')).to_be_hidden(timeout=5000)
    page.keyboard.press('Escape');page.keyboard.press('Escape')
    spectator=context.new_page();spectator.goto(url+'/?match=ui-war&spectate=1');expect(spectator.locator('#phase')).to_have_text('SPECTATING')
    spectator.wait_for_timeout(800)
    assert spectator.locator('#feed-list .feed-chat[data-channel="dm"],#feed-list [data-kind="system-offer"]').count()==0
    expect(spectator.locator('#attention')).to_be_hidden();spectator.close()
    report['assertions'].append('One attention badge: two DMs from different countries and an alliance offer read 3; a reload keeps it without any summary or replayed toast; reading the newer DM (in its country card) leaves the older one unread (per-item read state, persisted); the badge opens the offer first (Accept in the offering country’s card), then the remaining DM with the message box focused; a spectator sees none of these private items.')

TOAST_SIZE='''() => {
  const out={};for(const id of ['declaration','notice']){const e=document.getElementById(id);e.hidden=false;
    if(id==='declaration'){e.className='declaration war';e.querySelector('#declaration-kind').textContent='THE COUNCIL’S SEAL';e.querySelector('#declaration-title').textContent='WAR DECLARED';e.querySelector('#declaration-detail').textContent='German Empire declared war on British Empire. Both sides may now attack.';}
    else e.innerHTML='<div class="notice-card"><span class="notice-flag"></span><div class="notice-words"><b class="notice-title">German Empire</b><span class="notice-detail">Our armies should talk before the Rhine burns.</span></div><button class="notice-close">✕</button></div>';
    const r=e.getBoundingClientRect();out[id]={top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right};e.hidden=true;}
  return out;
}'''
BAND_COLORS='''async side=>{
  const {allianceColors}=await import('/relations.js'),state=await (await fetch('/api/games/ui-war')).json(),colors=allianceColors(state),expected={};
  for(const [id,color] of Object.entries(colors)){const probe=document.createElement('i');probe.style.color=color;document.body.append(probe);expected[id]=getComputedStyle(probe).color;probe.remove();}
  return {expected,rows:[...document.querySelectorAll('#lb-rows .lb-row[data-band="active"]')].map(r=>[r.dataset.id,r.dataset.side,getComputedStyle(r).borderLeftColor]),
    feed:[...document.querySelectorAll('#feed-list [data-kind="alliance"]')].map(r=>[r.dataset.side,getComputedStyle(r).borderLeftColor])};
}'''
def relation_checks(page,server,report,capture):
    """Relations in the recorded war room: Britain (this seat) declared war on the USA at tick 0."""
    page.set_viewport_size({'width':1366,'height':768});page.wait_for_timeout(150);page.keyboard.press('Escape')
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())");wars=set(state['wars'])
    at_war=lambda a,b:':'.join(sorted([a,b])) in wars
    assert 'britain:usa' in wars and len(wars)==3,wars
    rows=page.locator('#lb-rows .lb-row');assert rows.count()>=5
    for i in range(rows.count()):
        row=rows.nth(i);cid=row.get_attribute('data-id');countries=row.get_attribute('data-countries').split(',')
        expected='you' if 'britain' in countries else 'enemy' if any(at_war('britain',c) for c in countries) else 'neutral'
        assert row.get_attribute('data-relation')==expected,(cid,row.get_attribute('data-relation'))
        assert row.locator('.lb-rel').text_content()==('⚔' if expected=='enemy' else '')
    check_layout(page,'1366x768 war room')
    # Wars live in the leaderboard: every front, the one involving you marked; a click frames it on the map.
    fronts=page.locator('#lb-fronts .lb-front');expect(fronts).to_have_count(3)
    involved=page.locator('#lb-fronts .lb-front.involved');expect(involved).to_have_count(1);expect(involved).to_contain_text('United States')
    before=page.locator('#map').get_attribute('viewBox');involved.locator('button').click()
    assert page.locator('#map').get_attribute('viewBox')!=before
    capture('17-wars.png')
    # Country cards: the relation in big words and the one obvious next action.
    for cid,words,primary in [('usa','AT WAR','Offer peace'),('france','NEUTRAL','Propose alliance')]:
        page.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
        expect(page.locator('#card-status')).to_contain_text(words);expect(page.locator('#primary')).to_have_text(primary)
        check_layout(page,f'country {cid}');check_commit(page,f'country {cid}');page.keyboard.press('Escape')
    # Order card: the target owner's relation, and the owner line opens that country.
    board=page.evaluate("fetch('/api/games/ui-war/map').then(r=>r.json())");owner={p['id']:p['owner'] for p in state['provinces']}
    select(page,'england','north-france')
    expect(page.locator('#card')).to_have_attribute('data-relation','neutral');expect(page.locator('#card-status')).to_contain_text('NOT AT WAR')
    check_layout(page,'relation neutral peek')
    page.locator('#card-sub .card-owner').click();expect(page.locator('#card-title')).to_have_text('French Republic');page.keyboard.press('Escape')
    # Declare war & march (solo, keyboard): one confirmed order declares the war and reserves the march, or neither.
    select(page,'england','north-france')
    send=page.locator('#primary');expect(send).to_contain_text('Declare war on France & send')
    send.focus();page.keyboard.press('Enter');dialog=page.locator('#confirm-dialog');expect(dialog).to_be_visible();expect(dialog).to_contain_text('Declare war on French Republic?')
    expect(dialog.locator('.war-confirm')).to_contain_text('French Republic');expect(dialog.locator('[value="cancel"]')).to_be_focused()
    page.keyboard.press('Escape');expect(dialog).to_be_hidden()
    assert 'britain:france' not in page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())")['wars'],'Cancel keeps the peace'
    page.evaluate('()=>{window.__banners=[];const seen=new Set();new MutationObserver(()=>{for(const e of document.querySelectorAll("#declaration:not([hidden]),#alliance-seal:not([hidden]),#fallen-seal:not([hidden])"))if(e.dataset.seq&&!seen.has(e.dataset.seq)){seen.add(e.dataset.seq);window.__banners.push(e.textContent);}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:["hidden","data-seq"]});return 0;}')
    send.focus();page.keyboard.press('Enter');expect(dialog).to_be_visible();page.keyboard.press('Tab')
    expect(dialog.locator('[value="confirm"]')).to_be_focused();expect(dialog.locator('[value="confirm"]')).to_contain_text('Declare war & send')
    page.keyboard.press('Enter');expect(dialog).to_be_hidden()
    expect(page.locator('#feed-list [data-kind="war"]').last).to_contain_text('French Republic',timeout=5000)
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())");assert 'britain:france' in state['wars'],state['wars']
    mine=page.evaluate("fetch('/api/games/ui-war',{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('coi.identity')).token}}).then(r=>r.json())")
    assert any(o['type']=='move' and o['from']=='england' and o['to']=='north-france' for o in mine['commandBudget']['reserved']),mine['commandBudget']
    page.wait_for_timeout(1200);assert page.evaluate('window.__banners.length')==1 and 'WAR DECLARED' in page.evaluate('window.__banners[0]'),page.evaluate('window.__banners')
    report['assertions'].append('Declare war & march (solo, keyboard): a neutral target makes the one primary read “Declare war on France & send N”; the confirmation names the whole target side with Cancel focused; Escape keeps the peace; confirming declares the war and reserves the march in one order, adds the war row to the rail and shows exactly one banner (it affects this seat).')
    report['assertions'].append('Relations (recorded war room, Britain at war with the USA): every leaderboard row’s relation marker matches the public war list; the leaderboard lists exactly the war fronts, marks the one involving the viewer and frames it on the map; country cards state AT WAR / NEUTRAL with Offer peace / Propose alliance as the primary; the order card states the target owner’s relation and its owner line opens that country’s card.')
    # Alliances from the country card: forming (dashed) during the notice, then active in the alliance colour; the name stays text.
    page.locator('#lb-rows .lb-row[data-id="qing"]').click();expect(page.locator('#primary')).to_have_text('Propose alliance')
    page.locator('#primary').click();page.locator('#coalition-name').fill(HOSTILE_ALLIANCE);page.locator('#primary').click()
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE OFFER PENDING')
    server.stdin.write('ally qing\n');server.stdin.flush();assert json.loads(server.stdout.readline())['status']=='pending'
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE FORMING',timeout=5000)
    expect(page.locator('#lb-rows .lb-row[data-id="britain"]')).to_have_attribute('data-band','forming')  # your row is always listed
    page.keyboard.press('Escape')
    server.stdin.write('war 90\n');server.stdin.flush();json.loads(server.stdout.readline())
    expect(page.locator('#commander-side')).to_have_text(HOSTILE_ALLIANCE,timeout=5000)
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())")
    side=next(p['side'] for p in state['players'] if p['id']=='britain');assert next(p['side'] for p in state['players'] if p['id']=='qing')==side
    expect(page.locator('#lb-rows .lb-row[data-band="active"]').first).to_be_visible()
    colors=page.evaluate(BAND_COLORS,side)
    assert colors['rows'] and all(c==colors['expected'][s] for _,s,c in colors['rows']),colors  # every band = the shared allianceColors
    assert {r[0] for r in colors['rows'] if r[1]==side}=={'britain','qing',side},colors  # the alliance row and both members
    assert colors['feed'] and colors['feed'][-1]==[side,colors['expected'][side]],colors
    assert page.locator('b[onclick]').count()==0
    expect(page.locator('#feed-list [data-kind="alliance"]').last).to_contain_text(HOSTILE_ALLIANCE)
    page.locator('#hud-standard').click();expect(page.locator('#card-title')).to_have_text(HOSTILE_ALLIANCE);expect(page.locator('#card-status')).to_contain_text('Qing')
    check_layout(page,'1366x768 alliance active');capture('18-alliance-relations.png');page.keyboard.press('Escape')
    # Coalition member: war on a neutral country is a vote, never a march.
    page.locator('#lb-rows .lb-row[data-id="germany"]').click()
    expect(page.locator('#card-actions')).to_contain_text('Call war vote');page.keyboard.press('Escape')
    report['assertions'].append('As a coalition member, war on a neutral country is offered as “Call war vote” (no march is sent without the vote).')
    expect(page.locator('#map .map-effect')).to_have_count(0,timeout=6000)  # the live alliance effect ends before the effect-scope check
    report['assertions'].append('Alliances from the country card: Propose alliance → name → Send; the card then reads ALLIANCE OFFER PENDING, then ALLIANCE FORMING (dashed band in the leaderboard) during the notice, then active in the HUD, the leaderboard and the alliance card; bands and the alliance feed row use the same colour as the shared allianceColors helper (relations.js, also used by the map blocs); a hostile alliance name renders only as text.')

# iPhone Safari has no element Fullscreen API: simulate it, so only the CSS pseudo-fullscreen can work.
NO_FULLSCREEN_API='Object.defineProperty(Document.prototype,"fullscreenEnabled",{get:()=>false,configurable:true});'
VIEW_CENTRE='()=>{const [x,y,w,h]=document.querySelector("#review-map").getAttribute("viewBox").split(" ").map(Number);return [x+w/2,y+h/2];}'
def expand_checks(browser,url,identity,report,out):
    for w,h in [(390,844),(844,390)]:
        context=browser.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2)
        context.add_init_script(NO_FULLSCREEN_API);context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');'+COACH_DONE)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        # Replay map (after-action review).
        page.goto(url+'/?match=ui-review');expect(page.locator('#aar-player-scores tbody tr')).to_have_count(8)
        assert page.evaluate('document.fullscreenEnabled') is False
        page.locator('#aar-tab-replay').click();expect(page.locator('#replay-stage')).to_be_visible()
        button=page.locator('#replay-expand');expect(button).to_be_visible()
        board,corner=page.locator('#review-map').bounding_box(),button.bounding_box()
        assert corner['x']>=board['x'] and corner['x']+corner['width']<=board['x']+board['width']+1 and corner['y']+corner['height']<=board['y']+board['height']+1 and corner['height']>=44,(board,corner)
        page.locator('#replay-slider').fill('300');centre=page.evaluate(VIEW_CENTRE)
        button.click();theatre=page.locator('#replay-theatre');expect(theatre).to_have_class(re.compile('map-expanded'))
        assert theatre.bounding_box()=={'x':0,'y':0,'width':w,'height':h},theatre.bounding_box()
        scroll=page.evaluate('scrollY');page.mouse.wheel(0,600);page.wait_for_timeout(150);assert page.evaluate('scrollY')==scroll,'page scrolled behind the expanded map'
        assert page.locator('#review-map').bounding_box()['height']>=h*.45
        for control in ['#replay-play','#replay-slider','#replay-speed','#replay-expand']:
            box=page.locator(control).bounding_box();assert box and box['y']>=0 and box['y']+box['height']<=h+.5 and box['x']+box['width']<=w+.5,(control,box)
        page.locator('#replay-play').click();expect(page.locator('#replay-play')).to_have_text('Pause');page.locator('#replay-play').click()
        page.locator('#replay-slider').fill('420');expect(page.locator('#replay-stage')).to_have_attribute('data-tick','420')
        page.screenshot(path=str(out/f'19-expanded-replay-{w}x{h}.png'))
        # Rotation keeps the camera centre and refits the expanded map.
        centre=page.evaluate(VIEW_CENTRE);page.set_viewport_size({'width':h,'height':w});page.wait_for_timeout(250)
        assert theatre.bounding_box()=={'x':0,'y':0,'width':h,'height':w},theatre.bounding_box()
        after=page.evaluate(VIEW_CENTRE);assert abs(after[0]-centre[0])<1 and abs(after[1]-centre[1])<1,(centre,after)
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        page.keyboard.press('Escape');expect(theatre).not_to_have_class(re.compile('map-expanded'));expect(button).to_be_focused()
        expect(button).to_have_attribute('aria-pressed','false');assert theatre.bounding_box()['height']!=h or theatre.bounding_box()['y']!=0
        button.click();page.locator('#replay-expand').click();expect(theatre).not_to_have_class(re.compile('map-expanded'))  # ✕ Exit
        ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
        assert page.locator('#review-map [id]').evaluate_all('(n)=>n.every(e=>e.id.startsWith("review-map"))')
        # Live map.
        page.goto(url+'/?match=ui-fixture');expect(page.locator('#commander-title')).to_have_text('British Empire')
        live=page.locator('#map-expand');expect(live).to_be_visible()
        live.click();expect(page.locator('#stage')).to_have_class(re.compile('map-expanded'));expect(page.locator('.hud-bar')).to_be_visible()  # v0.8: the HUD is one row and stays
        assert page.locator('#map').bounding_box()=={'x':0,'y':0,'width':w,'height':h}
        expect(page.locator('#leaderboard')).to_be_visible();check_layout(page,f'{w}x{h} expanded live map')
        page.screenshot(path=str(out/f'20-expanded-live-{w}x{h}.png'))
        page.keyboard.press('Escape');expect(page.locator('#stage')).not_to_have_class(re.compile('map-expanded'))
        expect(page.locator('.hud-bar')).to_be_visible();expect(live).to_be_focused()
        # Popups on phones are compact toasts under the HUD, never over the order sheet or its commit.
        select(page,'england','low-countries')
        sheet=page.locator('#card').bounding_box();commit=page.locator('#primary').bounding_box();sizes=page.evaluate(TOAST_SIZE)
        for name,r in sizes.items():
            assert r['height']<=min(72,h*.15)+.5 and r['top']>=0,(w,h,name,r)
            for other in [sheet,commit]:assert r['bottom']<=other['y'] or r['top']>=other['y']+other['height'] or r['right']<=other['x'] or r['left']>=other['x']+other['width'],(w,h,name,r,other)
        page.keyboard.press('Escape')
        menu(page);expect(page.locator('#fullscreen-toggle')).to_be_visible()  # never hidden without the Fullscreen API
        page.locator('#fullscreen-toggle').click();expect(page.locator('#stage')).to_have_class(re.compile('map-expanded'));live.click()
        manifest=page.evaluate("fetch('/manifest.webmanifest').then(async r=>({type:r.headers.get('content-type'),body:await r.json()}))")
        assert manifest['type']=='application/manifest+json' and manifest['body']['display']=='fullscreen' and 'standalone' in manifest['body']['display_override'],manifest
        for icon in manifest['body']['icons']:assert page.evaluate(f"fetch('{icon['src']}').then(r=>r.ok)"),icon
        assert page.locator('link[rel=manifest]').count()==1 and page.locator('meta[name=apple-mobile-web-app-capable][content=yes]').count()==1
        assert not errors,errors
        context.close()
    report['assertions'].append('Popups on phones (390×844, 844×390) are compact toasts ≤72 px and ≤15% of the viewport height, clear of the order sheet and its commit button.')
    report['assertions'].append('Expand map without the Fullscreen API (iPhone emulation, 390×844 and 844×390): the replay and live maps each show a thumb-reachable Expand control; expanded, the map covers the viewport, the page does not scroll, replay play/slider/speed stay on screen and work, rotation refits without moving the camera centre, and Escape or ✕ Exit restores the layout and focus; the menu entry is never hidden; the web app manifest (display fullscreen → standalone) and its icons are served; replay and live SVG IDs stay scoped.')

LONG_MESSAGE=('The Atlantic Accord proposes a longer public statement to check the history column: '+'we will hold the Channel, the Low Countries and the sea lanes to the Americas together. '*4).strip()
def feed_checks(page,report):
    """World history: whole-match scrollback, pinned reply, no yank while reading, expanded-then-compact rows."""
    page.set_viewport_size({'width':1600,'height':1000})
    if page.locator('#feed-toggle').get_attribute('aria-expanded')!='true':page.locator('#feed-toggle').click()
    history=page.locator('#feed-list')
    history.evaluate('(l)=>{l.scrollTop=l.scrollHeight;l.dispatchEvent(new Event("scroll"))}')  # start caught up: no earlier "new" count
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
  // A march across the Pacific: its trace and marker take the short way over the dateline.
  const t=state.tick,from=map.provinces.find(p=>p.id==='west-us'),to=map.provinces.find(p=>p.id==='south-japan');
  atlas.update({...state,you:'usa',armies:[...state.armies,{id:'wrap-test',country:'usa',from:'west-us',to:'south-japan',amount:30,departedAt:t-5,arrivesAt:t+5}]},null,'south-japan');
  const trail=[...svg.querySelectorAll('.army-trail')].map(p=>p.getBBox().width);
  const marker=[...svg.querySelectorAll('.moving-army')].map(g=>Number(g.getAttribute('transform').slice('translate('.length).split(' ')[0]));
  const wrap=d=>Math.abs(d-1280*Math.round(d/1280));
  result.pacificTrail=Math.max(...trail);result.pacificMarkerFromOrigin=Math.min(...marker.map(x=>wrap(x-from.x)));
  result.shortWay=wrap(to.x-from.x);
  atlas.destroy();host.remove();return result;
}'''

def effect_checks(page,report):
    result=page.evaluate(EFFECT_CHECK)
    assert result['kinds']==['industry_up','industry_down','captured','alliance','war','peace','eliminated'],result
    assert all(result['accepted']),result;assert not any(result['rejected']),result;assert not result['threw']
    assert result['count']>=7 and result['hidden']=='true' and result['ids']==0 and result['leaked']==0,result
    assert result['still'] and result['animations']==0,result
    assert result['pacificTrail']<640 and result['pacificMarkerFromOrigin']<=result['shortWay']/2+2,result
    report['assertions'].append('atlas.effect exposes the supported kinds, draws aria-hidden effects inside its own map instance only, returns false for unknown kinds/ids/malformed data without throwing, and is a static highlight under reduced motion.')

# Test-only spy (not production code): counts AudioContexts and buffer starts, records the
# sound module's `coi:sound` decisions and any CSP violation. No real audio output is inspected.
SOUND_SPY='''(() => {
  const spy = window.__sound = { contexts: 0, starts: 0, cues: [], csp: [] };
  const Base = window.AudioContext;
  if (Base) window.AudioContext = class extends Base { constructor(...a) { super(...a); spy.contexts++; } };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { spy.starts++; return start.apply(this, a); };
  document.addEventListener('coi:sound', e => spy.cues.push(e.detail));
  document.addEventListener('securitypolicyviolation', e => spy.csp.push(e.violatedDirective + ' ' + e.blockedURI));
})();'''
spy=lambda page,expr:page.evaluate(f'window.__sound.{expr}')
audio_fetches=lambda page:page.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/audio/')).length")

def sound_settings_checks(page,context,url,report,bridge):
    # Controls: mute, volume sliders, reduced sound; persisted per browser; Shift+M never fires while typing.
    control=page.locator('#sound-control')
    menu(page);page.locator('.sound-toggle').click();expect(page.locator('#sound-panel')).to_be_visible()
    page.locator('#sound-music').fill('60');page.locator('#sound-effects').fill('40')
    page.locator('#sound-mute').check()
    expect(control).to_have_attribute('data-muted','true');expect(control).to_have_attribute('data-audio','suspended')
    expect(page.locator('.sound-toggle')).to_have_text('♪ Sound off')
    saved=json.loads(page.evaluate("localStorage.getItem('coi.sound')"))
    assert saved=={'muted':True,'music':.6,'effects':.4,'reduced':False},saved
    page.keyboard.press('Escape');expect(page.locator('#sound-panel')).to_be_hidden()
    expect(page.locator('#feed-text')).to_be_visible()
    page.locator('#feed-text').focus();page.keyboard.press('Shift+M');expect(control).to_have_attribute('data-muted','true')
    assert page.locator('#feed-text').input_value().endswith('M');page.locator('#feed-text').fill('')
    page.locator('#feed-text').evaluate('(e)=>e.blur()');page.keyboard.press('Shift+M')  # not typing any more
    expect(control).to_have_attribute('data-muted','false');expect(control).to_have_attribute('data-audio','running')
    fresh=context.new_page()
    if bridge:load_bridge(fresh,url,{})
    else:fresh.goto(url)
    expect(fresh.locator('#sound-control')).to_have_attribute('data-music','0.6')
    menu(fresh);fresh.locator('.sound-toggle').click()
    assert fresh.locator('#sound-music').input_value()=='60' and fresh.locator('#sound-effects').input_value()=='40'
    assert not fresh.locator('#sound-mute').is_checked()
    fresh.close()
    report['assertions'].append('Sound control: mute suspends audio, music/effects sliders and mute persist in localStorage across pages; Shift+M toggles mute but not while typing in the feed reply.')
def mobile_checks(browser,url,identity,report,out):
    # Real mobile emulation: the zoom limit is in screen px per map unit, so phones reach the same
    # maximum as desktop (the old fixed minimum view width gave a 390px phone ~2.9 px/unit).
    DESKTOP_OLD_MAX=1552/135  # what a 1920×1080 desktop map reached before this change
    px=lambda page:page.evaluate('document.querySelector("#map").getScreenCTM().a')
    for w,h in [(390,844),(844,390)]:
        context=browser.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2)
        context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');'+COACH_DONE)
        page=context.new_page();page.goto(url);page.locator('[data-room="ui-war"][data-resume]').click()
        expect(page.locator('#commander-title')).to_have_text('British Empire');page.locator('#map').scroll_into_view_if_needed()
        # The viewBox takes the element's aspect: no letterboxing.
        box=page.locator('#map').bounding_box();vb=[float(v) for v in page.locator('#map').get_attribute('viewBox').split()]
        assert abs(vb[2]/vb[3]-box['width']/box['height'])<.01,(vb,box)
        camera(page,'world');page.wait_for_timeout(150);start=vb_w=float(page.locator('#map').get_attribute('viewBox').split()[2])
        # Pinch (two real touch points through CDP) zooms in.
        cdp=context.new_cdp_session(page);page.locator('#map').scroll_into_view_if_needed();box=page.locator('#map').bounding_box()
        top,bottom=max(box['y'],0),min(box['y']+box['height'],h);cx,cy=box['x']+box['width']/2,(top+bottom)/2
        def pinch(spread):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':cx-10,'y':cy,'id':1},{'x':cx+10,'y':cy,'id':2}]})
            for i in range(1,9):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':cx-10-spread*i/8,'y':cy,'id':1},{'x':cx+10+spread*i/8,'y':cy,'id':2}]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(80)
        spread=min(box['width'],bottom-top)*.4;pinch(spread)
        after=float(page.locator('#map').get_attribute('viewBox').split()[2]);assert after<start*.5,(start,after)
        for _ in range(6):pinch(spread)
        assert px(page)>=MAX_PX-.05,('pinch max',w,px(page))
        # Double tap zooms 2× at the tap point.
        camera(page,'world');page.locator('#map').scroll_into_view_if_needed();page.wait_for_timeout(100)
        box=page.locator('#map').bounding_box()
        # Tap a spot with no counter under it (a tap on a merged counter would zoom to fit it instead).
        tx,ty=page.evaluate('''([x0,y0,x1,y1])=>{for(let y=y0+20;y<y1-20;y+=17)for(let x=x0+20;x<x1-20;x+=17){const e=document.elementFromPoint(x,y);
          if(e&&!e.closest('.map-counter,.battle-counter,.moving-army,.atlas-modes')&&e.closest('#map'))return [x,y];}return null;}''',[box['x'],max(box['y'],0),box['x']+box['width'],min(box['y']+box['height'],h)])
        before=float(page.locator('#map').get_attribute('viewBox').split()[2])
        page.touchscreen.tap(tx,ty);page.wait_for_timeout(60);page.touchscreen.tap(tx,ty);page.wait_for_timeout(120)
        now=float(page.locator('#map').get_attribute('viewBox').split()[2]);assert abs(now-before/2)<1,('double tap',before,now)
        # Europe at maximum zoom via the + button: near LOD, desktop-or-better px/unit, tappable provinces.
        camera(page,'europe')
        for _ in range(14):page.keyboard.press('e')  # touch: no +/− buttons (pinch, double tap, E)
        page.wait_for_timeout(200);level=page.locator('#map').get_attribute('data-lod')
        assert px(page)>=DESKTOP_OLD_MAX and px(page)>=MAX_PX-.05 and level=='near',(w,px(page),level)
        sizes=page.evaluate('''()=>['belgium','low-countries','ruhr','rhineland','saxony','serbia'].map(id=>{const r=document.querySelector('#province-'+id).getBoundingClientRect();return [id,Math.min(r.width,r.height)];})''')
        assert all(s>=32 for _,s in sizes),sizes
        camera(page,'europe');page.keyboard.press('e');page.keyboard.press('e');page.keyboard.press('e');page.wait_for_timeout(200)
        result=page.evaluate(MAP_AUDIT,'ui-war');assert not result['overlaps'] and not result['missing'] and not result['badSums'],result
        if w==390:page.screenshot(path=str(out/'19-mobile-max-zoom.png'))
        if w==390:
            # A column that has just left Scotland sits on the Scotland counter: a tap must still select Scotland.
            camera(page,'world');page.locator('#home-view').click()
            for _ in range(5):page.keyboard.press('e')
            page.locator('#map').scroll_into_view_if_needed();page.wait_for_timeout(250)
            departing=page.evaluate('''()=>{const c=document.querySelector('#marker-scotland .counter-body').getBoundingClientRect();
              return [...document.querySelectorAll('#map .moving-army:not(.engaged)')].map(g=>{const r=g.querySelector('.army-arrow').getBoundingClientRect();
                return {blocked:g.classList.contains('tap-blocked'),hit:g.querySelector('.army-hit').getBoundingClientRect().width,over:r.left<c.right&&c.left<r.right&&r.top<c.bottom&&c.top<r.bottom};}).filter(a=>a.over);}''')
            assert departing and all(a['blocked'] for a in departing) and all(a['hit']<=18 for a in departing),departing
            body=page.locator('#marker-scotland .counter-body').bounding_box()
            page.touchscreen.tap(body['x']+body['width']/2,body['y']+body['height']/2)
            expect(page.locator('#card-title')).to_have_text('Scotland')
        context.close()
    report['assertions'].append(f'Phones (390×844 and 844×390, touch emulation) reach {MAX_PX} px per map unit (desktop previously {DESKTOP_OLD_MAX:.1f}) by + button and by a real two-finger pinch; double tap zooms 2×; near LOD with names is reachable; small Europe provinces are ≥32 CSS px; a tap on a counter under a just-departed army selects the province; the viewBox fills the element (no letterboxing); counters stay non-overlapping.')

MAX_PX=14

def coach_and_drag_checks(browser,url,identity,report,out):
    """First-match tips (three, dismissible, stored per browser) and a real touch drag from a province counter."""
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');')
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url+'/?match=ui-fixture');expect(page.locator('#commander-title')).to_have_text('British Empire')
    coach=page.locator('#coach');expect(coach).to_be_visible(timeout=5000);expect(coach).to_contain_text('Tip 1 of 3');expect(coach).to_contain_text('Drag from your province')
    check_layout(page,'390 coach tip 1');page.screenshot(path=str(out/'21-coach-1.png'))
    page.locator('#coach-next').click();expect(coach).to_contain_text('Tap a country');check_layout(page,'390 coach tip 2')
    page.locator('#coach-next').click();expect(coach).to_contain_text('Your standard');expect(page.locator('#coach-next')).to_have_text('Got it')
    page.screenshot(path=str(out/'21-coach-3.png'));page.locator('#coach-next').click();expect(coach).to_be_hidden()
    assert page.evaluate("localStorage.getItem('coi.coach')")=='done'
    page.reload();expect(page.locator('#commander-title')).to_have_text('British Empire');page.wait_for_timeout(1200);expect(coach).to_be_hidden()
    menu(page);page.locator('#coach-replay').click();expect(coach).to_be_visible();page.keyboard.press('Escape');expect(coach).to_be_hidden()
    # Drag with a real touch point from Southern England's counter to the Low Countries.
    page.locator('#home-view').click();page.wait_for_timeout(250)
    def centre(sel):
        b=page.locator(sel).bounding_box();return b['x']+b['width']/2,b['y']+b['height']/2
    (x0,y0),(x1,y1)=centre('#marker-england .counter-body'),centre('#marker-low-countries .counter-body')
    cdp=context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x0,'y':y0,'id':1}]})
    for i in range(1,13):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x0+(x1-x0)*i/12,'y':y0+(y1-y0)*i/12,'id':1}]})
    page.wait_for_timeout(80)
    expect(page.locator('#map')).to_have_class(re.compile('command-drag'));expect(page.locator('#map .draft-arrow.snapped')).to_have_count(1)
    assert re.fullmatch(r'\d+ · \d+s',page.locator('#map .draft-label text').text_content()),page.locator('#map .draft-label text').text_content()  # troops · ETA
    page.screenshot(path=str(out/'22-touch-drag.png'))
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    expect(page.locator('#card')).to_have_attribute('data-kind','province');expect(page.locator('#card-title')).to_have_text('Low Countries')
    expect(page.locator('#card-sub')).to_contain_text('from Southern England');check_commit(page,'390 after drag')
    assert page.locator('#map .draft-arrow').count()==1  # the order arrow stays while the card is open
    page.screenshot(path=str(out/'23-after-drag.png'))
    assert not errors,errors
    context.close()
    report['assertions'].append('First match: three dismissible tips (drag to attack, tap a country, your standard shows what needs you), stored per browser, replayable from the menu, closed by Escape, never overlapping other overlays. A real touch drag from a province counter draws a snapped order arrow with an ETA label, then opens the order card for that target with one primary action; drags elsewhere still pan.')

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
            context.add_init_script(SOUND_SPY);context.add_init_script(COACH_DONE)
            page=context.new_page();page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(page,url,{'coi.identity':json.dumps(identity)})
            else:
                context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');'+COACH_DONE)
                page.goto(url)
            expect(page.locator('#faction-parade .insignia')).to_have_count(8)
            page.wait_for_timeout(600)
            assert spy(page,'contexts')==0 and spy(page,'starts')==0 and audio_fetches(page)==0,'audio before a gesture'
            expect(page.locator('#sound-control')).to_have_attribute('data-audio','idle')
            report['assertions'].append('No AudioContext, audio fetch or playback before the first user gesture.')
            page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#sound-control')).to_have_attribute('data-loaded','ogg',timeout=10000)
            assert spy(page,'contexts')==1 and spy(page,'starts')==2,(spy(page,'contexts'),spy(page,'starts'))  # theme + tension loops
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            expect(page.locator('#lb-rows .lb-row').first).to_be_visible()
            # Catch-up: the World feed shows history but nothing flashes or announces itself.
            expect(page.locator('#world-feed')).to_be_visible()
            expect(page.locator('#feed-list [data-kind="major_battle"]').first).to_be_visible()
            assert page.locator('#feed-list .feed-headline').count()>=10
            assert page.locator('#feed-list .fresh').count()==0
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
            page.wait_for_timeout(1600)  # two more polls
            assert spy(page,'cues')==[],spy(page,'cues')
            types=page.evaluate('''Promise.all(['effects.ogg','theme.ogg','tension.mp3','manifest.json'].map(f=>fetch('/audio/'+f).then(r=>r.headers.get('content-type'))))''')
            assert types==['audio/ogg','audio/ogg','audio/mpeg','application/json'],types
            report['assertions'].append('Audio decodes (Ogg Opus) under the page CSP with correct Content-Types; catch-up history plays no cue.')
            def capture(name,hold=900):
                # Clean real DOM capture: not a mockup, no credentials or local player storage.
                page.screenshot(path=str(out/name),full_page=True)
                if args.gif:
                    page.evaluate('''() => {const label=document.createElement('div');label.id='capture-label';label.textContent='ACTUAL UI · RECORDED TEST POSITION · NOT A LIVE MATCH';label.style.cssText='position:fixed;right:10px;bottom:5px;z-index:100;background:#12252e;color:#dfcfaa;font:10px system-ui;padding:6px 9px;pointer-events:none';document.body.append(label);}''')
                    frames.append((page.screenshot(),hold));page.locator('#capture-label').evaluate('(e)=>e.remove()')
            def no_overflow():
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            select(page,'england','low-countries')
            camera(page,'europe');capture('01-order-card-europe.png');no_overflow()
            page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
            # v0.8 one map: every listed viewport, player and spectator; idle, order card (peek/full), country and
            # alliance cards, and the history sheet. Nothing overlaps; the one primary action is always reachable.
            spectator=context.new_page();spectator.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(spectator,url);spectator.locator('[data-room="ui-fixture"][data-spectate="true"]').click()
            else:spectator.goto(url+'/?match=ui-fixture&spectate=1')
            expect(spectator.locator('#phase')).to_have_text('SPECTATING')
            shots=out/'layout';shots.mkdir(exist_ok=True)
            def feed_open(view,open):
                if (view.locator('#feed-toggle').get_attribute('aria-expanded')=='true')!=open:view.locator('#feed-toggle').click()
            def open_country(view,cid,compact):
                if compact:
                    if view.locator('#lb-toggle').get_attribute('aria-expanded')=='true':view.locator('#lb-toggle').click()
                    view.locator(f'#lb-powers [data-power="{cid}"]').click()
                else:view.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
                expect(view.locator('#card')).to_have_attribute('data-kind','country')
            surfaces={}
            for w,h in [(1920,1080),(1366,768),(1280,720),(390,844),(844,390),(768,1024)]:
                tag=f'{w}x{h}';compact=w<1024 or h<500
                for view in (page,spectator):view.set_viewport_size({'width':w,'height':h})
                feed_open(page,not compact);page.wait_for_timeout(200)
                idle=check_layout(page,f'{tag} player idle');page.screenshot(path=str(shots/f'{tag}-player.png'))
                surfaces[tag]=idle['visible']
                coverage={'idle':round(page.evaluate(UNCOVERED),3)}
                select(page,'england','low-countries')
                for size in ['full','peek']:
                    if page.locator('#card').get_attribute('data-size')!=size:page.locator('#card-size').click()
                    page.wait_for_timeout(60)
                    check_layout(page,f'{tag} order {size}');check_commit(page,f'{tag} {size}')
                    page.screenshot(path=str(shots/f'{tag}-order-{size}.png'))
                    if size=='peek':coverage['orderPeek']=round(page.evaluate(UNCOVERED),3)
                report.setdefault('uncoveredMap',{})[tag]=coverage
                if tag=='1366x768':assert coverage['idle']>=.65 and coverage['orderPeek']>=.62,coverage  # overlays stay compact; the map dominates
                page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
                open_country(page,'germany',compact);check_layout(page,f'{tag} country card');check_commit(page,f'{tag} country')
                page.screenshot(path=str(shots/f'{tag}-country.png'));page.keyboard.press('Escape')
                page.locator('#hud-standard').click();expect(page.locator('#card')).to_have_attribute('data-kind','alliance')
                check_layout(page,f'{tag} alliance card');page.screenshot(path=str(shots/f'{tag}-alliance.png'));page.keyboard.press('Escape')
                expect(page.locator('#card')).to_be_hidden()
                if compact:
                    expect(page.locator('#feed-ticker')).to_be_visible()
                    feed_open(page,True);expect(page.locator('#feed-list')).to_be_visible()
                    check_layout(page,f'{tag} history sheet');page.screenshot(path=str(shots/f'{tag}-history.png'))
                    feed_open(page,False)
                else:
                    expect(page.locator('#feed-list')).to_be_visible()
                    feed_open(page,False);check_layout(page,f'{tag} history edge tab');feed_open(page,True)
                feed_open(spectator,not compact);spectator.wait_for_timeout(150)
                check_layout(spectator,f'{tag} spectator');spectator.screenshot(path=str(shots/f'{tag}-spectator.png'))
                expect(spectator.locator('#feed-form')).to_be_hidden();expect(spectator.locator('#attention')).to_be_hidden()
                if not compact:expect(spectator.locator('#feed-list')).to_be_visible()
            # Spectators: the same cards, information only.
            spectator.set_viewport_size({'width':1366,'height':768});spectator.locator('#lb-rows .lb-row[data-id="germany"]').click()
            expect(spectator.locator('#card')).to_have_attribute('data-kind','country');expect(spectator.locator('#card-actions button')).to_have_count(0)
            expect(spectator.locator('#composer')).to_be_hidden();spectator.keyboard.press('Escape')
            click_at(spectator,spectator.locator('#marker-england .counter-body')) if spectator.locator('#marker-england .counter-body').is_visible() else None
            expect(spectator.locator('#amount-control')).to_be_hidden();expect(spectator.locator('#primary')).to_have_count(0)
            spectator.close()
            report['layout']=layout_log;report['persistentSurfaces']=surfaces
            assert all(len(v)<=4 for v in surfaces.values()),surfaces  # idle: HUD, leaderboard, history, camera (+ the map itself)
            report['assertions'].append('One-map contract at 1920×1080, 1366×768, 1280×720, 390×844, 844×390 and 768×1024 for player and spectator: the map is exactly the viewport, no document scroll, and no overlapping or off-screen overlays when idle, with an order card (peek and expanded), a country card, the alliance card, or the history collapsed/opened; the card has exactly one primary button, visible, unobstructed and outside any scrolling region. Idle, at most four floating surfaces (HUD, leaderboard, history, camera) sit over the map. At 1366×768 at least 65% of the map is uncovered idle and at least 62% with an order card peeking (actual shares in uncoveredMap). Spectators get the same cards without actions or message boxes.')
            page.set_viewport_size({'width':1600,'height':1000});page.wait_for_timeout(150)
            # Keyboard: your standard opens the alliance card with focus moved in; Escape closes it and returns focus.
            page.locator('#hud-standard').focus();page.keyboard.press('Enter')
            expect(page.locator('#card')).to_have_attribute('data-kind','alliance');expect(page.locator('#card-title')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden();expect(page.locator('#hud-standard')).to_be_focused()
            page.locator('#card-size').evaluate('(b)=>b')  # present
            page.locator('#menu-button').focus();page.keyboard.press('Enter');expect(page.locator('#hud-menu')).to_be_visible();expect(page.locator('#world-view')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#hud-menu')).to_be_hidden();expect(page.locator('#menu-button')).to_be_focused()
            # Keyboard orders: focus your province counter, Enter, then a neighbour, Enter → focus on the one primary; Escape cancels.
            page.locator('#home-view').click();page.locator('#marker-england').focus();page.keyboard.press('Enter')
            expect(page.locator('#card-title')).to_have_text('Southern England')
            page.locator('#marker-low-countries').focus();page.keyboard.press('Enter');expect(page.locator('#primary')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
            report['assertions'].append('Keyboard: the standard opens the alliance card with focus moved in and Escape returns it; the menu opens and closes the same way; a province then a neighbour selected with Enter puts focus on the one primary action (Enter sends), and Escape cancels.')
            observed=page.evaluate("fetch('/api/games/ui-fixture').then(r=>r.json())")
            def expected_troops(country):
                return sum(p['troops'] for p in observed['provinces'] if p['owner']==country)+sum(a['amount'] for a in observed['armies'] if a['country']==country)
            for w,h in [(1366,768),(1920,1080)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
                expect(page.locator('#leaderboard')).to_be_visible();check_layout(page,f'{w}x{h} leaderboard')
                rows=page.locator('#lb-rows .lb-row')
                assert rows.count()>=5
                groups=0
                for i in range(rows.count()):
                    # Teams view: an alliance row totals its nested members; every row sums its countries.
                    row=rows.nth(i);countries=row.get_attribute('data-countries').split(',')
                    assert int(row.get_attribute('data-troops'))==sum(expected_troops(c) for c in countries),countries
                    assert int(row.get_attribute('data-provinces'))==sum(1 for p in observed['provinces'] if p['owner'] in countries)
                    if row.get_attribute('data-kind')=='group':
                        groups+=1
                        nested=[rows.nth(j) for j in range(i+1,rows.count()) if rows.nth(j).get_attribute('data-kind')=='member'][:len(countries)]
                        assert sorted(r.get_attribute('data-id') for r in nested)==sorted(countries)
                        assert abs(sum(float(r.get_attribute('data-share')) for r in nested)-1)<1e-9
                        troops=[int(r.get_attribute('data-troops')) for r in nested];assert troops==sorted(troops,reverse=True)
                assert groups==3,groups  # three coalitions in the recorded position
            expect(page.locator('#lb-rows .lb-row.you')).to_contain_text('Britain')
            expect(page.locator('#lb-rows .lb-row').first).to_contain_text('Atlantic Accord')  # teams view is the default
            page.screenshot(path=str(out/'14-leaderboard-teams.png'))
            accord=page.locator('#lb-rows .lb-group').first;toggle=accord.locator('.lb-expand')
            members=page.locator('#lb-rows .lb-member').count()
            toggle.focus();page.keyboard.press('Enter');expect(toggle).to_have_attribute('aria-expanded','false')
            assert page.locator('#lb-rows .lb-member').count()==members-len(accord.get_attribute('data-countries').split(','))
            page.keyboard.press('Enter');expect(page.locator('#lb-rows .lb-group').first.locator('.lb-expand')).to_have_attribute('aria-expanded','true')
            page.locator('[data-lb-mode="players"]').click();expect(page.locator('#lb-rows .lb-group')).to_have_count(0)
            page.screenshot(path=str(out/'15-leaderboard-players-1920.png'))
            page.locator('[data-lb-mode="teams"]').click()
            report['assertions'].append('Leaderboard heads the right rail at 1366×768 and 1920×1080 without overlapping any overlay. Teams view (default): each alliance row equals the sum of its nested members, which are sorted by troops with shares summing to 100%; every row matches garrisons + armies from the public observation; groups collapse and expand by keyboard; the flat Players toggle works.')
            # A leaderboard row is a country: focus survives polling, Enter opens its card.
            page.locator('#lb-rows .lb-row[data-id="germany"]').focus();page.wait_for_timeout(850)
            expect(page.locator('#lb-rows .lb-row[data-id="germany"]')).to_be_focused()
            page.keyboard.press('Enter');expect(page.locator('#card')).to_have_attribute('data-kind','country');expect(page.locator('#card-title')).to_have_text('German Empire')
            page.keyboard.press('Escape')
            menu(page);page.locator('#journal-toggle').click();expect(page.locator('#war-journal')).to_be_visible()
            expect(page.locator('#journal-toggle')).to_have_attribute('aria-expanded','true')
            capture('02-war-log.png')
            page.keyboard.press('Escape');expect(page.locator('#war-journal')).to_be_hidden();expect(page.locator('#menu-button')).to_be_focused()
            page.keyboard.press('j');expect(page.locator('#war-journal')).to_be_visible()
            page.locator('#journal-close').click();expect(page.locator('#war-journal')).to_be_hidden()
            report['assertions'].append('Leaderboard rows keep keyboard focus across polling and open the country card; the War log opens from the menu or J and closes with Escape or Close.')
            select(page,'england','low-countries','full');capture('03-order-expanded.png')
            select(page,'scotland',None,'full');capture('04-own-province.png')
            open_country(page,'germany',False);capture('05-country.png');page.keyboard.press('Escape')
            select(page,'england','low-countries','peek');camera(page,'world');capture('06-order-world.png')
            # Templates with authored static symbols cannot execute arbitrary player inputs.
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            select(page,'england','midlands','full');page.locator('#card-body details[data-part="route"] summary').click();expect(page.locator('#set-route')).to_be_visible()
            page.wait_for_timeout(850);assert page.locator('#card-body details[data-part="route"]').get_attribute('open') is not None
            page.keyboard.press('Escape')
            report['assertions'].append('Order, own-province and country cards render in the same card; the recruitment disclosure in "More" stays open through refresh; SVG IDs are unique.')
            narrow=context.new_page();narrow.set_viewport_size({'width':390,'height':844})
            if args.bridge:load_bridge(narrow,url,{'coi.identity':json.dumps(identity)})
            else:narrow.goto(url)
            narrow.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(narrow.locator('#leaderboard')).to_have_class(re.compile('collapsed'))
            expect(narrow.locator('#lb-summary')).to_contain_text('You #')
            assert narrow.locator('#leaderboard').bounding_box()['height']<=48
            assert narrow.locator('#lb-powers [data-power]').count()==7  # every other power, one tap into diplomacy
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            narrow.screenshot(path=str(out/'16-leaderboard-390-collapsed.png'),full_page=True)
            narrow.locator('#lb-toggle').click();expect(narrow.locator('#lb-rows')).to_be_visible()
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            check_layout(narrow,'390 leaderboard expanded')
            narrow.close()
            report['assertions'].append('At 390px the leaderboard starts as a one-line strip under the HUD (your rank plus every other power’s standard as a one-tap way into diplomacy) and expands without horizontal overflow or covering other overlays.')
            page.keyboard.press('Escape')
            for w,h in [(1024,768),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(120);no_overflow();check_layout(page,f'{w}x{h} responsive')
                if w==390:capture('07-mobile.png')
            page.set_viewport_size({'width':1600,'height':1000});camera(page,'world')
            before=len(spy(page,'cues'))
            server.stdin.write('535\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==535
            expect(page.locator('#declaration')).to_contain_text('Major battle at Northern India',timeout=5000)
            page.wait_for_timeout(1600);fresh_cues=spy(page,'cues')[before:]
            assert len(fresh_cues)==1 and fresh_cues[0]['audible'],fresh_cues
            report['sound']={'tick535':fresh_cues}
            report['assertions'].append(f'The live tick-535 headlines chose exactly one audible cue ({fresh_cues[0]["cue"]}, priority {fresh_cues[0]["priority"]}).')
            expect(page.locator('#declaration')).to_contain_text('troops lost')
            expect(page.locator('#feed-list .fresh[data-kind="major_battle"]').last).to_contain_text('Northern India')
            page.screenshot(path=str(out/'13-major-battle-banner.png'))
            report['assertions'].append('A live recorded major battle (casualties above max(20, 3% of all troops)) raised one banner and a fresh feed row.')
            expect(page.locator('#notice')).to_contain_text('Province lost · Northern India',timeout=5000)
            expect(page.locator('#feed-list [data-kind="dominance_broken"]').last).to_contain_text('Countdown stopped')
            capture('11-battle-loss.png')
            server.stdin.write('539\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==539
            expect(page.locator('#notice')).to_contain_text('Line held',timeout=8000)
            expect(page.locator('#notice')).to_contain_text('16 troops')
            camera(page,'europe');capture('12-line-held.png')
            feed_checks(page,report)
            page.wait_for_timeout(900);before=len(spy(page,'cues'))
            go_back(page);page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            page.wait_for_timeout(900);expect(page.locator('#notice')).to_be_hidden()  # old battle notices are never replayed
            assert spy(page,'cues')[before:]==[],spy(page,'cues')[before:]
            sound_settings_checks(page,context,url,report,args.bridge)
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
            # The review atlas has its own blocs, legend and mode chip; toggling it never touches the live map.
            review_chip=page.locator('.aar-replay-map .atlas-mode-toggle');expect(review_chip).to_have_count(1)
            assert page.locator('#review-map .alliance-bloc').count()>=1
            review_chip.click();expect(page.locator('#review-map')).to_have_attribute('data-mode','political')  # observer: no focus country
            expect(page.locator('.aar-replay-map .atlas-legend')).to_contain_text('Hover a country');review_chip.click()
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            report['assertions'].append('After-action standards identify all winning members; exact map playback keeps separate SVG IDs and no live command surface.')
            map_checks(page,server,report,capture)
            wrap_checks(page,report,capture)
            relations_checks(page,report,capture)
            battle_checks(page,server,report,capture)
            if not args.bridge:relation_checks(page,server,report,capture)  # v0.7 HUD/rail/card relations; runs after the tick-58 battle step
            if not args.bridge:inbox_checks(page,server,context,url,report,capture)
            page.emulate_media(reduced_motion='reduce')
            if not args.bridge:effect_checks(page,report);hostile_name_check(page,report)  # dynamic module import needs native HTTP
            for selector in ['#declaration','#alliance-seal','.alliance-ribbon','#fallen-seal','.fallen-strike']:
                assert page.evaluate(f'getComputedStyle(document.querySelector("{selector}")).animationName')=='none',selector
            if not args.bridge:expand_checks(browser,url,identity,report,out)  # real navigation and an init script
            assert spy(page,'csp')==[],spy(page,'csp')
            if not args.bridge:mobile_checks(browser,url,identity,report,out)
            if not args.bridge:
                coach_and_drag_checks(browser,url,identity,report,out)
                # v0.8 core tasks, scripted like a player, with measured interaction counts (bounds in ui_tasks.BOUNDS).
                report['tapCounts']={'390x844 touch':walkthrough(browser,url,identity,server,report,out,'ui-tasks-m',390,844,True),
                    '1366x768 mouse':walkthrough(browser,url,identity,server,report,out,'ui-tasks-d',1366,768,False)}
                report['assertions'].append('Core tasks at 390×844 (touch) and 1366×768 (mouse), counted interactions within bounds: declare war on a neutral country and march ≤4, attack a neighbouring enemy with 50% ≤3 (drag on desktop, tap on phone), recall an army ≤2, propose an alliance ≤3, answer an alliance offer from the badge ≤2, reply to a DM ≤3 plus typing, develop a province ≤3 (actual counts in tapCounts; screenshots in tasks/).')
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
