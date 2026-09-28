import { sum } from './position.js';

/** War and peace are public rules, not a bypass for the military planner.
 * Motions need a real vote. Treaties get breathing room instead of immediate war.
 */
export function foreignPolicy(pos, memory) {
  const {state:s,me,country}=pos;
  if (!s.rules.warRequired) return null;
  const strength = side => sum(s.provinces.filter(p=>pos.side(p.owner)===side).map(p=>8*p.development+p.troops*.4))
    + sum(s.armies.filter(a=>pos.side(a.country)===side).map(a=>a.amount*.4));
  const own=strength(me.side), leader=side=>s.dominance[side]!==undefined;
  const sensiblePeace = other => !leader(other) && !leader(me.side) && (strength(other)>own*.85
    || new Set(s.players.filter(p=>pos.enemy(p.id)).map(p=>p.side)).size>1);
  for (const m of s.diplomacy || []) {
    if(!['voting','offered'].includes(m.status) || m.expiresAt<=s.tick)continue;
    const source=m.status==='voting' && m.fromRoster.includes(country) && !m.fromYes.includes(country);
    const target=m.kind==='peace' && m.status==='offered' && m.toRoster.includes(country) && !m.toYes.includes(country);
    if(!source && !target)continue;
    const other=source?m.toSide:m.fromSide;
    if(m.kind==='war') {
      const exposed=s.provinces.some(p=>pos.side(p.owner)===other && pos.neighbours(p).some(q=>pos.friendly(q.owner)));
      if(leader(other) || exposed && own>strength(other)*.65)
        return {action:{type:'vote_war',motionId:m.id},reason:'Approve an allied war plan with a viable front'};
    } else if(sensiblePeace(other)) return {action:{type:'vote_peace',motionId:m.id},reason:'Accept peace to stabilize a costly front'};
  }
  if(s.tick < (memory.nextPeaceAt || 180))return null;
  memory.nextPeaceAt=s.tick+90;
  const costly=s.players.filter(p=>p.eliminatedAt===null && pos.enemy(p.id) && sensiblePeace(p.side)
    && strength(p.side)>own*1.2 && (memory.warCooldown?.[p.side]||0)<=s.tick
    && !(s.diplomacy||[]).some(m=>['voting','offered'].includes(m.status) && m.kind==='peace' && [m.fromSide,m.toSide].includes(me.side) && [m.fromSide,m.toSide].includes(p.side)))
    .sort((a,b)=>strength(b.side)-strength(a.side))[0];
  return costly ? {action:{type:'offer_peace',country:costly.id},reason:'Offer a treaty rather than waste a weakened army'} : null;
}
