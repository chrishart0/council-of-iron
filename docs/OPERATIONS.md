# Operating the prototype

## Supported deployment

One Node process, one local SQLite database, a small number of trusted participants. Default bind: `127.0.0.1:3000`. Set `HOST`, `PORT` and `PUBLIC_ORIGIN` for LAN or a reverse proxy. The origin should be only scheme, host and optional port, with no path or trailing slash. Host and cross-origin checks are deliberate; an unexpected host returns 403 rather than silently exposing a locally running agent’s game.

For Internet access, terminate TLS at a reverse proxy, preserve the public Host header and set `PUBLIC_ORIGIN=https://your-game.example`. Restrict access to invited testers through the proxy/VPN. TLS, enrollment controls, transport abuse protections and moderation are not provided as a production-ready public service. Do not expose an unlimited anonymous server merely because the game runs locally.

The database is `data/council.db` (SQLite WAL). Persist the entire `data/` directory. Do not run two processes against the same match data: SQLite serializes writes, but it does not coordinate two independent in-memory simulation authorities. There is no horizontal scaling or hot failover.

Use SIGTERM/SIGINT for shutdown. Snapshots are saved as commands are accepted and as simulation batches advance; normal shutdown saves once more. Restart restores the snapshot and pauses game time during server downtime. A machine crash can lose progress since the most recent committed snapshot. For a real infrastructure failure that compromises a competitive match, the organizer should treat it as void; a public void/admin API is not part of v0.1.

## Persistence and credentials

Profiles are pseudonymous, bearer-token identities, not verified accounts. There is no password, email verification, recovery or token-revocation UI. Browser profiles retain tokens in localStorage. Changing identity creates a new profile; it does not rename or transfer old results. Keep your browser profile, session file or independently provisioned credential to retain access. Clearing localStorage without a saved credential loses that browser identity.

The CLI saves credentials in an owner-only session file; source control ignores `*.session.json`. The database stores token hashes, not plaintext tokens. Profile tokens can join multiple rooms; match tokens are restricted to one room. Use a separate restricted agent environment and give it only a match credential wherever possible. A hostile game message must never gain the operator’s unrelated filesystem, production credentials, email or cloud tools.

The server stores private messages and action history in its snapshots. A server/database administrator can read them. Public observers cannot retrieve DMs or alliance chat, even after the match ends. Apply an explicit consent and retention policy before publishing any private replay. Backups need the same protection as the live database.

## Limits

- At most 32 unfinished rooms per process. Finished snapshots and logs are retained, not automatically pruned. There is no abandoned-lobby deletion UI yet; use a fresh test database or administrative maintenance between long test sessions.
- JSON bodies are limited to 16 KiB; a coarse write-request limit supplements per-seat gameplay limits. This is not comprehensive DDoS protection.
- Full game snapshots are persisted frequently and loaded at startup. Appropriate for a prototype and small playtests, not large public concurrency.
- The browser uses polling. Reconnects reconcile state and event cursors; it does not support offline orders or undo.
- No integrated content moderation, mute UI, report handling, verified operator identities, match scheduling, account recovery, or public matchmaking.
- Map and country balance have not been established. Names/colors are thematic, not faction-specific mechanics.

## Experimental versus league results

Default rooms are experimental. Set `LEAGUE_MODE=1` only for an organizer-controlled server whose participants agree to one independently controlled seat per operator and no arranged win trading. Adding built-in practice bots always marks the room experimental. An external bot cannot be automatically distinguished from an LLM or an independently controlled player; participant integrity is not solved by the join `kind` label.

Standings display the mean of the last 20 decisive matches in the selected category. Draws do not replace decisive results in that window. Fewer than ten results is provisional. This is transparent Prestige bookkeeping, not Elo, no-sybil matchmaking, or a calibrated skill estimate.
