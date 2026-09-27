import { hash, sum } from './position.js';

/** Relative-strength estimate, not a calibrated win probability or Elo model. */
export function allianceValue(pos, memory, roster, coalition = null) {
  const s = pos.state, r = s.rules, now = s.tick, members = new Set(roster);
  if (members.size === s.players.length) return -Infinity; // Bots do not manufacture table-wide draws.
  const strength = ids => {
    const land = s.provinces.filter(p => ids.has(p.owner));
    return sum(land.map(p => 8 + p.troops * .3 + (r.distanceMovement ? p.development : 1) * 10))
      + sum(s.armies.filter(a => ids.has(a.country)).map(a => a.amount * .3));
  };
  const power = strength(members);
  const opponents = s.sides.map(t => strength(new Set(t.members.filter(id => !members.has(id))))).filter(x => x > 0);
  const probability = power * power / Math.max(1, power * power + sum(opponents.map(n => n*n)));
  const land = s.provinces.filter(p => members.has(p.owner)).length;
  const holdEnds = Object.values(s.dominance).map(t => t+r.hold);
  const finish = Math.min(r.duration, ...holdEnds, now + (land >= r.threshold ? r.notice+r.hold : r.maturity+120));
  const joining = coalition !== pos.me.side;
  const maturity = Math.max(0, Math.min(1, (finish-(joining ? now+r.notice : pos.me.joinedAt)) / Math.min(r.maturity, Math.max(1, finish))));
  const trust = roster.some(id => id !== pos.country && memory.relations[id]?.harmedAt > now-120) ? .8 : 1;
  return 100*s.players.length/members.size * maturity * probability * trust;
}
export function diplomacy(pos, memory, doctrine) {
  const { state: s, me, country } = pos, now = s.tick;
  const locked = id => s.departures.some(d => d.country === id) || s.proposals.some(q => q.status === 'pending' && q.roster.includes(id));
  const team = s.sides.find(t => t.id === me.side);
  const current = allianceValue(pos, memory, team.members, me.side);
  const acceptThreshold = current * (1.07 - (doctrine.diplomacy-1)*.1) + 3;
  // Receive formal offers promptly, but not at the expense of an immediate defense.
  for (const q of s.proposals.filter(q => q.status === 'open' && q.roster.includes(country) && !q.accepted.includes(country))) {
    if (q.roster.some(locked)) continue;
    const sameRoster = q.coalition ? s.sides.find(t => t.id === q.coalition)?.members.every(id => q.roster.includes(id))
      : q.roster.every(id => pos.players.get(id)?.side.startsWith('solo:'));
    if (!sameRoster) continue;
    const value = allianceValue(pos, memory, q.roster, q.coalition);
    const accept = value >= acceptThreshold;
    return { action: { type: accept ? 'accept' : 'decline', proposalId: q.id }, reason: accept ? 'Accept a coalition that improves our expected share' : 'Decline dilution, late membership or an all-player draw',
      response: { to: q.creator, text: accept ? 'Your terms serve our position. I have accepted the formal offer.' : 'I am declining these terms. The share, timing or strategic benefit is not right for us.' } };
  }
  if (now < memory.nextDiplomacyAt || locked(country)) return null;
  memory.nextDiplomacyAt = now + 40 + hash(`${memory.seed}:${now}:diplomacy`) % 21;
  if (now < 60) return null;
  // Loyalty has inertia. No last-minute re-formation to shed a weak partner.
  if (!me.side.startsWith('solo:') && now-me.joinedAt >= 300 && s.rules.duration-now > s.rules.maturity+s.rules.notice+90
      && s.dominance[me.side] === undefined && Object.keys(s.dominance).length === 0) {
    const solo = allianceValue(pos, memory, [country]);
    const ownLand = pos.owned.length, teamLand = team.provinces;
    if (teamLand && ownLand/teamLand > .8 && solo > current*1.4+15) {
      return { action: { type: 'leave' }, reason: 'Leave a long-standing alliance whose cost outweighs its support',
        response: { channel: 'alliance', text: 'Our position now calls for independence. I am giving the formal departure notice.' } };
    }
  }
  if (s.proposals.some(q => q.status === 'open' && q.creator === country)) return null;
  const candidates = s.players.filter(p => p.id !== country && p.eliminatedAt === null && p.side.startsWith('solo:') && !locked(p.id)
    && (memory.invited[p.id] || 0) <= now && !(memory.relations[p.id]?.harmedAt > now-120));
  const offers = candidates.map(p => {
    const roster = [...team.members, p.id], coalition = me.side.startsWith('solo:') ? null : me.side;
    return { p, value: allianceValue(pos, memory, roster, coalition) };
  }).filter(o => o.value > acceptThreshold+4).sort((a,b) => b.value-a.value || hash(`${memory.seed}:${a.p.id}`)-hash(`${memory.seed}:${b.p.id}`));
  if (!offers.length) return null;
  const candidate = offers[0].p;
  const names = ['The Iron Accord', 'The Common Front', 'The Meridian Pact', 'The Allied Council'];
  return { action: { type: 'propose', country: candidate.id, name: names[hash(country)%names.length] },
    reason: 'Seek a useful ally without dividing the prize unnecessarily',
    response: { to: candidate.id, text: 'We would be stronger together. A formal alliance offer is in your Council panel; the prize is shared.' } };
}

/** Explicit traditional-bot commands. Arbitrary text never becomes an instruction. */
export function readMessages(pos, memory) {
  const s = pos.state, now = s.tick;
  for (const e of s.events) {
    if (e.type !== 'message' || e.from === pos.country || e.channel !== 'dm' || e.to !== pos.country || e.id <= memory.cursor) continue;
    if (!e.text.startsWith('/')) continue;
    if ((memory.replied[e.from] || 0) > now) continue;
    memory.replied[e.from] = now + 45;
    const match = e.text.trim().match(/^\/(help|status|attack|defend)(?:\s+([a-z0-9-]{1,64}))?$/i);
    let text = 'Traditional bot commands: /help, /status, /attack PROVINCE_ID, /defend PROVINCE_ID. Use Council for formal alliances. I do not interpret free-form promises.';
    if (match?.[1].toLowerCase() === 'status') {
      text = `We hold ${pos.owned.length} provinces. ${pos.me.side.startsWith('solo:') ? 'We remain independent.' : 'Our alliance stands.'} Military plans remain private.`;
    } else if (match && ['attack','defend'].includes(match[1].toLowerCase())) {
      const id = match[2], target = pos.board.get(id);
      if (!pos.friendly(e.from)) text = 'Military requests are available to formal allies only. A promise in chat is not an alliance.';
      else if (!target) text = 'That province ID is not on this map. Use an ID from the map or /help.';
      else if (match[1].toLowerCase() === 'attack' ? pos.friendly(target.owner) : !pos.friendly(target.owner)) text = 'That request does not match the province’s current allegiance.';
      else {
        memory.request = { kind: match[1].toLowerCase(), target: id, from: e.from, expiresAt: now+120 };
        text = `I will consider ${pos.places.get(id).name} for the next two game minutes. Defense, travel time and troop availability may take priority; this is not a commitment.`;
      }
    }
    memory.replies.push({ to: e.from, text, expiresAt: now+90 });
  }
  memory.replies = memory.replies.filter(q => q.expiresAt > now).slice(-4);
}
