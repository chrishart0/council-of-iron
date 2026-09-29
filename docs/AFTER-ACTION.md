# After-action review

A finished room opens its review automatically; the room list labels finished matches **Review**. The review is built only from the public record and has no command capability: watching it cannot issue orders or change the result.

## Overview

- **Result band:** **Victory**, **Defeat** or **Draw** for a seat (spectators see "After-action report"), the winners' standards, the headline ("Victory for the Atlantic Accord", "France prevails" or "The council ends in a draw") and how it ended: a 60 % industry hold, the most industry at the deadline, or equal industry at the deadline. The medal shows your own industry (spectators: the winning side's industry).
- **Final standings**, grouped by alliance (the winning one marked *Victor*), then independents: **Land**, **Industry**, **Forces** (troops including those still marching at the finish) and each player's **Result** (Won / Lost / Draw). A country with no industry at the finish loses even if its alliance wins or the match is drawn. Industry — your completed factory levels at the end — is your score within your side; there is no prize, payout or other points.
- Match length, battles and casualties, a share-of-the-map chart per alliance, turning points that open the replay at that moment, and one primary *Watch the replay*.

Results are copied from the saved outcome, never recalculated by the browser, and stay visible even when history is unavailable.

## Replay

The server reconstructs the match with the authoritative engine and checks it against the saved final board, armies, alliances, holds and result before publishing it. The public record is stored once built; reopening it or restarting the server does not rerun the decision log. Map geometry and rules are part of the archive.

Frames are the end-of-tick state at exact one-second ticks; only already-committed moving armies are interpolated between them. Waiting orders and unissued intentions are not shown. Controls: play/pause, 1× / 4× / 16× / 64×, ±10 s, first/last, an exact-tick slider (keyboard too), event marks and next-event. Playback pauses on tab change, scrubbing or a hidden page, and stops at the finish.

Beside the map: the standings at the scrubbed tick, and the history thread up to that tick (public events; alliance chat only in rooms that announced it at join; messages disclosed by public AI seats). Rows seek the replay. Tapping a province shows its owner, garrison, industry, the last battle there and incoming armies, including arrivals after the finish.

## Report tabs

- **Military:** territory and forces over time; per-country captures, losses, battles and peak land/forces; a battle ledger with previous owner and garrison, arriving forces, resulting owner and survivors, and total casualties. Shared and allied battles have no per-player kill attribution, and the report does not invent one.
- **Economy:** recruited troops, production per minute, invested troops and upgrades. The ledger accounts for every troop, including neutral defenders and troops in transit: `initial + recruited − invested − casualties (− interned) = remaining`.
- **Diplomacy:** turning points (alliances, departures, wars, peace, holds, eliminations, the finish) that open the replay at their tick, and the searchable wire of messages disclosed by public AI seats, filtered by conversation.

## Privacy and verification

Reviews exist only after the match is finished; live-match history requests are refused. The report and replay use allowlisted public fields. Credentials, profile IDs, operation receipts, accepted action logs, waiting orders, unconfirmed offers, rallies and undisclosed messages stay on the server. Public AI seats disclose their World messages, their DMs with other public AI seats, and alliance chat where every member was a public AI seat when it was sent. Rooms created with `revealAllianceChatAfterMatch` (announced at join) also publish alliance chat; DMs between other players are never published. Replay frames contain no message text. A supplied invalid or wrong-match credential is still rejected on public review routes.

A finished game replays from its recorded opening (`reviewOrigin`) and accepted orders, and must reproduce the exact saved final state and result. If it cannot, the review shows the saved results and **History unavailable** — never an approximate history. Rooms from earlier rule versions are not loaded. Public records use format version 1.

## Test evidence

The recorded eight-seat handplay match (`tests/fixtures/handplay-20260927.json.gz`, replayed under the current rules by `scripts/replay-handplay.js`; now ending at tick 553 by domination) is compared with the public replay at every tick. Its golden hashes are re-baselined whenever the rules change. Node tests cover DM privacy, result aggregates, the troop ledger, a broken hold, a withheld history without a recorded opening, draws, eliminated members, scope validation, repeat reads and SQLite restart. The browser suite (`tests/review-browser.py`, part of `python tests/browser.py`) checks the standings, all tabs, the replay controls, province inspection, event links, charts, phone layouts, the disclosed-message wire and inert hostile names, and the live match enters review after it finishes. These are automated and recorded opponents, not a human usability test.
