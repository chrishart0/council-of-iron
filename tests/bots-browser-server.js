// Test-only stdin clock. No public HTTP time-control route.
import { createInterface } from 'node:readline';
import { makeServer } from '../src/server.js';
const app = makeServer({ dbPath: ':memory:', automatic: false, league: false });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ url: `http://127.0.0.1:${app.server.address().port}` }));
createInterface({ input: process.stdin }).on('line', line => {
  const n = Number(line);
  if (!Number.isInteger(n) || n < 0 || n > 1800) throw new Error('Invalid test clock step.');
  for (const g of app.games.values()) if (g.status === 'running') app.step(g, n);
  console.log(JSON.stringify({ stepped: n }));
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close().then(() => process.exit(0)));
