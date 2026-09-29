#!/usr/bin/env node
/** Seatless host: start a shared lobby once every country has joined (humans in the browser, model clients through the join API). */
import { setTimeout as sleep } from 'node:timers/promises';
import { CouncilClient } from '../client.js';

const client=new CouncilClient();
if (!client.match || !client.session.profileToken) throw new Error('Set COUNCIL_URL, COUNCIL_MATCH and COUNCIL_SESSION to the host profile.');
const map=await client.map();
for (;;) {
  const room=await client.observe(0);
  if (room.status!=='lobby') { console.log(`Room ${client.match}: ${room.status}`); break; }
  if (room.players.length===map.countries.length) {
    const started=await client.start();
    console.log(`Room ${client.match}: ${started.status}`);
    break;
  }
  await sleep(1000);
}
