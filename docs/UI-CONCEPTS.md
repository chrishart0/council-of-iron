# v0.9 — Three game-UI directions (Phase 1 concepts)

User verdict on v0.8: *"This feels like a website with a map in it, not like an integrated game UI."* and *"The map is good, it's everything else: the after-action report, the menus, etc., the chat. It doesn't feel integrated and cohesive."* Earlier: *"too complex, I get lost"* (v0.8 cut the match to 7 surfaces with one primary action per card; every concept keeps that model). Open bugs that shaped the layout rules: the desktop leaderboard was covered by the history, and in replay "Powers" covered "At this moment".

These are **static prototypes**, not the game. Each renders the unchanged atlas (`public/atlas.js`, rendering, zoom, counters and borders untouched) over a **recorded public position**, and applies one design system to the whole shell: title and rooms, country selection, match HUD, chat, notifications, menu, powers, replay and the after-action report, plus a style tile. Nothing sends orders; no rule, API or balance value changed.

- Open: `/concepts/` (index), `/concepts/A.html?s=hud` etc. Screens: `tile, title, faction, hud, province, country, offer, chat, menu, powers, replay, report`. The small switcher at the bottom (or `[` `]`) moves between screens; `&clean=1` hides it.
- Data: `node scripts/concept-fixture.js` writes `public/concepts/fixture/*.json`, exactly what the HTTP API returns: Britain's observation at tick 60 of a scripted eight-seat room (three alliances, two independents, eight wars, a pending *Channel Entente* offer from France, world chat and a DM), the public feed and map, and the review + replay of the recorded 530-tick handplay match (replay decoded every 10 ticks so a static page can scrub it). The title screen's room list shows these two rooms plus one illustrative open lobby, labelled as such.
- Check: `python scripts/concept-shots.py OUT [A B C]` renders every screen at 1920×1080, 1536×864 and 390×844 and fails on any overlap between visible `[data-region]` panels, a panel leaving the viewport, or document scroll.
- Server: `/concepts/*` is a startup-built allowlist of files under `public/concepts` (no request path reaches the filesystem). Temporary; removed or replaced when a direction is implemented.

## What makes a strategy UI feel like a game, not a page

Principles taken from shipped games (interaction and structure only; no art, names, icons or trade dress copied):

1. **The HUD is a frame anchored to the screen edges and corners**, not floating web cards. HoI4/Victoria/CK3 put a top bar with the flag and resources along the top edge and an outliner on the right; Civilization VI anchors the unit panel bottom-left, the minimap bottom-right and notifications down the right edge. Every element lives in one fixed place, so players build spatial memory.
2. **No page anywhere.** No document scroll, no scrollbars on the frame, no browser-default form controls. Lists scroll inside fixed panels; sizes do not reflow when content changes.
3. **One material language.** Every panel, button, tab, slider, toast and dialog is built from the same few primitives (plate/paper/sticker), the same type scale and the same icon style, on the title screen and the after-action report as much as in the match.
4. **A display face for titles, a workhorse face for numbers.** Tabular figures for anything that changes.
5. **Icon-first controls with labels where a decision is made**, tooltips and hotkeys on desktop, 44 px targets on touch.
6. **Micro-feedback**: hover and press states on every control, with `data-sfx` hooks for the existing sound system; a context cursor over legal targets.
7. **Diegetic touches where they help** (letters for events, seals for treaties, telegrams for messages) but clarity first: a real-time strategy game makes a clarity-first promise, so numbers stay non-diegetic and legible (Fagerholt & Lorentzon's diegetic/non-diegetic/spatial/meta framework).
8. **Notifications are a stack of icons that expand**, in their own lane, never over other panels (Civ VI's right-edge stack, HoI4's alert row under the top bar).
9. **Minimal, glanceable HUD**: status on top, actions in reach, the map owns the middle. The camera frames targets inside the uncovered area, never under the frame.
10. **One orchestrated transition per state** (a letter unfolds, a telegram slides out, a panel springs from its anchor) instead of scattered animation; reduced motion respected.

## Layout rules shared by all three (why nothing overlaps)

- The shell is a CSS grid of named regions; the map `<svg>` is full-bleed underneath and the camera receives the regions' rectangles as insets. Popups and toasts have their **own lane** (a grid area), so no panel is ever positioned by coordinates relative to another.
- Desktop: top band · left column (the one context card, primary button in a fixed footer) · map area · right column split by fixed rules into **Powers** (sized for 8 seats, 4 alliances + independents + a wars list, compact rows) and **History/chat** (the rest; scrolls inside). Notifications sit in the map area's top-right lane, left of the right column. Camera controls sit bottom-right of the map area.
- Phone: top band · one slim secondary row · map · bottom dock. The card and panels are bottom sheets that **replace** the dock; one notification slot under the top band.
- Replay: one team leaderboard **at the scrubbed tick** (replacing both "Powers" and "At this moment"), the history up to that tick, and a timeline band along the bottom.

## References

- Hearts of Iron IV user interface (top bar with flag, menu buttons with hotkeys): https://hoi4.paradoxwikis.com/User_interface · https://www.gamepressure.com/heartsofiron4/interface/z78eb8
- Crusader Kings III interface (resources and alerts along the top, outliner): https://www.gamepressure.com/crusader-kings-3/interface-description/z2f0f6
- Civilization VI interface (corner-anchored panels, notifications down the right edge): https://www.gameuidatabase.com/gameData.php?id=639 · https://interfaceingame.com/games/sid-meiers-civilization-vi/ · https://www.gamepressure.com/sidmeierscivilization6/interface/ze92ba
- Supremacy 1914 (period newspaper as the news hub, diplomacy window with country list and messages): https://supremacy1914.fandom.com/wiki/NEW_INTERFACE_MANUAL · https://bytro.helpshift.com/hc/en/3-supremacy-1914/faq/7-what-is-diplomacy-and-how-does-it-work/
- Conflict of Nations user interface (province bar on selection): https://wiki.conflictnations.com/User_Interface
- The Battle of Polytopia (clear icons, minimal mobile-first UI): https://gamificationplus.uk/the-battle-of-polytopia-finding-the-right-balance/
- territorial.io (full-screen map, one percentage bar): https://territorial.io/tutorial
- Diegesis in game UI (Fagerholt & Lorentzon's four categories): http://devmag.org.za/2011/02/02/video-game-user-interface-design-diegesis-theory/ · https://punchev.com/blog/diegetic-vs-non-diegetic-game-ui

## Fonts (bundled, SIL Open Font License 1.1; Latin subsets as WOFF2)

| File | Family | Used by | Size |
|---|---|---|---|
| `alegreya-sc-regular.woff2`, `alegreya-sc-bold.woff2` | Alegreya SC | A titles | 24 KB + 25 KB |
| `barlow-condensed-medium.woff2`, `barlow-condensed-semibold.woff2` | Barlow Condensed | A UI and numbers | 20 KB + 21 KB |
| `im-fell-english-sc.woff2` | IM FELL English SC | B headings | 53 KB |
| `courier-prime-regular.woff2`, `courier-prime-bold.woff2` | Courier Prime | B body and UI | 17 KB + 18 KB |
| `rubik-variable.woff2` | Rubik (variable weight) | C everything | 31 KB |

Licences: `public/concepts/fonts/OFL-*.txt`. Subset with `pyftsubset` (Basic Latin, Latin-1, typographic punctuation, arrows). Total 224 KB for all three; a chosen direction ships only its own (A 90 KB, B 88 KB, C 31 KB). All icons are original inline SVG.

<!-- DIRECTIONS -->
