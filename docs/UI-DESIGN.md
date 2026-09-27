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
