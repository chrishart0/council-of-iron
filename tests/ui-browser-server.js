// Recorded position for visual/interaction checks. No public clock-control endpoint.
import { createInterface } from 'node:readline';
import { makeServer } from '../src/server.js';
import { createGame, join, start, act, tick } from '../src/engine.js';
import { replay, seatRecorded, stepper, map } from '../scripts/replay-handplay.js';
const app=makeServer({dbPath:':memory:',automatic:false,map});
const profiles=Object.fromEntries(map.countries.map(c=>[c.id,app.store.register(c.name)]));
// The recorded decisions (scripts/replay-handplay.js adapter) under the current rules, paused at tick 480.
const g=createGame({id:'ui-fixture',name:'The Atlantic campaign',hostId:profiles.britain.id},map);
// Keep the recorded interaction fixture running through its later UI assertions.
g.rules.hold=1800;
seatRecorded(g,profiles);const recorded=stepper(g);recorded.to(480);
app.games.set(g.id,g);app.store.save(g);
// A short finished match whose room announced public alliance chat after the match (replay parity checks).
const talks=createGame({id:'ui-chat',name:'Pacific talks',hostId:profiles.britain.id},map);
for(const c of map.countries)join(talks,map,{country:c.id,name:profiles[c.id].name,profileId:profiles[c.id].id,kind:'agent'});
talks.rules.revealAllianceChatAfterMatch=true;talks.rules.duration=150;start(talks);
while(talks.status==='running'){
  if(talks.tick===1){const q=act(talks,map,'usa',{type:'propose',country:'japan',name:'Pacific Pact'},'ui-chat-p');act(talks,map,'japan',{type:'accept',proposalId:q.proposalId},'ui-chat-a');}
  if(talks.tick===45)act(talks,map,'usa',{type:'chat',channel:'alliance',text:'Hold the Pacific <b>line</b>.'},'ui-chat-c');
  if(talks.tick===60)act(talks,map,'usa',{type:'march',from:'west-us',to:'mexico',amount:10},'ui-chat-m');  // arrives 02:02, captures 02:05
  tick(talks);}
app.games.set(talks.id,talks);app.store.save(talks);
const finished=replay().game;finished.id='ui-review';finished.name='The Atlantic campaign';app.games.set(finished.id,finished);app.store.save(finished);
// A second recorded position with real phased battles (formal war rules), for the map suite.
// The same position is also created as separate task rooms for the v0.8 walkthroughs (phone, desktop),
// so those scripted players never disturb the map/relations assertions in 'ui-war'.
const warRoom=(id,name)=>{const room=createGame({id,name,hostId:profiles.britain.id},map);
  for(const c of map.countries)join(room,map,{country:c.id,name:profiles[c.id].name,profileId:profiles[c.id].id,kind:'agent'});start(room);return room;};
const w=warRoom('ui-war','The Rhine front');
const taskRooms=Object.fromEntries(['ui-tasks-m','ui-tasks-d','ui-turn'].map(id=>[id,warRoom(id,'The Rhine front · walkthrough')]));
// Britain (the browser seat) also declares war on the USA at tick 0: no armies move on that front, so the
// recorded battles are unchanged, but the viewer has a real war for the v0.7 relation UI.
const warOrders={0:[['britain',{type:'declare_war',country:'usa'}],['russia',{type:'declare_war',country:'ottoman'}],['russia',{type:'march',from:'ukraine',to:'caucasus',amount:10}],['germany',{type:'declare_war',country:'france'}]],
  25:[['germany',{type:'march',from:'ruhr',to:'south-france',amount:11}]],
  // Columns still on the march at tick 55, for army-layer checks.
  56:[['britain',{type:'march',from:'england',to:'ireland',amount:6}]],
  40:[['britain',{type:'march',from:'england',to:'low-countries',amount:8}],['france',{type:'march',from:'south-france',to:'iberia',amount:8}],['germany',{type:'march',from:'bavaria',to:'danube',amount:8}]]};
// Tick 50: an approved alliance still inside its activation delay (a "forming" bloc).
const pact=room=>{const q=act(room,map,'usa',{type:'propose',country:'japan',name:'Pacific Pact'},`${room.id}-pact`);act(room,map,'japan',{type:'accept',proposalId:q.proposalId},`${room.id}-pact-accept`);};
// 'ui-turn' (turned-back notice): Britain also goes to war with France; Germany (through the Southern France it took at 01:14)
// reaches Northern France at 02:11 and Britain's 5 from Great Britain at 02:12, while Germany's battle is still under way,
// so Britain's are turned back.
const roomOrders={'ui-turn':{55:[['britain',{type:'declare_war',country:'france'}]],
  75:[['germany',{type:'march',to:'north-france',sources:[{from:'ruhr',percent:100},{from:'bavaria',percent:100},{from:'prussia',percent:100}]}]],
  104:[['britain',{type:'march',from:'england',to:'north-france',amount:5}]]}};
const stepRoom=(room,to)=>{while(room.tick<to){for(const [country,action] of [...warOrders[room.tick]||[],...roomOrders[room.id]?.[room.tick]||[]])act(room,map,country,action,`${room.id}-${room.tick}-${country}-${action.type}`);if(room.tick===50)pact(room);tick(room);}};
const stepWar=to=>stepRoom(w,to);
for(const room of [w,...Object.values(taskRooms)]){stepRoom(room,55);app.games.set(room.id,room);app.store.save(room);}
// The phone map suite needs the column that has just left Great Britain (it departs at tick 57; internal links are fast, so it is still on the counter only then).
const mobileRoom=warRoom('ui-mobile','The Rhine front · phone');stepRoom(mobileRoom,57);app.games.set(mobileRoom.id,mobileRoom);app.store.save(mobileRoom);
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`,identity:profiles.britain})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));

// A private test-process channel, never a route on the game server.
createInterface({input:process.stdin}).on('line',input=>{
  // `@room command` addresses a task room with the same commands as the war room (dm, offer, ally, war N).
  let line=input,room=w;
  if(input.startsWith('@')){const [id,...rest]=input.slice(1).split(' ');room=taskRooms[id];if(!room)throw new Error('Unknown task room');line=rest.join(' ');}
  const reply=extra=>{app.store.save(room);console.log(JSON.stringify({tick:room.tick,...extra}));};
  if(room!==w){
    if(line.startsWith('dm ')){const [,from,to,...words]=line.split(' ');act(room,map,from,{type:'chat',channel:'dm',to,text:words.join(' ')},`${room.id}-dm-${room.tick}-${from}-${to}`);return reply({});}
    if(line.startsWith('offer ')){const [,from,to,...name]=line.split(' ');const r=act(room,map,from,{type:'propose',country:to,name:name.join(' ') || 'Iron Triangle'},`${room.id}-offer-${room.tick}-${from}-${to}`);return reply({proposalId:r.proposalId});}
    if(line.startsWith('war ')){const to=Number(line.slice(4));if(!Number.isSafeInteger(to)||to<room.tick||to>500)throw new Error('Invalid task room tick');stepRoom(room,to);return reply({});}
    throw new Error('Unknown task room command');
  }
  // Test-only: another seat in the war room sends a DM or an alliance offer (the same act() path as any client).
  if(line.startsWith('dm ')){const [,from,to,...words]=line.split(' ');act(w,map,from,{type:'chat',channel:'dm',to,text:words.join(' ')},`ui-war-dm-${w.tick}-${from}-${to}`);app.store.save(w);console.log(JSON.stringify({tick:w.tick}));return;}
  if(line.startsWith('offer ')){const [,from,to]=line.split(' ');const r=act(w,map,from,{type:'propose',country:to,name:'Iron Triangle'},`ui-war-offer-${w.tick}-${from}-${to}`);app.store.save(w);console.log(JSON.stringify({tick:w.tick,proposalId:r.proposalId}));return;}
  // Test-only: an agent seat in the war room accepts the open alliance offer it received.
  if(line.startsWith('ally ')){const who=line.slice(5).trim(),offer=w.proposals.find(q=>q.status==='open'&&q.roster.includes(who));if(!offer)throw new Error('No open offer');
    act(w,map,who,{type:'accept',proposalId:offer.id},`ui-war-accept-${offer.id}`);app.store.save(w);console.log(JSON.stringify({tick:w.tick,status:offer.status}));return;}
  if(line.startsWith('war ')){const to=Number(line.slice(4));if(!Number.isSafeInteger(to)||to<w.tick||to>120)throw new Error('Invalid war fixture tick');stepWar(to);app.store.save(w);console.log(JSON.stringify({tick:w.tick,battles:w.battles.length}));return;}
  const to=Number(line);if(!Number.isSafeInteger(to)||to<g.tick||to>800)throw new Error('Invalid fixture tick');
  recorded.to(to);
  app.store.save(g);console.log(JSON.stringify({tick:g.tick}));
});
