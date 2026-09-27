// Deterministic real-match fixtures for browser review tests. No public test endpoints.
import { makeServer, MAP } from '../src/server.js';
import { replay } from '../scripts/replay-handplay.js';
import { createGame, join, start, act, tick } from '../src/engine.js';
const app = makeServer({dbPath: ':memory:', automatic: false});
const game = replay().game; game.id = 'review-fixture'; game.name = 'The Atlantic campaign';
app.games.set(game.id, game); app.store.save(game);
const draw = createGame({id:'draw-fixture',name:'A negotiated peace',hostId:'usa'},MAP);
for (const country of ['usa','britain']) join(draw, MAP, {country,name:country,profileId:country});
start(draw);
const {proposalId}=act(draw,MAP,'usa',{type:'propose',country:'britain',name:'<img src=x onerror=window.REVIEW_XSS=1>'},'propose');
act(draw,MAP,'britain',{type:'accept',proposalId},'accept');
while(draw.status==='running')tick(draw);
app.games.set(draw.id, draw);app.store.save(draw);
const incompatible=structuredClone(game);incompatible.id='old-fixture';incompatible.name='Unverifiable older record';delete incompatible.reviewOrigin;incompatible.provinces[0].troops++;
app.games.set(incompatible.id,incompatible);app.store.save(incompatible);
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
