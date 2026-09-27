import { BOT_VERSION, DIFFICULTIES, PERSONALITIES, botSettings } from '../../public/bot-profiles.js';
import { position, forecast, hash } from './position.js';
import { military } from './military.js';
import { diplomacy, readMessages } from './diplomacy.js';

/** All memory belongs to ONE seat. JSON-only so restarting preserves its decisions. */
export function createBot(country, settings = {}, seed = 0) {
  const config = botSettings(settings);
  if (config.personality === 'mixed') config.personality = Object.keys(PERSONALITIES)[hash(`${seed}:${country}`)%Object.keys(PERSONALITIES).length];
  return { version: BOT_VERSION, country, config, seed: hash(String(seed)), cursor: 0,
    nextThinkAt: 1 + hash(`${seed}:${country}:start`)%5, nextDiplomacyAt: 60,
    nextChatAt: 0, focus: null, avoid: {}, relations: {}, transfers: [], invited: {}, replied: {}, replies: [], request: null };
}
/** Never mutates the observation/map. Private memory is deliberately explicit. */
export function decideBot(state, map, memory, { diplomacyEnabled = true } = {}) {
  if (state.you !== memory.country) throw new Error('Bot observation belongs to a different seat.');
  const me = state.players.find(p => p.id === memory.country);
  if (state.status !== 'running' || !me || me.eliminatedAt !== null) return null;
  const pos = position(state, map, memory.country), now = state.tick;
  for (const e of state.events.filter(e => e.id > memory.cursor)) {
    if (e.type === 'battle' && e.previousOwner === memory.country) for (const a of e.arrivals) if (!pos.friendly(a.country)) {
      (memory.relations[a.country] ||= {}).harmedAt = e.tick;
    }
    if (e.type === 'proposal_cancelled') {
      // An invitation cooldown already recorded at send time prevents offer spam.
      memory.nextDiplomacyAt = Math.max(memory.nextDiplomacyAt, now+10);
    }
  }
  readMessages(pos, memory);
  memory.cursor = state.cursor;
  // Drain inbox pages before deciding; a busy game must not silently drop diplomacy.
  if (state.hasMore || now < memory.nextThinkAt) return null;
  const skill = DIFFICULTIES[memory.config.difficulty], doctrine = PERSONALITIES[memory.config.personality];
  memory.nextThinkAt = now + skill.cadence;
  memory.transfers = memory.transfers.filter(t => t.until > now).slice(-24);
  for (const id of Object.keys(memory.avoid)) if (memory.avoid[id] <= now) delete memory.avoid[id];
  if (memory.request && (memory.request.expiresAt <= now || !pos.friendly(memory.request.from))) memory.request = null;
  const plan = military(pos, forecast(pos), skill, doctrine, memory);
  if (plan?.urgent) return plan;
  if (diplomacyEnabled) {
    const deal = diplomacy(pos, memory, doctrine);
    if (deal) return deal;
  }
  if (memory.replies.length && now >= Math.max(memory.nextChatAt, state.commandBudget.chatReadyAt)) {
    const reply = memory.replies.shift();
    return { action: { type: 'chat', channel: reply.channel || 'dm', ...(reply.to ? { to: reply.to } : {}), text: reply.text }, reason: 'Send a bounded diplomatic dispatch' };
  }
  return plan;
}
/** Record intentions only after normal adjudication accepts the proposed action. */
export function recordDecision(memory, decision, state, accepted = true) {
  if (!decision) return;
  const now = state.tick, action = decision.action;
  if (!accepted) { memory.nextThinkAt = now + DIFFICULTIES[memory.config.difficulty].cadence; return; }
  if (decision.focus) memory.focus = { id: decision.focus, until: now+90 };
  if (decision.avoid) memory.avoid[decision.avoid] = now+45;
  if (decision.transfer) memory.transfers.push({ from: action.from, to: action.to, until: now+1+(state.travelTimes?.[action.from]?.[action.to] ?? state.rules.travel)+20 });
  if (action.type === 'propose') memory.invited[action.country] = now+240;
  if (action.type === 'chat') memory.nextChatAt = now+45;
  if (decision.response && (decision.response.to !== memory.country)) {
    memory.replies.push({ ...decision.response, expiresAt: now+90 });
    memory.replies = memory.replies.slice(-4);
  }
}
