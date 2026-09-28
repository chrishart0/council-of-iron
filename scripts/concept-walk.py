"""The comms benchmark walkthrough, scripted like a player on each concept (docs/UI-CONCEPTS.md, "Comms").
Japan sends a DM, then an alliance offer, while world items arrive; the player reads, accepts, replies by voice,
scrolls back to the opening war declaration and dismisses the rest. Arrivals are recorded observations delivered
through a test-only page hook (window.__walk.arrive), never a game route. Counts taps/clicks; scrolls separately.
Usage: python scripts/concept-walk.py OUTDIR [A B C] [--sizes 1536x864,390x844]
"""
import argparse, json, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
SERVER = '''import { makeServer } from './src/server.js';const app=makeServer({dbPath:':memory:',automatic:false});
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));'''
CHECK = '''() => {const b=[];for(const e of document.querySelectorAll('[data-region]')){if(!e.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)continue;b.push([e.dataset.region,r.left,r.top,r.right,r.bottom]);}
const o=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const x=b[i],y=b[j];if(x[1]<y[3]-.5&&y[1]<x[3]-.5&&x[2]<y[4]-.5&&y[2]<x[4]-.5)o.push(x[0]+' x '+y[0]);}return o;}'''

def run(page, d, size, out, phone):
    shots, taps, scrolls, problems = [], 0, 0, []
    def shot(name):
        page.wait_for_timeout(250); p = out / f'{len(shots):02d}-{name}.png'; page.screenshot(path=str(p)); shots.append(p.name)
        o = page.evaluate(CHECK); o and problems.append(f'{name}: overlap {o}')
    def tap(selector, name):
        nonlocal taps
        loc = page.locator(selector).first
        loc.scroll_into_view_if_needed()
        (loc.tap if phone else loc.click)(timeout=4000); taps += 1; shot(name)
    shot('idle')
    page.evaluate('()=>__walk.arrive()'); shot('dm-arrives')
    page.evaluate('()=>__walk.arrive()'); shot('offer-and-world-arrive')
    tap('.cx-toast[data-tier=action] [data-do=view]', 'read-offer-thread')
    tap('.cx-sys[data-state=open] [data-do=accept]', 'accepted')
    tap('.cx-mic', 'voice-listening'); page.wait_for_timeout(1500); shot('voice-transcript')
    tap('.cx-send', 'reply-sent')
    tap('.cx-back', 'conversations')
    tap('[data-conv=world]', 'world-thread')
    page.evaluate("()=>{const m=document.querySelector('.cx-rows .cx-marker[data-tone=war]');m.scrollIntoView({block:'start'});}"); scrolls += 1; shot('scrolled-back-to-war')
    tap('.cx-readall', 'marked-all-read')
    tap('.cx-close', 'closed')
    return {'direction': d, 'size': size, 'taps': taps, 'scrolls': scrolls, 'screens': shots, 'problems': problems}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('directions', nargs='*', default=['A', 'B', 'C'])
    ap.add_argument('--sizes', default='1536x864,390x844'); a = ap.parse_args()
    server = subprocess.Popen(['node', '--input-type=module', '-e', SERVER], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    url = json.loads(server.stdout.readline())['url']; results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for d in a.directions:
                for size in a.sizes.split(','):
                    w, h = map(int, size.split('x')); phone = w < 700
                    ctx = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=phone, has_touch=phone)
                    page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
                    page.goto(f'{url}/concepts/{d}.html?s=walk&clean=1'); page.wait_for_selector('body[data-ready="1"]', state='attached', timeout=10000)
                    page.evaluate('document.fonts.ready')
                    out = Path(a.out) / d / 'walk' / size; out.mkdir(parents=True, exist_ok=True)
                    try: r = run(page, d, size, out, phone)
                    except Exception as e: r = {'direction': d, 'size': size, 'error': str(e).splitlines()[0]}
                    r['errors'] = errors[:3]; results.append(r); print(json.dumps(r)); ctx.close()
            browser.close()
    finally:
        server.terminate()
    (Path(a.out) / 'walk-summary.json').write_text(json.dumps(results, indent=1))
    sys.exit(1 if any(r.get('error') or r.get('problems') or r.get('errors') for r in results) else 0)

if __name__ == '__main__': main()
