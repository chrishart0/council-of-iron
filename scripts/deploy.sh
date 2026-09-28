#!/usr/bin/env bash
# Deploy the live game: fast-forward the dedicated deploy worktree and restart its systemd user unit,
# but only when nobody is playing. See docs/OPERATIONS.md -> "Deploying the live server".
#
#   scripts/deploy.sh --check                # dry run: every check, no pull, no restart
#   scripts/deploy.sh                        # deploy origin/<deploy branch>
#   scripts/deploy.sh --ref origin/other     # deploy another ref (must fast-forward the deployed commit)
#   scripts/deploy.sh --force                # deploy even though rooms with players are live (ask the user first)
#   scripts/deploy.sh --allow-drop-running   # let this one restart drop live rooms the new version cannot load
#
# Environment: COUNCIL_DEPLOY_DIR (default ~/git/council-gameui), COUNCIL_UNIT (default council-of-iron-ui-v08),
# COUNCIL_URL (default https|http://127.0.0.1:$PORT from the unit), COUNCIL_HOST (default: host of the unit's
# first PUBLIC_ORIGIN).
set -euo pipefail

DEPLOY_DIR="${COUNCIL_DEPLOY_DIR:-$HOME/git/council-gameui}"
UNIT="${COUNCIL_UNIT:-council-of-iron-ui-v08}"
CHECK=0 FORCE=0 ALLOW_DROP=0 REF=""

die() { printf 'deploy: REFUSED: %s\n' "$*" >&2; exit 1; }
say() { printf 'deploy: %s\n' "$*"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    --allow-drop-running) ALLOW_DROP=1 ;;
    --ref) [ $# -ge 2 ] || die "--ref needs a value"; REF="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done
command -v node >/dev/null || die "node is not on PATH (needed to read JSON)"
command -v curl >/dev/null || die "curl is not installed"

# --- Repository checks -------------------------------------------------------------------------------
git -C "$DEPLOY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$DEPLOY_DIR is not a git worktree"
BRANCH="$(git -C "$DEPLOY_DIR" symbolic-ref --quiet --short HEAD)" || die "$DEPLOY_DIR has a detached HEAD"
REF="${REF:-origin/$BRANCH}"
say "deploy worktree $DEPLOY_DIR (branch $BRANCH), unit $UNIT, target $REF"
git -C "$DEPLOY_DIR" fetch --prune origin
DIRTY="$(git -C "$DEPLOY_DIR" status --porcelain --untracked-files=normal)"
[ -z "$DIRTY" ] || die "the deploy worktree has uncommitted changes (never edit it; commit on a branch elsewhere):
$DIRTY"
DEPLOYED="$(git -C "$DEPLOY_DIR" rev-parse HEAD)"
TARGET="$(git -C "$DEPLOY_DIR" rev-parse --verify --quiet "$REF^{commit}")" || die "unknown ref $REF (pushed?)"
if [ "$DEPLOYED" = "$TARGET" ]; then say "already deployed: $(git -C "$DEPLOY_DIR" log -1 --format='%h %s' "$TARGET")"; exit 0; fi
git -C "$DEPLOY_DIR" merge-base --is-ancestor "$DEPLOYED" "$TARGET" \
  || die "$REF ($(git -C "$DEPLOY_DIR" rev-parse --short "$TARGET")) is not a fast-forward of the deployed commit $(git -C "$DEPLOY_DIR" rev-parse --short "$DEPLOYED"). Rebase/merge it first."
say "commits to deploy:"
git -C "$DEPLOY_DIR" log --oneline "$DEPLOYED..$TARGET" | sed 's/^/    /'
map_id() { git -C "$DEPLOY_DIR" show "$1:public/imperial-map.json" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).id)}catch{console.log("?")}})'; }
OLD_MAP="$(map_id "$DEPLOYED")" NEW_MAP="$(map_id "$TARGET")"
[ "$OLD_MAP" = "$NEW_MAP" ] || say "NOTE: the map changes ($OLD_MAP -> $NEW_MAP): rooms on the old map cannot be loaded by the new version."
if ! git -C "$DEPLOY_DIR" diff --quiet "$DEPLOYED" "$TARGET" -- src/engine.js; then
  say "NOTE: src/engine.js changes: if RULES keys changed, rooms created before cannot be loaded by the new version."
fi

# --- Live server: who is playing? --------------------------------------------------------------------
UNIT_ENV="$(systemctl --user show -p Environment --value "$UNIT" 2>/dev/null || true)"
env_of() { printf '%s\n' "$UNIT_ENV" | tr ' ' '\n' | sed -n "s/^$1=//p" | head -n1; }
PORT="$(env_of PORT)"; ORIGIN="$(env_of PUBLIC_ORIGIN | cut -d, -f1)"
[ -n "$PORT" ] || PORT="${ORIGIN##*:}"
SCHEME="${ORIGIN%%://*}"; [ -n "$ORIGIN" ] || SCHEME=http
URL="${COUNCIL_URL:-$SCHEME://127.0.0.1:$PORT}"
HOST_HEADER="${COUNCIL_HOST:-${ORIGIN#*://}}"; HOST_HEADER="${HOST_HEADER:-127.0.0.1:$PORT}"
[ -n "$PORT" ] || die "cannot find PORT/PUBLIC_ORIGIN in the environment of $UNIT; set COUNCIL_URL and COUNCIL_HOST"
api() { curl -ksS --max-time 10 -H "Host: $HOST_HEADER" "$@"; }
if ! systemctl --user show -p RestartPreventExitStatus --value "$UNIT" 2>/dev/null | grep -qw 78; then
  say "WARNING: $UNIT lacks RestartPreventExitStatus=78: if the new version refuses to start (live rooms it cannot load), systemd will keep retrying it."
fi

# Rooms somebody may be playing: running, or a lobby with a human seat, and not abandoned (30 min idle).
LIVE_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const gs=JSON.parse(s).games;
  for(const g of gs){const humans=g.players.filter(p=>p.kind==="human").length;
    if(g.abandoned===true||!(g.status==="running"||(g.status==="lobby"&&humans>0)))continue;
    console.log(`${g.id}\t${g.status}\ttick ${g.tick}\t${humans} human(s)\t${g.players.map(p=>p.id+":"+p.kind).join(" ")}\t${JSON.stringify(g.name)}`)}})'
ACTIVE_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const g of JSON.parse(s).games)if(g.status!=="finished")console.log(g.id)})'
BEFORE=""
if [ "$(systemctl --user is-active "$UNIT" 2>/dev/null || true)" = active ]; then
  GAMES="$(api "$URL/api/games")" || { [ "$FORCE" = 1 ] || die "cannot read $URL/api/games (Host: $HOST_HEADER); use --force only if you know nobody is playing"; GAMES='{"games":[]}'; }
  LIVE="$(printf '%s' "$GAMES" | node -e "$LIVE_JS")" || die "unexpected /api/games response"
  BEFORE="$(printf '%s' "$GAMES" | node -e "$ACTIVE_JS")"
  if [ -n "$LIVE" ]; then
    printf 'deploy: live rooms with players:\n%s\n' "$(printf '%s\n' "$LIVE" | sed 's/^/    /')"
    [ "$FORCE" = 1 ] || die "rooms are in play; wait for them to finish (or be idle 30 min), or pass --force only if the user explicitly said so"
    say "--force: deploying anyway"
  else say "no live rooms with players"; fi
else
  say "WARNING: $UNIT is not active; skipping the live-room check (the server refuses to start over live rooms it cannot load)"
fi

if [ "$CHECK" = 1 ]; then say "--check: would fast-forward $(git -C "$DEPLOY_DIR" rev-parse --short "$DEPLOYED") -> $(git -C "$DEPLOY_DIR" rev-parse --short "$TARGET") and restart $UNIT"; exit 0; fi

# --- Deploy --------------------------------------------------------------------------------------------
if [ "$REF" = "origin/$BRANCH" ]; then git -C "$DEPLOY_DIR" pull --ff-only --quiet origin "$BRANCH"
else git -C "$DEPLOY_DIR" merge --ff-only --quiet "$TARGET"; fi
[ "$(git -C "$DEPLOY_DIR" rev-parse HEAD)" = "$TARGET" ] || die "the deploy worktree did not end at $TARGET"
say "deploy worktree now at $(git -C "$DEPLOY_DIR" log -1 --format='%h %s')"
if [ "$ALLOW_DROP" = 1 ]; then
  systemctl --user set-environment COUNCIL_ALLOW_DROP_RUNNING=1
  trap 'systemctl --user unset-environment COUNCIL_ALLOW_DROP_RUNNING' EXIT
  say "--allow-drop-running: this restart may drop live rooms the new version cannot load"
fi
systemctl --user restart "$UNIT"

# --- Verify ----------------------------------------------------------------------------------------------
rollback="to roll back: git -C $DEPLOY_DIR reset --hard $DEPLOYED && systemctl --user restart $UNIT"
fail() {
  printf 'deploy: FAILED after restart: %s\n' "$*" >&2
  journalctl --user -u "$UNIT" -n 30 --no-pager >&2 || true
  printf 'deploy: %s\n' "$rollback" >&2; exit 1
}
code=000
for _ in $(seq 1 30); do
  code="$(api -o /dev/null -w '%{http_code}' "$URL/" 2>/dev/null || true)"
  [ "$code" = 200 ] && break
  [ "$(systemctl --user is-active "$UNIT" 2>/dev/null || true)" = failed ] && break
  sleep 1
done
[ "$code" = 200 ] || fail "GET / returned $code"
STT="$(api -f "$URL/api/stt")" || fail "GET /api/stt failed"
say "GET / 200; /api/stt $STT"
GAMES="$(api -f "$URL/api/games")" || fail "GET /api/games failed"
AFTER="$(printf '%s' "$GAMES" | node -e "$ACTIVE_JS")" || fail "unexpected /api/games response"
MISSING="$(comm -23 <(printf '%s\n' "$BEFORE" | sed '/^$/d' | sort) <(printf '%s\n' "$AFTER" | sort))"
if [ -n "$MISSING" ]; then
  [ "$ALLOW_DROP" = 1 ] || fail "unfinished rooms disappeared: $(echo $MISSING)"
  say "WARNING: dropped unfinished rooms (snapshots kept in the database): $(echo $MISSING)"
fi
say "GET /api/games 200: $(printf '%s\n' "$AFTER" | sed '/^$/d' | wc -l) unfinished room(s) loaded; deployed $(git -C "$DEPLOY_DIR" rev-parse --short HEAD)"
