import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,join,start,act,tick,observe,turnAroundPlan,RULES} from '../src/engine.js';
import {journeyPoint} from '../public/movement.js';
const map=JSON.parse(readFileSync(new URL('../public/imperial-map.json',import.meta.url)));
let next=0;
function game(ids=['usa','britain','japan']){
  const g=createGame({id:`turn-${++next}`,name:'Turn around',hostId:ids[0]},map);
  for(const id of ids)join(g,map,{profileId:id,name:id,country:id});
  start(g);return g;
}
const send=(g,id,action,opId=`turn-test-${++next}`)=>act(g,map,id,action,opId);
const advance=(g,n)=>{for(let i=0;i<n;i++)tick(g);};
const province=(g,id)=>g.provinces.find(p=>p.id===id);
const armyOf=(g,orderId)=>g.armies.find(a=>a.orderId===orderId);
/** USA marches on British Mexico while a war is on; returns the army once it has left. */
function march(g,amount=20){
  province(g,'mexico').owner='britain';province(g,'mexico').troops=6;
  if(!g.wars.includes('britain:usa'))send(g,'usa',{type:'declare_war',country:'britain'});province(g,'west-us').troops=60;
  const r=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount});tick(g);
  return armyOf(g,r.orderId);
}
const leg=g=>g.travelTimes['west-us'].mexico;

test('a manual recall then turn-around resumes from the actual position with the remaining-distance ETA',()=>{
  const g=game(),a=march(g);advance(g,20);
  const departed=a.departedAt;send(g,'usa',{type:'recall',id:a.id});tick(g);
  assert.equal(a.returning,true);const recalledAt=g.tick,backAt=a.arrivesAt;
  assert.equal(backAt-recalledAt,recalledAt-departed,'recall takes the elapsed outbound time');
  advance(g,5);
  const plan=turnAroundPlan(g,'usa',a.id);
  assert.equal(plan.mode,'resume');assert.equal(plan.to,'mexico');
  const here=g.tick+1,distanceHome=backAt-here;
  assert.equal(plan.arrivesAt,here+leg(g)-distanceHome);
  const r=send(g,'usa',{type:'turn_around',armyId:a.id});
  assert.equal(r.mode,'resume');assert.equal(r.arrivesAt,plan.arrivesAt);assert.equal(a.returning,true,'next-tick execution');
  const before=journeyPoint(a,g.positions,here);tick(g);
  assert.equal(a.returning,undefined);assert.equal(a.to,'mexico');assert.equal(a.from,'west-us');
  assert.equal(a.arrivesAt,plan.arrivesAt);assert.deepEqual(a.startPoint,before,'turns at its actual position');
  assert.equal(a.turnArounds,1);
  assert.ok(g.events.some(e=>e.type==='army_turned_around'&&e.armyId===a.id&&e.to==='mexico'&&e.arrivesAt===plan.arrivesAt));
  advance(g,a.arrivesAt-g.tick);
  assert.ok(g.battles.some(b=>b.province==='mexico')||province(g,'mexico').owner==='usa','the resumed army attacks on arrival');
});

test('an army auto-turned by another side’s battle can resume toward its target',()=>{
  const g=game();province(g,'mexico').owner='britain';province(g,'mexico').troops=400;
  send(g,'usa',{type:'declare_war',country:'britain'});send(g,'japan',{type:'declare_war',country:'britain'});
  province(g,'west-us').troops=60;
  // Japan's battle is already under way when the American column arrives.
  g.battles.push({id:'battle-x',province:'mexico',startedAt:0,attackerSide:'solo:japan:0',previousOwner:'britain',before:400,
    arrivals:[],defenderRecruited:0,defenderRouted:0,withdrawn:0,engaged:500,casualties:0,lastRound:null});
  g.armies.push({id:'army-j',country:'japan',from:'philippines',to:'mexico',amount:500,departedAt:0,arrivesAt:0,engaged:true});
  const r=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:20});
  advance(g,1+leg(g));
  const a=armyOf(g,r.orderId),turned=g.events.find(e=>e.type==='army_recalled'&&e.armyId===a.id);
  assert.equal(turned.reason,'battle_in_progress');assert.equal(turned.province,'mexico');
  assert.equal(turned.battleAttackerSide,'solo:japan:0');assert.equal(turned.owner,'britain');
  assert.equal(a.returning,true);assert.equal(a.arrivesAt-g.tick,leg(g),'turned back from the province itself');
  const plan=turnAroundPlan(g,'usa',a.id);
  assert.deepEqual(plan.battleInProgress,{attackerSide:'solo:japan:0',joins:false});
  advance(g,10);send(g,'usa',{type:'turn_around',armyId:a.id});tick(g);
  assert.equal(a.to,'mexico');assert.equal(a.arrivesAt,g.tick+11,'eleven ticks back out (ten waited plus the order tick) is eleven ticks out again');
});

test('no_war still names the owner when the war really is missing',()=>{
  const g=game();province(g,'mexico').owner='britain';province(g,'mexico').troops=6;province(g,'west-us').troops=60;
  send(g,'usa',{type:'declare_war',country:'britain'});
  const r=send(g,'usa',{type:'move',from:'west-us',to:'mexico',amount:20});tick(g);
  g.wars=[];advance(g,leg(g));
  const e=g.events.find(e=>e.type==='army_recalled'&&e.armyId===armyOf(g,r.orderId).id);
  assert.equal(e.reason,'no_war');assert.equal(e.owner,'britain');assert.equal(e.province,'mexico');
});

test('turning an advancing army around is exactly a recall',()=>{
  const g1=game(),g2=game();
  for(const [g,type] of [[g1,'recall'],[g2,'turn_around']]){
    const a=march(g);advance(g,12);
    const r=send(g,'usa',type==='recall'?{type,id:a.id}:{type,armyId:a.id});
    if(type==='turn_around')assert.equal(r.mode,'recall');
    tick(g);
  }
  const strip=g=>JSON.stringify({armies:g.armies,orders:g.orders,provinces:g.provinces});
  assert.equal(strip(g1),strip(g2));
});

test('turn-around is refused when the target is no longer a legal move, the army is engaged, or it is not yours',()=>{
  const g=game(),a=march(g);advance(g,5);send(g,'usa',{type:'recall',id:a.id});tick(g);
  assert.throws(()=>send(g,'britain',{type:'turn_around',armyId:a.id}),e=>e.status===403);
  g.wars=[];
  assert.throws(()=>send(g,'usa',{type:'turn_around',armyId:a.id}),/Declare war/);
  // The owner became an ally: resuming is a reinforcement, which is legal.
  const usa=g.players.find(p=>p.id==='usa'),britain=g.players.find(p=>p.id==='britain');
  britain.side=usa.side;assert.equal(turnAroundPlan(g,'usa',a.id).mode,'resume');
  britain.side='solo:britain:0';
  // War ends after the order is accepted: it fails at execution and nothing moves.
  g.wars=['britain:usa'];const before=JSON.stringify(a);
  send(g,'usa',{type:'turn_around',armyId:a.id});g.wars=[];tick(g);
  assert.equal(JSON.stringify({...a}),JSON.stringify({...JSON.parse(before)}));
  assert.ok(g.events.some(e=>e.type==='order_failed'&&e.reason.includes('Declare war')));
  // Engaged armies withdraw with recall, not turn-around.
  g.wars=['britain:usa'];advance(g,10);const b=march(g,10);advance(g,b.arrivesAt-g.tick);
  assert.equal(b.engaged,true);
  assert.throws(()=>send(g,'usa',{type:'turn_around',armyId:b.id}),/fighting/);
  assert.throws(()=>send(g,'usa',{type:'turn_around',armyId:'army-none'}),e=>e.status===409);
});

test('transit columns cannot resume; retries are idempotent; each turn costs one command; the per-army cap holds',()=>{
  const g=game(),a=march(g);advance(g,30);send(g,'usa',{type:'recall',id:a.id});tick(g);advance(g,10);
  const remaining=()=>observe(g,'usa').commandBudget.remaining,used=remaining(),action={type:'turn_around',armyId:a.id};
  const first=send(g,'usa',action,'same-op');assert.deepEqual(send(g,'usa',action,'same-op'),first);
  assert.equal(remaining(),used-1,'one command, charged once despite the retry');assert.equal(g.orders.filter(o=>o.type==='turn_around').length,1);
  assert.throws(()=>send(g,'usa',{type:'turn_around',armyId:a.id}),/already queued/);
  tick(g);advance(g,10);
  for(let i=0;i<RULES.maxTurnArounds-1;i++){send(g,'usa',{type:'recall',id:a.id});tick(g);advance(g,10);
    send(g,'usa',{type:'turn_around',armyId:a.id});tick(g);advance(g,10);}
  assert.equal(a.turnArounds,RULES.maxTurnArounds);
  send(g,'usa',{type:'recall',id:a.id});tick(g);advance(g,10);
  assert.throws(()=>send(g,'usa',{type:'turn_around',armyId:a.id}),/at most/);
  // Budget: three per ten ticks, shared with every other military command.
  const h=game(),b=march(h);advance(h,30);send(h,'usa',{type:'recall',id:b.id});tick(h);
  send(h,'usa',{type:'move',from:'west-us',to:'central-us',amount:1});send(h,'usa',{type:'move',from:'west-us',to:'central-us',amount:1});
  assert.equal(h.players.find(p=>p.id==='usa').orderTicks.filter(t=>t>h.tick-10).length,3);
  assert.throws(()=>send(h,'usa',{type:'turn_around',armyId:b.id}),e=>e.status===429);
  const t=game();t.armies.push({id:'army-t',country:'usa',from:'central-us',to:'west-us',amount:5,departedAt:0,arrivesAt:40,
    transit:true,path:['central-us','east-us'],pathIndex:0,origin:'west-us',originDepartedAt:0,returning:true});
  assert.throws(()=>send(t,'usa',{type:'turn_around',armyId:'army-t'}),/transit column/);
});

test('recalling a resumed army measures its way home by its distance, not the time since it turned',()=>{
  const g=game(),a=march(g);advance(g,40);send(g,'usa',{type:'recall',id:a.id});tick(g);
  advance(g,10);send(g,'usa',{type:'turn_around',armyId:a.id});tick(g);
  const fromHome=leg(g)-(a.arrivesAt-g.tick);advance(g,6);
  send(g,'usa',{type:'recall',id:a.id});tick(g);
  assert.equal(a.arrivesAt-g.tick,fromHome+7);
});

test('turn-around is deterministic and survives save/load; old snapshots without the new fields still load',()=>{
  const run=()=>{const g=game();g.id='same';const a=march(g);advance(g,25);send(g,'usa',{type:'recall',id:a.id},'r');tick(g);advance(g,5);
    send(g,'usa',{type:'turn_around',armyId:a.id},'t');return g;};
  const g=run(),h=run();
  const loaded=JSON.parse(JSON.stringify(g));advance(g,30);advance(loaded,30);advance(h,30);
  assert.equal(JSON.stringify(g),JSON.stringify(loaded));assert.equal(JSON.stringify(g.armies),JSON.stringify(h.armies));
  // A pre-v0.8.x snapshot: no maxTurnArounds rule and no turnArounds on its returning army.
  const old=run();delete old.rules.maxTurnArounds;old.orders=old.orders.filter(o=>o.type!=='turn_around');
  const back=JSON.parse(JSON.stringify(old)),a=back.armies.find(x=>x.returning);delete a.turnArounds;
  assert.equal(turnAroundPlan(back,'usa',a.id).mode,'resume');
  send(back,'usa',{type:'turn_around',armyId:a.id},'after-restart');tick(back);assert.equal(a.turnArounds,1);
  assert.equal(observe(back,'usa').turnAroundLimit,RULES.maxTurnArounds);
});
