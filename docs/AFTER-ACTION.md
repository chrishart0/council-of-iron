# After-action review — v0.4

## Entry and information hierarchy

A finished room opens Overview automatically; the room list labels completed matches **Review**. Scores remain visible even if historical reconstruction is unavailable. Tabs use keyboard-accessible selection, and playback is independent of the live command interface. Observing an archived match cannot issue orders or change its outcome.

**Overview** shows every original seat, including eliminated players and countries with troops still in transit. Individual Prestige, payout and maturity are copied from the saved final outcome, not recalculated by the browser. Final land counts distinct provinces; forces include garrisons and marching/returning troops. Coalition payouts depend on both final owned industry and uninterrupted tenure. A decisive hold awards the full pool to its side; a deadline finish distributes half to first and a quarter each to second and third, with tied second/third sides sharing their occupied prize slots. An equal-first deadline result draws and pays 100 to each seat.

Final alliance cards include the roster, final land, gross payout and **Alliance Prestige = sum of that final roster's individual match Prestige**. It is a display aggregate, not another prize, skill rating, coalition currency or historical attribution of all its members' actions. An independent country appears as its own side. Draws pay 100 to each seat for zero Prestige. The individual table separates final industry-based team prize share from earned allegiance tenure.

## Replay

Map history is reconstructed with the authoritative engine, then validated against the saved final board, armies, allegiances, dominance and outcome before it is published. New matches retain a start checkpoint for this reconstruction. The server materializes and persists the resulting public record; reopening it or restarting the server does not rerun its decision log. Geometry and rules are included in the archive so a later default-map change does not redraw an old match on the wrong map.

The replay stores sparse changes at exact one-second **simulation ticks**, not interpolated estimates of troop strength. Its browser reader can seek backward or forward. Rendering interpolates only the position of already-committed moving armies. An arrival, capture, recruitment, development completion or alliance activation becomes visible at its actual resolved tick. Waiting orders and unissued intentions are not exposed. The view is the completed end-of-tick military state, so same-tick intermediate mutations are not separate slider frames.

Controls include play/pause, 1×/4×/16×/64× game-time rates, opening/end, ten-tick steps, exact-tick slider, keyboard slider input and previous/next public event. Playback pauses when changing tabs, scrubbing or hiding the document and stops at the finish. Province inspection shows garrison, industry, owner, local-recruit arrow, most recent battle and known incoming waves, including returns and arrivals beyond the end of the match. Watching a battle from Military or selecting a timeline event seeks its exact tick.

## Report definitions

**Military** compares territory and total forces over time. Country rows show battles participated in, captures, provinces lost and peak territory/forces. A battle participation counts a country with positive arriving strength or the actual defending country with a positive garrison. A capture credits the country awarded ownership; recapturing a province counts again. These are descriptive statistics and never award additional Prestige.

The battle ledger records prior owner/garrison, arriving forces, resulting owner/survivors and total troop casualties. Multi-sided and allied battles do not have a well-defined per-player kill attribution under this game's simplified combat; the report deliberately does not invent one.

**Economy** compares recruited troops, production per game minute and invested manpower. Completed upgrades are credited to the country finishing the work. Investment counts manpower actually spent, including construction later destroyed. Peak values are measured every tick; line-chart samples are every ten ticks with an exact final sample. Final and peak numbers remain available in tables rather than only color-coded lines.

The whole-match manpower ledger includes neutral defenders and troops in transit:

`initial troops + recruited − invested − battle casualties = final troops`

**Diplomacy** shows activated membership intervals and public military/diplomatic turning points. Historic territory belongs to the alliance that held it at that tick, not the final roster projected backward. A stopped victory hold distinguishes territory loss from a change to that side's membership. Private conversations are not a public diplomacy replay.

## Privacy and verification

The report and replay are public only after completion. Both use explicitly selected public fields; credentials, profile IDs, operation receipts, accepted action logs, waiting orders, unconfirmed offers and undisclosed messages stay server-side. Public AI seats disclose their world dispatches and direct messages with other public AI seats. Alliance chat is disclosed only if every member was a public AI seat when the message was sent. The report presents these in a searchable diplomatic wire with conversation filters and map jumps; replay frames contain no message text. A supplied invalid or wrong-match credential is still rejected on public review routes.

A finished game reconstructs from its recorded opening (`reviewOrigin`) and accepted orders, and the result must reproduce the exact saved final state and score. A game without a recorded opening, or whose inputs do not reproduce the saved state, shows final scores and **History unavailable**. It does not present approximate history as accurate. There is no compatibility with earlier rule versions: rooms from them are not loaded at all. Once a verified public archive has been stored, a subsequent read uses that archive rather than depending on the original private command log. Persisted public records currently use format version 1.

## Live-play refinements from the hands-on match

**Local recruitment arrows.** These forward newly created local recruits only. Existing reserves and arriving reinforcements do not form a conveyor. A reserve notice shows uncommitted troops in owned arrow-source provinces; **Draft transfer** prepares the ordinary troop form without issuing an order. This is a clearer interface, not a new automatic-forwarding mechanic.

**Coalition admission preview.** Shows combined currently held industry against the threshold, whether that would start a hold or form an all-player draw, and each roster member's conditional industry-weighted share/full-maturity Prestige. Existing incumbents retain maturity; founders and newcomers start at zero. Notice and the exact current membership matter. Territory and development can change before activation, so the preview is labeled as conditional rather than a guaranteed victory.

**Development forecast.** Uses the province's actual next-recruitment tick, construction completion and incremental one-troop-per-cycle gain. It gives the earliest manpower payback tick, extra recruits and net manpower before the match deadline. This assumes only this upgrade, uninterrupted ownership/production and no earlier match end; it is not a financial return, a tactical recommendation or a guarantee. Cost, construction time and recruitment rules are unchanged.

**Threat feedback.** Incoming waves show source, amount, arrival and returning status; recent battle results explain rapid recaptures. Recent stopped-hold notices explain why the victory countdown reset. Movement still has no on-road interception.

## Test evidence

The eight-seat recorded match (recorded decisions replayed under the current rules through the adapter in `scripts/replay-handplay.js`; 622 ticks) is compared to the replay at every tick, including cross-player synchronized arrivals, changing coalitions and war declarations. Its golden event digest is re-baselined whenever the rules change. Tests cover DMs not leaking, score aggregates, recruitment/casualty/investment accounting (with a short match of its own for construction), a broken victory hold, a withheld history without a recorded opening, draws, eliminated members, exact phase-aware forecasts, scope validation, immutable repeat reads and SQLite restart.

The browser suite checks score tables, all five tabs, zoom, province inspection, forward/backward slider movement, keyboard input, speed/play/pause/end controls, event links, country-filtered charts, mobile layouts, unsupported records, the disclosed public-AI message wire and inert hostile display names. The full browser-and-external-HTTP-agent playthrough also enters review after actual completion. These are automated controls and heuristic/recorded opponents—not independent human enjoyment testing or a new LLM tournament.

Reference for conventional history/replay navigation: the official Age of Empires IV replay guide, https://support.ageofempires.com/hc/en-us/articles/9132861789460-Age-IV-Replays . No game artwork or proprietary code is reused.
