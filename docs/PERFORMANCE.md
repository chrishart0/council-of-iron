# Performance on phones

A player finished a full match on a phone and reported: laggy, the phone got hot, the screen constantly
flashing. This page records what was measured, what caused it, what changed, and the budgets that
`tests/perf-browser.py` now enforces (it runs inside `python tests/browser.py`; alone: `npm run test:perf`).

## How it is measured

- A live room on the real HTTP server (`tests/browser-server.js`, whole test clock ×2, quick pace): the
  browser holds Britain, seven practice bots hold the rest. Measured from about 10:00 game time: ~55 armies on
  the move, 17–19 wars, several battles at once.
- Playwright Chromium, Pixel 7 emulation (412×915, touch), CPU throttled 4× with `Emulation.setCPUThrottlingRate`.
- Counters: Chrome's `Performance.getMetrics` (task, script, layout and style time and counts, DOM nodes,
  listeners, heap), a devtools timeline trace (paints, frames), and in-page probes installed before the app loads
  (`tests/perf_probe.py`): a `MutationObserver` counting nodes added/removed and attribute writes per poll,
  long tasks, `requestAnimationFrame` calls, live intervals, poll payloads (decoded and on the wire) and running
  CSS animations.
- Each column is the mean of two 12 s windows per build, before (master at `cd90f37`) and after, run back to back on
  the same machine (a busy 24-core host: treat single figures as ±5 points).

## Before and after

| Phone, 4× CPU throttle, busy live match | Before | After |
|---|---|---|
| Main thread busy, map view | **95 %** | **22 %** |
| Main thread busy, Messages open on the World thread | 97 % | 25 % |
| Main thread busy, page hidden | 94 % | **0.2 %** |
| Style recalculations per second (map) | 66 (184 ms/s) | 13 (42 ms/s) |
| Layouts per second (map) | 64 | 13 |
| Paints per second / frames per second (map, traced) | 67 / 57 | 33 / 14 |
| Endless CSS animations running | 40–51 | 0 |
| Army animation frames per second | 30 (a rAF loop that never stopped) | 9–10 (10 fps cap on touch screens; none when nothing marches, when hidden, or under reduced motion) |
| Observation polls per second | 1.33 (also while hidden) | 1.0 (none while hidden) |
| Observation size decoded / on the wire | 41 KB / 41 KB | 44 KB / **8.6 KB** (gzip) |
| Attribute writes per poll | 2 900 – 3 550 | 990 – 1 130 |
| Elements removed per poll | 254 – 282 | 120 – 130 |
| World thread rows re-created per poll with nothing changed in them | the whole thread (rebuilt by `innerHTML`) | 0 (checked by the test) |
| Long tasks per 12 s / longest | 16–18 / 177 ms | 8–12 / 167 ms |
| DOM elements / JS listeners / heap over a whole 30-minute match (clock ×1) | – | 2 660 → 3 060 elements (following the armies on the map), 141 listeners throughout, 7.1 → 8.1 MB heap after GC |

The remaining work is real: about 20 armies start or finish per second in an eight-bot match (each is created and
removed once), counters and the leaderboard change numbers, and each army frame repaints the map SVG.

## Root causes

1. **Endless animations inside the map SVG.** Any animating element inside an SVG makes Chrome restyle, lay out
   and repaint the whole map every frame. The map had dozens at once: a shimmer on every war-front segment (inside
   the world layer that two `<use>` copies repeat, so three times), a pulse on every battle, a float-and-fade on
   every round's losses (a round every game second per battle, restarted with a forced layout), a flash on every
   resolving battle, a 0.4 s bar transition per round, and a capture/war/alliance effect for every headline in the
   world. With the CSS animations disabled the same page dropped from ~90 % to ~30 % busy. This is the heat and most
   of the "flashing": battle counters and front lines never stopped blinking.
2. **An army animation loop that never idled**: `requestAnimationFrame` at the display rate while the match ran,
   rewriting every army's transform (and reading the SVG's screen matrix, a forced layout) on every frame, even when
   no army moved a pixel, and while the tab was hidden.
3. **Panels rebuilt on every poll.** The Messages thread, conversation list and conversation switcher were rebuilt
   with `innerHTML` whenever anything in them changed; the World thread is the match history, so a busy match
   rebuilt it on nearly every poll. Every row's node was new: entrance animations ("letter unfolds") replayed, taps
   landed on detached buttons, and the whole HTML string was also stored in a `data-html` attribute. The threat toast
   had a countdown in its markup, so it was rebuilt, and its drop-in animation replayed, every second. The war log
   was rebuilt every poll even while closed.
4. **Unchanged writes.** Each poll wrote ~3 000 attributes with the value they already had (every province fill,
   class, counter width, aria-label, leaderboard row class and data attributes), rebuilt the legend, routes, trails,
   sea fronts, country and alliance names from scratch, and replaced text nodes with the same text. Writes inside the
   world layers also made both `<use>` copies re-clone the map.
5. **Network**: a 40–55 KB uncompressed observation every 750 ms, also while the page was hidden (about 200 MB an
   hour on mobile data).

## What changed

- Map (`public/atlas.js`, `map-layers.css`): attributes, text and data are written only when they change; the
  legend, routes, trails, sea fronts and names are rebuilt only when what they draw changes. No endless or per-round
  animation: war fronts and battle markers are static, a round's losses are plain text for a moment, a resolved
  battle shows the winner's colour briefly, the tug-of-war bar eases only with a mouse. Army interpolation runs from
  a timer at 30 fps (10 fps on touch screens), moves a marker only when it would move half a pixel, uses the cached
  scale, and stops when nothing marches, the match is not running, the page is hidden or motion is reduced.
- Map effects (`public/feed.js`): a seat sees the effects of headlines that concern it (and its own industry);
  spectators still see them all.
- Messages (`public/comms.js`, `ui.js` `patchList`): the thread, list and switcher are keyed lists; a row whose
  content did not change keeps its node. The threat countdown updates text only. Cached HTML lives in a property,
  not an attribute.
- App (`public/app.js`, `leaderboard-panel.js`): text and attributes only when changed; the war log renders only
  while open; the lobby renders only in the lobby. Polling stops while the page is hidden (and resumes at once when
  shown) and runs every 1 s on touch screens (750 ms with a mouse).
- CSS: no endless animations left (the comms button's ring, the offer dot and the battle pulse are gone or finite),
  no drop-shadow filter on every insignia.
- Server (`src/server.js`): JSON responses over 1 KB are gzipped for clients that accept it. The observation's
  content is unchanged, so no API change was needed.

## Budgets (`tests/perf-browser.py`)

Pixel 7, 4× throttle, the live room above:

- main thread busy < 60 % on the map and with the World thread open; no long task ≥ 200 ms (these two depend on
  the host's load: `npm run test:perf` and `python tests/browser.py --full` enforce them, the default
  `python tests/browser.py` runs `--quick` and only reports them);
- no endless CSS animation; army frames ≤ 12 per second on a touch screen;
- observation < 15 KB on the wire;
- no World-thread row re-created by polling when its content did not change;
- page hidden: no poll and no animation frame; a lobby (nothing moves): no animation frame;
- DOM elements grow by < 25 % from 5:00 to 25:00 game time (sampled while the match runs; `--quick`, used by the default `python tests/browser.py`, samples 30 s of it).

## Memory profile (2026-09-29)

### Server

I ran three 8-seat quick matches to completion back to back in one `makeServer` process with an in-memory SQLite
store, seven built-in practice bots and one seated agent doing `boardView` / `decisionView`, plus spectator-shaped
polling. It fetched observations, feed and inbox every 120 ticks. Each match reached the 30-minute/finish window
(one ended early at tick 1,751). I called V8 GC before each
heap sample. Before the fix, finished rooms stayed in `games`; the finished `g` retained both the full private event
and action history and the materialized public replay. The rooms had 6.4–8.2k events, 719–922 accepted commands and
receipts, and 89–112 headlines. `JSON.stringify(g)` was 21–32 MB per room. The heap grew from
8.5 MB at startup to 59.7 MB after match one, 99.4 MB after match two and 154.6 MB after match three. RSS was
226 MB / 597 MB / 657 MB at those checkpoints. Early and late heap snapshots were 95 MB and 260 MB respectively.
The retaining path in the server was `games` Map → finished game → `events` / `actionLog` / `receipts` and
`afterAction.replay`; this is directly visible in the server ownership path (`games` stores each `g`, and `afterAction`
stores the archive on that same object).

Once review reconstruction succeeds (or is withheld with saved scores), the server now writes the materialized,
allowlisted archive to a separate SQLite table, releases the accepted-command log and review opening, and removes
the archive, event stream, headlines and receipts from the in-memory room. Recipient-filtered observations, inboxes,
feed pages and same-operation retries load the saved history on demand; the room shell keeps its final board and
scores. Startup checks finished archive markers without parsing the large replay blobs, then compacts the room shell.
It also prunes finished-room entries from the activity, fraction, bot-memory and write-throttle maps. The latest
three-match rerun had 46–51 KB per in-memory room and heap after GC of 11.4 MB / 14.3 MB / 14.8 MB, about 1.9 MB
retained per finished match across the run. RSS was 234 MB / 323 MB / 355 MB. RSS includes the `:memory:` SQLite
store's durable 1.5–1.9 MB history snapshot plus 20–32 MB public archive per row, and V8 allocator high-water memory;
it is not a measure of the remaining JavaScript room object alone. This brought third-room heap from 154.6 MB to
14.8 MB and RSS from 657 MB to 355 MB.

The repeatable server regression is `npm run test:memory`: three full 8-seat bot matches, observer/feed/inbox polling,
archive and history reads, and a post-GC heap bound (<55 MB aggregate growth, with headroom for test-runner variation).
It also asserts the compact room size and that the persisted recipient-filtered event stream, retry receipts, public
report and replay survive materialization.

### Browser

`tests/memory-browser.py` ran the accelerated phone match with a player and spectator page through the 30:00 finish,
then opened and closed the finished report three times. The player measured 5.9 MB heap, 3,728 CDP DOM nodes and
142 event listeners; the spectator measured 7.3 MB, 4,992 nodes and 154 listeners. After report reopen, the player
measured 7.4 / 7.4 / 7.5 MB, 6,094 nodes and 153 listeners on each cycle. These post-GC readings show no retained
report DOM/listener growth across room changes. The 30-second phone regression sample in
`python tests/perf-browser.py --quick` grew from 5.0 MB to 5.8 MB after GC, with 138 listeners. The full long-run
browser check now asserts <16 MB heap growth and <300 listeners after GC; DOM growth remains bounded by the existing
25% budget. The full CPU profile run was load-sensitive on this host and once measured 68.4% busy against the 60%
budget before reaching its memory sample; the quick memory/performance run passed.
