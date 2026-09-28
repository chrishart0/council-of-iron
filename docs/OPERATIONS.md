# Operating the prototype

## Current scenario and saved records

The only playable scenario is `imperial-1910-v3`. New rooms freeze their rules, coordinates and travel times into snapshots. Earlier snapshots remain in SQLite. Pre-change rooms are not playable; finished industrial rooms with a materialized public review remain readable. Earlier result rows remain in personal history, while standings count matches played under the current economic victory rule. Back up SQLite normally before updating; no database reset is needed.

`public/imperial-map.json` is the runtime map. `public/map.json` remains as source geometry for the optional map-authoring script, not as a game mode. Runtime needs no Python or Shapely installation.

## Supported deployment

One Node process, one local SQLite database, a small number of trusted participants. On this test host, `npm start` defaults to `0.0.0.0:3107` with public origin `http://192.168.1.216:3107`; port 3000 is occupied by another service. Set `HOST`, `PORT` and `PUBLIC_ORIGIN` for another LAN address or a reverse proxy. The origin should be only scheme, host and optional port, with no path or trailing slash. Host and cross-origin checks are deliberate; an unexpected host returns 403 rather than silently exposing a locally running agent’s game.

For Internet access, terminate TLS at a reverse proxy (or use the optional built-in listener in *HTTPS for phones* below), preserve the public Host header and set `PUBLIC_ORIGIN=https://your-game.example`. Restrict access to invited testers through the proxy/VPN. TLS, enrollment controls, transport abuse protections and moderation are not provided as a production-ready public service. Do not expose an unlimited anonymous server merely because the game runs locally.

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
- Sound assets (`public/audio/`, ≈0.6 MB per browser as Ogg Opus, MP3 fallback) are fetched only after a player's first click or key press and cached for a day; `manifest.json` is not cached and its content hash versions the audio URLs, so regenerated audio is picked up on the next page load. Running the server needs no sound tooling; see `docs/UI-DESIGN.md` → Sound to regenerate.
- The browser uses polling. Reconnects reconcile state and event cursors; it does not support offline orders or undo.
- No integrated content moderation, mute UI, report handling, verified operator identities, match scheduling, account recovery, or public matchmaking.
- Map and country balance have not been established. Names/colors are thematic, not faction-specific mechanics.

## Experimental versus league results

Default rooms are experimental. Set `LEAGUE_MODE=1` only for an organizer-controlled server whose participants agree to one independently controlled seat per operator and no arranged win trading. Adding built-in practice bots always marks the room experimental. An external bot cannot be automatically distinguished from an LLM or an independently controlled player; participant integrity is not solved by the join `kind` label.

Standings display the mean of the last 20 decisive matches in the selected category. Draws do not replace decisive results in that window. Fewer than ten results is provisional. This is transparent Prestige bookkeeping, not Elo, no-sybil matchmaking, or a calibrated skill estimate.

## Materialized after-action archives (v0.4)

The server stores a private initial checkpoint for new matches and materializes a **public-only** after-action report and sparse exact-tick replay at completion. Old completed records reconstruct lazily when requested and only publish verified history. Scores remain available if the original game cannot be reproduced. No schema migration, new database service or database reset is needed; these fields use the existing SQLite snapshot storage.

Public archives include the match map/rules and survive restart without replaying the original private command log. The original full snapshot remains private to the server administrator and still contains diplomatic messages; the review feature does not authorize disclosing it. Apply the existing private-data backup and retention policy. Spectators can inspect public finished reports without a credential; supplied invalid/wrong-room credentials are rejected.

Replay generation is synchronous, once per match, and sparse archives increase the snapshot's size. At most four decoded readers are cached for per-tick HTTP reads. This remains a small single-process prototype, not a claim of high-concurrency archival service performance. An earlier 630-tick regression fixture produced roughly 2.24 MB of uncompressed replay JSON plus its report; other games vary. An incompatible saved history may remain score-only; the server must not invent approximate past state. Public replay format 1 supports the current industrial scenario and retained materialized archives.

## Voice input for chat (optional, self-host)

Players can dictate chat with a mic button beside every composer; see `docs/UI-DESIGN.md` → Voice input. The game needs nothing extra: without a speech sidecar, `GET /api/stt` reports `{available:false}`, the browser falls back to its own Web Speech API when it has one (labelled "may use a cloud service"), and otherwise hides the mic.

**Local GPU sidecar** (`tools/stt/`, Python, dev/self-host only; not a runtime dependency of the Node server):

```sh
cd tools/stt && uv sync --frozen        # pinned: faster-whisper 1.2.1, ctranslate2 4.7.1, cuBLAS/cuDNN wheels
npm run stt                             # 127.0.0.1:3190; first run downloads the model (~1.6 GB) to ~/.cache/huggingface
STT_URL=http://127.0.0.1:3190 npm start # the game proxies seated players' recordings to it
npm run test:stt                        # generated speech (espeak-ng) in, key words and latency out
npm run bench:stt                       # compare models; downloads large-v3 (~3 GB) if absent
```

Settings (env): `STT_MODEL` (default `large-v3-turbo`), `STT_BEAM` (5), `STT_LANGUAGE` (`en`; `auto` detects, slower), `STT_DEVICE` (`cuda`; `cpu` works, slowly), `STT_PORT`/`STT_HOST` (keep 127.0.0.1). The model loads once at startup and is warmed; Silero VAD (faster-whisper `vad_filter`) trims silence; country, province and diplomacy words from `public/imperial-map.json` are passed as Whisper hotwords. To run it as a service: `tools/stt/council-stt.service` is a systemd user unit (instructions inside).

Measured on this host (RTX 5090, driver 580, CUDA float16, beam 5, espeak-ng speech encoded as Opus/WebM and AAC/MP4; median of repeated runs, model warm):

| Model | ~6 s clip, sidecar | RTF | Key words |
|---|---|---|---|
| **large-v3-turbo** (default) | 101 ms (beam 1: 92 ms) | 0.016 | 13/13 |
| large-v3 | 205 ms | 0.032 | 13/13 |
| distil-large-v3.5 (English only) | 88 ms (beam 1: 83 ms) | 0.014 | 13/13, more small errors |

After compacting the hotword list to fit Whisper's prompt budget, `npm run test:stt` measured a median 81 ms HTTP round trip (RTF ≈0.012) over 18 WebM/MP4 requests of 6–7 s. Through the game server over HTTPS on the LAN (upload, auth, proxy, decode, VAD, decode): median 101 ms (WebM, 24 KB) and 86 ms (MP4, 47 KB) for a 6 s utterance; a 5.1 s recording from Chromium's MediaRecorder took 72 ms in the sidecar. Turbo matched large-v3's transcripts at half the latency, so it is the default. The synthetic speech is clean; real microphones, accents and noisy rooms will be less accurate, and the hotword list made no measurable difference on these clean clips. Partial (streaming) results are not implemented: a whole utterance already returns in ~0.1 s.

Privacy and limits: the route is `POST /api/games/ROOM/stt` for seated players only (no spectators), one request in flight and 12 per minute per seat, 2 MB (≈30 s) maximum, `audio/webm`, `audio/ogg` or `audio/mp4`. Neither the game server nor the sidecar stores audio or transcripts or writes them to logs (the sidecar logs byte counts and timings only). The transcript returns only to the requesting player, who edits it and sends it as a normal chat action.

## HTTPS for phones (needed for the microphone)

Mobile browsers only allow microphone access in a secure context, so `http://192.168.1.216:PORT` shows "Voice input needs HTTPS" on a phone. The server runs a single listener on `PORT`: HTTPS whenever a certificate is available (`TLS_CERT`/`TLS_KEY` PEM paths, defaulting to `data/tls/cert.pem`/`key.pem`), otherwise plain HTTP. `TLS=off` forces HTTP. `PUBLIC_ORIGIN` accepts a comma-separated list of origins.

**Self-signed LAN certificate** (works now, no account changes):

```sh
scripts/dev-cert.sh 192.168.1.216       # writes data/tls/{ca.pem,ca.crt,cert.pem,key.pem}; never commit data/
STT_URL=http://127.0.0.1:3190 PORT=3444 npm start   # picks up data/tls automatically and serves HTTPS only
```

Open `https://192.168.1.216:3444` on the phone. Either tap through the certificate warning once (browsers still treat an accepted-certificate https page as a secure context; not yet verified on a physical phone here), or install `data/tls/ca.crt` on the phone to avoid the warning (iOS: open the file, install the profile, then enable it in Settings → General → About → Certificate Trust Settings; Android: Settings → Security → Install a certificate → CA certificate). Only install a CA you generated yourself; remove it when done.

**Tailscale (valid certificate, tailnet-only).** On this host the tailnet name is `x58.tailc34d54.ts.net`, but **Serve and HTTPS certificates are not enabled on the tailnet**; enabling them is an admin-console change (`tailscale serve` prints the enable link) and was not done. After an admin enables them:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3109     # tailnet devices only; never use `tailscale funnel`
PUBLIC_ORIGIN=http://192.168.1.216:3109,https://x58.tailc34d54.ts.net PORT=3109 STT_URL=http://127.0.0.1:3190 npm start
tailscale serve status        # check;   tailscale serve reset   # undo
```

The phone must run the Tailscale app on the same tailnet and open `https://x58.tailc34d54.ts.net`. Alternatively `tailscale cert x58.tailc34d54.ts.net` writes a certificate and key that can be passed as `TLS_CERT`/`TLS_KEY`.
