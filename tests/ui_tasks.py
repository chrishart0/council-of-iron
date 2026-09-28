"""v0.8 task walkthroughs: the core player tasks scripted like a user, counting interactions.

Each task runs in its own copy of the recorded war room (ui-tasks-m on a 390×844 touch phone,
ui-tasks-d on a 1366×768 desktop), stepped only through the fixture's private stdin channel.
Interactions counted: taps/clicks and drags on game controls, and Send. Typing a message and
moving the camera (pan) are reported separately and are not counted. Screenshots of every step
are written to <artifacts>/tasks/<viewport>/ for manual review.
"""
import json, re
from playwright.sync_api import expect
from browser_helpers import lane, close_comms

BOUNDS = {'attack': 3, 'declare': 3, 'propose': 3, 'respond': 2, 'reply': 2, 'recall': 2, 'turn': 2, 'develop': 3, 'rally': 3, 'converse': 7,
          'long': 3, 'through-ally': 3, 'bordering-desktop': 3, 'bordering-phone': 5, 'shift': 4, 'lasso': 3, 'select-mode': 6}

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
        # A banner for news that affects you (e.g. your alliance forming) sits over the map for a few seconds: wait, as a player would.
        expect(self.page.locator('.herald:visible')).to_have_count(0, timeout=12000)
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
    def bring(self, province, escape=True):
        """Camera only (not counted): pan the map by dragging empty map so the province is on screen."""
        if escape: self.page.keyboard.press('Escape')
        vw, vh = self.page.viewport_size['width'], self.page.viewport_size['height']
        for _ in range(16):
            x, y = self.at(self.counter(province))
            if abs(x - vw / 2) > vw * 1.5 or abs(y - vh / 2) > vh * 1.5:  # far away on a zoomed-in map: zoom out a step
                self.page.keyboard.press('q'); self.page.wait_for_timeout(150); self.camera += 1; continue
            clear = self.counter(province).evaluate('(el,[x,y])=>el.contains(document.elementFromPoint(x,y))', [x, y]) if 0 <= x < vw and 0 <= y < vh else False
            if 40 < x < vw - 40 and vh * .25 < y < vh * .55 and clear: return
            start = self.page.evaluate('''([w,h])=>{for(let y=h*.35;y<h*.6;y+=13)for(let x=w*.3;x<w*.7;x+=13){const e=document.elementFromPoint(x,y);
              if(e&&e.closest('#map')&&!e.closest('.map-counter,.map-cluster,.battle-counter,.moving-army'))return [x,y];}return null;}''', [vw, vh])
            # One drag stays inside the viewport (a pointer leaving it ends the pan): several drags cover long distances.
            sx, sy = start; dx, dy = max(-vw * .25, min(vw * .25, vw / 2 - x)), max(-vh * .2, min(vh * .2, vh * .4 - y))
            self.page.mouse.move(sx, sy); self.page.mouse.down()
            for i in range(1, 11): self.page.mouse.move(sx + dx * i / 10, sy + dy * i / 10)
            self.page.mouse.up(); self.page.wait_for_timeout(120); self.camera += 1
        raise AssertionError(('could not bring into view', province))

def walkthrough(browser, url, identity, server, report, out, room, width, height, touch):
    folder = out / 'tasks' / f'{width}x{height}'; folder.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=touch, has_touch=touch, device_scale_factor=2 if touch else 1)
    context.add_init_script('localStorage.setItem("coi.identity",' + json.dumps(json.dumps(identity)) + ');localStorage.setItem("coi.coach","done");')
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{url}/?match={room}'); expect(page.locator('#commander-title')).to_have_text('Britain' if width < 1024 else 'British Empire')
    w = Walk(page, server, room, touch, folder, report)
    page.locator('#home-view').click(); page.wait_for_timeout(300)
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
    assert any(o['type'] == 'march' and o['to'] == 'north-france' and o['amount'] == amount for o in s['orders']), s['orders']
    w.end()

    # (a) Attack a neighbouring enemy province with 50%: Indochina (France, now at war), from India.
    w.bring('indochina')  # camera only (not counted): the Indian front
    w.begin('attack')
    before = {p['id']: p['troops'] for p in s['provinces']}
    if touch:
        w.tap(w.counter('indochina'), 'target')
    else:
        w.drag('india', 'indochina', 'drag')
    expect(page.locator('#card')).to_have_attribute('data-relation', 'enemy')
    w.tap(page.locator('[data-fraction="0.5"]'), 'half')
    expect(primary).to_contain_text('Attack Indochina with')
    w.tap(primary, 'sent')
    s = w.state()
    free = before['india'] - 1 - sum(o['amount'] for o in s['orders'] if o['from'] == 'india' and o['to'] != 'indochina')
    order = next(o for o in s['orders'] if o['to'] == 'indochina')
    assert order['from'] == 'india' and order['amount'] == max(1, free // 2), (order, free)
    w.end()

    # Recall: tap your own moving army, then Recall.
    w.begin('recall')
    w.stdin(f'war {order["executeAt"]}')
    army = None
    for _ in range(8):
        page.wait_for_timeout(900)
        s = w.state(); army = next((a for a in s['armies'] if a['country'] == 'britain' and a['to'] == 'indochina' and not a.get('returning')), None)
        if army and page.locator(f'[data-army="{army["id"]}"]:not(.tap-blocked) .army-hit').count(): break
        w.stdin(f'war {s["tick"] + 1}')
    assert army, 'no marching army to recall'
    hit = page.locator(f'[data-army="{army["id"]}"] .army-hit'); x, y = w.at(hit)
    if page.evaluate('([x,y])=>Boolean(document.elementFromPoint(x,y)?.closest("[data-army]"))', [x, y]):
        w.tap(hit, 'army'); w.results['recallPath'] = 'army marker'
        expect(page.locator('#card')).to_have_attribute('data-kind', 'army'); expect(primary).to_contain_text('Recall')
        w.tap(primary, 'recalled')
    else:  # the column still sits on a counter (counter taps win): recall from the province it left
        w.tap(w.counter('india'), 'province'); w.results['recallPath'] = 'source province card'
        w.tap(page.locator('#card-actions button', has_text='→ Indochina'), 'recalled')
    expect(lane(page)).to_contain_text('Recall queued')
    w.end()

    # March again: the recalled column is on its way home; send it back toward Indochina from where it is.
    s = w.state(); back = None
    for _ in range(4):
        back = next((a for a in s['armies'] if a['id'] == army['id']), None)
        if back and back.get('returning'): break
        w.stdin(f'war {s["tick"] + 1}'); page.wait_for_timeout(900); s = w.state()
    assert back and back.get('returning') and back['resume']['target'] == 'indochina', back
    page.keyboard.press('Escape'); page.wait_for_timeout(900)  # start from a closed card (not counted)
    w.begin('turn')
    hit = page.locator(f'[data-army="{army["id"]}"]:not(.tap-blocked) .army-hit')
    if hit.count() and page.evaluate('([x,y])=>Boolean(document.elementFromPoint(x,y)?.closest("[data-army]"))', list(w.at(hit))):
        w.tap(hit, 'returning-army'); w.results['turnPath'] = 'army marker'
        expect(page.locator('#card')).to_have_attribute('data-kind', 'army'); expect(page.locator('#card-status')).to_contain_text('RETURNING')
        expect(primary).to_contain_text('March again → Indochina (arrives'); w.snap('card')
        w.tap(primary, 'marched')
    else:  # still on India's counter (counter taps win): the province card lists the troops heading home there
        w.tap(w.counter('india'), 'province'); w.results['turnPath'] = 'home province card'
        w.tap(page.locator('#card-actions button', has_text='March again'), 'marched')
    expect(lane(page)).to_contain_text('Marching again → Indochina')
    s = w.state(); assert any(o['type'] == 'turn_around' and o['target'] == army['id'] for o in s['orders']), s['orders']
    w.end()

    # (c) Propose an alliance: tap Russia (the powers strip on phones, its leaderboard row on desktop).
    close_comms(page)
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

    # (d) Respond to an incoming alliance offer: the one Messages button opens the offer, Accept is inline.
    w.begin('respond')
    w.stdin('offer germany britain Rhine Pact')
    expect(page.locator('#comms-button')).to_have_attribute('data-action', '1', timeout=5000)
    toast = page.locator('#toasts .cx-toast[data-tier="action"]')
    expect(toast).to_contain_text('German Empire', timeout=5000); expect(toast).to_contain_text('Rhine Pact')
    w.snap('toast')
    w.tap(page.locator('#comms-button'), 'thread')
    expect(page.locator('#comms')).to_have_attribute('data-view', 'thread'); expect(page.locator('#comms .cx-title')).to_have_text('German Empire')
    letter = page.locator('#comms .cx-letter')
    expect(letter).to_contain_text('Rhine Pact')
    w.tap(letter.locator('[data-do="accept"]'), 'accepted')
    s = w.state(); q = next(q for q in s['proposals'] if q['name'] == 'Rhine Pact'); assert 'britain' in q['accepted'], q
    expect(page.locator('#comms-button')).to_have_attribute('data-action', '0', timeout=5000)
    w.end()
    close_comms(page)

    # (e) Reply to a DM: the Messages button opens the sender's thread with the composer focused → type → Send.
    w.begin('reply')
    base = int(page.locator('#comms-button').get_attribute('data-unread') or 0)  # earlier notices may still be unread
    w.stdin('dm usa britain Will you stand down in the Atlantic?')
    expect(page.locator('#comms-button')).to_have_attribute('data-unread', str(base + 1), timeout=5000)
    w.tap(page.locator('#comms-button'), 'thread')
    expect(page.locator('#comms .cx-title')).to_have_text('United States'); expect(page.locator('#comms .cx-rows')).to_contain_text('Will you stand down in the Atlantic?')
    expect(page.locator('#cx-text')).to_be_focused()
    expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=5000)
    page.keyboard.type('Only if you recall your fleet.'); w.snap('typed')
    w.tap(page.locator('#comms .cx-send'), 'sent')
    expect(page.locator('#comms .cx-msg[data-mine="true"]').last).to_contain_text('Only if you recall your fleet.', timeout=5000)
    expect(page.locator('#comms-button')).to_have_attribute('data-unread', str(base))
    w.end()
    close_comms(page)

    # Develop a province: Canada (level II) once natural recruitment pays for level III (48 troops).
    w.begin('develop')
    w.stdin('war 400')
    w.bring('canada')
    w.tap(w.counter('canada'), 'province')
    develop = page.locator('#develop-province'); expect(develop).to_contain_text('Develop · 48 troops'); expect(develop).to_be_enabled(timeout=5000)
    w.tap(develop, 'confirm-open')
    w.tap(page.locator('#confirm-dialog [value="confirm"]'), 'invested')
    expect(lane(page)).to_contain_text('Investment committed')
    s = w.state(); assert any(o['type'] == 'develop' and o['from'] == 'canada' for o in s['orders']), s['orders']
    w.end()

    # Rally point: tap a province of yours → "Rally troops to…" → tap the rally province (Ireland → Great Britain;
    # the British seat's analogue of "always send Mexico's new troops to Pacific States").
    w.begin('rally')
    w.stdin('war 420')
    page.keyboard.press('Escape'); page.locator('#home-view').click(); w.bring('ireland')  # home view (camera) is next to Ireland
    w.tap(w.counter('ireland'), 'source')
    rally = page.locator('#rally-province'); expect(rally).to_have_text('Rally troops to…'); expect(rally).to_be_enabled(timeout=5000)
    w.tap(rally, 'pick')
    expect(lane(page)).to_contain_text('Tap one of your provinces')
    w.tap(w.counter('england'), 'set')
    expect(lane(page)).to_contain_text('Rally set', timeout=5000)
    s = w.state(); order = next(o for o in s['orders'] if o['type'] == 'rally')
    assert order['sources'] == ['ireland'] and order['to'] == 'england', order
    w.stdin('war 422'); page.wait_for_timeout(1500)
    expect(page.locator('[data-rally="ireland"]').first).to_be_attached(timeout=5000)
    w.snap('arrow')
    w.end()

    # Back and forth: DM Japan, receive a reply, reply again, switch to the alliance chat, send, switch back.
    # Budgets: ≤2 taps to open a thread from the idle map, ≤1 to switch threads, 1 per Send (7 in all).
    w.begin('converse')
    page.keyboard.press('Escape'); close_comms(page)
    steps = {}
    before = w.count
    if not page.locator('#comms [data-conv="dm:japan"]').first.is_visible(): w.tap(page.locator('#comms-button'))
    # The button opens the most important thread (or the list); either way Japan is one more tap (row or switcher).
    japan = page.locator('#comms .cx-switch [data-conv="dm:japan"]' if page.evaluate('document.body.dataset.comms') == 'thread' else '#comms .cx-list [data-conv="dm:japan"]')
    japan.scroll_into_view_if_needed()  # the list scrolls inside its panel (a scroll, not a tap)
    w.tap(japan, 'dm-open')
    steps['openDm'] = w.count - before; assert steps['openDm'] <= 2, steps
    expect(page.locator('#comms .cx-title')).to_have_text('Empire of Japan')
    expect(page.locator('#cx-text')).to_be_focused()
    w.stdin('war 432'); expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=5000)
    page.keyboard.type('Tokyo and London share an enemy.'); w.tap(page.locator('#comms .cx-send'), 'dm-sent')
    expect(page.locator('#comms .cx-msg[data-mine="true"]').last).to_contain_text('share an enemy', timeout=5000)
    expect(page.locator('#cx-text')).to_be_focused()
    unread = page.locator('#comms-button').get_attribute('data-unread')
    w.stdin('dm japan britain Then let us share the Pacific. What do you propose?')
    expect(page.locator('#comms .cx-msg:not([data-mine="true"])').last).to_contain_text('share the Pacific', timeout=5000)
    page.wait_for_timeout(900)
    assert page.locator('#toasts .cx-toast[data-thread="dm:japan"]').count() == 0, 'no toast for the open thread'
    expect(page.locator('#comms-button')).to_have_attribute('data-unread', unread)  # read on arrival in the open thread
    page.keyboard.type('A pact, and the Philippines stay yours.')
    w.stdin('war 444'); page.wait_for_timeout(1600)  # polling while a draft is typed
    expect(page.locator('#cx-text')).to_have_value('A pact, and the Philippines stay yours.'); expect(page.locator('#cx-text')).to_be_focused()
    expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=5000)
    w.tap(page.locator('#comms .cx-send'), 'dm-reply')
    expect(page.locator('#comms .cx-msg[data-mine="true"]').last).to_contain_text('Philippines', timeout=5000)
    page.keyboard.type('Half-written thought')  # a draft left in the Japan thread
    before = w.count
    w.tap(page.locator('#comms .cx-switch [data-conv="alliance"]'), 'alliance-open')
    steps['toAlliance'] = w.count - before; assert steps['toAlliance'] <= 1, steps
    expect(page.locator('#comms .cx-members')).to_be_visible(); expect(page.locator('#comms .cx-members')).to_contain_text('Germany')
    expect(page.locator('#cx-text')).to_have_value('')
    w.stdin('war 456'); expect(page.locator('#comms .cx-send')).to_be_enabled(timeout=5000)
    page.keyboard.type('Japan is ready to talk. I will keep the Pacific quiet.'); w.tap(page.locator('#comms .cx-send'), 'alliance-sent')
    expect(page.locator('#comms .cx-msg[data-mine="true"]').last).to_contain_text('Pacific quiet', timeout=5000)
    before = w.count
    w.tap(page.locator('#comms .cx-switch [data-conv="dm:japan"]'), 'dm-back')
    steps['toDm'] = w.count - before; assert steps['toDm'] <= 1, steps
    expect(page.locator('#comms .cx-title')).to_have_text('Empire of Japan'); expect(page.locator('#cx-text')).to_have_value('Half-written thought')
    w.end(); w.results['converse']['steps'] = steps
    close_comms(page)

    # Long moves through friendly land: tap your province, tap the destination anywhere, one button. The card's one-line
    # preview names the way (the server's /plan route); the arrow on the map follows it leg by leg.
    routes = w.results.setdefault('routes', {})
    for task, source, dest, ally in [('long', 'ireland', 'low-countries', False), ('through-ally', 'ireland', 'bavaria', True)]:
        page.keyboard.press('Escape'); page.locator('#home-view').click(); w.bring(source)
        w.begin(task)
        w.tap(w.counter(source), 'source')
        if not w.counter(dest).evaluate('(el)=>{const r=el.getBoundingClientRect();return r.left>20&&r.right<innerWidth-20&&r.top>60&&r.bottom<innerHeight*.55&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'):
            w.bring(dest, escape=False)  # camera only
        lit = page.evaluate('id=>document.querySelector(`#map [data-province="${id}"].province`)?.classList.contains("neighbor")', dest)
        assert lit, ('destination not lit while the source is chosen', dest)
        w.tap(w.counter(dest), 'target')
        expect(primary).to_contain_text('Reinforce ')
        preview = page.locator('#order-preview')
        expect(preview).to_contain_text(' via ', timeout=5000); expect(preview).to_contain_text('(arrives')
        legs = page.locator('#map .draft-arrow.route'); expect(legs).to_have_count(1)
        w.snap('route')
        text = preview.inner_text()
        w.tap(primary, 'sent')
        s = w.state(); order = next(o for o in s['orders'] if o['type'] == 'march' and o['from'] == source and o['to'] == dest)
        owners = {p['id']: p['owner'] for p in s['provinces']}
        path = order['path']; assert len(path) >= 2, path  # not a neighbour: at least one province on the way
        routes[task] = {'source': source, 'via': path[:-1], 'target': dest, 'arrivesAt': order['arrivesAt'], 'preview': text}
        allied = [v for v in path[:-1] if owners[v] not in (None, 'britain')]
        assert (allied and all(owners[v] == 'germany' for v in allied)) if ally else not allied, (path, owners)
        w.end()
    assert not errors, errors
    context.close()
    return w.results


def multiselect(browser, url, identity, server, report, out, room, width, height, touch):
    """Attack one province from several of yours at once: "Select all bordering" (desktop ≤3, phone ≤5 interactions),
    Shift-click and a Shift-drag rectangle (desktop), the Select mode and a long-press (phone). Room: Britain holds
    four provinces bordering the USA's Pacific States (west-us) and is at war with the USA."""
    folder = out / 'tasks' / f'{width}x{height}'; folder.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=touch, has_touch=touch, device_scale_factor=2 if touch else 1)
    context.add_init_script('localStorage.setItem("coi.identity",' + json.dumps(json.dumps(identity)) + ');localStorage.setItem("coi.coach","done");')
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{url}/?match={room}'); expect(page.locator('#commander-title')).to_have_text('Britain' if width < 1024 else 'British Empire')
    w = Walk(page, server, room, touch, folder, report)
    primary, chips, card = page.locator('#primary'), page.locator('#sources .source-chip'), page.locator('#card')
    four = ['canada', 'central-us', 'hawaii', 'mexico']
    def closer():
        """Camera only (not counted): zoom in until the counters show, keeping west-us in view."""
        page.keyboard.press('Escape')
        for _ in range(8):
            try: w.bring('west-us', escape=False)
            except AssertionError: pass
            else:
                if all(w.counter(p).is_visible() for p in ['west-us', 'mexico', 'central-us']): return
            page.keyboard.press('e'); page.wait_for_timeout(150); w.camera += 1
        raise AssertionError('counters not visible')
    close_comms(page); closer()
    task = 'bordering-phone' if touch else 'bordering-desktop'
    w.begin(task)
    w.tap(w.counter('west-us'), 'target')
    expect(card).to_have_attribute('data-relation', 'enemy')
    select_all = page.locator('#select-bordering'); expect(select_all).to_have_text('Select all bordering (4)')
    w.tap(select_all, 'all-bordering')
    expect(primary).to_contain_text('Attack Pacific States from 4 provinces · ')
    expect(chips).to_have_count(4)
    expect(page.locator('#order-preview')).to_contain_text('from 4 provinces'); expect(page.locator('#order-preview')).to_contain_text('all arrive together at')
    expect(page.locator('#map .draft-arrow')).to_have_count(4)
    total = int(primary.inner_text().split('·')[-1])
    w.snap('order-card')
    w.tap(primary, 'sent')
    s = w.state(); orders = [o for o in s['orders'] if o['type'] == 'march' and o['to'] == 'west-us']
    assert sorted(o['from'] for o in orders) == sorted(four), orders
    assert len({o['arrivesAt'] for o in orders}) == 1 and len({o['groupId'] for o in orders}) == 1, orders
    assert sum(o['amount'] for o in orders) == total, (orders, total)
    w.end(); w.results[task]['sources'] = len(orders)

    if not touch:
        # Shift-click two provinces of yours, then the target: one order from both.
        closer()
        w.begin('shift')
        page.keyboard.down('Shift'); w.tap(w.counter('mexico')); w.tap(w.counter('central-us')); page.keyboard.up('Shift')
        expect(page.locator('#card-title')).to_have_text('2 provinces selected'); expect(chips).to_have_count(2)
        expect(page.locator('#map .province.selected')).to_have_count(2)
        w.snap('shift-selected')
        w.tap(w.counter('west-us'), 'shift-target')
        expect(primary).to_contain_text('Attack Pacific States from 2 provinces')
        w.tap(primary, 'shift-sent')
        s = w.state(); group = [o for o in s['orders'] if o['type'] == 'march' and o['to'] == 'west-us' and o['groupId'] != orders[0]['groupId']]
        assert sorted(o['from'] for o in group) == ['central-us', 'mexico'], group
        w.end()
        # Shift-drag a rectangle around two provinces: both are selected (only your own), Escape clears.
        closer()
        w.begin('lasso')
        boxes = [w.counter(p).bounding_box() for p in ['mexico', 'central-us']]
        x0, y0 = min(b['x'] for b in boxes) - 12, min(b['y'] for b in boxes) - 12
        x1, y1 = max(b['x'] + b['width'] for b in boxes) + 12, max(b['y'] + b['height'] for b in boxes) + 12
        page.keyboard.down('Shift'); page.mouse.move(x0, y0); page.mouse.down()
        for i in range(1, 11): page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10)
        expect(page.locator('#map .lasso')).to_be_attached(); w.snap('lasso-drawing')
        page.mouse.up(); page.keyboard.up('Shift'); w.count += 1
        expect(page.locator('#map .lasso')).to_have_count(0)
        picked = page.evaluate("[...document.querySelectorAll('#sources .source-chip span')].map(e=>e.textContent)")
        assert {'Mexico', 'Great Plains'} <= set(picked), picked
        assert set(picked) <= {'Mexico', 'Great Plains', 'Canada', 'Hawaii'}, picked  # only your own
        # Destinations are lit for the selection; a province you cannot attack is dimmed and says why on hover (not counted).
        expect(page.locator('#map .province[data-province="west-us"]')).to_have_class(re.compile(r'\breach-attack\b'))
        expect(page.locator('#map .province[data-province="andes"]')).not_to_have_class(re.compile(r'\bneighbor\b'))
        page.mouse.move(*w.at(w.counter('andes'))); expect(page.locator('.atlas-tooltip')).to_contain_text('You cannot attack it: none of your provinces borders it')
        w.snap('lasso-selected')
        w.tap(w.counter('west-us'), 'lasso-target')
        expect(primary).to_contain_text('Attack Pacific States from')
        w.end()
        page.keyboard.press('Escape'); expect(card).to_be_hidden(); expect(page.locator('#map .province.selected')).to_have_count(0)
    else:
        # Select mode: taps add your provinces; a long-press adds one too; Escape leaves the mode and clears.
        closer()
        w.begin('select-mode')
        toggle = page.locator('#select-mode'); w.tap(toggle, 'mode-on'); expect(toggle).to_have_attribute('aria-pressed', 'true')
        w.tap(w.counter('mexico')); w.bring('central-us', escape=False); w.tap(w.counter('central-us'), 'two-selected')
        expect(page.locator('#card-title')).to_have_text('2 provinces selected'); expect(chips).to_have_count(2)
        w.bring('west-us', escape=False); w.tap(w.counter('west-us'), 'mode-target')
        expect(primary).to_contain_text('Attack Pacific States from 2 provinces')
        w.end()
        page.keyboard.press('Escape'); expect(card).to_be_hidden(); expect(toggle).to_have_attribute('aria-pressed', 'false')
        x, y = w.at(w.counter('mexico'))
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
        page.wait_for_timeout(700)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        x, y = w.at(w.counter('central-us'))
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
        page.wait_for_timeout(700)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        expect(page.locator('#card-title')).to_have_text('2 provinces selected'); w.snap('long-press')
        page.keyboard.press('Escape'); expect(card).to_be_hidden()
    assert not errors, errors
    context.close()
    return w.results
