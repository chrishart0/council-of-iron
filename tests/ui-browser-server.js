// Recorded position for visual/interaction checks. No public clock-control endpoint.
import { createInterface } from 'node:readline';
import { makeServer, MAP } from '../src/server.js';
import { createGame, join, start, act, tick } from '../src/engine.js';
import { fixture, replay } from '../scripts/replay-handplay.js';
const app=makeServer({dbPath:':memory:',automatic:false});
const profiles=Object.fromEntries(MAP.countries.map(c=>[c.id,app.store.register(c.name)]));
const g=createGame({id:'ui-fixture',name:'The Atlantic campaign',hostId:profiles.britain.id},MAP);
for(const c of MAP.countries)join(g,MAP,{country:c.id,name:profiles[c.id].name,profileId:profiles[c.id].id,kind:'agent'});
g.rules.warRequired=false;
// Keep the recorded interaction fixture running through its tick-539 UI assertions.
g.rules.hold=1800;
start(g);let index=0;
while(g.tick<480){while(fixture.actions[index]?.tick===g.tick){const a=fixture.actions[index++];act(g,MAP,a.country,a.action,a.opId);}tick(g);}
app.games.set(g.id,g);app.store.save(g);
const finished=replay().game;finished.id='ui-review';finished.name='The Atlantic campaign';app.games.set(finished.id,finished);app.store.save(finished);
// A second recorded position with real phased battles (formal war rules), for the map suite.
const w=createGame({id:'ui-war',name:'The Rhine front',hostId:profiles.britain.id},MAP);
for(const c of MAP.countries)join(w,MAP,{country:c.id,name:profiles[c.id].name,profileId:profiles[c.id].id,kind:'agent'});
start(w);
const warOrders={0:[['russia',{type:'declare_war',country:'ottoman'}],['russia',{type:'move',from:'ukraine',to:'east-anatolia',amount:10}],['germany',{type:'declare_war',country:'france'}]],
  25:[['germany',{type:'move',from:'rhineland',to:'alpine-france',amount:11}]],
  // Columns still on the march at tick 55, for army-layer checks.
  56:[['britain',{type:'move',from:'scotland',to:'ireland',amount:6}]],
  40:[['britain',{type:'move',from:'england',to:'low-countries',amount:8}],['france',{type:'move',from:'occitania',to:'iberia',amount:8}],['germany',{type:'move',from:'saxony',to:'balkans',amount:8}]]};
// Tick 50: an approved alliance still inside its activation delay (a "forming" bloc).
const pact=()=>{const q=act(w,MAP,'usa',{type:'propose',country:'japan',name:'Pacific Pact'},'ui-war-pact');act(w,MAP,'japan',{type:'accept',proposalId:q.proposalId},'ui-war-pact-accept');};
const stepWar=to=>{while(w.tick<to){for(const [country,action] of warOrders[w.tick]||[])act(w,MAP,country,action,`ui-war-${w.tick}-${country}-${action.type}`);if(w.tick===50)pact();tick(w);}};
stepWar(55);app.games.set(w.id,w);app.store.save(w);
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`,identity:profiles.britain})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));

// A private test-process channel, never a route on the game server.
createInterface({input:process.stdin}).on('line',line=>{
  if(line.startsWith('war ')){const to=Number(line.slice(4));if(!Number.isSafeInteger(to)||to<w.tick||to>60)throw new Error('Invalid war fixture tick');stepWar(to);app.store.save(w);console.log(JSON.stringify({tick:w.tick,battles:w.battles.length}));return;}
  const to=Number(line);if(!Number.isSafeInteger(to)||to<g.tick||to>539)throw new Error('Invalid fixture tick');
  while(g.tick<to && g.status==='running'){while(fixture.actions[index]?.tick===g.tick){const a=fixture.actions[index++];act(g,MAP,a.country,a.action,a.opId);}tick(g);}
  app.store.save(g);console.log(JSON.stringify({tick:g.tick}));
});
