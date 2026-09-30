"""Rendering regression on paused recorded armies, not a new strategic match.

A separate army SVG must share the camera and input with the map while repainting only its own layer.
Chrome's Paint events identify the painted SVG by backendNodeId; CPU timing is reported, not asserted.
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_helpers import start_server, stop

SETUP = '''async () => {
  const {Atlas}=await import('/atlas.js'), map=await (await fetch('/map.json')).json();
  const state=await (await fetch('/api/games/ui-war')).json();
  const host=document.createElement('div');host.id='render-host';host.style.cssText='position:fixed;inset:0;z-index:9999;background:#12303a';document.body.append(host);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='render-map';svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';host.append(svg);
  // Use recorded positions, with explicit test-only stepping of the client snapshot; no running timer or endpoint.
  state.status='lobby';window.__atlas=new Atlas(svg,map,()=>{}, {onArmy:id=>{window.__armySelected=id;return true;}});
  window.__atlas.update(state,null,null);window.__atlas.world();await document.fonts.ready;
}'''
ALIGNED = '''() => {
  const atlas=window.__atlas,a=atlas.svg.getBoundingClientRect(),b=atlas.armySvg.getBoundingClientRect();
  return atlas.svg.getAttribute('viewBox')===atlas.armySvg.getAttribute('viewBox') && ['left','top','width','height'].every(k=>Math.abs(a[k]-b[k])<.5)
    && atlas.svg.dataset.lod===atlas.armySvg.dataset.lod;
}'''
STEP = '''async () => {
  const atlas=window.__atlas,base=atlas.state.tick;
  const before=[...atlas.marches.children].map(e=>e.getAttribute('transform'));
  for(let i=1;i<=20;i++){atlas.state.tick=base+i*.25;atlas.positions();await new Promise(r=>setTimeout(r,100));}
  return [...atlas.marches.children].some((e,i)=>e.getAttribute('transform')!==before[i]);
}'''

def backend_id(cdp, selector):
    root=cdp.send('DOM.getDocument')['root']['nodeId']
    node=cdp.send('DOM.querySelector', {'nodeId':root,'selector':selector})['nodeId']
    return cdp.send('DOM.describeNode',{'nodeId':node})['node']['backendNodeId']

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',default='artifacts/render');parser.add_argument('--executable')
    args=parser.parse_args();out=Path(args.artifacts);out.mkdir(parents=True,exist_ok=True)
    server,settings=start_server('tests/ui-browser-server.js');report={'status':'failed','position':'Paused recorded armies; rendering checks, not a new match','viewports':[]}
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(**({'executable_path':args.executable} if args.executable else {}))
            for width,height in [(390,844),(844,390),(1366,768)]:
                context=browser.new_context(**{**p.devices['Pixel 7'],'viewport':{'width':width,'height':height}})
                page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(settings['url']);page.wait_for_selector('#rooms');page.evaluate(SETUP);page.wait_for_timeout(600)
                assert page.evaluate(ALIGNED),(width,height,'initial army camera')
                cdp=context.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':4})
                map_id=backend_id(cdp,'#render-map');army_id=backend_id(cdp,'#render-map-armies')
                browser.start_tracing(page=page,categories=['devtools.timeline'])
                moved=page.evaluate(STEP)
                events=json.loads(browser.stop_tracing())['traceEvents']
                paints=[e for e in events if e.get('name')=='Paint']
                terrain=[e for e in paints if e.get('args',{}).get('data',{}).get('nodeId')==map_id]
                armies=[e for e in paints if e.get('args',{}).get('data',{}).get('nodeId')==army_id]
                row={'viewport':[width,height],'armyPaints':len(armies),'terrainPaints':len(terrain),
                     'armyPaintMs':round(sum(e.get('dur',0) for e in armies)/1000,1)}
                report['viewports'].append(row)
                assert moved and armies,('army interpolation must still draw',row)
                assert not terrain,('army interpolation repainted the terrain',row)
                # Camera changes and touch gestures keep the two SVGs aligned.
                page.evaluate('()=>window.__atlas.europe()');page.wait_for_timeout(100);assert page.evaluate(ALIGNED)
                x,y=width/2,height/2
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-50,'y':y,'id':0},{'x':x+50,'y':y,'id':1}]})
                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-70,'y':y,'id':0},{'x':x+70,'y':y,'id':1}]})
                cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(100)
                assert page.evaluate(ALIGNED),(width,height,'pinch army camera')
                # Keyboard input on a marker uses the same country-independent army hook as a tap.
                army=page.locator('#render-map-armies .moving-army:not(.engaged)').first
                selected=army.get_attribute('data-army');army.focus();page.keyboard.press('Enter')
                assert page.evaluate('window.__armySelected')==selected
                page.keyboard.press('ArrowRight');page.wait_for_timeout(100);assert page.evaluate(ALIGNED)
                # A repeated unchanged observation preserves merged counters: no brief show/hide cycle every poll.
                unchanged=page.evaluate('''() => {
                  const a=window.__atlas,o=new MutationObserver(()=>{});o.observe(a.svg,{attributes:true,subtree:true});
                  a.update(a.state,null,null);
                  const writes=o.takeRecords().filter(m=>m.target.classList.contains('map-counter')&&m.attributeName==='class').length;o.disconnect();return writes;
                }''')
                assert unchanged==0,('unchanged counter classes rewritten',unchanged)
                # A phone still shows personal map signals, without animating the terrain for each headline.
                signals=page.evaluate('''() => {
                  const a=window.__atlas,accepted=[a.effect('captured',{province:'ruhr',owner:'germany'}),a.effect('industry_up',{province:'ruhr',level:2})];
                  const effects=[...document.querySelectorAll('#render-host .map-effect')];
                  return {accepted,static:effects.length>0&&effects.every(e=>e.classList.contains('still')),
                    animations:document.getAnimations().filter(e=>e.effect?.target?.closest('#render-host .map-effect')).length};
                }''')
                assert all(signals['accepted']) and signals['static'] and signals['animations']==0,('phone effects kept animating',signals)
                page.evaluate('''() => { window.__oldSvg=window.__atlas.svg;window.__atlas.destroy(); }''')
                assert page.locator('#render-map-armies').count()==0
                # Disposed map handlers must no longer pan when an old element receives a key.
                before=page.evaluate('()=>window.__atlas.view.x')
                page.evaluate('()=>window.__oldSvg.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight"}))')
                assert page.evaluate('()=>window.__atlas.view.x')==before
                assert not errors,errors
                context.close()
            browser.close()
        report['status']='passed'
    finally:
        stop(server);(out/'render-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
