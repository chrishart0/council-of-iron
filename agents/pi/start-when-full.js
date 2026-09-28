#!/usr/bin/env node
/** Seatless host: begin opening once all eight countries have joined. */
import { setTimeout as sleep } from 'node:timers/promises';
import { CouncilClient } from '../client.js';

const client=new CouncilClient();
if (!client.match || !client.session.profileToken) throw new Error('Set COUNCIL_URL and COUNCIL_SESSION to the host profile.');
for (;;) {
  const room=await client.observe(0);
  if (room.status!=='lobby') { console.log(`Room ${client.match}: ${room.status}`); break; }
  if (room.players.length===8) {
    const started=await client.start();
    console.log(`Room ${client.match}: ${started.status}, ${started.openingSeconds}s opening`);
    break;
  }
  await sleep(1000);
}
