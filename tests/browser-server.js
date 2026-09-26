// Test-only process: real HTTP, SQLite, wall clock, no privileged HTTP test endpoints.
import { makeServer } from '../src/server.js';
const app=makeServer({dbPath:process.env.TEST_DB || ':memory:',clockScale:Number(process.env.TEST_CLOCK_SCALE || 12)});
app.server.listen(Number(process.env.PORT || 3001),'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}`})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
