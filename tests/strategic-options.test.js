import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, start, observe } from '../src/engine.js';
import { strategicOptions } from '../agents/strategic-options.js';

const map = JSON.parse(readFileSync(new URL('../public/imperial-map.json', import.meta.url)));

test('strategic options distinguish taking rival industry from taking neutral industry', () => {
  const game = createGame({id:'options',name:'Options',hostId:'test'},map);
  join(game,map,{profileId:'usa',name:'USA',country:'usa'});
  join(game,map,{profileId:'britain',name:'Britain',country:'britain'});
  start(game);
  const before = structuredClone(game);
  const result = strategicOptions(observe(game,'usa'),map);
  assert.equal(result.ownIndustry,11);
  assert.equal(result.totalIndustry,34);
  assert.equal(result.decisiveThreshold,21);
  assert.equal(result.industryGap,10);
  assert.equal(result.latestHoldStart,1710);
  const england = result.nearbyTargets.find(p=>p.province==='england');
  assert.equal(england.owner,'britain');
  assert.equal(england.gapReduction,3);
  assert.equal(england.industryGapAfterCapture,7);
  assert.equal(england.requiresWar,true);
  assert.ok(england.adjacentSources.some(p=>p.from==='east-us'));
  const mexico = result.nearbyTargets.find(p=>p.province==='mexico');
  assert.equal(mexico.owner,null);
  assert.equal(mexico.gapReduction,1);
  assert.equal(mexico.industryGapAfterCapture,9);
  assert.equal(result.possibleIndependentPartners[0].country,'britain');
  assert.equal(result.possibleIndependentPartners[0].industryGapTogether,0);
  const partner = result.possibleIndependentPartners[0];
  const share = 11 ** .75 / (11 ** .75 + partner.industry ** .75);
  assert.ok(Math.abs(partner.victoryShareIfJoinedNow - share) < 1e-10);
  assert.ok(Math.abs(partner.decisivePrestigeAtFullMaturityIfWon - (200 * share - 100)) < 1e-10);
  assert.deepEqual(partner.deadlinePrestigeAtFullMaturityByRank,
    [.5, .25, .25].map(fraction => 200 * share * fraction - 100));
  const east = result.developmentChoices.find(p=>p.province==='east-us');
  assert.equal(east.availableNow, game.provinces.find(p=>p.id==='east-us').troops-1);
  assert.equal(east.manpowerReady, east.availableNow>=east.cost);
  assert.deepEqual(game,before);
});

test('strategic development options exclude reserved manpower', () => {
  const game = createGame({id:'develop-options',name:'Options',hostId:'test'},map);
  join(game,map,{profileId:'usa',name:'USA',country:'usa'});
  join(game,map,{profileId:'britain',name:'Britain',country:'britain'});
  start(game);
  const province=game.provinces.find(p=>p.id==='east-us');
  province.troops=100;
  const readyOptions=strategicOptions(observe(game,'usa'),map);
  const ready=readyOptions.developmentChoices.find(p=>p.province==='east-us');
  assert.equal(ready.manpowerReady,true);
  assert.ok(readyOptions.readyDevelopments.some(p=>p.province==='east-us'));
  game.orders.push({type:'move',country:'usa',from:'east-us',to:'west-us',amount:90,executeAt:game.tick+1});
  const reservedOptions=strategicOptions(observe(game,'usa'),map);
  const reserved=reservedOptions.developmentChoices.find(p=>p.province==='east-us');
  assert.equal(reserved.availableNow,9);
  assert.equal(reserved.manpowerReady,false);
  assert.ok(!reservedOptions.readyDevelopments.some(p=>p.province==='east-us'));
});

test('partner forecast keeps the country share when already allied', () => {
  const game = createGame({id:'allied-options',name:'Options',hostId:'test'},map);
  for (const country of ['usa', 'france', 'britain'])
    join(game,map,{profileId:country,name:country,country});
  start(game);
  const seen = observe(game, 'usa');
  seen.players.find(player => player.id === 'france').side = seen.players.find(player => player.id === 'usa').side;
  const industry = country => seen.provinces.filter(province => province.owner === country)
    .reduce((total, province) => total + province.development, 0);
  const partner = strategicOptions(seen, map).possibleIndependentPartners.find(entry => entry.country === 'britain');
  const expected = industry('usa') ** .75 /
    (industry('usa') ** .75 + industry('france') ** .75 + industry('britain') ** .75);
  assert.ok(Math.abs(partner.victoryShareIfJoinedNow - expected) < 1e-10);
  assert.equal(partner.combinedIndustry, industry('usa') + industry('france') + industry('britain'));
});

test('strategic options require a player seat', () => {
  const game = createGame({id:'options',name:'Options',hostId:'test'},map);
  join(game,map,{profileId:'usa',name:'USA',country:'usa'});
  join(game,map,{profileId:'britain',name:'Britain',country:'britain'});
  start(game);
  assert.throws(()=>strategicOptions(observe(game),map),/Join a country/);
});
