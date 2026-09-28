// Deterministic real-match fixtures for browser review tests. No public test endpoints.
import { makeServer, MAP } from '../src/server.js';
import { replay } from '../scripts/replay-handplay.js';
import { createGame, join, start, act, tick } from '../src/engine.js';
const app = makeServer({dbPath: ':memory:', automatic: false});
const game = replay().game; game.id = 'review-fixture'; game.name = 'The Atlantic campaign';
app.games.set(game.id, game); app.store.save(game);
// A drawn match: Qing and Japan (hostile alliance name) hold as much industry as the United States at the deadline.
const draw = createGame({id:'draw-fixture',name:'A drawn council',hostId:'usa'},MAP);
for (const country of ['usa','qing','japan','ottoman']) join(draw, MAP, {country,name:country,profileId:country});
draw.rules.duration=60;start(draw);
const {proposalId}=act(draw,MAP,'qing',{type:'propose',country:'japan',name:'<img src=x onerror=window.REVIEW_XSS=1>'},'propose');
act(draw,MAP,'japan',{type:'accept',proposalId},'accept');
while(draw.status==='running')tick(draw);
if(!draw.outcome.draw)throw new Error('draw fixture did not draw');
app.games.set(draw.id, draw);app.store.save(draw);
const wire=createGame({id:'wire-fixture',name:'The opened wire',hostId:'usa'},MAP);
wire.rules.duration=55;wire.rules.hold=1800;
for(const [country,visibility] of [['usa','public'],['britain','public'],['france','private'],['germany','private']])
  join(wire,MAP,{country,name:country,profileId:`wire-${country}`,kind:'agent',visibility});
start(wire);
act(wire,MAP,'usa',{type:'chat',channel:'world',text:'<img src=x onerror=window.REVIEW_XSS=1> Public terms'},'wire-world');
act(wire,MAP,'britain',{type:'chat',channel:'dm',to:'usa',text:'The public pair can talk.'},'wire-dm');
act(wire,MAP,'france',{type:'chat',channel:'world',text:'PRIVATE LINE'},'wire-private');
const wireOffer=act(wire,MAP,'usa',{type:'propose',country:'britain',name:'Open Accord'},'wire-offer');
act(wire,MAP,'britain',{type:'accept',proposalId:wireOffer.proposalId},'wire-accept');
while(wire.tick<30)tick(wire);
act(wire,MAP,'usa',{type:'chat',channel:'alliance',text:'We hold the line.'},'wire-alliance');
while(wire.status==='running')tick(wire);
app.games.set(wire.id,wire);app.store.save(wire);
const incompatible=structuredClone(game);incompatible.id='old-fixture';incompatible.name='Unverifiable older record';delete incompatible.reviewOrigin;incompatible.provinces[0].troops++;
app.games.set(incompatible.id,incompatible);app.store.save(incompatible);
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
