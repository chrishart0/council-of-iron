# The War Room — browser UI

This describes the browser client as it is now (`public/`). The UI holds no rules: every order goes through the same actions, validation and observation as agents, and the rules themselves are README "How to play" (also in the ☰ menu). Earlier UI passes (v0.2–v0.9) are in git history.

## Design system

- **Material:** blued-iron plates (brushed gradient, brass rim, dark inner line, four brass studs), engraved brass title strips (plaques), **oxblood** enamel for war and danger, **verdigris** for alliances, ivory text. One set of primitives in `public/style.css`: `.plate`, `.plaque`, `.btn` (`-primary` brass, `-danger` oxblood, `-ghost`), round `.bezel-btn`, `.tabs`, `.seg`, `.chip`, the brass range slider, input slots, and letters (`dialog.letter` for confirmations; open decisions in Messages). Messages in `public/comms.css`, replay and report in `public/review.css`, map type in `public/map-layers.css`.
- **Type:** Alegreya SC for titles and plaques, Barlow Condensed for UI and tabular numbers. Three Latin-subset WOFF2 files (Alegreya SC Bold, Barlow Condensed Medium and SemiBold) with their SIL OFL 1.1 licences in `public/fonts/`, served with a one-day cache.
- **Icons:** one original engraved line set in `public/presentation.js` (24-unit grid, `icon(name)`, unknown names fall back to the compass). The eight country standards there are fictional insignia, always shown beside the country name; decorative SVG is `aria-hidden` and never contains player text.
- **Motion:** one moment per state — a card slides in, a letter unfolds, a toast drops, a herald plate scales in — and press feedback on every control. `prefers-reduced-motion` removes all of it.
- **Copy:** game voice, sentence case, no development jargon ("Bots", "Declare war on France & send 9", "Recall queued").

## Layout: anchored regions, no overlap

Every panel is a named grid region of the stage, marked `data-region`; nothing is positioned relative to another panel.

```
┌ hud: [standard][troops][provinces][industry gauge] ─── [clock · victory line] ─── [Messages ●][⚙] ┐
│ card (left, bottom-anchored,        map area: toasts (top) · banner (under it)      │ powers  (≤ 62%) │
│ primary in a fixed footer)          camera (bottom-right, round bezel buttons)     │ comms   (rest)  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
The menu and war log take the right column while open.
Phones (< 1024 px): hud · strip of standards · map · dock (Map / Powers / Menu); the card, Powers, Messages
and the menu are sheets that replace the dock. Short landscape (< 500 px tall): one side sheet on the left,
the dock as a column on the right.
```

`#map` is exactly the viewport and the document never scrolls. The camera receives the covered edges as insets (`atlas.setInsets({left,right,top})` and `{insets}` on focus/fit), so Home, World view and card reveals frame the uncovered map. **Expand** (camera cluster, and the replay map's corner) is a CSS pseudo-fullscreen that works without the Fullscreen API (iPhone Safari); the web app manifest makes *Add to Home Screen* open without browser chrome. On phones the zoom buttons leave the camera column while a card is open (zoom stays on pinch, wheel and Q/E), so a tall peek card never pushes the column over the card's controls.

## Screens

- **Title:** the iron gate (emblem, name, commander, *Name & sound*), *The Assembly* (rooms by state with Resume / Watch / Enter / Review, and a *Record* tab of wins–draws–losses), *Open a council* (your name and Pace: Standard 30 min or Quick 5 min; the server names the room with two random words; one primary).
- **Settings** (*Name & sound* on the title): its own page in place of the title plates, with *Your name* (*Save name*; a new name is a new player, past results stay with the old one) and the sound controls inline. Back, Escape and the phone's Back return to the rooms (`#settings` history entry).
- **Lobby:** a rack of the eight standards, the dossier of the chosen country (starting holdings, commander name, *Take this seat*), host controls (*Fill empty seats with bots*, *Start match*; a host who filled every seat with bots can take one over), the invite link. *Start match* starts play at once.
- **Match:** the HUD (your standard, troops, provinces, your side's industry against the amount needed, the clock with a one-line victory status, Messages, ☰), the card, Powers (teams or players, land and troops, alliance totals, every war front listed under the rows, then any truce: both sides with a laurel and *Truce until 12:40*, marked when it involves you), Messages, heralds, the camera and the menu.
- **Menu (☰):** room status; **How to play** (the eight rules of README "How to play", filled with this room's numbers — hold time, recruitment interval, build costs and times, peace window, alliance notice); map views (World, Europe, Expand); sound and voice; the map key; controls; War log (L); Copy room link; *Show the tips*; Change identity; Leave to rooms.
- **Tips:** three first-match tips (drag to attack; tap a country; the Messages button), stored per browser, replayable from ☰; a tip advances by itself once acted on.
- **Spectators** get the same map, Powers, read-only cards (no actions) and the World thread without a composer.
- **After the match:** the review opens by itself (the room list labels it **Review**) and has no command capability. A result band (**Victory / Defeat / Draw**, or "After-action report" for spectators) with the headline and how it ended; final standings by alliance (Land, Industry, Forces, Result), copied from the saved outcome; *Watch the replay*. The replay has play/pause, 1×/4×/16×/64×, ±10 s, an exact-tick slider, event marks, the standings and the history thread at the scrubbed tick (rows seek), and province inspection; it pauses on a hidden page. Report tabs: **Military** (territory and forces over time, battle ledger), **Economy** (recruits, production, investments, troop ledger), **Diplomacy** (turning points and the disclosed-message wire). Data and privacy: [API.md](API.md#after-action-review-finished-matches-only).

## Orders: everything starts from the map

Two nouns: a **province** (troops) and a **country** (diplomacy). One card shows whichever you selected, with two sizes (peek and *Show more*) and exactly **one primary button whose label says what happens**.

- **March.** Drag from your province's counter to any province you can reach: every reachable province is lit (cream to reinforce, coral to attack) and the rest dimmed; the arrow follows the actual route leg by leg and shows `troops · ETA` at the target. The one-line preview reads `Send N → X via A, B (arrives mm:ss)`. Tap-tap works the same, and so does target-first (tap a target; your best-placed province is proposed). Tap more of your provinces to add them as sources (chips with per-source amounts): one `march` order, all arriving together. The card holds one amount control (slider plus 25/50/75/100 %, remembered per browser), the route and the capture chance on arrival. The primary reads `Attack Normandy with 5`, `Reinforce Ruhr with 24` or, against a country you are not at war with, `Declare war on France & send 9` (danger style; the confirmation letter names everyone who will be at war). Keyboard: Enter on your counter, then on a target, focuses the primary; Enter sends, Escape cancels.
- **Turn around.** A marching army is its arrow: tap it (or the province it left) for one primary: `Recall → Home (arrives mm:ss)` while it advances (and *Recall the whole march* for a multi-source march), `March again → Target (arrives mm:ss)` while it comes back, with a one-line preview (and a warning when another side's battle is under way there); disabled with *Already sent back twice* after the second re-advance. The turned-back notice carries *March again* beside *Show army* (not for `peace`/`no_war`, which need a declaration first); on phones its text gets its own row above 44 px buttons. Counter taps win over army taps.
- **Rally.** On your province: *Rally troops to…*, then tap one of your provinces. A dashed arrow in your colour shows it; *Clear rally* removes it; a paused rally (rally province lost, no friendly path) is a personal notice.
- **Build.** *Develop · 24 troops* on your own province, with a confirmation that states cost and time. When the garrison cannot pay, the button is disabled and says what is missing: *Needs 24 · you have 11*.
- **Battles:** a province in battle shows the live odds and recent rounds in its card.

## Diplomacy: tap a country

A Powers row, a standard on the phone strip, or a province card's owner line opens the country card. It states the relation in large type (**AT WAR / ALLIED / ALLIANCE FORMING / ALLIANCE OFFER PENDING / NEUTRAL / FALLEN**), strength, alliance and wars, and one primary: *Propose alliance* (inline name, default `Britain–Russia Pact`, with the combined industry against the target) and *Declare war* as the secondary; *Accept alliance* / *Decline* for an offer; *Offer peace* at war, *Accept peace* for an offer to your side; *Message* for an ally, with *Leave alliance*. When your alliance is at its size cap the card says so. After peace, the card states *Truce until 12:40* and a disabled *Truce until 12:40* replaces *Declare war*; an order card that would declare war on a truce partner shows the same disabled primary. Your own standard opens the **alliance card**: members, industry toward victory, wars, *Alliance chat*, *Leave alliance*.

## Messages and notifications

`public/comms-model.js` (pure triage) and `public/comms.js` (controller).

| Tier | What | Arrives as | Sound |
|---|---|---|---|
| ACTION | an alliance offer to you, a peace offer to your side, an enemy army landing on your province within 30 s | the one toast slot, persistent, inline Accept / Read / ×, "+N" | `dispatch` stinger |
| PERSONAL | DMs, alliance chat, diplomatic rows and headlines that affect you, your battle results, armies turned back (sticky, *Show army* and *March again*), paused rallies | a brief one-line toast (bursts from one sender coalesce) | `chat` blip for messages |
| WORLD | everything else | no toast; the World conversation pulses | silent |

**Toast priority.** There is one toast slot. A decision (ACTION) always owns it. Otherwise your own order's confirmation or error shows first (about 4 s; 7 s for an error), ahead of a personal notice, which then takes the slot.

**Messages** (one button, **C**; red count = decisions, brass = unread) lists every conversation sorted by what needs you: World, your alliance (pinned, or *Propose an alliance* if you have none) and every power, even before the first message. Threads have inline Accept/Decline, an Unread divider, "↓ N new", quick replies and the composer with the mic. A row of standards under a thread's title switches conversation in one tap; the alliance thread names its members and, in rooms that reveal alliance chat after the match, says so above the composer. Drafts are kept per conversation across polling and switching; Enter sends (Shift+Enter for a new line); focus stays in the box after sending. A reply in the open thread arrives in place (read, no toast). Read state is per item (`coi.comms.<match>.<seat>` in localStorage). **J / K** move between conversations. Docked in the right column on desktop, a sheet on phones. Anti-spam limits are server-side and have no countdown in the UI.

**Heralds** (banners) are only for headlines that affect you: war seal, treaty, alliance seal with both standards, fallen standard (DEFEAT for your own country), major battle, victory countdown. One queue of at most five, most important first; `pointer-events:none`, never focused, and only for events after the initial catch-up, so reconnects replay nothing. Player text is set with `textContent` only.

## Headlines

`src/engine.js` classifies each public event once (`classifyHeadline`) as structured facts (kind, IDs, counts); clients write the prose. Private events are never headlines.

| Event → `headline.kind` | Herald | Map effect |
|---|---|---|
| `war_declared` → `war` | War seal | `war {from,to}` |
| `peace_accepted` → `peace` | Treaty | `peace {from,to}` |
| `alliance_activated` → `alliance` | Alliance seal (name is player text) | `alliance {countries}` |
| `eliminated` → `eliminated` | Fallen standard | `eliminated {country}` |
| `departed` / `coalition_dissolved` → `departure` / `dissolved` | Dispatch | — |
| `dominance` / stopped hold → `dominance` / `dominance_broken` | Victory countdown / countdown stopped | — |
| major `battle` → `major_battle` | "Major battle at P · N troops lost" | `captured` if ownership changed |
| `development_completed` at level III → `industry_up` | — | `industry_up {province,level}` |
| `finished` → `finished` | result screen | — |

A battle is major when `casualties ≥ max(20, ceil(3% × all troops on the map))`; the headline carries both numbers. Level II builds are routine and stay in the War log.

## Map layers

- **Borders** (`public/map-geometry.js`): thin dashed province borders, a heavier border where owners differ (re-classified on every update), coastline over a faint shelf. `tests/map-geometry.test.js` checks that shared borders match and every touching pair is connected.
- **Level of detail** by on-screen pixels per map unit: far = one counter per same-owner region; mid = overlapping same-owner counters merge (never across owners); near = every province with industry pips and names. Remaining overlaps are nudged with a leader line; every province's troops are on screen exactly once. Clicking a merged counter zooms to its members.
- **Battles:** a clash counter per battle (attacker strength × swords × garrison) with a two-colour tug-of-war bar split by strength (colours separated by ≥ 20 ΔE incl. simulated colour-blindness), a flash per round, the winner's colour when it resolves.
- **Armies** are the top layer: owner-coloured arrow, troop pill, larger for big columns; hover/focus shows owner, size, route and ETA. Their hit circle is disabled wherever it overlaps a counter, so counter taps always win.
- **Rallies:** your own rally points as dashed arrows (private to you).
- **Wraparound:** the world repeats every 1280 units; world layers are repeated by `<use>` copies (no duplicate IDs) and interactive overlays are drawn once on the nearest copy. Pacific routes cross the dateline.
- **Alliances:** `public/relations.js` (shared with agents) assigns one of four palette hues (≥ 38 ΔE apart under normal and simulated protan/deutan/tritan vision, `tests/relations.test.js`). Each coalition gets a bloc outline, member counter ticks and its name on its largest land (player text, `textContent`, ≤ 28 characters); forming alliances are dashed.
- **Wars:** crimson hatched fronts on land borders between countries at war; a dashed sea front only where they share no land. **M** toggles Diplomacy mode (focus country gold, allies blue-green, enemies red).
- **Map key** in ☰ (legend and the Diplomacy toggle).
- **Zoom** is capped at 14 screen px per map unit on every device; pinch, wheel, +/−, double tap and Q/E share the clamp. Small European provinces reach ≥ 32 CSS px on a phone.
- **Effects API:** `atlas.effect(kind, data)` for the kinds in `MAP_EFFECTS`; decorative, `aria-hidden`, scoped to one map instance, never throws. Live and review maps use distinct ID prefixes.

## Phones

Below 1024 px: HUD, a strip of standards (one tap into diplomacy), the map, and a dock (Map / Powers / Menu). The card, Powers, Messages and the menu are sheets that replace the dock; the primary stays in the sheet's fixed footer. 44 px targets on coarse pointers; +/− are hidden there (pinch). The toast is compact (≤ 72 px) and clear of the order sheet.

- **Orders by thumb.** Tapping your province opens its card with up to four targets as big rows (best capture chance first; your provinces under attack or on the front line), each the same as tapping that province: province → row → send is 3 taps. Tapping the target on the map works as before; with your troops chosen, a tap on open map within a finger's radius (34 px) of a legal target snaps to it. Two quick taps on two different provinces are two selections, never a double-tap zoom. On touch, a one-finger drag marches only from the counter of a province you have already selected; every other drag pans.
- **No ghost clicks.** A tap on the map can open a sheet right under the finger; the browser's synthetic click for that same tap is swallowed (it used to open the owner's country card or press whatever was there).
- **Expand / full screen** (`public/expand.js`) is one state derived from the document: expanded ⇔ our pseudo-fullscreen class or real fullscreen we asked for. Any browser exit (Back, a swipe, Escape, rotation, switching apps; standard and `webkit` events) leaves the pseudo state too, and the button always toggles on what is true now. Without the Fullscreen API (iPhone) Expand gives the strip's and the dock's rows to the map; ☰ → Map explains *Add to Home Screen*, which is the only real full screen there (the manifest asks for `fullscreen`, then `standalone`). `public/sw.js` makes the app installable everywhere; it caches nothing (a live match must never run on stale code or keep match data on the device) and only answers a failed page load with a self-contained *No connection* page whose Try again reloads the same address.
- **Messages you notice.** The Messages button rings once when something arrives for you; a DM or alliance message toasts for 9 s with the sender on its own line, the first line and a brass *Reply* that opens the thread with the keyboard up (focus inside the tap, as iOS requires). Unread conversations come first in the list, in bold with a dot; the thread switcher keeps a steady order. With the on-screen keyboard up (a shorter `visualViewport`), the War Room is sized to the visible area, the switcher and quick replies step aside, and a reader at the latest message stays there.
- Every control is ≥ 44 px on coarse pointers (asserted at 360×780), fields use ≥ 16 px text (no zoom on focus), and short landscape puts the slider and the share chips on one row so the commit stays on screen. Phones need HTTPS for the microphone (`scripts/dev-cert.sh`, see [OPERATIONS.md](OPERATIONS.md)).

## Sound

Presentation only: every sound repeats something visible, so muting loses no information.

| Cue | Plays when (live only) |
|---|---|
| `war`, `alliance`, `peace` | a headline of that kind that affects you |
| `battle` | a major battle that affects you |
| `fallen` / `defeat` | another country falls / your country falls or your side loses |
| `industry_up` | a level-III factory completes (yours or your side's) |
| `countdown` / `countdown_stop` | a victory hold starts / stops |
| `victory` / `draw` | the match ends (spectators hear `victory` for any winner) |
| `dispatch` | an ACTION decision addressed to you; an alliance departure or dissolution |
| `warning` | a hostile army newly targets one of your provinces |
| `chat` | a DM or alliance message to you |
| `march` / `click` | your own accepted march / any other accepted order |

The sprite still contains an unused `industry_down` cue from the removed capture damage.

**Music:** `theme`, a 64 s D-minor march that loops seamlessly; `tension`, a 16 s percussion layer faded in while you are at war or a victory countdown runs.

**Arbitration** (`public/sound-model.js`, pure, unit-tested): at most one stinger per poll (priority ≥ 2; +2 when it names your country), a UI cue only when no stinger was chosen, per-cue cooldowns, a 2.5 s gap between stingers, at most four stingers per 20 s (your defeat always passes). Music ducks to 30 % under a stinger. Catch-up history, reconnects and room switches play nothing.

**Settings:** nothing is fetched or decoded until the first click, tap or key press. A touch's `pointerdown` is not a user activation, so every trusted gesture resumes a suspended context until it runs; the music starts once its two loops are decoded, without waiting for the cue sprite. Mute, Music and Effects sliders and *Reduced sound* (stingers only, quieter, no tension layer) live in ☰ during a match and on the Settings page otherwise, and persist in `localStorage["coi.sound"]`. **Shift+M** mutes (ignored while typing). Hidden tabs suspend audio. Defaults: effects 70 %, music 30 %.

**How the audio is made:** original synthesis only — no samples or recordings. `scripts/sound/compose.js` describes each cue with Tone.js 15.1 (a devDependency, used in headless Chromium at build time, never served). `scripts/sound/generate.py` renders with `Tone.Offline` at 48 kHz, cuts seamless loops, levels to ITU-R BS.1770 targets (stingers −16 LUFS momentary, UI −24, theme −23 LUFS integrated, tension −25, peaks ≤ −1 dBFS) and encodes Ogg Opus plus MP3 fallbacks into one cue sprite indexed by `public/audio/manifest.json`. A browser downloads about 600 KB (Ogg) or 960 KB (MP3).

Regenerate: `npm install` (dev), `python -m pip install numpy scipy matplotlib` plus the Playwright Chromium from `tests/requirements.txt`, ffmpeg with libopus and libmp3lame, then `python scripts/sound/generate.py --report /tmp/sound-report` (spectrograms and `levels.json`). Encoded bytes can differ between runs.

## Voice input

`public/voice.js` adds a mic to every text box marked `data-voice` (the Messages composer); it never sends.

- **Talk:** tap to start and again to stop, or press and hold (walkie-talkie). A level bar and elapsed time show while recording; it stops after 30 s or about 1.5 s of silence after speech. **Esc** cancels; **Ctrl+Shift+Space** toggles while the composer has focus.
- **Review, then Send:** the transcript is inserted at the caret, trimmed to 500 characters, focused, never sent automatically.
- **Paths:** the server's transcription when `GET /api/stt` says it is available — OpenAI's API when `OPENAI_API_KEY` is set (the mic says "transcribed by OpenAI"), else the optional local sidecar (`npm run stt`, `STT_URL=…`); otherwise the browser's Web Speech API (dashed mic, "may use a cloud service"); otherwise no mic. Spectators get no mic. On plain HTTP the mic is dimmed and explains that it needs HTTPS.
- The transcript is untrusted player text and only reaches `input.value`.

## Accessibility

Skip link to the map controls; every card, sheet and menu opens with focus moved in and returns it on Escape (which closes the top-most layer: tip, banner, menu, war log, Messages, card, Powers sheet, expanded map). Keyboard order entry, tabs with arrow/Home/End, `aria-expanded` / `aria-pressed` / `aria-live` (assertive for ACTION, polite for PERSONAL); the victory timer is not re-announced. Shortcuts (C, J/K, H, Q/E, M, L, Shift+M) never fire inside text entry. Representative text in every region meets WCAG contrast (4.5:1, 3:1 for large text). Relations are never colour-only: the card states them in words, and country names accompany every standard.

## Verified (automated, not a usability study)

The full `python tests/browser.py` run includes `tests/ui-browser.py` (recorded-position fixture with test-only stdin stepping; its screenshots are recorded-position UI, not a live match), `tests/ui_tasks.py` and `tests/voice-browser.py`.

- **Region audit** at **1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 390×844 and 844×390**, for the player (idle, order card peek and expanded, country card, alliance card, Messages list and thread, menu, the phone Powers sheet), the spectator, the lobby, the replay and the report: no visible `[data-region]` overlaps another by more than 4 px or leaves the viewport, no document scroll, `#map` is the viewport, exactly one primary on the card, visible and unobstructed.
- **Contrast:** WCAG ratio of the computed colour against the effective background (gradient stops included) in every region and viewport.
- **Uncovered map** (asserted): ≥ 65 % idle and ≥ 50 % with an order card peeking at 1366×768; ≥ 73 % / 65 % at 1920×1080; ≥ 64 % idle at every viewport.
- **Interaction bounds** (`tests/ui_tasks.py`, 390×844 touch and 1366×768 mouse; taps, clicks and drags counted, typing and camera moves separately):

| Task | Steps | Bound |
|---|---|---:|
| Declare war on a neutral country and march | tap target, primary, confirm | 3 |
| Attack a neighbouring enemy province with 50 % | tap target (or drag), 50 %, send | 3 |
| Attack from your province's target list (phone) | province, row, send | 3 |
| Attack from every bordering province | target, Select all bordering, send | 3 (bound 4) |
| Recall a marching army | army (or source province), Recall | 2 |
| Send a returning army back | army (or its province), March again | 2 |
| Long move across your own land | source, far target, send | 3 |
| Move through an ally's land | source, target beyond the ally, send | 3 |
| Propose an alliance | country, Propose alliance, Send | 3 |
| Respond to an incoming offer | Messages, Accept | 2 |
| Reply to a DM | Messages, Send (+ typing) | 2 |
| Develop a province | province, Develop, confirm (+1 camera move) | 3 |
| Set a rally point | province, Rally troops to…, rally province | 3 |
| Converse: DM Japan, get a reply, reply, switch to alliance chat, send, switch back | open ≤ 2, each switch 1, each send 1 | 7 (measured 7 touch / 6 mouse) |

The walkthroughs also check no toast for the open thread and drafts kept across polling.

Not verified: real devices and iOS Safari (the keyboard is simulated with a shorter `visualViewport`; real fullscreen only in Chromium), screen-reader output beyond the asserted ARIA attributes, how anything sounds, and whether players find the UI clear or enjoyable.

## Known issues

- With a card open on a phone the map shows about 41 % of the screen (the card is the focus there).
- An incoming-attack warning (ACTION) holds the toast slot, so a battle notice waits until it is dismissed.
- The replay's phone map is short while the standings sheet is open.
- Country names and some alliance names often have no room in dense Europe at world zoom.
