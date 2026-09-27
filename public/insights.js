/** Read-only forecasts from the same visible state used by humans and agents.
 * No future opponents' orders, secret bonuses, or gameplay decisions here.
 */
export function developmentForecast(state, provinceId) {
  const p = state.provinces.find(p => p.id === provinceId), r = state.rules;
  if (!p || !p.owner || p.development >= r.maxDevelopment) return null;
  const level = p.development, queued = state.commandBudget?.reserved.find(o => o.type === 'develop' && o.from === p.id);
  const cost = r.developmentCosts[level];
  const completesAt = p.developing?.completesAt ?? (queued?.executeAt ?? state.tick + 1) + r.developmentTicks[level];
  // Completion precedes recruitment on a tick; an already-due recruitment counts.
  const firstExtraAt = p.nextRecruit === null ? null
    : p.nextRecruit + Math.max(0, Math.ceil((completesAt - p.nextRecruit) / r.recruit)) * r.recruit;
  const additionalRecruits = firstExtraAt === null || firstExtraAt > r.duration ? 0
    : 1 + Math.floor((r.duration - firstExtraAt) / r.recruit);
  const paybackAt = firstExtraAt === null ? null : firstExtraAt + (cost - 1) * r.recruit;
  return { province: p.id, level: level + 1, cost, completesAt, firstExtraAt, paybackAt,
    secondsToPayback: paybackAt === null ? null : Math.max(0, paybackAt - state.tick),
    additionalRecruits, netBeforeDeadline: additionalRecruits - cost,
    paysBackBeforeDeadline: paybackAt !== null && paybackAt <= r.duration,
    alreadyInvested: Boolean(p.developing), queued: Boolean(queued),
    assumption: 'Only this upgrade; uninterrupted ownership and production until the deadline. Earlier victory or capture reduces the return.' };
}
export function coalitionForecast(state, roster, coalition = null, activateAt = state.tick + state.rules.notice) {
  const ids = [...new Set(roster)], pool = state.players.length * 100;
  const land = state.provinces.filter(p => ids.includes(p.owner)).length;
  const economy = state.provinces.filter(p => ids.includes(p.owner)).reduce((n, p) => n + p.development, 0);
  const totalEconomy = state.provinces.filter(p => p.owner).reduce((n, p) => n + p.development, 0);
  const threshold = Math.ceil(totalEconomy * state.rules.economyShare);
  const draw = ids.length === state.players.length;
  const divisor = Math.max(1, Math.min(state.rules.maturity, activateAt));
  const strengths = ids.map(id => state.provinces.filter(p => p.owner === id).reduce((n, p) => n + p.development, 0));
  const weights = strengths.map(value => value ** (state.rules.strengthExponent ?? .75));
  const weightTotal = weights.reduce((n, value) => n + value, 0);
  return { roster: ids, land, economy, totalEconomy, threshold, remaining: Math.max(0, threshold - economy),
    wouldDraw: draw, wouldStartHold: !draw && economy >= threshold, activateAt,
    members: ids.map((id, index) => {
      const p = state.players.find(p => p.id === id);
      const keepsMaturity = Boolean(coalition && p?.side === coalition);
      const maturity = keepsMaturity ? Math.max(0, Math.min(1, ((p.eliminatedAt ?? activateAt) - p.joinedAt) / divisor)) : 0;
      const victoryShare = weightTotal ? weights[index] / weightTotal : 0;
      const maximumShare = pool * victoryShare;
      return { country: id, keepsMaturity, maturityAtActivation: maturity, victoryShare, strengthIndustry: strengths[index], maximumShare,
        prestigeAtActivation: draw ? 0 : maximumShare * maturity - 100,
        fullMaturityPrestige: draw ? 0 : maximumShare - 100 };
    }),
    assumption: 'Current completed industry and ownership held until activation. Shares use each member’s industry^0.75; captures, development, tenure, and roster changes can change the result.' };
}
export function operationalInsights(state) {
  if (!state.you) return { developments: [], routeReserves: [], admissions: [] };
  const owned = state.provinces.filter(p => p.owner === state.you);
  return {
    developments: owned.map(p => developmentForecast(state, p.id)).filter(Boolean),
    routeReserves: owned.filter(p => p.route).map(p => ({ province: p.id, to: p.route,
      available: Math.max(0, p.troops - 1 - (state.commandBudget?.reserved || [])
        .filter(o => o.from === p.id && ['move', 'develop'].includes(o.type)).reduce((n, o) => n + o.amount, 0)),
      rule: 'Local recruits only. Existing garrisons and arriving reinforcements do not follow this arrow.' })),
    admissions: state.proposals.filter(q => q.roster.includes(state.you)).map(q => ({ proposalId: q.id,
      ...coalitionForecast(state, q.roster, q.coalition, q.activateAt ?? state.tick + state.rules.notice) }))
  };
}
