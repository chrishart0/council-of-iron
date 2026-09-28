"""v0.8 task walkthroughs: the core player tasks scripted like a user, counting interactions.

Each task runs in its own copy of the recorded war room (ui-tasks-m on a 390×844 touch phone,
ui-tasks-d on a 1366×768 desktop), stepped only through the fixture's private stdin channel.
Interactions counted: taps/clicks and drags on game controls, and Send. Typing a message and
moving the camera (pan) are reported separately and are not counted. Screenshots of every step
are written to <artifacts>/tasks/<viewport>/ for manual review.
"""
import json
from playwright.sync_api import expect

BOUNDS = {'attack': 3, 'declare': 4, 'propose': 3, 'respond': 2, 'reply': 3, 'recall': 2, 'develop': 3}

class Walk:
    def __init__(self, page, server, room, touch, out, report):
        self.page, self.server, self.room, self.touch, self.out, self.report = page, server, room, touch, out, report
        self.count = 0; self.camera = 0; self.shot = 0; self.task = None; self.results = {}
    def stdin(self, line):
        self.server.stdin.write(f'@{self.room} {line}\n'); self.server.stdin.flush()
        return json.loads(self.server.stdout.readline())
    def state(self):
        return self.page.evaluate("room=>fetch('/api/games/'+room,{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('coi.identity')).token}}).then(r=>r.json())", self.room)
    def begin(self, name):
        self.task = name; self.count = 0; self.camera = 0
    def end(self):
        self.results[self.task] = {'interactions': self.count, 'bound': BOUNDS[self.task], 'cameraMoves': self.camera}
        assert self.count <= BOUNDS[self.task], (self.task, self.count)
    def snap(self, label):
        self.shot += 1
        self.page.wait_for_timeout(250)
        self.page.screenshot(path=str(self.out / f'{self.shot:02d}-{self.task}-{label}.png'))
    def at(self, locator):
        box = locator.bounding_box(); assert box, locator
        return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    def tap(self, locator, label=None):
        """One tap (touch) or click (mouse) at the element's centre, hit-tested like a real finger."""
        expect(locator).to_be_visible(); expect(locator).to_be_enabled()
        x, y = self.at(locator)
        hit = locator.evaluate('(el,[x,y])=>{const e=document.elementFromPoint(x,y);return el.contains(e)||e?.closest("[data-army]")===el.closest("[data-army]")&&Boolean(e?.closest("[data-army]"))?true:(e?(e.closest("[id]")?.id||e.className||e.tagName):null)}', [x, y])
        assert hit is True, ('covered', label, hit)
        if self.touch: self.page.touchscreen.tap(x, y)
        else: self.page.mouse.click(x, y)
        self.count += 1
        if label: self.snap(label)
    def counter(self, province):
        return self.page.locator(f'#marker-{province} .counter-body')
    def drag(self, source, target, label=None):
        """Press on a counter and drag to another (mouse on desktop; real touch points on phones)."""
        (x0, y0), (x1, y1) = self.at(self.counter(source)), self.at(self.counter(target))
        if self.touch:
            cdp = self.page.context.new_cdp_session(self.page)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0, 'id': 1}]})
            for i in range(1, 13): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * i / 12, 'y': y0 + (y1 - y0) * i / 12, 'id': 1}]})
            self.page.wait_for_timeout(60)
            if label: self.snap(label + '-dragging')
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            self.page.mouse.move(x0, y0); self.page.mouse.down()
            for i in range(1, 13): self.page.mouse.move(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12)
            self.page.wait_for_timeout(60)
            if label: self.snap(label + '-dragging')
            self.page.mouse.up()
        self.count += 1
        if label: self.snap(label)
    def bring(self, province):
        """Camera only (not counted): pan the map by dragging empty map so the province is on screen."""
        self.page.keyboard.press('Escape')
        vw, vh = self.page.viewport_size['width'], self.page.viewport_size['height']
        for _ in range(4):
            x, y = self.at(self.counter(province))
            if 40 < x < vw - 40 and vh * .25 < y < vh * .55: return
            start = self.page.evaluate('''([w,h])=>{for(let y=h*.35;y<h*.6;y+=13)for(let x=w*.3;x<w*.7;x+=13){const e=document.elementFromPoint(x,y);
              if(e&&e.closest('#map')&&!e.closest('.map-counter,.map-cluster,.battle-counter,.moving-army'))return [x,y];}return null;}''', [vw, vh])
            sx, sy = start; dx, dy = vw / 2 - x, vh * .4 - y
            self.page.mouse.move(sx, sy); self.page.mouse.down()
            for i in range(1, 11): self.page.mouse.move(sx + dx * i / 10, sy + dy * i / 10)
            self.page.mouse.up(); self.page.wait_for_timeout(120); self.camera += 1
        raise AssertionError(('could not bring into view', province))

def walkthrough(browser, url, identity, server, report, out, room, width, height, touch):
    folder = out / 'tasks' / f'{width}x{height}'; folder.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=touch, has_touch=touch, device_scale_factor=2 if touch else 1)
    context.add_init_script('localStorage.setItem("coi.identity",' + json.dumps(json.dumps(identity)) + ');localStorage.setItem("coi.coach","done");')
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{url}/?match={room}'); expect(page.locator('#commander-title')).to_have_text('British Empire')
    w = Walk(page, server, room, touch, folder, report)
    page.locator('#home-view').click(); page.wait_for_timeout(300)
    # A private row shown in the open desktop history counts as read; start collapsed so the badge path is what gets measured.
    if page.locator('#feed-toggle').get_attribute('aria-expanded') == 'true': page.locator('#feed-toggle').click()
    primary = page.locator('#primary')

    # (b) Declare war on a neutral country and march: France (neutral), from the best-placed province.
    w.begin('declare')
    w.tap(w.counter('north-france'), 'target')
    expect(page.locator('#card')).to_have_attribute('data-relation', 'neutral')
    expect(primary).to_contain_text('Declare war on France & send')
    expect(page.locator('#card-status')).to_contain_text('NOT AT WAR')
    amount = int(primary.inner_text().split()[-1])
    w.tap(primary, 'confirm-open')
    dialog = page.locator('#confirm-dialog'); expect(dialog).to_contain_text('Declare war on French Republic?')
    expect(dialog.locator('.war-confirm')).to_contain_text('French Republic')
    w.tap(dialog.locator('[value="confirm"]'), 'sent')
    expect(page.locator('#card')).to_be_hidden()
    s = w.state(); assert 'britain:france' in s['wars'], s['wars']
    assert any(o['type'] == 'move' and o['to'] == 'north-france' and o['amount'] == amount for o in s['commandBudget']['reserved']), s['commandBudget']
    w.end()

    # (a) Attack a neighbouring enemy province with 50%: Normandy (France, now at war).
    w.begin('attack')
    before = {p['id']: p['troops'] for p in s['provinces']}
    if touch:
        w.tap(w.counter('normandy'), 'target')
    else:
        w.drag('england', 'normandy', 'drag')
    expect(page.locator('#card')).to_have_attribute('data-relation', 'enemy')
    w.tap(page.locator('[data-fraction="0.5"]'), 'half')
    expect(primary).to_contain_text('Attack Normandy with')
    w.tap(primary, 'sent')
    s = w.state()
    free = before['england'] - 1 - sum(o['amount'] for o in s['commandBudget']['reserved'] if o['from'] == 'england' and o['to'] != 'normandy')
    order = next(o for o in s['commandBudget']['reserved'] if o['to'] == 'normandy')
    assert order['from'] == 'england' and order['amount'] == max(1, free // 2), (order, free)
    w.end()

    # Recall: tap your own moving army, then Recall.
    w.begin('recall')
    w.stdin(f'war {order["executeAt"]}')
    army = None
    for _ in range(8):
        page.wait_for_timeout(900)
        s = w.state(); army = next((a for a in s['armies'] if a['country'] == 'britain' and a['to'] == 'normandy' and not a.get('returning')), None)
        if army and page.locator(f'[data-army="{army["id"]}"]:not(.tap-blocked) .army-hit').count(): break
        w.stdin(f'war {s["tick"] + 1}')
    assert army, 'no marching army to recall'
    while not s['commandBudget']['remaining']: s = w.state() if w.stdin(f'war {s["tick"] + 1}') else s  # the fixture's own tick-56 order shares the 3-per-10 s budget
    hit = page.locator(f'[data-army="{army["id"]}"] .army-hit'); x, y = w.at(hit)
    if page.evaluate('([x,y])=>Boolean(document.elementFromPoint(x,y)?.closest("[data-army]"))', [x, y]):
        w.tap(hit, 'army'); w.results['recallPath'] = 'army marker'
        expect(page.locator('#card')).to_have_attribute('data-kind', 'army'); expect(primary).to_contain_text('Recall')
        w.tap(primary, 'recalled')
    else:  # the column still sits on a counter (counter taps win): recall from the province it left
        w.tap(w.counter('england'), 'province'); w.results['recallPath'] = 'source province card'
        w.tap(page.locator('#card-actions button', has_text='→ Normandy'), 'recalled')
    expect(page.locator('#toast')).to_contain_text('Recall queued')
    w.end()

    # (c) Propose an alliance: tap Russia (the powers strip on phones, its leaderboard row on desktop).
    w.begin('propose')
    w.tap(page.locator('#lb-powers [data-power="russia"]') if touch else page.locator('#lb-rows .lb-row[data-id="russia"]'), 'country')
    expect(page.locator('#card')).to_have_attribute('data-kind', 'country'); expect(page.locator('#card-status')).to_contain_text('NEUTRAL')
    expect(primary).to_have_text('Propose alliance')
    w.tap(primary, 'name')
    expect(page.locator('#coalition-name')).to_have_value('Britain–Russia Pact'); expect(primary).to_have_text('Send alliance offer')
    w.tap(primary, 'sent')
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE OFFER PENDING')
    s = w.state(); assert any(q['name'] == 'Britain–Russia Pact' and q['status'] == 'open' and 'russia' in q['roster'] for q in s['proposals']), s['proposals']
    w.end()
    page.keyboard.press('Escape')

    # (d) Respond to an incoming alliance offer from the one attention badge.
    w.begin('respond')
    w.stdin('offer germany britain Rhine Pact')
    expect(page.locator('#attention-count')).to_have_text('1', timeout=5000)
    expect(page.locator('#notice')).to_contain_text('Alliance offer from German Empire', timeout=5000)
    w.snap('badge')
    page.locator('#notice [data-notice-close]').click() if page.locator('#notice [data-notice-close]').is_visible() else None
    w.tap(page.locator('#attention'), 'card')
    expect(page.locator('#card')).to_have_attribute('data-kind', 'country'); expect(page.locator('#card-title')).to_have_text('German Empire')
    expect(page.locator('#card-status')).to_contain_text('ALLIANCE OFFER PENDING'); expect(primary).to_have_text('Accept alliance')
    w.tap(primary, 'accepted')
    s = w.state(); q = next(q for q in s['proposals'] if q['name'] == 'Rhine Pact'); assert 'britain' in q['accepted'], q
    expect(page.locator('#attention')).to_be_hidden()
    w.end()
    page.keyboard.press('Escape')

    # (e) Reply to a DM: badge → the sender's card with the message box focused → type → Send.
    w.begin('reply')
    w.stdin('dm usa britain Will you stand down in the Atlantic?')
    expect(page.locator('#attention-count')).to_have_text('1', timeout=5000)
    w.tap(page.locator('#attention'), 'thread')
    expect(page.locator('#card-title')).to_have_text('United States'); expect(page.locator('#card-body')).to_contain_text('Will you stand down in the Atlantic?')
    expect(page.locator('#composer-text')).to_be_focused()
    expect(page.locator('#composer-send')).to_be_enabled(timeout=5000)
    page.keyboard.type('Only if you recall your fleet.'); w.snap('typed')
    w.tap(page.locator('#composer-send'), 'sent')
    expect(page.locator('#card-body .thread-row.mine').last).to_contain_text('Only if you recall your fleet.', timeout=5000)
    expect(page.locator('#attention')).to_be_hidden()
    w.end()
    page.keyboard.press('Escape')

    # Develop a province: East Canada (level II) once natural recruitment pays for level III.
    w.begin('develop')
    w.stdin('war 140')
    w.bring('east-canada')
    w.tap(w.counter('east-canada'), 'province')
    develop = page.locator('#develop-province'); expect(develop).to_contain_text('Develop · 24 troops'); expect(develop).to_be_enabled(timeout=5000)
    w.tap(develop, 'confirm-open')
    w.tap(page.locator('#confirm-dialog [value="confirm"]'), 'invested')
    expect(page.locator('#toast')).to_contain_text('Investment committed')
    s = w.state(); assert any(o['type'] == 'develop' and o['from'] == 'east-canada' for o in s['commandBudget']['reserved']), s['commandBudget']
    w.end()
    assert not errors, errors
    context.close()
    return w.results
