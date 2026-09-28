/** Exact static Risk-round odds. Reinforcement, retreat and recruitment are excluded. */
const outcomes = new Map();
function distribution(attackDice, defendDice,development) {
  const key=`${attackDice}:${defendDice}:${development}`;
  if(outcomes.has(key))return outcomes.get(key);
  const counts=new Map(),rolls=attackDice+defendDice,total=6**rolls;
  for(let value=0;value<total;value++){
    let n=value;const dice=[];
    for(let i=0;i<rolls;i++){dice.push(1+n%6);n=Math.floor(n/6);}
    const attack=dice.slice(0,attackDice).sort((a,b)=>b-a),defend=dice.slice(attackDice).sort((a,b)=>b-a);
    defend[0]=Math.min(6,defend[0]+Math.floor(development/2));
    let defenderLoss=0;
    for(let i=0;i<Math.min(attackDice,defendDice);i++)if(attack[i]>defend[i])defenderLoss++;
    counts.set(defenderLoss,(counts.get(defenderLoss)||0)+1);
  }
  const result=[...counts].map(([defenderLoss,count])=>({attackerLoss:Math.min(attackDice,defendDice)-defenderLoss,defenderLoss,probability:count/total}));
  outcomes.set(key,result);return result;
}
export function combatForecast(attackers,defenders,development=1) {
  attackers=Math.max(0,Math.floor(attackers));defenders=Math.max(0,Math.floor(defenders));
  const attackDice=Math.min(3,attackers),defendDice=Math.min(2,defenders);
  if(!attackers || !defenders)return {attackers,defenders,attackDice,defendDice,attackerWinChance:attackers?1:0,expectedAttackerLoss:0,expectedDefenderLoss:0,exact:true};
  const rolls=distribution(attackDice,defendDice,development);
  const expectedAttackerLoss=rolls.reduce((n,r)=>n+r.attackerLoss*r.probability,0);
  const expectedDefenderLoss=rolls.reduce((n,r)=>n+r.defenderLoss*r.probability,0);
  // Keep the read-only forecast bounded for very large garrisons.
  if(attackers>250 || defenders>250) {
    const balance=attackers/Math.max(1,expectedAttackerLoss)-defenders/Math.max(.01,expectedDefenderLoss);
    return {attackers,defenders,development,defenseBonus:Math.floor(development/2),attackDice,defendDice,attackerWinChance:1/(1+Math.exp(-balance/10)),expectedAttackerLoss,expectedDefenderLoss,exact:false};
  }
  const memo=new Map();
  function chance(a,d){
    if(d<=0)return 1;if(a<=0)return 0;
    const key=a*251+d;if(memo.has(key))return memo.get(key);
    const odds=distribution(Math.min(3,a),Math.min(2,d),development).reduce((n,r)=>n+r.probability*chance(a-r.attackerLoss,d-r.defenderLoss),0);
    memo.set(key,odds);return odds;
  }
  return {attackers,defenders,development,defenseBonus:Math.floor(development/2),attackDice,defendDice,attackerWinChance:chance(attackers,defenders),expectedAttackerLoss,expectedDefenderLoss,exact:true};
}

// Shared public probability distribution; no access to a match's seeded rolls.
export { distribution as combatDistribution };
