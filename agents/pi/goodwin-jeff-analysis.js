#!/usr/bin/env node
/** Allowlisted local-model study results. No player text, private commands or credentials are exported. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, gameRules } from '../../src/engine.js';
export const mean = values => values.length ? values.reduce((n, x) => n + x, 0) / values.length : null;
export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}
const round = n => n === null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000;
export function distribution(values) {
  return { n: values.length, mean: round(mean(values)), median: round(quantile(values, .5)),
    p90: round(quantile(values, .9)), p95: round(quantile(values, .95)), min: values.length ? round(Math.min(...values)) : null,
    max: values.length ? round(Math.max(...values)) : null };
}
export function wilson(wins, n) {
  if (!n) return [null, null];
  const z = 1.959963984540054, p = wins / n, divisor = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / divisor;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor;
  return [round(centre - half), round(centre + half)];
}
export function pairedAnalysis(differences) {
  const n = differences.length;
  if (!n || n > 20 || differences.some(d => !Number.isFinite(d))) throw new Error('Need 1–20 finite paired differences.');
  const observed = Math.abs(mean(differences)); let extreme = 0;
  for (let mask = 0; mask < 2 ** n; mask++) {
    const value = differences.reduce((sum, d, i) => sum + ((mask >>> i) & 1 ? d : -d), 0) / n;
    if (Math.abs(value) >= observed - 1e-12) extreme++;
  }
  let x = 20260930; const bootstrap = [];
  for (let sample = 0; sample < 10000; sample++) {
    let sum = 0;
    for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; sum += differences[Math.floor(x / 4294967296 * n)]; }
    bootstrap.push(sum / n);
  }
  return { n, differences, meanDifference: round(mean(differences)), medianDifference: round(quantile(differences, .5)),
    better: differences.filter(d => d > 0).length, tied: differences.filter(d => d === 0).length, worse: differences.filter(d => d < 0).length,
    bootstrap95: [round(quantile(bootstrap, .025)), round(quantile(bootstrap, .975))],
    exactSignFlipTwoSidedP: round(extreme / 2 ** n) };
}


const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = resolve(root, process.argv[2] || 'data/goodwin-jeff/main');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json')));
const raw = readdirSync(resolve(root, 'data/pi')).filter(f => f.endsWith('.json') && !f.endsWith('.session.json'))
  .map(f => JSON.parse(readFileSync(resolve(root, 'data/pi', f))));
const sum = (rs, key) => rs.reduce((n, r) => n + (r[key] || 0), 0);
const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
function summarize(record, job) {
  if (!record) return { country: job.country, seed: job.seed, arm: job.arm, status: 'no-record' };
  if (record.country!==job.country || record.combatSeed!==job.seed || record.modelId!==manifest.modelId ||
      !manifest.sourceRevision.startsWith(record.sourceRevision)) throw new Error('Run does not match the frozen job/model/source.');
  const finished = record.status === 'finished' && ['win','draw','loss'].includes(record.score?.result) && Number.isFinite(record.score.industry);
  const decisions = record.decisions || [], turns = record.turnLog || [], actions = record.actions || [];
  const military = actions.filter(a => ['march','develop','rally','turn_around'].includes(a.type));
  let worker = null;
  try { worker = JSON.parse(readFileSync(job.statusFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const usage = Object.fromEntries(tokenKeys.map(k => [k, record.usage?.[k] ?? null]));
  return { country: job.country, seed: job.seed, arm: job.arm, runId: record.runId,
    sourceRevision: record.sourceRevision, interfaceVersion: record.interfaceVersion,
    status: finished ? 'finished' : worker?.status === 'running' ? 'running' : 'incomplete',
    processExitCode: worker?.exitCode ?? null, errorPresent: !!record.error,
    terminationReason:finished?'finished':worker?.status==='stopped-by-user'?'user-pause':record.error?'run-error':'unknown',
    result: finished ? record.score.result : null, ownIndustry: finished ? record.score.industry : null,
    finalTick: record.finalTick ?? null, eliminatedAt: record.eliminatedAt ?? null,
    usage, plannerTurns: turns.length, plannerTimeouts: turns.filter(t => t.timedOut).length,
    plannerWallSeconds: distribution(turns.map(t => t.wallMs / 1000)),
    wakeReasons: Object.fromEntries([...new Set(turns.map(t => t.wake || t.trigger))].map(k => [k, turns.filter(t => (t.wake || t.trigger) === k).length])),
    acceptedMilitary: military.filter(a => a.ok).length, rejectedMilitary: military.filter(a => a.ok === false).length,
    acceptedDiplomacy: actions.filter(a => a.ok && a.type !== 'chat' && !military.includes(a)).length,
    acceptedMessages: actions.filter(a => a.ok && a.type === 'chat').length,
    firstMilitarySeconds: military.find(a => a.ok) ? (Date.parse(military.find(a => a.ok).at) - Date.parse(record.startedAt)) / 1000 : null,
    selectorCalls: decisions.filter(d => d.model).length, selectorErrors: decisions.filter(d => d.error).length,
    selectorSkips: Object.fromEntries(['only-wait','unchanged-menu'].map(k => [k, decisions.filter(d => d.skipReason === k).length])),
    selectorInputTokens: decisions.reduce((n, d) => n + (d.usage?.input_tokens || 0), 0),
    selectorOutputTokens: decisions.reduce((n, d) => n + (d.usage?.output_tokens || 0), 0),
    selectorBusyRetries: decisions.reduce((n, d) => n + (d.busyRetries || 0), 0),
    selectorWallSeconds: distribution(decisions.filter(d => Number.isFinite(d.wallMs)).map(d => d.wallMs / 1000)),
    selectorServiceSeconds: distribution(decisions.filter(d => Number.isFinite(d.serviceMs)).map(d => d.serviceMs / 1000)),
    choiceCounts: Object.fromEntries(['attack','reinforce','develop','rally','wait'].map(k => [k, decisions.filter(d => d.kind === k).length])) };
}
const runs = manifest.jobs.map(j => summarize(raw.find(r => r.playerModel === j.alias), j));
if (!process.argv.includes('--partial') && runs.some(r => ['running','no-record'].includes(r.status))) throw new Error('Study still running; --partial is progress only.');
const arms = {};
for (const arm of ['baseline','hybrid']) {
  const rs = runs.filter(r => r.arm === arm), complete = rs.filter(r => r.status === 'finished');
  const privateRecords=manifest.jobs.filter(j=>j.arm===arm).map(j=>raw.find(r=>r.playerModel===j.alias)).filter(Boolean);
  const decisions=privateRecords.flatMap(r=>r.decisions||[]),turns=privateRecords.flatMap(r=>r.turnLog||[]);
  const usage = Object.fromEntries(tokenKeys.map(k => [k, rs.every(r => Number.isFinite(r.usage?.[k])) ? rs.reduce((n,r)=>n+r.usage[k],0) : null]));
  const weightedAssumption = usage.input === null ? null : (usage.input * .10 + usage.cacheRead * .01 + usage.output * .50 + usage.cacheWrite * .125) / 1000000;
  arms[arm] = { attempted: rs.length, finished: complete.length, incomplete: rs.length-complete.length,
    wins: complete.filter(r=>r.result==='win').length, draws: complete.filter(r=>r.result==='draw').length,
    losses: complete.filter(r=>r.result==='loss').length, industry: distribution(complete.map(r=>r.ownIndustry)),
    finalTicks: distribution(complete.map(r=>r.finalTick).filter(Number.isFinite)), usage,
    plannerTurns: sum(rs,'plannerTurns'), plannerTimeouts: sum(rs,'plannerTimeouts'),
    acceptedMilitary: sum(rs,'acceptedMilitary'), rejectedMilitary: sum(rs,'rejectedMilitary'),
    acceptedDiplomacy: sum(rs,'acceptedDiplomacy'), acceptedMessages: sum(rs,'acceptedMessages'),
    selectorCalls: sum(rs,'selectorCalls'), selectorErrors: sum(rs,'selectorErrors'),
    selectorInputTokens: sum(rs,'selectorInputTokens'), selectorOutputTokens: sum(rs,'selectorOutputTokens'),
    selectorWallSeconds:distribution(decisions.map(d=>d.wallMs/1000).filter(Number.isFinite)),
    selectorServiceSeconds:distribution(decisions.filter(d=>Number.isFinite(d.serviceMs)).map(d=>d.serviceMs/1000)),
    plannerWallSeconds:distribution(turns.map(t=>t.wallMs/1000).filter(Number.isFinite)),
    selectorChoices:Object.fromEntries(['attack','reinforce','develop','rally','wait'].map(k=>[k,decisions.filter(d=>d.kind===k).length])),
    illustrativeLunaAssumptionUsd: weightedAssumption,
    illustrativeLunaAssumptionMeanUsd: weightedAssumption === null ? null : weightedAssumption / rs.length };
  if (complete.length===rs.length && complete.every(r=>Number.isFinite(r.finalTick))) {
    const ticks=sum(complete,'finalTick');
    arms[arm].totalMatchTicks=ticks;
    arms[arm].llmTokensPer1000MatchTicks=usage.total*1000/ticks;
    arms[arm].illustrativeLunaAssumptionUsdPer1000MatchTicks=weightedAssumption*1000/ticks;
  }
}
const pairs = runs.filter(r=>r.arm==='baseline').map(b=>{
  const h=runs.find(r=>r.arm==='hybrid'&&r.country===b.country&&r.seed===b.seed);
  return {country:b.country,seed:b.seed,baselineStatus:b.status,hybridStatus:h.status,
    baselineIndustry:b.ownIndustry,hybridIndustry:h.ownIndustry,
    difference:b.status==='finished'&&h.status==='finished'?h.ownIndustry-b.ownIndustry:null};
});
const differences=pairs.map(p=>p.difference).filter(Number.isFinite);
const map=JSON.parse(readFileSync(resolve(root,'public/imperial-map.json')));
const cap=map.provinces.length*gameRules(createGame({id:'analysis',name:'Bounds',hostId:'analysis'},map)).maxDevelopment;
const missingBounds = { maxIndustry:cap,
  lowerMean:mean(pairs.map(p=>(p.hybridIndustry??0)-(p.baselineIndustry??cap))),
  upperMean:mean(pairs.map(p=>(p.hybridIndustry??cap)-(p.baselineIndustry??0))),
  interpretation:'Logical bounds for missing outcomes, not a confidence interval.' };
const positions = JSON.parse(readFileSync(resolve(root,'data/goodwin-jeff/positions/results.private.json')));
const positionSummary = {};
for (const selector of ['jeff','llm']) {
  const rs=positions.rows.filter(r=>r.selector===selector), good=rs.filter(r=>!r.error);
  positionSummary[selector] = {calls:rs.length,errors:rs.length-good.length,
    wallSeconds:distribution(good.map(r=>r.wallMs/1000)),
    choices:Object.fromEntries(['attack','reinforce','develop','rally','wait'].map(k=>[k,good.filter(r=>r.kind===k).length]))};
}
const positionPairs = [...new Set(positions.rows.map(r=>r.position))].map(position=>{
  const js=positions.rows.filter(r=>r.position===position&&r.selector==='jeff'&&!r.error);
  const ls=positions.rows.filter(r=>r.position===position&&r.selector==='llm'&&!r.error);
  return js.length===2&&ls.length===2?mean(js.map(r=>r.wallMs/1000))-mean(ls.map(r=>r.wallMs/1000)):null;
}).filter(Number.isFinite);
const latency = positionPairs.length ? pairedAnalysis(positionPairs) : null;
if (latency) { latency.slower = latency.better; latency.faster = latency.worse; delete latency.better; delete latency.worse; }
const allFinished=runs.every(r=>r.status==='finished');
const result={study: 'goodwin-jeff-events-v1', phase:manifest.phase,
  completionState:allFinished?'complete':runs.some(r=>r.terminationReason==='user-pause')?'paused-by-user':'partial',
  sourceRevision:manifest.sourceRevision,protocolSha256:manifest.protocolSha256,
  generatedAt:new Date().toISOString(),modelId:manifest.modelId,localRuntime:manifest.localRuntime,
  runs,arms,pairs,missingBounds,
  pairedIndustry: differences.length===pairs.length ? pairedAnalysis(differences) : null,
  reportedTotalTokenReduction:allFinished&&arms.baseline.usage.total?1-arms.hybrid.usage.total/arms.baseline.usage.total:null,
  illustrativeLunaAssumptionCostReduction:allFinished&&arms.baseline.illustrativeLunaAssumptionUsd?1-arms.hybrid.illustrativeLunaAssumptionUsd/arms.baseline.illustrativeLunaAssumptionUsd:null,
  positions:{positions:positions.positions,datasetSha256:positions.datasetSha256,selectors:positionSummary,
    pairedJeffMinusFullLlmSeconds:latency,
    latencyDefinition:'Jeff is one local API request. LLM is the full PI select_move turn, including acknowledgement; first-choice time was not recorded.',
    qualityWarning:'No optimality labels: agreement and order consistency are diagnostics only.'},
  costAssumptions:{llm:'Hypothetical Luna standard rates carried from the earlier cost question: uncached input 0.10, cached input 0.01, output 0.50, cache write 0.125 USD per million tokens. Not the actual Goodwin bill.',
    jeff:'No API fee; local CPU/hosting cost unknown and excluded from the illustrative dollar figures.',
    metering:'Provider-reported PI usage only; aborted requests without final usage can be undercounted. SDK cost zero placeholders are not billing.'},
  limitations:['Small exploratory eight-block comparison','Whole systems change: strategy scheduling, memory and restricted military interface','Shared inference services and concurrent rooms influence latency','Completion-selected analysis is invalid if main outcomes are missing','Bot diplomacy is not human diplomacy','Reply quality and response delays were not measured']};
const out=resolve(root, process.argv.includes('--partial')?'data/goodwin-jeff/progress.json':'docs/experiments/goodwin-jeff-results.json');
mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out,arms,pairedIndustry:result.pairedIndustry},null,2));
