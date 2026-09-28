import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, start, observe } from '../src/engine.js';
import { MAP } from '../src/server.js';
import { repairHint } from '../agents/mcp-hints.js';

test('MCP repair hints use only authenticated availability and public connections', () => {
  const game=createGame({id:'hints',name:'Hints',hostId:'britain'},MAP);
  join(game,MAP,{profileId:'britain',name:'Britain',country:'britain'});
  join(game,MAP,{profileId:'france',name:'France',country:'france'});
  start(game);
  game.orders.push({type:'march',country:'britain',from:'england',to:'low-countries',amount:2,executeAt:1});
  const observation=observe(game,'britain');
  const own=repairHint(observation,MAP,'march',{from:'england',to:'north-france'});
  const england=observation.provinces.find(p=>p.id==='england');
  assert.equal(own.sources[0].available,england.troops-3);
  assert.equal(own.status,'running');
  assert.ok(own.sources[0].directNeighbors.includes('low-countries'));
  assert.equal(own.target.owner,'france');assert.equal(own.target.attackReady,false);
  const foreign=repairHint(observation,MAP,'preview',{from:'north-france',to:'england'});
  assert.equal(Object.hasOwn(foreign.sources[0],'available'),false);
  assert.equal(repairHint(observation,MAP,'join_match',{country:'france'}),null);
});
