#!/usr/bin/env node
/** External version of the same traditional bot used by the host. No LLM needed. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CouncilClient } from './client.js';
import { createBot, decideBot, recordDecision } from './bots/controller.js';
import { BOT_VERSION, botSettings, botLabel } from '../public/bot-profiles.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const client = new CouncilClient();
try {
  const country = process.env.COUNCIL_COUNTRY || client.session.country;
  if (!country || !client.match) throw new Error('Set COUNCIL_MATCH and COUNCIL_COUNTRY, or reuse a joined session.');
  const settings = botSettings({ difficulty: process.env.COUNCIL_BOT_DIFFICULTY || 'standard', personality: process.env.COUNCIL_BOT_PERSONALITY || 'mixed' });
  const seed = process.env.COUNCIL_BOT_SEED || client.match;
  if (!client.explicitToken && (!client.session.seatToken || client.session.country !== country || client.session.match !== client.match))
    await client.join(client.match, country, process.env.COUNCIL_NAME || `${country} commander`, BOT_VERSION, botLabel(settings));
  const scope = `${client.url}/${client.match}/${country}`, path = resolve(process.env.COUNCIL_BOT_STATE || `${client.sessionPath}.bot.json`);
  let saved = { scope, brain: createBot(country, settings, seed), pending: null };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.scope === scope && data.brain?.version === BOT_VERSION) {
      botSettings(data.brain.config);
      if (data.brain.country !== country || !Array.isArray(data.brain.replies) || !Array.isArray(data.brain.transfers)
          || !Number.isSafeInteger(data.brain.cursor)) throw new Error('Invalid saved commander state.');
      if ((process.env.COUNCIL_BOT_DIFFICULTY && settings.difficulty !== data.brain.config.difficulty)
          || (process.env.COUNCIL_BOT_PERSONALITY && settings.personality !== 'mixed' && settings.personality !== data.brain.config.personality))
        throw new Error('Settings differ from this saved commander. Resume with its settings, or deliberately use a new COUNCIL_BOT_STATE file after resolving pending orders.');
      saved = data;
    }
  }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`Cannot read bot memory: ${e.message}`); }
  function save() {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 }); renameSync(temporary, path);
  }
  const map = await client.map(); let failures = 0;
  console.error(`Traditional ${botLabel(saved.brain.config)} bot: ${client.match} / ${country}. No LLM, hidden bonuses or free-form language understanding.`);
  while (true) {
    try {
      if (saved.pending) {
        const { decision, context, opId } = saved.pending;
        try { const receipt = await client.action(decision.action, opId); recordDecision(saved.brain, decision, { ...context, tick:receipt.acceptedTick }); }
        catch (e) {
          if (![400,403,409,429].includes(e.status)) throw e;
          console.error(`Order rejected: ${e.message}`); recordDecision(saved.brain, decision, context, false);
        }
        saved.pending = null; save();
      }
      const state = await client.observe(saved.brain.cursor);
      if (state.status === 'opening' && !state.players.find(p=>p.id===country)?.openingLocked) {
        await client.opening(`${country} ${saved.brain.config.personality}`, 'We will defend our industry, honor useful partnerships and contest the field.');
        continue;
      }
      if (state.status === 'finished') { console.log(JSON.stringify(state.outcome)); break; }
      const decision = decideBot(state, map, saved.brain);
      if (decision) {
        // Save the ID BEFORE transmission. Lost responses/crashes replay the same order.
        saved.pending = { decision, opId: randomUUID(), context: { tick: state.tick, rules: state.rules, travelTimes: state.travelTimes, players: state.players.map(p=>({id:p.id,side:p.side})) } };
      }
      save(); failures = 0;
      if (saved.pending || state.hasMore) continue;
      await sleep(Math.max(100, 1000/state.speed));
    } catch (e) {
      const temporary = e.status === 429 || e.status >= 500 || ['TimeoutError','AbortError'].includes(e.name) || (e.name === 'TypeError' && e.message === 'fetch failed');
      if (!temporary) throw e;
      console.error(`Connection interrupted; keeping command receipt and memory: ${e.message}`);
      await sleep(Math.min(5000, 500 * 2 ** Math.min(4, failures++)));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
