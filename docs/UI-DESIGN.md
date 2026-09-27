# v0.5 — The command table

This is a layout and interaction pass, not a claim that automated tests can establish taste, fun or “world-class” quality. The earlier local reskin was not on master. This release replaces the old CSS system rather than adding its hundreds of bevel/shadow overrides.

## Visual decisions

The live match has a fixed desktop field of view: slim campaign status, force/territory/allegiance/Prestige strip, large map, contextual Orders/Council/Dispatches pane and one compact roster. At 1366×768 and above, the primary order and roster stay in the viewport. Longer reports belong in the War log drawer, not under the board. Below the desktop breakpoint, and on short viewports, the page flows normally instead of clipping controls.

Original eight-power standards recur in country selection, the player's command header, the roster and the final result. Each has a distinct line motif and banner tone. These are **fictional game insignia**, not verified historical heraldry. They do not add national abilities. Country names accompany them; decorative SVG is hidden from assistive technology. No flags, icons, screenshots or textures were copied from other games. No font files or asset service is required.

The palette reserves brass for the selected action and important state, dark naval blue for instruments, and parchment for the analytical post-match ledger. Rectangular military counters retain screen-space size while zooming; nationality stripes match the board. Recruitment levels remain separate, not disguised as extra resources. Labels declutter independently. Fine stipple stays a fine grain at every zoom. An initial diagonal texture was rejected because it looked like an occupation map mode.

Marching markers point toward the actual destination. Visible route traces are selective: sizeable own commitments or those tied to the selected province, not an unreadable web of every one-troop reinforcement. Returning paths start at the actual turn-around coordinate. All time/position calculations still use the existing shared movement module.

## Interactions

- **Faction selection** chooses the actual native country selector and shows its starting assets. Occupied seats disable. The in-game roster inspects a country's strongest currently held province without submitting an order. Its button retains keyboard focus through polling.
- **Primary commands** are docked outside the scrolling detail pane. March uses a normal form-associated submit button; Coordinate/Develop call the same existing actions. The dock displays the source/destination and the March button states the chosen troop count. No hotkey commits an attack.
- **War log** opens by click or J, closes by Escape or Close, and returns focus. It is hidden in review. J does not hijack typing in a chat message, number field or dialog.
- **Battle notices** come only from fresh completed battles involving the controlled country. Secured, Lost and Line held are distinct. They can be dismissed or inspected; they never move the camera automatically, issue an order, disclose private messages or replay stale notifications on reconnect. An active victory hold gets a contrasting status strip. Its timer is not repeatedly announced as an aria-live message.
- **Spectators** retain the concurrent full-screen map, escaped public-chat bubbles and running-game lobby groups. A separate Resume action restores an authenticated playing seat; Spectate remains credential-free even for its owner. The read-only note lives in the sidebar so it cannot displace the map grid.
- **Results** identify Victory/Defeat for the viewing participant, Armistice for a draw, or Campaign concluded for an observer. Every winner's standard is shown without inventing an alliance emblem, bonus or kill attribution.

## References

The official Total War campaign manual describes a faction-symbol entry point and separation of faction, objectives and economic views. That inspired recurring country standards and bounded command surfaces, not a copy of its interface: https://r2enc.totalwar.com/en/manual/single-player/0015a_enc_page_campaign_play_interface/

Paradox's Victoria 3 map-graphics diary discusses making UI selections relate visibly to the map. That informed contextual inspection and restrained map feedback, not extra scenery or an imported mechanic: https://www.paradoxinteractive.com/games/victoria-3/news/victoria-3-dev-diary-70-feature-game-jam-pt2

## Verification boundaries

Run `npm test`, `npm run check`, and `python tests/browser.py`. The browser entry point includes both historical review and the new focused UI suite. To run the focused suite alone: `python tests/ui-browser.py`.

The focused server uses a recorded position at tick 480 and a private stdin test channel to resume the original decisions to ticks 535/539; this does not expose a public time-control API. Those real adjudicated outcomes verify Lost/Line held notices and interrupted holds. It is not another independent strategic match. Tests cover 1366×768/1600×1000/1920×1080 desktop fitting, 1024px/390px/short-landscape flow, persistent keyboard focus, symbol uniqueness/injection resistance, docked controls, faction selection, disclosures and review identity separation. Reduced-motion styling disables the brief notice entrance. This is not a full accessibility audit or an independent usability study.

See `docs/testing/v05-local.json` and, when published, `v05-native-ci.json` for actual verification. Native Chromium/CSP/origin checks remain distinct from the explicit managed-environment bridge.

---

## Earlier design records

# v0.3 interaction refinements

The atlas visual language remains; order complexity is separated into **March / Coordinate / Develop** modes rather than a taller wall of controls. Source/destination selection stays shared. Coordinate lists each adjacent owned source, its actual travel time, selectable percentage/exact troops and an optional common arrival tick. It shows earliest arrival and delayed dispatch explicitly. A read-only server preview is not a commitment.

Committed orders distinguish waiting, outbound and returning components, with individual/group recall controls. No recall button promises instant restoration. Development shows level, output, local troop cost, construction time and capture risk before a confirmation. Lobby summaries expose starting troop, production and territory differences instead of presenting them as equal starts.

Map anchors, distance durations and recall turning positions are shared with the server; the UI does not invent a trajectory or result. Industrial output appears on province markers and in country summaries. The Orders scroller retains position while data refreshes. Army/plan state changes are server-validated; a stale draft cannot spend unavailable troops.

Browser tests cover these controls through real HTTP actions. Screenshots and GIF are actual rendered gameplay with an explicit 12× test-clock/heuristic-agent label, not concept art. Native browser evidence is separate from the managed local browser bridge. No claim of a full accessibility audit or independent-user usability study.

---

# Historical v0.2 design notes

# UI and UX pass — v0.2

## Direction

An atlas on a diplomatic table, not an admin dashboard. The map stays visually dominant; the command panel should answer “what can I do next?” and the campaign strip should answer “what needs attention?” Navy ocean, restrained brass, readable parchment controls, system serif headings and system UI body text. No copied game art, downloaded fonts, or decorative resources are required at runtime.

This pass was implemented and reviewed within the same assistant session. No independent second coding-agent runtime was available; do not represent it as an independently reviewed design.

## References and adaptation

- **OpenFront**, official game: https://openfront.io/ — contextual map actions, attack-fraction controls, event navigation and visible incoming threats. Adapted here as explicit 25/50/Max controls, a source-garrison explanation and a focusable incoming-army banner, not as new mechanics.
- **Warzone / War.app**, official Orders list: https://war.app/wiki/Orders_list — keep entered/executed orders linked to the board. Adapted as a visible committed-march queue with troop counts, destinations and ETA. Council's committed movements remain irreversible; no turn-based undo was imported.

These are interaction references, not claims that either game proves the new UI is enjoyable. No screenshots or assets from those games are shipped.

## Changes

**Map.** Troop counters retain a useful screen size while zooming, neutral clutter is suppressed when appropriate, labels appear with detail, and allied countries keep their own colors. Source/target selection and connections are explicit. Hover/focus information names a province; counters for Scotland and Ireland no longer appear over a distant disconnected polygon. Moving armies interpolate visually between authoritative ticks; reduced-motion preferences suppress animation. The server still decides all arrivals.

**Orders.** Click an owned province, then a connected target; Shift-click selects a different source, Escape clears. Source and destination selectors remain available for keyboard users and dense regions. Presets and a range slider complement the precise troop input. Available troops and previews account for already-reserved orders. The command budget shows its next recovery time. An in-flight/queued order list confirms accepted commands; a repeated click cannot accidentally dispatch another copy while a request is pending.

**Situational awareness.** A compact strip shows land, troop total, victory progress and projected individual Prestige. Incoming attacks have a focus action and an ETA. The map and sidebar have independent useful space on desktop instead of forcing a tall empty map whenever a form grows.

**Diplomacy.** Open proposals show the exact roster and maximum slice cost before acceptance. Decline and withdraw are real server actions. Leaving displays a confirmation with the maturity consequence; Escape cancels without a departure. Pending changes remain clearly distinct from active membership. Private message delivery stays recipient-scoped. Unread means unseen incoming messages, not every message ever sent. Draft text survives polling and tab changes.

**Navigation.** Abort stale room/identity reads before they can display another seat's inbox. Keyboard-accessible tabs implement arrow/Home/End navigation and selection state. Dialog focus returns to the initiating control. A skip-map link and standard form controls provide alternatives to pointer use. Wheel, drag and pinch camera gestures coexist with world/Europe/home buttons. A 390-pixel layout keeps controls reachable without horizontal document overflow.

## Verified versus unproven

The browser test exercises room creation, human and CLI-agent seats, actual shared-API orders, alliance acceptance, private messaging, escaped hostile HTML, reconnect, a full scored match, and a second-room map interaction. Added checks cover leave-cancel, unread behavior, retained drafts, troop presets, map/Shift-click targeting, keyboard tabs and mobile overflow. GIF recording uses these real browser frames, not mockups or generated imagery.

Local managed Chromium required the documented HTTP test bridge. Native CI uses actual navigation, origin, storage and served CSP. No live LLM or independent human enjoyment study was performed, and automated focus/layout tests are not a full accessibility audit. Color distinction, map density and mobile camera comfort still need real player feedback.
