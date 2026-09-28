"""Focused UI checks (v0.5 command table → v0.7 full-screen match) against a recorded position and the real HTTP server.
Not a new strategic match. Native navigation by default; explicit bridge optional.
"""
import argparse,io,json,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_helpers import load_bridge, lane, open_thread, close_comms
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
    // Industry is readable at every zoom: owned singles show one pip per level, owned merges show the summed level.
    const pips=e.querySelector('.industry-pips'),owned=members.every(id=>troops.get(id).owner);
    const industry=!owned||e.classList.contains('battle-counter')?null:e.dataset.cluster?(shown(pips)?Number(e.dataset.industry):-1):(shown(pips)?pips.querySelectorAll('rect').length:-1);
    units.push({industry,members,total:e.dataset.cluster?Number(e.dataset.total):e.classList.contains('battle-counter')?Number(e.dataset.defend):Number(e.querySelector('.counter-value').textContent),
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
    badIndustry:units.filter(u=>u.industry!==null&&u.industry!==u.members.reduce((n,id)=>n+(troops.get(id).development||0),0)).map(u=>u.members.join()),
    missing:state.provinces.filter(p=>count.get(p.id)!==1).map(p=>p.id),overlaps,
    battles:state.battles.map(b=>b.province),
    battleMarks:units.filter(u=>u.battle).map(u=>({id:u.members[0],attack:Number(svg.querySelector(`.battle-counter[data-province="${u.members[0]}"]`).dataset.attack),expected:engaged(u.members[0])})),
    mergedBattles:units.filter(u=>u.members.length>1&&u.members.some(id=>state.battles.some(b=>b.province===id))).length};
}'''

# v0.9 anchored-region contract: every panel is a [data-region]; visible regions never overlap (>4 px), never leave
# the viewport, and the document never scrolls. In a match the map is exactly the viewport.
LAYOUT='''() => {
  const boxes=[];
  for(const e of document.querySelectorAll('[data-region]')){
    if(!e.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
    const r=e.getBoundingClientRect();if(r.width<1 || r.height<1)continue;
    boxes.push({name:e.dataset.region,x:r.left,y:r.top,r:r.right,b:r.bottom});
  }
  const overlaps=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];
    if(a.x<b.r-4 && b.x<a.r-4 && a.y<b.b-4 && b.y<a.b-4)overlaps.push(`${a.name} × ${b.name}`);}
  const svg=document.querySelector('#map'),map=svg&&svg.checkVisibility()?svg.getBoundingClientRect():null;
  return {overlaps,visible:boxes.map(b=>b.name),outside:boxes.filter(b=>b.x<-.5 || b.y<-.5 || b.r>innerWidth+.5 || b.b>innerHeight+.5).map(b=>b.name),
    map:map?[map.left,map.top,map.width,map.height]:null,viewport:[innerWidth,innerHeight],
    scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight,scrollY]};
}'''
# WCAG contrast of representative text in every region against the effective background behind it: the first
# opaque background colour up the tree, or every colour stop of a gradient (including a button's ::before face).
CONTRAST=r'''() => {
  const parse=c=>{const m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;const v=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);return [v[0],v[1],v[2],v.length>3?v[3]:1];};
  const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const layer=s=>{const stops=s.backgroundImage&&s.backgroundImage!=='none'?[...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m=>parse(m[0])).filter(c=>c&&c[3]>.6):[];
    if(stops.length)return stops;const bc=parse(s.backgroundColor);return bc&&bc[3]>.9?[bc]:null;};
  const behind=e=>{for(let n=e;n&&n.nodeType===1;n=n.parentElement){
      const before=getComputedStyle(n,'::before'),bh=parseFloat(before.height),bw=parseFloat(before.width);
      // A ::before face that covers the element (a button's inner plate), not a thin decorative strip.
      if(before.content!=='none'&&before.position==='absolute'&&(!(bh>=0)||bh>=n.clientHeight*.6)&&(!(bw>=0)||bw>=n.clientWidth*.6)){const l=layer(before);if(l)return l;}
      const l=layer(getComputedStyle(n));if(l)return l;}
    return [[18,48,58,1]];};
  const picks=['.plaque h2','.plaque-note','#card-title','.card-sub','.card-relation','.card-body p','.lb-label','.lb-land','.lb-troops','.lb-columns span','.lb-fronts-title',
    '.lb-front-button span','.cx-title','.cx-conv-main b','.cx-preview','.cx-text','.cx-headline p','.cx-marker p','.cx-sys p','.cx-toast p','.btn','button.primary','button.danger',
    '#card-actions button','.chip','.stat b','.stat>span>small','.clock-plaque b','.clock-plaque .victory','.nation b','.nation small','.dock-btn b','.amount-line label',
    '.order-preview','.menu-body h3','.menu-status','.keys dd','.room-card p','.room-card small','.field','.tagline','.lobby-title small','.starting-holdings','.rack b','.rack small',
    '.coach p','.herald strong','.herald p','.r-table td','.r-table th','.turning span','.replay-row','.fine'];
  const out=[];
  for(const sel of picks){let n=0;for(const e of document.querySelectorAll(sel)){
    if(n>=3||!e.checkVisibility({opacityProperty:true,visibilityProperty:true})||!e.textContent.trim())continue;
    const r=e.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight)continue;n++;
    const s=getComputedStyle(e),fg=parse(s.color);if(!fg)continue;const size=parseFloat(s.fontSize),bold=Number(s.fontWeight)>=600;
    const need=size>=24||size>=18.66&&bold?3:4.5,worst=Math.min(...behind(e).map(bg=>ratio(fg,bg)));
    out.push({sel,text:e.textContent.trim().slice(0,30),ratio:Math.round(worst*100)/100,need});}}
  return out;
}'''
contrast_log={}
def check_contrast(page,label):
    rows=page.evaluate(CONTRAST);bad=[r for r in rows if r['ratio']<r['need']]
    low=min((r['ratio'] for r in rows),default=None)
    contrast_log[label]={'samples':len(rows),'minimum':low,'failures':bad}
    assert rows and not bad,(label,bad)
    return low
# The card's primary action must be on screen, unobstructed and outside any scrolling region.
COMMIT='''() => {
  const button=document.querySelector('#primary'),r=button.getBoundingClientRect();
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);let scroller=null;
  for(let e=button.parentElement;e;e=e.parentElement){const o=getComputedStyle(e).overflowY;if((o==='auto' || o==='scroll') && e.scrollHeight>e.clientHeight+1){scroller=e.id || e.className;break;}}
  return {visible:button.checkVisibility(),inView:r.top>=0 && r.left>=0 && r.bottom<=innerHeight+.5 && r.right<=innerWidth+.5,hit:button.contains(hit),scroller,primaries:document.querySelectorAll('#card .primary').length};
}'''
layout_log=[]
# Share of the viewport where the map is not under any HTML region (4 px grid sample). The camera cluster is
# measured button by button: its bounding box includes empty map between the buttons.
UNCOVERED='''() => {
  const rects=[];
  for(const e of document.querySelectorAll('[data-region]:not([data-region=camera]),#map-controls>button')){
    if(!e.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;const r=e.getBoundingClientRect();if(r.width && r.height)rects.push(r);}
  let free=0,all=0;for(let y=2;y<innerHeight;y+=4)for(let x=2;x<innerWidth;x+=4){all++;if(!rects.some(r=>x>=r.left && x<r.right && y>=r.top && y<r.bottom))free++;}
  return free/all;
}'''
def check_layout(page,label,match=True):
    # Overlays that size around the alert stack settle in the next rendering step.
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    # Entrance animations (a card rising, a letter unfolding) settle first; endless pulses are ignored.
    page.evaluate('()=>Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>0))),new Promise(r=>setTimeout(r,1500))])')
    result=page.evaluate(LAYOUT);w,h=result['viewport']
    layout_log.append({'state':label,'visible':result['visible']})
    if match:assert result['map']==[0,0,w,h],(label,result['map'])
    assert result['scroll'][0]<=w+1 and result['scroll'][1]<=h+1 and result['scroll'][2]==0,(label,result['scroll'])
    assert not result['overlaps'],(label,result['overlaps'])
    assert not result['outside'],(label,result['outside'])
    return result
def check_commit(page,label):
    page.evaluate('()=>Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>0))),new Promise(r=>setTimeout(r,1500))])')
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
    else:
        if page.locator('#replay-exit').is_visible():page.locator('#replay-exit').click()
        page.locator('[data-home]:visible').first.click()  # the report's Back to rooms, or the lobby's back

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
        assert not result['badIndustry'],(where,result['badIndustry'])
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
    page.locator('#zoom-in').click();page.wait_for_timeout(150)
    for _ in range(4):  # drag east until the dateline (x = 0 ≡ 1280) is in the centre, whatever the world-view fit
        x,y,w,h=view_box(page);off=((x+w/2)-10+640)%1280-640  # aim just east of the seam: Australia is then on the western copy
        if abs(off)<15:break
        drag_map(page,off*page.evaluate('document.querySelector("#map").getScreenCTM().a'))
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
  const wars=new Set(state.wars),side=new Map(state.players.map(p=>[p.id,p.side]));
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
    key();assert page.evaluate("[...document.querySelectorAll('.war-room .atlas-modes')].every(e=>e.closest('#map-key'))")  # only inside the menu's key
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
        close_comms(page)
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
        close_comms(page)
        audit_zooms(page,'ui-war',f'war {w}',views)
    page.set_viewport_size({'width':1366,'height':768});camera(page,'europe')
    server.stdin.write('war 56\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==56
    expect(page.locator('#map .round-loss').first).to_be_attached(timeout=6000)
    capture('13-battle-round.png',600)
    report['assertions'].append('Real phased battles show a persistent attacker-vs-defender clash marker at every zoom (never merged), matching engaged armies and garrison, and flash the losses of a newly adjudicated round.')

HOSTILE_ALLIANCE='<b onclick="x()">Iron & "Pact"</b>'
def inbox_checks(page,server,context,url,report,capture):
    """v0.9 Messages: one button (decisions loud, unread quiet), one toast lane, an inbox of threads; read per item, never replayed."""
    page.set_viewport_size({'width':1366,'height':768});page.keyboard.press('Escape');close_comms(page)
    page.locator('#comms .cx-readall').click()  # "Mark all read": start from zero unread (decisions keep their chips)
    expect(page.locator('#comms-button')).to_have_attribute('data-unread','0')
    for line in ['dm russia britain An older note from Petersburg.','dm germany britain Our armies should talk before the Rhine burns.','offer qing france']:
        server.stdin.write(line+'\n');server.stdin.flush();json.loads(server.stdout.readline())
    button=page.locator('#comms-button')
    expect(button).to_have_attribute('data-action','1',timeout=5000)  # the offer waits for this seat (a new member of its alliance)
    expect(button).to_have_attribute('data-unread','2')  # two unread DMs
    toast=page.locator('#toasts .cx-toast[data-tier="action"]')
    expect(toast).to_have_count(1,timeout=8000);expect(toast).to_contain_text('proposes French Republic');expect(toast).to_contain_text(HOSTILE_ALLIANCE);assert page.locator('#toasts b[onclick]').count()==0  # the alliance name is text
    for control in ['[data-do="accept"]','[data-do="view"]','[data-do="dismiss"]']:expect(toast.locator(control)).to_be_visible()
    expect(page.locator('#toasts .cx-live[data-tier="action"]')).to_have_attribute('aria-live','assertive')
    expect(page.locator('#toasts .cx-live[data-tier="personal"]')).to_have_attribute('aria-live','polite')
    assert page.locator('#toasts .cx-toast').count()==1  # ONE lane: the decision owns it, the DMs wait underneath
    check_layout(page,'1366x768 action toast');capture('19-offer-toast.png')
    page.reload();expect(page.locator('#commander-title')).to_have_text('British Empire')
    expect(button).to_have_attribute('data-action','1',timeout=5000);expect(button).to_have_attribute('data-unread','2')
    page.wait_for_timeout(1600);expect(lane(page)).to_have_attribute('data-state','empty')  # no summary, no replayed toasts
    # Per item: reading Germany's (newer) DM must not mark Russia's (older) one read.
    rows=open_thread(page,'dm:germany');expect(rows).to_contain_text('before the Rhine burns')
    expect(button).to_have_attribute('data-unread','1',timeout=5000);close_comms(page)
    stored=page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('coi.comms.ui-war.britain'))")
    assert stored==['coi.comms.ui-war.britain'],stored
    page.reload();expect(button).to_have_attribute('data-unread','1',timeout=5000)  # read state persists per item
    button.click()  # first: the decision, as a letter in the thread with Accept inline
    letter=page.locator('#comms .cx-letter');expect(letter).to_contain_text('Qing, France and you');check_layout(page,'1366x768 offer letter')
    letter.locator('[data-do="accept"]').click();expect(button).to_have_attribute('data-action','0',timeout=5000)
    close_comms(page);button.click();expect(page.locator('#comms .cx-title')).to_have_text('Russian Empire')
    expect(page.locator('#cx-text')).to_be_focused();expect(button).to_have_attribute('data-unread','0',timeout=5000)
    # Escape order: thread → list (docked resting state).
    page.locator('#comms .cx-title').focus();page.keyboard.press('Escape');expect(page.locator('#comms')).to_have_attribute('data-view','list')
    spectator=context.new_page();spectator.goto(url+'/?match=ui-war&spectate=1');expect(spectator.locator('#phase')).to_have_text('Watching')
    spectator.wait_for_timeout(800)
    expect(spectator.locator('#comms [data-conv^="dm:"],#comms [data-conv="alliance"]')).to_have_count(0)
    rows=open_thread(spectator,'world');assert 'Rhine burns' not in rows.inner_text() and 'Petersburg' not in rows.inner_text()
    expect(spectator.locator('#comms-button .cx-count')).to_have_count(0);spectator.close()
    report['assertions'].append('Messages: two DMs from different countries and an alliance decision read 1 decision (loud) and 2 unread (quiet) on the one button; the decision arrives as ONE action toast with Accept, Read and dismiss in an assertive live region (personal toasts are polite) while the DMs wait; a reload keeps the counts without any summary or replayed toast; reading the newer DM in its thread leaves the older one unread (per-item read state persisted under coi.comms.<match>.<seat>); the button opens the decision first as a letter with Accept inline, then the remaining DM with the composer focused; Escape returns from a thread to the list; a spectator sees none of these private items.')

TOAST_SIZE='''() => {
  const out={},lane=document.querySelector('#toasts'),live=lane.querySelector('.cx-live[data-tier=personal]'),saved=live.innerHTML,state=lane.dataset.state;
  live.innerHTML='<div class="cx-toast" data-tier="personal"><span class="cx-standard"></span><p><b>German Empire</b> <span class="cx-line">Our armies should talk before the Rhine burns.</span></p><button class="cx-secondary">Reply</button><button class="cx-dismiss">x</button></div>';lane.dataset.state='personal';
  const d=document.getElementById('declaration');d.hidden=false;d.className='declaration herald war';d.querySelector('#declaration-kind').textContent='The council’s seal';d.querySelector('#declaration-title').textContent='War declared';d.querySelector('#declaration-detail').textContent='German Empire declared war on British Empire. Both sides may now attack.';
  for(const [name,e] of [['declaration',d],['notice',lane]]){const r=e.getBoundingClientRect();out[name]={top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right};}
  d.hidden=true;live.innerHTML=saved;lane.dataset.state=state;return out;
}'''
BAND_COLORS='''async side=>{
  const {allianceColors}=await import('/relations.js'),state=await (await fetch('/api/games/ui-war')).json(),colors=allianceColors(state),expected={};
  for(const [id,color] of Object.entries(colors)){const probe=document.createElement('i');probe.style.color=color;document.body.append(probe);expected[id]=getComputedStyle(probe).color;probe.remove();}
  const probe=c=>{const i=document.createElement('i');i.style.color=c;document.body.append(i);const v=getComputedStyle(i).color;i.remove();return v;};
  return {expected,rows:[...document.querySelectorAll('#lb-rows .lb-row[data-band="active"]')].map(r=>[r.dataset.id,r.dataset.side,probe(r.style.getPropertyValue('--band'))])};
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
        assert row.locator('.lb-rel svg').count()==(1 if expected=='enemy' else 0),(cid,expected)
    check_layout(page,'1366x768 war room')
    # Wars live in the leaderboard: every front, the one involving you marked; a click frames it on the map.
    fronts=page.locator('#lb-fronts .lb-front');expect(fronts).to_have_count(3);expect(page.locator('#lb-front-count')).to_have_text('3')
    for size in [(1366,768),(1920,1080)]:
        page.set_viewport_size({'width':size[0],'height':size[1]});page.wait_for_timeout(150);close_comms(page)
        for i in range(3):
            fronts.nth(i).scroll_into_view_if_needed();expect(fronts.nth(i)).to_be_visible()
            box=fronts.nth(i).bounding_box();hit=page.evaluate('([x,y])=>document.elementFromPoint(x,y)?.closest(".lb-front")?.textContent||null',[box['x']+box['width']/2,box['y']+box['height']/2])
            assert hit==fronts.nth(i).text_content(),(size,i,hit)
    page.set_viewport_size({'width':1366,'height':768});page.wait_for_timeout(150)
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
    rows=open_thread(page,'world');expect(rows.locator('[data-kind="war"]').last).to_contain_text('French Republic',timeout=5000);close_comms(page)
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())");assert 'britain:france' in state['wars'],state['wars']
    mine=page.evaluate("fetch('/api/games/ui-war',{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('coi.identity')).token}}).then(r=>r.json())")
    assert any(o['type']=='move' and o['from']=='england' and o['to']=='north-france' for o in mine['commandBudget']['reserved']),mine['commandBudget']
    page.wait_for_timeout(1200);assert page.evaluate('window.__banners.length')==1 and 'war declared' in page.evaluate('window.__banners[0]').lower(),page.evaluate('window.__banners')
    report['assertions'].append('Declare war & march (solo, keyboard): a neutral target makes the one primary read “Declare war on France & send N”; the confirmation names the whole target side with Cancel focused; Escape keeps the peace; confirming declares the war and reserves the march in one order, adds the war marker to the World thread and shows exactly one banner (it affects this seat).')
    report['assertions'].append('Relations (recorded war room, Britain at war with the USA): every leaderboard row’s relation marker matches the public war list; Powers always lists exactly the war fronts under the rows (count shown; every front row visible and hit-testable at 1366×768 and 1920×1080), marks the one involving the viewer and frames it on the map; country cards state AT WAR / NEUTRAL with Offer peace / Propose alliance as the primary; the order card states the target owner’s relation and its owner line opens that country’s card.')
    # Alliances from the country card: forming (dashed) during the notice, then active in the alliance colour; the name stays text.
    page.locator('#lb-rows .lb-row[data-id="qing"]').click();expect(page.locator('#primary')).to_have_text('Propose alliance')
    page.locator('#primary').click();page.locator('#coalition-name').fill(HOSTILE_ALLIANCE);page.locator('#primary').click()
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE OFFER PENDING')
    server.stdin.write('ally qing\n');server.stdin.flush();assert json.loads(server.stdout.readline())['status']=='pending'
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE FORMING',timeout=5000)
    expect(page.locator('#lb-rows .lb-row[data-id="britain"]')).to_have_attribute('data-band','forming')  # your row is always listed
    page.keyboard.press('Escape')
    server.stdin.write('war 90\n');server.stdin.flush();json.loads(server.stdout.readline())
    expect(page.locator('#commander-side')).to_contain_text(HOSTILE_ALLIANCE,timeout=5000)
    state=page.evaluate("fetch('/api/games/ui-war').then(r=>r.json())")
    side=next(p['side'] for p in state['players'] if p['id']=='britain');assert next(p['side'] for p in state['players'] if p['id']=='qing')==side
    expect(page.locator('#lb-rows .lb-row[data-band="active"]').first).to_be_visible()
    colors=page.evaluate(BAND_COLORS,side)
    assert colors['rows'] and all(c==colors['expected'][s] for _,s,c in colors['rows']),colors  # every band = the shared allianceColors
    assert {r[0] for r in colors['rows'] if r[1]==side}=={'britain','qing',side},colors  # the alliance row and both members
    assert page.locator('b[onclick]').count()==0
    rows=open_thread(page,'world');expect(rows.locator('[data-kind="alliance"]').last).to_contain_text(HOSTILE_ALLIANCE);assert rows.locator('b[onclick]').count()==0;close_comms(page)
    page.locator('#hud-standard').click();expect(page.locator('#card-title')).to_have_text(HOSTILE_ALLIANCE);expect(page.locator('#card-status')).to_contain_text('Qing')
    check_layout(page,'1366x768 alliance active');capture('18-alliance-relations.png');page.keyboard.press('Escape')
    # Coalition member: war on a neutral country is a vote, never a march.
    page.locator('#lb-rows .lb-row[data-id="germany"]').click()
    expect(page.locator('#card-actions')).to_contain_text('Call war vote');page.keyboard.press('Escape')
    report['assertions'].append('As a coalition member, war on a neutral country is offered as “Call war vote” (no march is sent without the vote).')
    expect(page.locator('#map .map-effect')).to_have_count(0,timeout=6000)  # the live alliance effect ends before the effect-scope check
    report['assertions'].append('Alliances from the country card: Propose alliance → name → Send; the card then reads ALLIANCE OFFER PENDING, then ALLIANCE FORMING (dashed band in the leaderboard) during the notice, then active in the HUD, the leaderboard and the alliance card; bands use the same colour as the shared allianceColors helper and the World thread shows the alliance marker (relations.js, also used by the map blocs); a hostile alliance name renders only as text.')

# iPhone Safari has no element Fullscreen API: simulate it, so only the CSS pseudo-fullscreen can work.
NO_FULLSCREEN_API='Object.defineProperty(Document.prototype,"fullscreenEnabled",{get:()=>false,configurable:true});'
VIEW_CENTRE='()=>{const [x,y,w,h]=document.querySelector("#review-map").getAttribute("viewBox").split(" ").map(Number);return [x+w/2,y+h/2];}'
def expand_checks(browser,url,identity,report,out):
    for w,h in [(390,844),(844,390)]:
        context=browser.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2)
        context.add_init_script(NO_FULLSCREEN_API);context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');'+COACH_DONE)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        # Replay map (after-action review).
        page.goto(url+'/?match=ui-review');expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
        assert page.evaluate('document.fullscreenEnabled') is False
        page.locator('#aar-tab-replay').click();expect(page.locator('#replay-stage')).to_be_visible()
        button=page.locator('#replay-expand');expect(button).to_be_visible()
        board,corner=page.locator('#review-map').bounding_box(),button.bounding_box()
        # v0.9: the Expand key sits in the replay's top bar (a fixed HUD spot), fully on screen, ≥40 px.
        assert corner['x']>=0 and corner['y']>=0 and corner['x']+corner['width']<=w+.5 and corner['y']+corner['height']<=h+.5 and corner['height']>=40,(board,corner)
        page.locator('#replay-slider').fill('300');centre=page.evaluate(VIEW_CENTRE)
        button.click();theatre=page.locator('#aar-replay');expect(theatre).to_have_class(re.compile('map-expanded'))
        assert theatre.bounding_box()=={'x':0,'y':0,'width':w,'height':h},theatre.bounding_box()
        scroll=page.evaluate('scrollY');page.mouse.wheel(0,600);page.wait_for_timeout(150);assert page.evaluate('scrollY')==scroll,'page scrolled behind the expanded map'
        # v0.9: expanded, the phone replay keeps the standings at the tick and the timeline beside the map (map ≈39% of 844 px).
        assert page.locator('#review-map').bounding_box()['height']>=h*(.38 if w<h else .45)
        for control in ['#replay-play','#replay-slider','#replay-expand']+(['#replay-speed'] if w<h else []):  # short landscape: speed lives in the collapsed timeline
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
        expect(button).to_have_attribute('aria-pressed','false')  # v0.9: the replay is itself a full-screen stage; expanding only hides its panels
        button.click();page.locator('#replay-expand').click();expect(theatre).not_to_have_class(re.compile('map-expanded'))  # ✕ Exit
        ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
        assert page.locator('#review-map [id]').evaluate_all('(n)=>n.every(e=>e.id.startsWith("review-map"))')
        # Live map.
        page.goto(url+'/?match=ui-fixture');expect(page.locator('#commander-title')).to_have_text('Britain')
        live=page.locator('#map-expand');expect(live).to_be_visible()
        live.click();expect(page.locator('#stage')).to_have_class(re.compile('map-expanded'));expect(page.locator('#hud')).to_be_visible()  # the HUD frame stays
        assert page.locator('#map').bounding_box()=={'x':0,'y':0,'width':w,'height':h}
        check_layout(page,f'{w}x{h} expanded live map')
        page.screenshot(path=str(out/f'20-expanded-live-{w}x{h}.png'))
        page.keyboard.press('Escape');expect(page.locator('#stage')).not_to_have_class(re.compile('map-expanded'))
        expect(page.locator('#hud')).to_be_visible();expect(live).to_be_focused()
        # Popups on phones are compact toasts under the HUD, never over the order sheet or its commit.
        select(page,'england','low-countries')
        sheet=page.locator('#card').bounding_box();commit=page.locator('#primary').bounding_box();sizes=page.evaluate(TOAST_SIZE)
        for name,r in sizes.items():
            assert r['height']<=min(80 if name=='declaration' else 72,h*.22)+.5 and r['top']>=0,(w,h,name,r)
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
    report['assertions'].append('Popups on phones (390×844, 844×390): the one toast lane holds a compact toast ≤72 px and a banner ≤80 px (each ≤22% of the viewport height), clear of the order sheet and its commit button.')
    report['assertions'].append('Expand map without the Fullscreen API (iPhone emulation, 390×844 and 844×390): the replay and live maps each show a thumb-reachable Expand control; expanded, the map covers the viewport, the page does not scroll, replay play/slider/speed stay on screen and work, rotation refits without moving the camera centre, and Escape or ✕ Exit restores the layout and focus; the menu entry is never hidden; the web app manifest (display fullscreen → standalone) and its icons are served; replay and live SVG IDs stay scoped.')

LONG_MESSAGE=('The Atlantic Accord proposes a longer public statement to check the history column: '+'we will hold the Channel, the Low Countries and the sea lanes to the Americas together. '*4).strip()
def feed_checks(page,report):
    """The World thread is the history: whole-match scrollback, a pinned composer, clamped long messages."""
    page.set_viewport_size({'width':1600,'height':1000});close_comms(page)
    history=open_thread(page,'world')
    first=history.evaluate('(l)=>{l.scrollTop=0;l.dispatchEvent(new Event("scroll"));const f=l.querySelector("[data-key]").getBoundingClientRect(),b=l.getBoundingClientRect();return {scrollable:l.scrollHeight>l.clientHeight,shown:f.top>=b.top-1 && f.top<b.bottom}}')
    assert first['scrollable'] and first['shown'],first
    form=page.locator('#comms .cx-composer').bounding_box();panel=page.locator('#comms').bounding_box()
    assert abs((form['y']+form['height'])-(panel['y']+panel['height']))<=3,(form,panel)
    expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=5000)
    page.locator('#cx-text').fill(LONG_MESSAGE);page.locator('#comms .cx-send').click()
    row=page.locator('#comms .cx-msg[data-mine="true"]').last;clamp=row.locator('.cx-text')
    expect(row).to_contain_text('sea lanes',timeout=5000)
    assert history.evaluate('(l)=>l.scrollHeight-l.scrollTop-l.clientHeight')<40  # your own message: the thread follows it
    measure='(e)=>({lines:Math.round(e.clientHeight/parseFloat(getComputedStyle(e).lineHeight)),clipped:e.scrollHeight>e.clientHeight+1})'
    fresh=clamp.evaluate(measure);assert fresh['lines']<=4 and fresh['clipped'],fresh
    more=row.locator('.cx-more-btn');expect(more).to_be_visible();expect(more).to_have_text('More')
    more.click();expect(more).to_have_text('Less')
    full=clamp.evaluate(measure);assert not full['clipped'] and full['lines']>4,full
    more.focus();page.keyboard.press('Enter');expect(more).to_have_text('More')
    assert page.locator('#comms img').count()==0
    report['assertions'].append('World thread (the history): older items are reachable by scrolling to the top of the match; the composer is pinned to the panel bottom; sending follows your own message; a long message is clamped to ≤4 lines with a More/Less control (click and Enter) that reveals it in full.')
    close_comms(page)

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
    menu(page);expect(page.locator('#sound-panel')).to_be_visible()  # inline in the menu (no popover)
    page.locator('#sound-music').fill('60');page.locator('#sound-effects').fill('40')
    page.locator('#sound-mute').check()
    expect(control).to_have_attribute('data-muted','true');expect(control).to_have_attribute('data-audio','suspended')
    expect(page.locator('.sound-toggle')).to_have_text('♪ Sound off')
    saved=json.loads(page.evaluate("localStorage.getItem('coi.sound')"))
    assert saved=={'muted':True,'music':.6,'effects':.4,'reduced':False},saved
    page.locator('#menu-close').click();expect(page.locator('#hud-menu')).to_be_hidden()
    open_thread(page,'world');expect(page.locator('#cx-text')).to_be_visible()
    page.locator('#cx-text').focus();page.keyboard.press('Shift+M');expect(control).to_have_attribute('data-muted','true')
    assert page.locator('#cx-text').input_value().endswith('M');page.locator('#cx-text').fill('')
    page.locator('#cx-text').evaluate('(e)=>e.blur()');page.keyboard.press('Shift+M')  # not typing any more
    close_comms(page)
    expect(control).to_have_attribute('data-muted','false');expect(control).to_have_attribute('data-audio','running')
    fresh=context.new_page()
    if bridge:load_bridge(fresh,url,{})
    else:fresh.goto(url)
    expect(fresh.locator('#sound-control')).to_have_attribute('data-music','0.6')
    fresh.locator('.sound-toggle').click()  # the home page keeps it in the masthead
    assert fresh.locator('#sound-music').input_value()=='60' and fresh.locator('#sound-effects').input_value()=='40'
    assert not fresh.locator('#sound-mute').is_checked()
    fresh.close()
    report['assertions'].append('Sound control: mute suspends audio, music/effects sliders and mute persist in localStorage across pages; Shift+M toggles mute but not while typing a message.')
def mobile_checks(browser,url,identity,report,out):
    # Real mobile emulation: the zoom limit is in screen px per map unit, so phones reach the same
    # maximum as desktop (the old fixed minimum view width gave a 390px phone ~2.9 px/unit).
    DESKTOP_OLD_MAX=1552/135  # what a 1920×1080 desktop map reached before this change
    px=lambda page:page.evaluate('document.querySelector("#map").getScreenCTM().a')
    for w,h in [(390,844),(844,390)]:
        context=browser.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2)
        context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');'+COACH_DONE)
        page=context.new_page();page.goto(url);page.locator('[data-room="ui-mobile"][data-resume]').click()
        expect(page.locator('#commander-title')).to_have_text('Britain');page.locator('#map').scroll_into_view_if_needed()
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
        result=page.evaluate(MAP_AUDIT,'ui-mobile');assert not result['overlaps'] and not result['missing'] and not result['badSums'],result
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

def replay_parity_checks(page,report,capture):
    """The replay uses the live components: team leaderboard at the scrubbed tick, history up to the tick
    (with alliance chat only where the room announced it), rows that seek, and effects only when playing forward."""
    page.set_viewport_size({'width':1366,'height':900});go_back(page);page.locator('[data-room="ui-chat"]').first.click()
    page.locator('#aar-tab-replay').click();expect(page.locator('#replay-stage')).to_be_visible()
    rows=lambda:page.locator('#replay-feed .replay-row:not([hidden])')
    page.locator('#replay-slider').fill('40');page.wait_for_timeout(150)
    ticks=[int(t) for t in rows().evaluate_all('(n)=>n.map(e=>e.dataset.tick)')];assert ticks and max(ticks)<=40,ticks
    expect(page.locator('#replay-feed .replay-chat').first).to_be_hidden()
    expect(page.locator('.replay-leaderboard .lb-group')).to_contain_text('Pacific Pact')
    page.locator('#replay-slider').fill('10');page.wait_for_timeout(150);expect(page.locator('.replay-leaderboard .lb-group')).to_have_count(0)  # not yet active at 00:10
    page.locator('#replay-slider').fill('100');page.wait_for_timeout(150)
    chat=page.locator('#replay-feed .replay-chat').first;expect(chat).to_be_visible();expect(chat).to_contain_text('Hold the Pacific <b>line</b>.')
    assert chat.locator('b b, span b:not(:first-child)').count()==0 and page.locator('#replay-feed b:has-text("line")').count()==0  # player text stays text
    page.locator('[data-replay-filter="chat"]').click();assert all('replay-chat' in c for c in rows().evaluate_all('(n)=>n.map(e=>e.className)'))
    page.locator('[data-replay-filter="all"]').click()
    page.locator('#replay-feed .replay-event button',has_text='Pacific Pact becomes active').click()
    expect(page.locator('#replay-stage')).to_have_attribute('data-tick','31');assert page.locator('#replay-slider').input_value()=='31'
    expect(page.locator('#replay-feed .replay-row.current')).to_contain_text('Pacific Pact')
    capture('10b-replay-history.png')
    page.locator('#replay-slider').fill('130');page.locator('#replay-slider').fill('120');page.wait_for_timeout(200)
    assert page.locator('#review-map .map-effect').count()==0,'scrubbing plays no effects'
    page.locator('#replay-speed [data-speed="4"]').click();page.locator('#replay-play').click()
    expect(page.locator('#review-map .map-effect').first).to_be_attached(timeout=6000)  # the tick-125 capture while playing forward
    page.locator('#replay-play').click()
    ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
    report['assertions'].append('Replay parity (short recorded match whose room announced public alliance chat): the shared team leaderboard shows the board at the scrubbed tick (no alliance before activation, Pacific Pact after); the history lists public events and the revealed alliance chat only up to the scrubbed tick, as text; an Alliance chat chip filters; selecting a row seeks the scrubber and marks it current; scrubbing plays no map effects, playing forward does; IDs stay unique.')

def coach_and_drag_checks(browser,url,identity,report,out):
    """First-match tips (three, dismissible, stored per browser) and a real touch drag from a province counter."""
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    context.add_init_script('localStorage.setItem("coi.identity",'+json.dumps(json.dumps(identity))+');')
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url+'/?match=ui-fixture');expect(page.locator('#commander-title')).to_have_text('Britain')
    coach=page.locator('#coach');expect(coach).to_be_visible(timeout=5000);expect(coach).to_contain_text('Tip 1 of 3');expect(coach).to_contain_text('Drag from your province')
    check_layout(page,'390 coach tip 1');page.screenshot(path=str(out/'21-coach-1.png'))
    page.locator('#coach-next').click();expect(coach).to_contain_text('Tap a country');check_layout(page,'390 coach tip 2')
    page.locator('#coach-next').click();expect(coach).to_contain_text('Messages button');expect(page.locator('#coach-next')).to_have_text('Got it')
    page.screenshot(path=str(out/'21-coach-3.png'));page.locator('#coach-next').click();expect(coach).to_be_hidden()
    assert page.evaluate("localStorage.getItem('coi.coach')")=='done'
    page.reload();expect(page.locator('#commander-title')).to_have_text('Britain');page.wait_for_timeout(1200);expect(coach).to_be_hidden()
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
    expect(page.locator('#card')).to_have_attribute('data-kind','province');expect(page.locator('#card-title')).to_have_text('Netherlands')  # low-countries is named Netherlands on this map
    expect(page.locator('#card-sub')).to_contain_text('from Southern England');check_commit(page,'390 after drag')
    assert page.locator('#map .draft-arrow').count()==1  # the order arrow stays while the card is open
    page.screenshot(path=str(out/'23-after-drag.png'))
    assert not errors,errors
    context.close()
    report['assertions'].append('First match: three dismissible tips (drag to attack, tap a country, the Messages button counts what needs you), stored per browser, replayable from the menu, closed by Escape, never overlapping other overlays. A real touch drag from a province counter draws a snapped order arrow with an ETA label, then opens the order card for that target with one primary action; drags elsewhere still pan.')

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
            expect(page.locator('#rooms .room-card').first).to_be_visible();expect(page.locator('#faction-choices button')).to_have_count(8)
            page.wait_for_timeout(600)
            assert spy(page,'contexts')==0 and spy(page,'starts')==0 and audio_fetches(page)==0,'audio before a gesture'
            expect(page.locator('#sound-control')).to_have_attribute('data-audio','idle')
            report['assertions'].append('No AudioContext, audio fetch or playback before the first user gesture.')
            check_layout(page,'title 1600x1000',match=False);check_contrast(page,'title 1600x1000')
            page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#sound-control')).to_have_attribute('data-loaded','ogg',timeout=10000)
            assert spy(page,'contexts')==1 and spy(page,'starts')==2,(spy(page,'contexts'),spy(page,'starts'))  # theme + tension loops
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            expect(page.locator('#lb-rows .lb-row').first).to_be_visible()
            # Catch-up: the World thread (the history) shows the match so far, but nothing toasts or announces itself.
            expect(page.locator('#comms')).to_be_visible();expect(page.locator('#comms')).to_have_attribute('data-view','list')
            rows=open_thread(page,'world')
            expect(rows.locator('[data-kind="major_battle"]').first).to_be_attached()
            assert rows.locator('.cx-marker,.cx-headline').count()>=10
            expect(lane(page)).to_have_attribute('data-state','empty')
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
            close_comms(page)
            page.wait_for_timeout(1600)  # two more polls
            assert spy(page,'cues')==[],spy(page,'cues')
            types=page.evaluate('''Promise.all(['effects.ogg','theme.ogg','tension.mp3','manifest.json'].map(f=>fetch('/audio/'+f).then(r=>r.headers.get('content-type'))))''')
            assert types==['audio/ogg','audio/ogg','audio/mpeg','application/json'],types
            fonts=page.evaluate("Promise.all(['/fonts/alegreya-sc-bold.woff2','/fonts/barlow-condensed-medium.woff2'].map(f=>fetch(f).then(r=>r.headers.get('content-type'))))")
            assert fonts==['font/woff2','font/woff2'],fonts
            report['assertions'].append('Audio decodes (Ogg Opus) and the bundled OFL fonts load under the page CSP with correct Content-Types; catch-up history plays no cue and raises no toast.')
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
            # v0.9 War Room: every listed viewport, player and spectator; idle, order card (peek/full), country and
            # alliance cards, Messages (list and thread), the menu and (compact) the Powers sheet. Nothing overlaps;
            # the one primary action is always reachable; text keeps WCAG contrast.
            spectator=context.new_page();spectator.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if args.bridge:load_bridge(spectator,url);spectator.locator('[data-room="ui-fixture"][data-spectate="true"]').click()
            else:spectator.goto(url+'/?match=ui-fixture&spectate=1')
            expect(spectator.locator('#phase')).to_have_text('Watching')
            shots=out/'layout';shots.mkdir(exist_ok=True)
            def open_country(view,cid,compact):
                close_comms(view)
                if compact:
                    if view.locator('#lb-powers [data-power="%s"]'%cid).is_visible():view.locator(f'#lb-powers [data-power="{cid}"]').click()
                    else:view.locator('[data-dock="powers"]').click();view.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
                else:view.locator(f'#lb-rows .lb-row[data-id="{cid}"]').click()
                expect(view.locator('#card')).to_have_attribute('data-kind','country')
            surfaces={};minimum={}
            for w,h in [(1920,1080),(1536,864),(1440,900),(1366,768),(1280,800),(390,844),(844,390)]:
                tag=f'{w}x{h}';compact=w<1024 or h<500
                for view in (page,spectator):view.set_viewport_size({'width':w,'height':h})
                close_comms(page);page.wait_for_timeout(250)
                idle=check_layout(page,f'{tag} player idle');page.screenshot(path=str(shots/f'{tag}-player.png'))
                surfaces[tag]=idle['visible'];low=[check_contrast(page,f'{tag} player idle')]
                coverage={'idle':round(page.evaluate(UNCOVERED),3)}
                select(page,'england','low-countries')
                for size in ['full','peek']:
                    if page.locator('#card').get_attribute('data-size')!=size:page.locator('#card-size').click()
                    page.wait_for_timeout(60)
                    check_layout(page,f'{tag} order {size}');check_commit(page,f'{tag} {size}')
                    page.screenshot(path=str(shots/f'{tag}-order-{size}.png'))
                    if size=='peek':coverage['orderPeek']=round(page.evaluate(UNCOVERED),3);low.append(check_contrast(page,f'{tag} order peek'))
                report.setdefault('uncoveredMap',{})[tag]=coverage
                page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden()
                open_country(page,'germany',compact);check_layout(page,f'{tag} country card');check_commit(page,f'{tag} country')
                low.append(check_contrast(page,f'{tag} country card'))
                page.screenshot(path=str(shots/f'{tag}-country.png'));page.keyboard.press('Escape')
                if compact and page.locator('#leaderboard.sheet').count():page.locator('[data-dock="map"]').click()
                page.locator('#hud-standard').click();expect(page.locator('#card')).to_have_attribute('data-kind','alliance')
                check_layout(page,f'{tag} alliance card');page.screenshot(path=str(shots/f'{tag}-alliance.png'));page.keyboard.press('Escape')
                expect(page.locator('#card')).to_be_hidden()
                # Messages: the list (docked on desktop, a sheet on compact screens) and a thread.
                if compact:page.locator('#comms-button').click();expect(page.locator('#comms')).to_be_visible()
                if page.locator('#comms').get_attribute('data-view')=='thread':page.locator('#comms .cx-back').click()
                check_layout(page,f'{tag} messages list')
                open_thread(page,'world');check_layout(page,f'{tag} messages thread');low.append(check_contrast(page,f'{tag} messages thread'))
                page.screenshot(path=str(shots/f'{tag}-messages.png'));close_comms(page)
                menu(page);check_layout(page,f'{tag} menu');low.append(check_contrast(page,f'{tag} menu'));page.screenshot(path=str(shots/f'{tag}-menu.png'));menu(page,False)
                if compact:
                    page.locator('[data-dock="powers"]').click();expect(page.locator('#leaderboard')).to_have_class(re.compile('sheet'))
                    check_layout(page,f'{tag} powers sheet');low.append(check_contrast(page,f'{tag} powers sheet'));page.screenshot(path=str(shots/f'{tag}-powers.png'))
                    page.locator('[data-dock="map"]').click();expect(page.locator('#leaderboard')).not_to_have_class(re.compile('sheet'))
                close_comms(spectator);spectator.wait_for_timeout(150)
                check_layout(spectator,f'{tag} spectator');spectator.screenshot(path=str(shots/f'{tag}-spectator.png'))
                expect(spectator.locator('#comms-button .cx-count')).to_have_count(0)
                if not compact:
                    expect(spectator.locator('#comms')).to_be_visible();expect(spectator.locator('#comms [data-conv^="dm:"]')).to_have_count(0)
                open_thread(spectator,'world');expect(spectator.locator('#comms .cx-composer')).to_be_hidden();check_layout(spectator,f'{tag} spectator thread');close_comms(spectator)
                minimum[tag]=min(low)
            report['contrastMinimum']=minimum;report['contrast']=contrast_log
            cov=report['uncoveredMap']
            # The War Room frame (top bar, right column) is permanent: honest bounds measured on this fixture.
            # Measured on this fixture: 1366×768 68.6% idle / 54.2% peek; 1920×1080 76.7% / 69.1% (full table in uncoveredMap).
            assert cov['1366x768']['idle']>=.65 and cov['1366x768']['orderPeek']>=.50,cov['1366x768']
            assert cov['1920x1080']['idle']>=.73 and cov['1920x1080']['orderPeek']>=.65,cov['1920x1080']
            assert all(c['idle']>=.64 for c in cov.values()),cov
            # Spectators: the same cards, information only.
            spectator.set_viewport_size({'width':1366,'height':768});close_comms(spectator);spectator.locator('#lb-rows .lb-row[data-id="germany"]').click()
            expect(spectator.locator('#card')).to_have_attribute('data-kind','country');expect(spectator.locator('#card-actions button')).to_have_count(0)
            spectator.keyboard.press('Escape')
            click_at(spectator,spectator.locator('#marker-england .counter-body')) if spectator.locator('#marker-england .counter-body').is_visible() else None
            expect(spectator.locator('#amount-control')).to_be_hidden();expect(spectator.locator('#primary')).to_have_count(0)
            spectator.close()
            report['layout']=layout_log;report['persistentSurfaces']=surfaces
            assert all(len(v)<=4 for v in surfaces.values()),surfaces  # idle: HUD, powers, messages, camera (desktop) · HUD, strip, camera, dock (compact)
            report['assertions'].append('War Room region contract at 1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 390×844 and 844×390 for player and spectator: the map is exactly the viewport, no document scroll, no visible [data-region] overlaps another by more than 4 px or leaves the viewport — idle, with an order card (peek and expanded), a country card, the alliance card, Messages (list and thread), the menu and (compact) the Powers sheet; the card has exactly one primary button, visible, unobstructed and outside any scrolling region; representative text in every region meets WCAG contrast (4.5:1, 3:1 for large text; minimum per viewport in contrastMinimum). Idle, at most four regions sit over the map. Uncovered map share (region boxes over the map, camera per button) at 1366×768 ≥65% idle and ≥50% with an order card peeking, ≥64% idle at every viewport (actual in uncoveredMap). Spectators get the same cards and the World thread without actions, composer or counts.')
            page.set_viewport_size({'width':1600,'height':1000});page.wait_for_timeout(150)
            # Keyboard: your standard opens the alliance card with focus moved in; Escape closes it and returns focus.
            page.locator('#hud-standard').focus();page.keyboard.press('Enter')
            expect(page.locator('#card')).to_have_attribute('data-kind','alliance');expect(page.locator('#card-title')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#card')).to_be_hidden();expect(page.locator('#hud-standard')).to_be_focused()
            page.locator('#card-size').evaluate('(b)=>b')  # present
            page.locator('#menu-button').focus();page.keyboard.press('Enter');expect(page.locator('#hud-menu')).to_be_visible()
            assert page.evaluate("document.querySelector('#hud-menu').contains(document.activeElement)")
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
            close_comms(page);expect(page.locator('#lb-rows .lb-row.you')).to_contain_text('Britain')
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
            page.keyboard.press('l');expect(page.locator('#war-journal')).to_be_visible();check_layout(page,'1600x1000 war log')
            page.locator('#journal-close').click();expect(page.locator('#war-journal')).to_be_hidden()
            report['assertions'].append('Powers rows keep keyboard focus across polling and open the country card; the War log opens from the menu or L and closes with Escape or Close.')
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
            expect(narrow.locator('#leaderboard')).to_be_hidden()  # compact: the strip of standards, Powers opens as a sheet
            expect(narrow.locator('#lb-powers [data-power]')).to_have_count(7)  # every other power, one tap into diplomacy
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            narrow.screenshot(path=str(out/'16-leaderboard-390-strip.png'),full_page=True)
            narrow.locator('[data-dock="powers"]').click();expect(narrow.locator('#lb-rows')).to_be_visible()
            expect(narrow.locator('#lb-summary')).to_contain_text('You #') if narrow.locator('#lb-summary').is_visible() else None
            assert narrow.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            check_layout(narrow,'390 powers sheet');narrow.screenshot(path=str(out/'16b-powers-390.png'))
            narrow.close()
            report['assertions'].append('At 390px the powers are a strip of standards under the top bar (every other power, one tap into diplomacy) and the full Powers list opens as a sheet from the dock without horizontal overflow or covering other regions.')
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
            page.screenshot(path=str(out/'13-major-battle-banner.png'))
            personal=page.locator('#toasts .cx-toast[data-tier="personal"]')
            # This legacy room makes every non-ally hostile: Russia's army reaching the Netherlands is an ACTION and owns
            # the one lane; the battle result waits underneath until the decision is dismissed (it stays in Messages).
            threat=page.locator('#toasts .cx-toast[data-tier="action"]')
            expect(threat).to_contain_text('attacks Netherlands',timeout=5000);expect(personal).to_have_count(0)
            check_layout(page,'1600x1000 banner and action toast')
            threat.locator('[data-do="dismiss"]').click()
            expect(personal).to_contain_text('Province lost · Northern India',timeout=3000)
            check_layout(page,'1600x1000 banner and toast')
            capture('11-battle-loss.png')
            rows=open_thread(page,'world')
            expect(rows.locator('[data-kind="major_battle"]').last).to_contain_text('Northern India')
            expect(rows.locator('[data-kind="dominance_broken"]').last).to_contain_text('Countdown stopped')
            close_comms(page)
            report['assertions'].append('A live recorded major battle (casualties above max(20, 3% of all troops)) raised one banner and a row in the World thread; an incoming attack arrived as the one ACTION toast (the battle result waited underneath and showed once the decision was dismissed).')
            server.stdin.write('539\n');server.stdin.flush();assert json.loads(server.stdout.readline())['tick']==539
            expect(personal).to_contain_text('Line held',timeout=8000)
            expect(personal).to_contain_text('16 troops')
            camera(page,'europe');capture('12-line-held.png')
            feed_checks(page,report)
            page.wait_for_timeout(900);before=len(spy(page,'cues'))
            go_back(page);page.locator('[data-room="ui-fixture"][data-resume]').click()
            expect(page.locator('#commander-title')).to_have_text('British Empire')
            page.wait_for_timeout(900);expect(lane(page)).to_have_attribute('data-state','empty')  # old battle notices are never replayed
            assert spy(page,'cues')[before:]==[],spy(page,'cues')[before:]
            sound_settings_checks(page,context,url,report,args.bridge)
            for banner in ['#declaration','#alliance-seal','#fallen-seal']:expect(page.locator(banner)).to_be_hidden()
            rows=open_thread(page,'world');expect(rows.locator('[data-kind="major_battle"]').last).to_contain_text('Netherlands');close_comms(page)
            report['assertions'].append('Reopening the room rebuilt the World thread without replaying banners or toasts.')
            report['assertions'].append('Actual recorded losses and defense trigger factual, dismissible notices; broken hold explains itself; reopening suppresses old battle popups.')
            page.set_viewport_size({'width':1500,'height':1150});go_back(page)
            page.locator('#room-name').fill('Choose your standard');page.locator('#create-form button[type=submit]').click()
            expect(page.locator('#faction-choices button')).to_have_count(8)
            page.locator('[data-country-seat="germany"]').click();expect(page.locator('#country-choice')).to_have_value('germany')
            expect(page.locator('[data-country-seat="germany"]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#dossier-head')).to_contain_text('German Empire')
            check_layout(page,'lobby 1500×1150');check_contrast(page,'lobby 1500x1150')
            capture('08-faction-selection.png')
            page.locator('#join-form button').click();expect(page.locator('[data-country-seat="germany"]')).to_be_disabled()
            for w,h in [(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150);check_layout(page,f'lobby {w}x{h}')
            page.set_viewport_size({'width':1500,'height':1150})
            report['assertions'].append('Responsive layouts pass at 1024px, 390px and short landscape; faction standards select real seats, show the country in the dossier and disable occupied countries; the lobby regions never overlap.')
            go_back(page);page.locator('[data-room="ui-review"]').click()
            expect(page.locator('#aar-standings tr[data-result-country]')).to_have_count(8)
            expect(page.locator('.v-standards .insignia')).to_have_count(3)
            capture('09-victory-review.png')
            for w,h in [(1920,1080),(1536,864),(1440,900),(1366,768),(1280,800),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(200)
                check_layout(page,f'{w}x{h} report',match=False);check_contrast(page,f'{w}x{h} report');page.screenshot(path=str(shots/f'{w}x{h}-report.png'))
            page.set_viewport_size({'width':1500,'height':1150})
            page.locator('#aar-tab-replay').click()
            expect(page.locator('#replay-stage')).to_be_visible()
            page.locator('#replay-slider').fill('530');page.locator('[data-aar-map="europe"]').click();capture('10-replay.png')
            for w,h in [(1920,1080),(1536,864),(1440,900),(1366,768),(1280,800),(390,844),(844,390)]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(250)
                check_layout(page,f'{w}x{h} replay',match=False);check_contrast(page,f'{w}x{h} replay');page.screenshot(path=str(shots/f'{w}x{h}-replay.png'))
            page.set_viewport_size({'width':1500,'height':1150});page.wait_for_timeout(150)
            # The review atlas has its own blocs, legend and mode chip; toggling it never touches the live map.
            review_chip=page.locator('#aar-replay .atlas-mode-toggle');expect(review_chip).to_have_count(1)
            assert page.locator('#review-map .alliance-bloc').count()>=1
            if not review_chip.is_visible() and page.locator('#replay-key').count():page.locator('#replay-key').click() if page.locator('#replay-key').is_visible() else None
            review_chip.click(force=True);expect(page.locator('#review-map')).to_have_attribute('data-mode','political')  # observer: no focus country
            expect(page.locator('#aar-replay .atlas-legend')).to_contain_text('Hover a country');review_chip.click(force=True)
            ids=page.locator('[id]').evaluate_all('(n)=>n.map(e=>e.id)');assert len(ids)==len(set(ids))
            report['assertions'].append('After-action report and replay pass the region contract (no overlap, nothing off-screen, no document scroll) and WCAG contrast at all seven viewports; the winning standards identify all members; exact map playback keeps separate SVG IDs and no live command surface.')
            replay_parity_checks(page,report,capture)
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
