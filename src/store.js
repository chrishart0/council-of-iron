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
      CREATE TABLE IF NOT EXISTS results (game_id TEXT NOT NULL, profile_id TEXT NOT NULL,
        country TEXT NOT NULL, prestige REAL NOT NULL, eligible INTEGER NOT NULL,
        draw INTEGER NOT NULL, finished_at INTEGER NOT NULL, PRIMARY KEY(game_id,profile_id));`);
    if (!this.db.prepare('PRAGMA table_info(results)').all().some(c=>c.name==='scenario'))
      this.db.exec("ALTER TABLE results ADD COLUMN scenario TEXT NOT NULL DEFAULT 'classic-64'");
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
  load() { return this.db.prepare('SELECT snapshot FROM games').all().map(row => JSON.parse(row.snapshot)); }
  save(g) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR REPLACE INTO games VALUES (?,?)').run(g.id, JSON.stringify(g));
      if (g.outcome) for (const s of g.outcome.scores) {
        const p = g.players.find(p => p.id === s.country);
        this.db.prepare('INSERT OR IGNORE INTO results (game_id,profile_id,country,prestige,eligible,draw,finished_at,scenario) VALUES (?,?,?,?,?,?,?,?)').run(
          g.id, p.profileId, p.id, s.prestige, Number(g.eligible), Number(g.outcome.draw), Date.now(), g.scenario);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  standings(eligible = false, scenario = 'imperial-1910-v3') {
    return this.db.prepare(`WITH recent AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY finished_at DESC,game_id) AS n
      FROM results WHERE eligible=? AND scenario=? AND draw=0
        AND game_id IN (SELECT id FROM games WHERE json_extract(snapshot,'$.rules.economyShare')=0.6))
      SELECT p.id,p.name,AVG(r.prestige) AS prestige,COUNT(*) AS matches
      FROM recent r JOIN profiles p ON p.id=r.profile_id WHERE r.n<=20
      GROUP BY p.id ORDER BY prestige DESC`).all(Number(eligible),scenario).map(p => ({ ...p, provisional: p.matches < 10 }));
  }
  history(profileId) {
    return this.db.prepare('SELECT * FROM results WHERE profile_id=? ORDER BY finished_at DESC LIMIT 50').all(profileId);
  }
  close() { this.db.close(); }
}
