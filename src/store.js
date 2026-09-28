import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
/** Single-process SQLite persistence. No credentials are included in game snapshots. */
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL, game_id TEXT);
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      DROP TABLE IF EXISTS results;
      CREATE TABLE IF NOT EXISTS outcomes (game_id TEXT NOT NULL, profile_id TEXT NOT NULL, country TEXT NOT NULL,
        kind TEXT NOT NULL, result TEXT NOT NULL, industry INTEGER NOT NULL, finished_at INTEGER NOT NULL,
        PRIMARY KEY(game_id,profile_id));
      CREATE TABLE IF NOT EXISTS room_activity (game_id TEXT PRIMARY KEY, active_at INTEGER, seen_at INTEGER, dropped_at INTEGER);`);
  }
  credential(profileId, gameId = null) {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO credentials VALUES (?,?,?)').run(hash(token), profileId, gameId);
    return token;
  }
  register(name) {
    const id = randomUUID(); this.db.prepare('INSERT INTO profiles VALUES (?,?)').run(id, name);
    return { id, name, token: this.credential(id) };
  }
  authenticate(token) {
    if (!token) return null;
    return this.db.prepare(`SELECT p.id,p.name,c.game_id AS gameId FROM credentials c
      JOIN profiles p ON p.id=c.profile_id WHERE c.hash=?`).get(hash(token)) || null;
  }
  /** Every stored room; an unreadable snapshot is skipped (logged), never fatal. */
  load() {
    return this.db.prepare('SELECT id, snapshot FROM games').all().flatMap(row => {
      try { return [JSON.parse(row.snapshot)]; }
      catch { console.log(`Skipped unreadable stored room ${row.id}.`); return []; }
    });
  }
  save(g) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR REPLACE INTO games VALUES (?,?)').run(g.id, JSON.stringify(g));
      if (g.outcome) for (const s of g.outcome.scores) {
        const p = g.players.find(p => p.id === s.country);
        this.db.prepare('INSERT OR IGNORE INTO outcomes VALUES (?,?,?,?,?,?,?)').run(
          g.id, p.profileId, p.id, p.kind, s.result, s.industry, Date.now());
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Wall-clock bookkeeping kept outside the snapshot (the engine never reads a clock). `active_at`: last
   * request from a seated human or agent (or room creation). `seen_at`: last time a running server held
   * the room, so server downtime never counts as idleness. `dropped_at`: an operator allowed startup to
   * drop this live room (COUNCIL_ALLOW_DROP_RUNNING=1); it no longer blocks startup. */
  activity() {
    return new Map(this.db.prepare('SELECT game_id, active_at, seen_at, dropped_at FROM room_activity').all()
      .map(r => [r.game_id, { activeAt: r.active_at, seenAt: r.seen_at, droppedAt: r.dropped_at }]));
  }
  touch(gameId, at) {
    this.db.prepare(`INSERT INTO room_activity (game_id, active_at, seen_at) VALUES (?,?,?)
      ON CONFLICT(game_id) DO UPDATE SET active_at=excluded.active_at, seen_at=excluded.seen_at, dropped_at=NULL`).run(gameId, at, at);
  }
  seen(gameIds, at) {
    const update = this.db.prepare('UPDATE room_activity SET seen_at=? WHERE game_id=?');
    for (const id of gameIds) update.run(at, id);
  }
  markDropped(gameId, at) {
    this.db.prepare(`INSERT INTO room_activity (game_id, dropped_at) VALUES (?,?)
      ON CONFLICT(game_id) DO UPDATE SET dropped_at=excluded.dropped_at`).run(gameId, at);
  }
  /** Wins, draws and losses of every human and agent profile across finished matches. */
  standings() {
    return this.db.prepare(`SELECT p.id, p.name, SUM(o.result='win') AS wins, SUM(o.result='draw') AS draws,
      SUM(o.result='loss') AS losses, COUNT(*) AS matches FROM outcomes o JOIN profiles p ON p.id=o.profile_id
      WHERE o.kind<>'bot' GROUP BY p.id ORDER BY wins DESC, matches ASC, p.name`).all();
  }
  close() { this.db.close(); }
}
