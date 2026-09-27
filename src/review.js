/** Build a finished-match report by replaying its accepted orders in an isolated engine.
 * Never export those orders, receipts, profile IDs, private messages or private offers.
 * The materialized public record is persisted: later patches need not rerun old rules.
 */
import { isDeepStrictEqual } from 'node:util';
import { act, createGame, displayName, economyThreshold, gameRules, join, requireRule, sides, start, tick } from './engine.js';

const clone = value => structuredClone(value);
const sum = values => values.reduce((n, v) => n + v, 0);
export function publicBoard(g) {
  return { provinces: clone(g.provinces), armies: clone(g.armies),
    players: g.players.map(p => ({ id: p.id, side: p.side, joinedAt: p.joinedAt, eliminatedAt: p.eliminatedAt })),
    sideNames: sides(g).map(s => ({ id: s.id, name: s.name })), dominance: { ...g.dominance },
    ...(gameRules(g).warRequired?{wars:[...g.wars],battles:clone(g.battles)}:{}) };
}
function freshGame(game, map) {
  if (game.reviewOrigin) return clone(game.reviewOrigin);
  // Legacy games predate an initial checkpoint. Verify reconstruction before use.
  const g = createGame({ id: game.id, name: game.name, hostId: game.hostId, speed: game.speed, eligible: game.eligible }, map);
  if (game.rules) g.rules = clone(game.rules);
  if (game.travelTimes) g.travelTimes = clone(game.travelTimes);
  if (game.positions) g.positions = clone(game.positions);
  for (const p of game.players) join(g, map, { ...p, country: p.id });
  start(g); delete g.reviewOrigin;
  return g;
}
function terminalProjection(g) {
  return { tick: g.tick, status: g.status, provinces: g.provinces, armies: g.armies,
    affiliations: g.players.map(p => [p.id, p.side, p.joinedAt, p.eliminatedAt]),
    sides: sides(g), dominance: g.dominance, outcome: g.outcome,
    ...(gameRules(g).warRequired?{wars:g.wars,battles:g.battles}:{}) };
}
function summary(game) {
  const players = game.players.map(p => ({ country: p.id, name: p.name, displayName: displayName(p), leaderName:p.leaderName, kind: p.kind,
    model: p.model, persona: p.persona, visibility: p.visibility || 'private', side: p.side, eliminatedAt: p.eliminatedAt,
    land: game.provinces.filter(v => v.owner === p.id).length,
    economy: sum(game.provinces.filter(v => v.owner === p.id).map(v => v.development)),
    troops: sum(game.provinces.filter(v => v.owner === p.id).map(v => v.troops)) + sum(game.armies.filter(a => a.country === p.id).map(a => a.amount)),
    ...game.outcome.scores.find(s => s.country === p.id) }));
  const alliances = sides(game).map(s => ({ ...s, won: s.id === game.outcome.winningSide,
    payout: sum(players.filter(p => s.members.includes(p.country)).map(p => p.payout)),
    prestige: sum(players.filter(p => s.members.includes(p.country)).map(p => p.prestige)) }));
  return { id: game.id, name: game.name, scenario: game.scenario, eligible: game.eligible,
    duration: game.tick, rules: clone(gameRules(game)), outcome: clone(game.outcome), players, alliances,
    maximumPrize: 100 * game.players.length,
    unawardedPrize: Math.max(0, 100 * game.players.length - sum(players.map(p => p.payout))),
    allianceScoreDefinition: 'Sum of final roster members’ individual match Prestige. Not a second reward or a separate rating.',
    privacy: 'After completion, world dispatches from public AI agents, direct messages between public AI agents, and chat within fully public AI alliances are shown. Other messages, unexecuted orders and private offers stay hidden.' };
}
export function unavailableReview(game, reason) {
  return { version: 1, report: { ...summary(game), historyAvailable: false, historyError: reason }, replay: null };
}
export function buildReview(game, map) {
  requireRule(game.status === 'finished' && game.outcome, 'After-action review is available only when the match is finished.', 409);
  const report = { ...summary(game), historyAvailable: true, series: [], events: [], messages: [], battles: [], tenures: [],
    totals: { battles: 0, casualties: 0, interned: 0, recruited: 0, invested: 0, upgrades: 0 } };
  const g = freshGame(game, map), rules = gameRules(g), ids = g.players.map(p => p.id);
  const metrics = new Map(ids.map(id => [id, { country: id, recruited: 0, invested: 0, upgrades: 0,
    captures: 0, provincesLost: 0, battles: 0, peakLand: 0, peakTroops: 0 }]));
  const replay = { version: 1, duration: game.tick, scenario: report.scenario, rules: clone(rules), map: clone(map), frames: [] };
  let previousBoard = null, eventIndex = g.events.length, actionIndex = 0;
  const tenures = new Map(ids.map(id => [id, { country: id, side: g.players.find(p => p.id === id).side, start: 0 }]));
  function record() {
    const board = publicBoard(g), patch = { tick: g.tick };
    patch.provinces = board.provinces.filter((p, i) => !previousBoard || !isDeepStrictEqual(p, previousBoard.provinces[i]));
    if (!patch.provinces.length) delete patch.provinces;
    for (const key of ['armies', 'players', 'dominance', 'sideNames', 'wars', 'battles'])
      if (!previousBoard || !isDeepStrictEqual(board[key], previousBoard[key])) patch[key] = board[key];
    if (Object.keys(patch).length > 1 || !replay.frames.length) replay.frames.push(patch);
    previousBoard = board;
    const sample = { tick: g.tick, countries: [] };
    for (const id of ids) {
      const land = g.provinces.filter(p => p.owner === id), m = metrics.get(id);
      const troops = sum(land.map(p => p.troops)) + sum(g.armies.filter(a => a.country === id).map(a => a.amount));
      m.peakLand = Math.max(m.peakLand, land.length); m.peakTroops = Math.max(m.peakTroops, troops);
      sample.countries.push({ country: id, land: land.length, troops,
        production: sum(land.map(p => p.development)) * 60 / rules.recruit,
        recruited: m.recruited, invested: m.invested });
      const current = tenures.get(id), side = g.players.find(p => p.id === id).side;
      if (side !== current.side) { report.tenures.push({ ...current, end: g.tick }); tenures.set(id, { country: id, side, start: g.tick }); }
    }
    if (g.tick % 10 === 0 || g.status === 'finished') report.series.push(sample);
  }
  function addEvent(e) { report.events.push(e); }
  for(const e of g.events)if(e.type==='message' && e.archiveEligible===true){
    report.messages.push({id:e.id,tick:e.tick,from:e.from,to:e.to,side:e.side,channel:e.channel,text:e.text,leaderName:e.leaderName});
    addEvent({tick:e.tick,type:'dispatch',from:e.from,channel:e.channel});
  }
  record();
  while (g.status === 'running' && g.tick < game.tick) {
    while (game.actionLog[actionIndex]?.tick === g.tick) {
      const a = game.actionLog[actionIndex++]; act(g, map, a.country, a.action, a.opId);
    }
    const beforeDominance = { ...g.dominance }, affiliations = new Map(g.players.map(p => [p.id, p.side])), beforeNext = new Map(g.provinces.map(p => [p.id, p.nextRecruit]));
    tick(g);
    const events = g.events.slice(eventIndex); eventIndex = g.events.length;
    const captured = new Set(events.filter(e => e.type === 'battle' && e.owner !== e.previousOwner).map(e => e.province));
    for (const p of g.provinces) if (p.owner && !captured.has(p.id) && beforeNext.get(p.id) !== null && beforeNext.get(p.id) <= g.tick && p.nextRecruit === g.tick + rules.recruit) {
      const born = p.development;
      metrics.get(p.owner).recruited += born; report.totals.recruited += born;
    }
    for (const e of events) {
      // Explicit allowlist: new engine events are NOT automatically made public here.
      if(e.type==='message' && e.archiveEligible===true) {
        report.messages.push({id:e.id,tick:e.tick,from:e.from,to:e.to,side:e.side,channel:e.channel,text:e.text,leaderName:e.leaderName});
        addEvent({tick:e.tick,type:'dispatch',from:e.from,channel:e.channel});
        continue;
      }
      if (e.recipients) continue;
      if (e.type === 'battle') {
        const casualties = e.casualties ?? (e.before + (e.defenderRecruited||0) + sum(e.arrivals.map(a => a.amount)) - e.troops - (e.withdrawn||0) - (e.defenderRouted||0));
        const battle = { tick: e.tick, type: e.type, province: e.province, previousOwner: e.previousOwner,
          owner: e.owner, before: e.before, troops: e.troops, arrivals: clone(e.arrivals), casualties,
          duration:e.duration||0,industryLost:e.industryLost||0 };
        report.battles.push(battle); report.totals.battles++; report.totals.casualties += casualties;
        const participants = new Set(e.arrivals.filter(a => a.amount > 0).map(a => a.country));
        if (e.previousOwner && e.before > 0) participants.add(e.previousOwner);
        for (const id of participants) metrics.get(id).battles++;
        if (e.owner !== e.previousOwner) {
          if (e.owner) metrics.get(e.owner).captures++;
          if (e.previousOwner) metrics.get(e.previousOwner).provincesLost++;
          addEvent({ tick: e.tick, type: 'capture', province: e.province, owner: e.owner, previousOwner: e.previousOwner });
        }
      } else if (e.type === 'development_started') {
        metrics.get(e.country).invested += e.cost; report.totals.invested += e.cost;
        addEvent({ tick: e.tick, type: e.type, country: e.country, province: e.province, cost: e.cost, level: e.level });
      } else if (e.type === 'development_completed') {
        metrics.get(e.country).upgrades++; report.totals.upgrades++;
        addEvent({ tick: e.tick, type: e.type, country: e.country, province: e.province, level: e.level });
      } else if (e.type === 'industry_damaged') {
        addEvent({tick:e.tick,type:e.type,province:e.province,owner:e.owner,level:e.level});
      } else if (e.type === 'alliance_activated') {
        addEvent({ tick: e.tick, type: e.type, side: e.side, name: e.name, roster: [...e.roster] });
      } else if (e.type === 'coalition_dissolved') {
        addEvent({ tick: e.tick, type: e.type, side: e.side });
      } else if (e.type === 'war_declared' || e.type === 'peace_accepted') {
        addEvent({ tick: e.tick, type: e.type, from: e.from, to: e.to,
          fromRoster: [...e.fromRoster], toRoster: [...e.toRoster] });
      } else if (e.type === 'departed') {
        addEvent({ tick: e.tick, type: e.type, country: e.country, side: e.side, formerSide: e.formerSide });
      } else if (e.type === 'dominance') {
        addEvent({ tick: e.tick, type: e.type, side: e.side, winsAt: e.winsAt });
      } else if (e.type === 'eliminated') {
        addEvent({ tick: e.tick, type: e.type, country: e.country });
      } else if (e.type === 'army_recalled') {
        addEvent({ tick: e.tick, type: e.type, country: e.country, to: e.to, amount: e.amount, arrivesAt: e.arrivesAt,
          ...(e.reason?{reason:e.reason}:{}) });
      } else if (e.type === 'army_interned') {
        report.totals.interned += e.amount;
        addEvent({ tick: e.tick, type: e.type, country: e.country, province: e.province, amount: e.amount });
      }
    }
    for (const [side, since] of Object.entries(beforeDominance)) if (g.dominance[side] !== since) {
      const team = sides(g).find(s => s.id === side);
      addEvent({ tick: g.tick, type: 'dominance_broken', side, provinces: team?.provinces ?? 0, economy: team?.economy ?? 0,
        threshold: economyThreshold(g),
        reason: g.players.some(p => (affiliations.get(p.id) === side) !== (p.side === side))
          ? 'Membership changed; the hold restarts.' : 'Economy fell below 60%.' });
    }
    record();
  }
  requireRule(actionIndex === game.actionLog.length && isDeepStrictEqual(JSON.parse(JSON.stringify(terminalProjection(g))), JSON.parse(JSON.stringify(terminalProjection(game)))),
    'This older match cannot be reproduced exactly by the current rules. Final scores remain available; replay is withheld.', 409);
  report.metrics = [...metrics.values()];
  report.tenures.push(...[...tenures.values()].map(t => ({ ...t, end: game.tick })));
  report.sideNames = [...new Map([...g.coalitions.map(c => [c.id, c.name]), ...ids.map(id => [`solo:${id}:0`, id])])]
    .map(([id, name]) => ({ id, name }));
  if(rules.warRequired)report.totals.casualties=g.economy.casualties||0;
  report.totals.initialTroops = sum(replay.frames[0].provinces.map(p => p.troops)) + sum((replay.frames[0].armies || []).map(a => a.amount));
  report.totals.remainingTroops = sum(g.provinces.map(p => p.troops)) + sum(g.armies.map(a => a.amount));
  requireRule(report.totals.initialTroops + report.totals.recruited - report.totals.invested - report.totals.casualties - report.totals.interned === report.totals.remainingTroops,
    'The review troop ledger did not reconcile; replay is withheld.', 409);
  report.events.sort((a, b) => a.tick - b.tick);
  report.events.push({ tick: game.tick, type: 'finished', winningSide: game.outcome.winningSide, reason: game.outcome.reason });
  return { version: 1, report, replay };
}
