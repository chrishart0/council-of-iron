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
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`,identity:profiles.britain})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));

// A private test-process channel, never a route on the game server.
createInterface({input:process.stdin}).on('line',line=>{
  const to=Number(line);if(!Number.isSafeInteger(to)||to<g.tick||to>539)throw new Error('Invalid fixture tick');
  while(g.tick<to && g.status==='running'){while(fixture.actions[index]?.tick===g.tick){const a=fixture.actions[index++];act(g,MAP,a.country,a.action,a.opId);}tick(g);}
  app.store.save(g);console.log(JSON.stringify({tick:g.tick}));
});
