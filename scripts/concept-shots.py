"""Render every v0.9 concept screen at the review viewports and check the anchored-region contract.
Usage: python scripts/concept-shots.py OUTDIR [A B C] [--screens hud,report] [--sizes 1920x1080,390x844]
Each direction marks its HUD panels with [data-region]; visible regions must not overlap each other,
leave the viewport, or scroll the document. Prototype tooling only (no game rule or route implied).
"""
import argparse, json, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
SCREENS = ['tile', 'title', 'faction', 'hud', 'province', 'country', 'offer', 'chat', 'menu', 'powers', 'replay', 'report']
SIZES = ['1920x1080', '1536x864', '390x844']
CHECK = '''() => {
  const boxes=[];for(const e of document.querySelectorAll('[data-region]')){if(!e.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
    const r=e.getBoundingClientRect();if(r.width<1||r.height<1)continue;boxes.push({name:e.dataset.region,x:r.left,y:r.top,r:r.right,b:r.bottom});}
  const overlaps=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];
    if(a.x<b.r-.5&&b.x<a.r-.5&&a.y<b.b-.5&&b.y<a.b-.5)overlaps.push(a.name+' x '+b.name);}
  const outside=boxes.filter(b=>b.x<-.5||b.y<-.5||b.r>innerWidth+.5||b.b>innerHeight+.5).map(b=>b.name);
  const d=document.scrollingElement;return {overlaps,outside,regions:boxes.map(b=>b.name),scroll:[d.scrollWidth>innerWidth+1,d.scrollHeight>innerHeight+1]};
}'''
SERVER = '''import { makeServer } from './src/server.js';const app=makeServer({dbPath:':memory:',automatic:false});
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));'''

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('directions', nargs='*', default=['A', 'B', 'C'])
    ap.add_argument('--screens', default=','.join(SCREENS)); ap.add_argument('--sizes', default=','.join(SIZES)); a = ap.parse_args()
    server = subprocess.Popen(['node', '--input-type=module', '-e', SERVER], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    url = json.loads(server.stdout.readline())['url']; problems = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for d in a.directions:
                for size in a.sizes.split(','):
                    w, h = map(int, size.split('x')); phone = w < 700
                    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=phone, has_touch=phone)
                    page = ctx.new_page(); errors = []
                    page.on('pageerror', lambda e: errors.append(str(e))); page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
                    for s in a.screens.split(','):
                        page.goto(f'{url}/concepts/{d}.html?s={s}&clean=1')
                        try: page.wait_for_selector('body[data-ready="1"]', state='attached', timeout=10000)
                        except Exception: errors.append(f'{s}: never ready')
                        page.evaluate('document.fonts.ready'); page.wait_for_timeout(350)
                        r = page.evaluate(CHECK); target = Path(a.out) / d; target.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(target / f'{s}-{size}.png'))
                        bad = r['overlaps'] or r['outside'] or any(r['scroll'])
                        line = f'{d} {s} {size}: regions={len(r["regions"])}' + (f' OVERLAP {r["overlaps"]}' if r['overlaps'] else '') + (f' OUTSIDE {r["outside"]}' if r['outside'] else '') + (f' SCROLL {r["scroll"]}' if any(r['scroll']) else '')
                        print(line); bad and problems.append(line)
                    if errors: print(d, size, 'ERRORS', errors[:5]); problems.append(f'{d} {size} errors {errors[:3]}')
                    ctx.close()
            browser.close()
    finally:
        server.terminate()
    print('\n'.join(['', f'{len(problems)} problem(s)'] + problems)); sys.exit(1 if problems else 0)

if __name__ == '__main__': main()
