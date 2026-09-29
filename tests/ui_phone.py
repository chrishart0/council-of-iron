"""Phone-first checks (inside tests/ui-browser.py): thumb orders with measured taps, the ghost-click guard, snapping to a
nearby target, fullscreen that survives every exit path, and messages you cannot miss (badge, toast, Reply, keyboard).
Rooms ui-phone (390×844) and ui-phone-l (844×390) are recorded positions stepped only through the fixture's private stdin
channel; screenshots go to <artifacts>/phone/ (recorded-position UI, not a live match)."""
import json, re
from playwright.sync_api import expect
from browser_helpers import lane, close_comms

COACH_DONE = 'localStorage.setItem("coi.coach","done");'
# A fake visualViewport installed before the app loads, so a test can "open the phone keyboard": the layout viewport
# keeps its height while the visible part shrinks, as on iOS Safari.
FAKE_VIEWPORT = """(()=>{const vv=new EventTarget();vv.width=innerWidth;vv.height=innerHeight;vv.offsetTop=0;vv.offsetLeft=0;vv.scale=1;
  Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});addEventListener('resize',()=>{vv.width=innerWidth;vv.height=innerHeight;});})();"""
FULLSCREEN_STATE = """() => ({cls:document.querySelector('#stage').classList.contains('map-expanded'),pressed:document.querySelector('#map-expand').getAttribute('aria-pressed'),
  menu:document.querySelector('#fullscreen-toggle').getAttribute('aria-pressed'),real:Boolean(document.fullscreenElement),lock:document.documentElement.classList.contains('map-expanded-lock')})"""
# A point on open map (no counter, not a legal target's province) whose nearest legal counter is within a finger's radius.
SEA_NEAR_TARGET = """() => {
  const lit=[...document.querySelectorAll('#map .province.neighbor')].map(e=>e.dataset.province);
  const rects=lit.map(id=>[id,document.querySelector(`#marker-${CSS.escape(id)} .counter-body`)?.getBoundingClientRect()]).filter(([,r])=>r&&r.width);
  const dist=(r,x,y)=>Math.hypot(Math.max(r.left-x,0,x-r.right),Math.max(r.top-y,0,y-r.bottom));
  const card=document.querySelector('#card').getBoundingClientRect(),hud=document.querySelector('.strip').checkVisibility()?document.querySelector('.strip').getBoundingClientRect().bottom:document.querySelector('#hud').getBoundingClientRect().bottom;
  const camera=[...document.querySelectorAll('#map-controls>button')].filter(b=>b.checkVisibility()).map(b=>b.getBoundingClientRect());
  for(const [id,r] of rects)for(const [dx,dy] of [[0,-22],[0,22],[-22,0],[22,0],[-18,-18],[18,18],[18,-18],[-18,18]]){
    const x=(dx<0?r.left:dx>0?r.right:r.left+r.width/2)+dx,y=(dy<0?r.top:dy>0?r.bottom:r.top+r.height/2)+dy;
    if(y<hud+8||x<4||x>innerWidth-4||y>innerHeight-4)continue;
    if(x>card.left-4&&x<card.right+4&&y>card.top-4&&y<card.bottom+4)continue;
    if(camera.some(c=>x>c.left-6&&x<c.right+6&&y>c.top-6&&y<c.bottom+6))continue;
    const e=document.elementFromPoint(x,y);if(!e||!e.closest('#map')||e.closest('.map-counter,.moving-army,.battle-counter,.map-cluster,.draft-label'))continue;
    const hit=e.closest('[data-province]')?.dataset.province;if(hit&&(lit.includes(hit)||hit==='england'))continue;
    const near=rects.map(([v,q])=>[v,dist(q,x,y)]).sort((a,b)=>a[1]-b[1]);
    if(near[0][0]!==id||near[0][1]>30||(near[1]&&near[1][1]-near[0][1]<6))continue;
    return {x,y,id};
  }
  return null;
}"""
SMALL_TARGETS = """() => [...document.querySelectorAll('#stage button,#stage input,#stage [role=button]')]
  .filter(e=>e.checkVisibility({visibilityProperty:true})&&!e.closest('#map')).map(e=>[e.id||String(e.className)||e.tagName,e.getBoundingClientRect()])
  .filter(([,r])=>r.width>0&&(r.height<43.5||r.width<43.5)).map(([n,r])=>n+' '+Math.round(r.width)+'x'+Math.round(r.height))"""


def phone_checks(browser, url, identity, server, report, out, check_layout, check_contrast, check_commit):
    folder = out / 'phone'; folder.mkdir(exist_ok=True); flows = report.setdefault('phoneFlows', {})
    def stdin(room, line):
        server.stdin.write(f'@{room} {line}\n'); server.stdin.flush(); return json.loads(server.stdout.readline())
    for (w, h), room in [((390, 844), 'ui-phone'), ((844, 390), 'ui-phone-l')]:
        tag = f'{w}x{h}'
        context = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True, device_scale_factor=2)
        context.add_init_script('localStorage.setItem("coi.identity",' + json.dumps(json.dumps(identity)) + ');' + COACH_DONE)
        context.add_init_script(FAKE_VIEWPORT)
        page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{url}/?match={room}'); expect(page.locator('#commander-title')).to_have_text('Britain')
        def shot(name):
            page.wait_for_timeout(250); page.screenshot(path=str(folder / f'{tag}-{name}.png'))
        def at(sel):
            b = page.locator(sel).first.bounding_box(); assert b, sel; return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        def tap(sel):
            x, y = at(sel); page.touchscreen.tap(x, y); page.wait_for_timeout(250)
        def home():
            page.keyboard.press('Escape'); page.keyboard.press('Escape'); page.locator('#home-view').tap(); page.wait_for_timeout(300)
        def state():
            return page.evaluate("room=>fetch('/api/games/'+room,{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('coi.identity')).token}}).then(r=>r.json())", room)
        home(); shot('01-idle'); check_layout(page, f'{tag} phone idle')

        # 1) Ghost click: your province, then a neighbour whose sheet opens under the finger. The synthetic click the
        # browser fires for that tap must not land on the new sheet (it used to open the owner's country card).
        tap('#marker-england .counter-body'); expect(page.locator('#card-title')).to_have_text('Great Britain')
        tap('#marker-north-france .counter-body')
        expect(page.locator('#card')).to_have_attribute('data-kind', 'province'); expect(page.locator('#card-title')).to_have_text('Northern France')
        expect(page.locator('#primary')).to_contain_text('Declare war on France'); check_commit(page, f'{tag} neighbour order'); shot('02-ghost-click-guarded')

        # 2) Attack from the target list on your province's card: province, row, send = 3 taps (the remembered 50%).
        home(); taps = 0
        tap('#marker-england .counter-body'); taps += 1
        rows = page.locator('#card .send-row'); expect(rows.first).to_be_visible(); assert 1 <= rows.count() <= 4, rows.count()
        for i in range(rows.count()):
            r = rows.nth(i).bounding_box(); assert r['height'] >= 44, (tag, r)
        check_layout(page, f'{tag} own province with targets'); check_contrast(page, f'{tag} own province with targets'); shot('03-targets')
        first = rows.first; words = first.locator('b').inner_text(); pid = first.get_attribute('data-pick-target')
        tap('#card .send-row'); taps += 1
        expect(page.locator('#card-title')).to_have_text(words.split(' ', 1)[1]); check_commit(page, f'{tag} order from list')
        slider = page.locator('#amount-slider').bounding_box(); assert slider['height'] >= 44, slider
        for chip in page.locator('[data-fraction]').all():
            b = chip.bounding_box(); assert b['height'] >= 44 and b['width'] >= 44, (tag, b)
        shot('04-order-from-list')
        page.locator('#primary').tap(); taps += 1
        if page.locator('#confirm-dialog').is_visible(): page.locator('#confirm-dialog [value="confirm"]').tap(); taps += 1
        expect(lane(page)).to_contain_text('Sent', timeout=5000)
        s = state(); assert any(o['type'] == 'march' and o['to'] == pid and o['from'] == 'england' for o in s['orders']), s['orders']
        flows[f'{tag} attack from the target list'] = taps; assert taps <= 3, (tag, taps)

        # 3) Snapping: with your troops chosen, a tap on open map within a finger's radius of a legal target selects it.
        home(); tap('#marker-england .counter-body')
        spot = page.evaluate(SEA_NEAR_TARGET); assert spot, (tag, 'no open-map point near a legal target')
        page.touchscreen.tap(spot['x'], spot['y']); page.wait_for_timeout(300)
        title = page.evaluate("id=>fetch('/map.json').then(r=>r.json()).then(m=>m.provinces.find(p=>p.id===id).name)", spot['id'])
        expect(page.locator('#card')).to_have_attribute('data-kind', 'province'); expect(page.locator('#card-title')).to_have_text(title)
        expect(page.locator('#primary')).to_be_visible(); shot('05-snapped')
        flows[f'{tag} snap'] = f"tap at {round(spot['x'])},{round(spot['y'])} → {spot['id']}"

        # 4) Fullscreen with the real API (Chromium): five enter/exit cycles by different paths, always consistent.
        home(); cycles = []
        def consistent(label):
            st = page.evaluate(FULLSCREEN_STATE); on = st['cls']
            assert st['pressed'] == str(on).lower() and st['menu'] == str(on).lower() and st['lock'] == on, (tag, label, st)
            if not on: assert not st['real'], (tag, label, st)
            cycles.append(label); return st
        for i, path in enumerate(['button', 'escape', 'browser-exit', 'menu', 'button']):
            page.locator('#map-expand').tap(); page.wait_for_timeout(300)
            st = consistent(f'{i + 1} enter'); assert st['cls'] and st['real'], (tag, path, st)
            if path == 'button': page.locator('#map-expand').tap()
            elif path == 'escape': page.keyboard.press('Escape')
            elif path == 'browser-exit': page.evaluate('document.exitFullscreen()')  # Back, a swipe, the browser's own Esc
            elif path == 'menu': page.locator('#menu-button').tap(); page.locator('#fullscreen-toggle').tap()
            page.wait_for_timeout(300); st = consistent(f'{i + 1} exit via {path}'); assert not st['cls'], (tag, path, st)
        # Rotation while expanded (orientation events and a resize) keeps the state; leaving afterwards still works.
        page.locator('#map-expand').tap(); page.wait_for_timeout(300)
        page.evaluate("dispatchEvent(new Event('orientationchange'));dispatchEvent(new Event('resize'))"); page.wait_for_timeout(200)
        st = consistent('rotation while expanded'); assert st['cls'] and st['real'], st
        shot('06-expanded')
        page.evaluate('document.exitFullscreen()'); page.wait_for_timeout(300); consistent('browser exit after rotation')
        flows[f'{tag} fullscreen checks'] = cycles

        # 5) A DM from another seat: badge and a toast (sender, first line, Reply) within one poll; Reply opens the thread
        # with the composer focused; with the keyboard up the composer and the latest message stay visible.
        base = int(page.locator('#comms-button').get_attribute('data-unread') or 0)
        stdin(room, 'dm usa britain Hold your fleet at Gibraltar and we talk.')
        expect(page.locator('#comms-button')).to_have_attribute('data-unread', str(base + 1), timeout=1600)  # 750 ms polling
        toast = page.locator('#toasts .cx-toast[data-message]'); expect(toast).to_be_visible(timeout=1600)
        expect(toast).to_contain_text('United States'); expect(toast).to_contain_text('Hold your fleet'); expect(toast.locator('.cx-reply')).to_have_text('Reply')
        b = toast.bounding_box(); assert b['height'] <= 80 and b['y'] >= 0, b
        expect(page.locator('#comms-button')).to_have_class(re.compile('cx-bump')); shot('07-dm-toast')
        toast.locator('.cx-reply').tap()
        expect(page.locator('#comms')).to_have_attribute('data-view', 'thread'); expect(page.locator('#comms .cx-title')).to_have_text('United States')
        assert page.evaluate('document.activeElement?.id') == 'cx-text', 'composer not focused after Reply'
        tick = state()['tick']
        for i in range(8):  # one message per game tick (the same operation within a tick would be a retry)
            tick = stdin(room, f'war {tick + 3}')['tick']; stdin(room, f'dm usa britain Line {i} of our terms.')
        expect(page.locator('#comms .cx-msg').last).to_contain_text('Line 7', timeout=3000); page.wait_for_timeout(300)
        keyboard = int(h * .45); visible = h - keyboard
        page.evaluate("k=>{const vv=visualViewport;vv.height=innerHeight-k;vv.dispatchEvent(new Event('resize'));}", keyboard); page.wait_for_timeout(400)
        expect(page.locator('body')).to_have_class(re.compile('keyboard-open'))
        comp = page.locator('#comms .cx-composer').bounding_box(); assert comp['y'] >= 0 and comp['y'] + comp['height'] <= visible + 1, (tag, comp, visible)
        last = page.locator('#comms .cx-msg').last.bounding_box(); rows = page.locator('#comms .cx-rows').bounding_box()
        assert rows['y'] - 2 <= last['y'] and last['y'] + last['height'] <= rows['y'] + rows['height'] + 2, (tag, 'latest message hidden', last, rows)
        assert page.evaluate('document.activeElement?.id') == 'cx-text'; shot('08-keyboard-open')
        page.evaluate("()=>{const vv=visualViewport;vv.height=innerHeight;vv.dispatchEvent(new Event('resize'));}"); page.wait_for_timeout(300)
        expect(page.locator('body')).not_to_have_class(re.compile('keyboard-open'))
        # Unread conversations come first in the list, in bold.
        stdin(room, 'dm japan britain A word about the Pacific.')
        page.locator('#comms .cx-back').tap(); expect(page.locator('#comms')).to_have_attribute('data-view', 'list')
        first = page.locator('#comms .cx-list .cx-conv').first
        expect(first).to_have_attribute('data-conv', 'dm:japan', timeout=3000); expect(first).to_have_attribute('data-state', 'unread')
        assert int(first.locator('.cx-conv-main b').evaluate('e=>getComputedStyle(e).fontWeight')) >= 700; shot('09-unread-first')
        close_comms(page)
        assert not errors, errors; context.close()

    # Small Android (360×780): the region contract and 44 px targets with the target list and with the order sheet.
    context = browser.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=3)
    context.add_init_script('localStorage.setItem("coi.identity",' + json.dumps(json.dumps(identity)) + ');' + COACH_DONE)
    page = context.new_page(); page.goto(f'{url}/?match=ui-phone'); expect(page.locator('#commander-title')).to_have_text('Britain')
    page.locator('#home-view').tap(); page.wait_for_timeout(300); check_layout(page, '360x780 idle')
    small = page.evaluate(SMALL_TARGETS); assert not small, ('touch targets under 44 px at 360×780, idle', small)
    b = page.locator('#marker-england .counter-body').bounding_box(); page.touchscreen.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    expect(page.locator('#card .send-row').first).to_be_visible(); check_layout(page, '360x780 own province'); page.screenshot(path=str(folder / '360x780-targets.png'))
    small = page.evaluate(SMALL_TARGETS); assert not small, ('touch targets under 44 px at 360×780, province card', small)
    page.locator('#card .send-row').first.tap(); check_commit(page, '360x780 order'); check_layout(page, '360x780 order')
    small = page.evaluate(SMALL_TARGETS); assert not small, ('touch targets under 44 px at 360×780, order card', small)
    page.screenshot(path=str(folder / '360x780-order.png'))
    context.close()
    report['assertions'].append('Phones (390×844 and 844×390 touch; 360×780 Android layout): a tap on your province and then a neighbour opens that order (the browser’s synthetic click for the tap no longer lands on the sheet that opened under the finger); your province’s card lists up to four targets as ≥44 px rows (best capture chance first; your provinces under attack or on the front line), and an attack from the list takes 3 taps (province, row, send); a tap on open map within a finger’s radius of a legal target snaps to it; the slider and share chips are ≥44 px and the commit stays on screen; fullscreen stays consistent over five enter/exit cycles (button, Escape, the browser’s own exit, the menu, button) and a rotation (class, both buttons, scroll lock and document.fullscreenElement agree); a DM from another seat raises the badge and a message toast with Reply within one poll, Reply opens the thread with the composer focused, and with the keyboard up (a shorter visual viewport) the composer and the latest message stay visible; unread conversations come first, in bold; every visible control at 360×780 is at least 44 px.')
