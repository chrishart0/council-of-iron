// Test-only process: real HTTP, SQLite, wall clock, no privileged HTTP test endpoints.
import { fstatSync } from 'node:fs';
import { makeServer } from '../src/server.js';
const app=makeServer({dbPath:process.env.TEST_DB || ':memory:',clockScale:Number(process.env.TEST_CLOCK_SCALE || 12)});
app.server.listen(Number(process.env.PORT || 3001),'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
// Exit with the test runner: its stdin pipe closes even when the runner is killed.
if(fstatSync(0).isFIFO())process.stdin.on('end',()=>app.close().then(()=>process.exit(0))).resume();
