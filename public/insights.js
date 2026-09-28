/** Read-only forecasts from the same visible state used by humans and agents.
 * No future opponents' orders, secret bonuses, or gameplay decisions here.
 */
export function developmentForecast(state, provinceId) {
  const p = state.provinces.find(p => p.id === provinceId), r = state.rules;
  if (!p || !p.owner || p.development >= r.maxDevelopment) return null;
  const level = p.development, queued = state.orders?.find(o => o.type === 'develop' && o.from === p.id);
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
/** What an alliance of `roster` would hold now: combined industry against the 60% victory line. */
export function allianceForecast(state, roster) {
  const ids = [...new Set(roster)];
  const economy = state.provinces.filter(p => ids.includes(p.owner)).reduce((n, p) => n + p.development, 0);
  const totalEconomy = state.provinces.filter(p => p.owner).reduce((n, p) => n + p.development, 0);
  const threshold = Math.ceil(totalEconomy * state.rules.economyShare);
  return { roster: ids, economy, totalEconomy, threshold, remaining: Math.max(0, threshold - economy),
    wouldStartHold: economy >= threshold,
    assumption: 'Current completed industry and ownership held until the alliance starts.' };
}
export function operationalInsights(state) {
  if (!state.you) return { developments: [], admissions: [] };
  const owned = state.provinces.filter(p => p.owner === state.you);
  return {
    developments: owned.map(p => developmentForecast(state, p.id)).filter(Boolean),
    admissions: state.proposals.filter(q => q.roster.includes(state.you)).map(q => ({ proposalId: q.id, ...allianceForecast(state, q.roster) }))
  };
}
