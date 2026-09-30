#!/usr/bin/env node
/** Allowlisted aggregate analysis. Private actions, chats, strategies and credentials are never exported. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

/** One narrow row per attempted match, including failed trials but excluding their private error strings. */
export function summarizeStudyRun(raw, arm) {
  const complete = raw.status === 'finished' && ['win', 'draw', 'loss'].includes(raw.score?.result) && Number.isFinite(raw.score.industry);
  const actions = raw.actions || [], decisions = raw.decisions || [], turns = raw.turnLog || [];
  const military = actions.filter(a => ['march', 'develop', 'rally', 'recall', 'turn_around'].includes(a.type));
  const samples = (raw.positionLog || []).map(p => ({ tick: p.tick, ownIndustry: p.ownIndustry,
    sideIndustry: p.sideIndustry, ownProvinces: p.ownProvinces })).filter(p => Number.isFinite(p.tick) && Number.isFinite(p.ownIndustry));
  if (Number.isFinite(raw.eliminatedAt)) samples.push({ tick: raw.eliminatedAt, ownIndustry: 0, sideIndustry: null, ownProvinces: 0 });
  if (complete) samples.push({ tick: raw.finalTick, ownIndustry: raw.score.industry, sideIndustry: null, ownProvinces: raw.score.land ?? null });
  const byTick = new Map(samples.sort((a, b) => a.tick - b.tick).map(p => [p.tick, p]));
  const progress = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  let area = 0;
  for (let i = 1; i < progress.length; i++) area += progress[i - 1].ownIndustry * (progress[i].tick - progress[i - 1].tick);
  const firstMilitary = military.find(a => a.ok), first = actions.find(a => a.ok);
  // Both runners anchor first-action timing at runner startup, including setup; no inferred game-start time.
  const elapsed = at => at ? (Date.parse(at) - Date.parse(raw.startedAt)) / 1000 : null;
  const usageFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
  const usage = Object.fromEntries(usageFields.map(k => [k, Number.isFinite(raw.usage?.[k]) ? raw.usage[k] : null]));
  const rejectionCategory = error => /Membership change already pending/.test(error || '') ? 'pending-membership'
    : /Operation ID already used/.test(error || '') ? 'operation-id-reuse'
    : /Too many messages/.test(error || '') ? 'chat-limit'
    : /not in an alliance/.test(error || '') ? 'alliance-chat-before-membership'
    : /Offer is no longer open/.test(error || '') ? 'expired-offer'
    : /No route|No path|Unknown province|rally point must/.test(error || '') ? 'route-or-target'
    : /selected, .*free|troops|manpower/.test(error || '') ? 'troop-availability'
    : 'other';
  const rejectionCounts = {};
  for (const a of actions.filter(a => a.ok === false)) {
    const category = rejectionCategory(a.error); rejectionCounts[category] = (rejectionCounts[category] || 0) + 1;
  }
  return { runId: raw.runId, country: raw.country, combatSeed: raw.combatSeed, arm,
    model: arm === 'pure-jev' ? decisions.find(d => d.model)?.model || 'typesafe/jev-1.13' : raw.modelId,
    plannerModel: arm === 'pure-jev' ? null : raw.modelId,
    mapId: raw.mapId, sourceRevision: raw.sourceRevision, interfaceVersion: raw.interfaceVersion,
    startedAt: raw.startedAt, finishedAt: raw.finishedAt ?? null, status: complete ? 'finished' : 'incomplete',
    result: complete ? raw.score.result : null, ownIndustry: complete ? raw.score.industry : null,
    finalTick: complete ? raw.finalTick : null, survived: complete ? raw.score.industry > 0 : null,
    meanOwnIndustryDuringMatch: complete && raw.finalTick > 0 ? round(area / raw.finalTick) : null,
    eliminatedAt: Number.isFinite(raw.eliminatedAt) ? raw.eliminatedAt : null,
    acceptedOrders: actions.filter(a => a.ok).length, rejectedOrders: actions.filter(a => a.ok === false).length,
    rejectionCategories: rejectionCounts,
    acceptedMilitaryOrders: military.filter(a => a.ok).length, rejectedMilitaryOrders: military.filter(a => a.ok === false).length,
    acceptedDiplomaticOrders: actions.filter(a => a.ok && a.type !== 'chat' && !military.includes(a)).length,
    acceptedMessages: actions.filter(a => a.ok && a.type === 'chat').length,
    firstAcceptedOrderSeconds: round(elapsed(first?.at)), firstAcceptedMilitarySeconds: round(elapsed(firstMilitary?.at)),
    plannerTurns: turns.length, plannerTurnSeconds: distribution(turns.map(t => t.wallMs / 1000).filter(Number.isFinite)),
    plannerTimeouts: turns.filter(t => t.timedOut).length, reportedPlannerTokens: usage,
    tacticalDecisions: decisions.length, decisionErrors: decisions.filter(d => d.error).length,
    rejectedPreviews: decisions.reduce((n, d) => n + (d.rejectedPreviews || 0), 0),
    decisionRequestSeconds: distribution(decisions.map(d => d.wallMs / 1000).filter(Number.isFinite)),
    decisionIncludingMenuSeconds: distribution(decisions.map(d => d.totalMs / 1000).filter(Number.isFinite)),
    decisionReportedCost: round(decisions.reduce((n, d) => n + (d.usage?.cost || 0), 0)),
    decisionInputTokens: decisions.reduce((n, d) => n + (d.usage?.input_tokens || 0), 0),
    decisionModels: [...new Set(decisions.map(d => d.model).filter(Boolean))],
    choiceCounts: Object.fromEntries(['attack', 'reinforce', 'rally', 'develop', 'wait', 'diplomacy'].map(k => [k, decisions.filter(d => d.kind === k).length])),
    errorPresent: !!raw.error, progress };
}

export function summarizePositions(raw) {
  const rows = raw.rows, selectors = {};
  for (const selector of ['jev', 'llm']) {
    const group = rows.filter(r => r.selector === selector), complete = group.filter(r => !r.error);
    const ids = [...new Set(group.map(r => r.position))];
    const pairs = ids.map(id => group.filter(r => r.position === id && !r.error)).filter(rs => rs.length === 2);
    selectors[selector] = { calls: group.length, errors: group.filter(r => r.error).length,
      requestSeconds: distribution(complete.map(r => r.wallMs / 1000)),
      orderConsistentPositions: pairs.filter(rs => rs[0].choice === rs[1].choice).length, consistencyDenominator: pairs.length,
      agreementWithHeuristic: complete.filter(r => r.choice === r.heuristicChoice).length,
      choiceCounts: Object.fromEntries(['attack', 'reinforce', 'rally', 'develop', 'wait'].map(k => [k, complete.filter(r => r.kind === k).length])),
      reportedCost: round(complete.reduce((n, r) => n + (r.usage?.cost || 0), 0)),
      servedModels: [...new Set(complete.map(r => r.model))] };
  }
  const matched = rows.filter(r => r.selector === 'jev' && !r.error).map(j => {
    const l = rows.find(r => r.selector === 'llm' && r.position === j.position && r.repeat === j.repeat && !r.error);
    return l ? { position: j.position, jevMs: j.wallMs, llmMs: l.wallMs, agreed: j.choice === l.choice } : null;
  }).filter(Boolean);
  const byPosition = [...new Set(matched.map(r => r.position))].map(id => {
    const rs = matched.filter(r => r.position === id); return { position: id, jevSeconds: mean(rs.map(r => r.jevMs)) / 1000,
      llmSeconds: mean(rs.map(r => r.llmMs)) / 1000, matchedShuffles: rs.length };
  });
  return { positions: raw.positions, datasetSha256: raw.datasetSha256, selectors,
    matchedCalls: matched.length, sameChoiceCalls: matched.filter(r => r.agreed).length,
    pairedPositionMeanSeconds: byPosition,
    medianRequestSpeedRatio: round(selectors.llm.requestSeconds.median / selectors.jev.requestSeconds.median),
    warning: 'Choice agreement and order consistency are diagnostics, not optimality labels or playing-strength scores.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url)), dir = resolve(root, process.argv[2] || 'data/jev-study/main');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json')));
  const rawFiles = readdirSync(resolve(root, 'data/pi')).filter(f => f.endsWith('.json') && !f.endsWith('.session.json'));
  const raw = rawFiles.map(f => JSON.parse(readFileSync(resolve(root, 'data/pi', f))));
  const processes = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
  const batchRows = (batch, batchLabel) => batch.jobs.map(j => {
    const r = raw.find(r => r.playerModel === j.alias); if (!r) throw new Error(`No raw run for ${j.alias}`);
    let workerStatus;
    if (j.statusFile) try { workerStatus = JSON.parse(readFileSync(j.statusFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const row = summarizeStudyRun(r, j.arm);
    const processRunning = processes.includes(`--model ${j.alias} `);
    return { ...row, batch: batchLabel, processExitCode: workerStatus?.exitCode ?? j.exitCode ?? null,
      processSignal: workerStatus?.signal ?? j.signal ?? null,
      executionStatus: row.status === 'finished' ? 'completed-record' : processRunning ? 'running' : 'interrupted-or-failed' };
  });
  const original = batchRows(manifest, 'original');
  const replacementIndex = process.argv.indexOf('--baseline-replacement');
  let replacementManifest, replacement = [];
  if (replacementIndex >= 0) {
    replacementManifest = JSON.parse(readFileSync(resolve(root, process.argv[replacementIndex + 1], 'manifest.json')));
    if (replacementManifest.protocolSha256 !== manifest.protocolSha256) throw new Error('Replacement protocol differs.');
    replacement = batchRows(replacementManifest, 'baseline-replacement');
    if (replacement.length !== 8 || replacement.some(r => r.arm !== 'baseline')) throw new Error('Expected all eight baseline replacement cases.');
  }
  const hybridIndex = process.argv.indexOf('--hybrid-replacement');
  let hybridManifest, hybridReplacement = [];
  if (hybridIndex >= 0) {
    hybridManifest = JSON.parse(readFileSync(resolve(root, process.argv[hybridIndex + 1], 'manifest.json')));
    if (hybridManifest.protocolSha256 !== manifest.protocolSha256) throw new Error('Hybrid replacement protocol differs.');
    hybridReplacement = batchRows(hybridManifest, 'hybrid-replacement');
    if (hybridReplacement.length !== 24 || hybridReplacement.some(r => r.arm === 'baseline')) throw new Error('Expected all 24 hybrid replacement cases.');
  }
  const hybrids = hybridReplacement.length ? hybridReplacement : original.filter(r => r.arm !== 'baseline');
  const runs = replacement.length ? [...hybrids, ...replacement] : original;
  const attempts = [...original, ...replacement, ...hybridReplacement];
  if (!process.argv.includes('--partial') && attempts.some(r => r.executionStatus === 'running'))
    throw new Error('Study still running. Use --partial for progress only.');
  const arms = {};
  for (const arm of ['baseline', 'heuristic', 'jev', 'pure-jev']) {
    const group = runs.filter(r => r.arm === arm), complete = group.filter(r => r.status === 'finished');
    const wins = complete.filter(r => r.result === 'win').length;
    arms[arm] = { attempted: group.length, finished: complete.length, incomplete: group.length - complete.length,
      wins, draws: complete.filter(r => r.result === 'draw').length, losses: complete.filter(r => r.result === 'loss').length,
      winRateWilson95: wilson(wins, complete.length), survivors: complete.filter(r => r.survived).length,
      ownIndustry: distribution(complete.map(r => r.ownIndustry)),
      meanOwnIndustryDuringMatch: distribution(complete.map(r => r.meanOwnIndustryDuringMatch)),
      acceptedMilitaryOrders: group.reduce((n, r) => n + r.acceptedMilitaryOrders, 0),
      rejectedMilitaryOrders: group.reduce((n, r) => n + r.rejectedMilitaryOrders, 0),
      acceptedMessages: group.reduce((n, r) => n + r.acceptedMessages, 0),
      plannerTurns: group.reduce((n, r) => n + r.plannerTurns, 0),
      reportedPlannerTotalTokens: group.every(r => r.reportedPlannerTokens.total !== null) ? group.reduce((n, r) => n + r.reportedPlannerTokens.total, 0) : null,
      decisionErrors: group.reduce((n, r) => n + r.decisionErrors, 0),
      meanPerMatchDecisionSeconds: distribution(group.map(r => r.decisionIncludingMenuSeconds.mean).filter(Number.isFinite)),
      decisionReportedCost: round(group.reduce((n, r) => n + r.decisionReportedCost, 0)) };
  }
  const paired = {};
  for (const other of ['heuristic', 'baseline', 'pure-jev']) {
    const complete = runs.filter(r => r.arm === 'jev' && r.status === 'finished').map(j => {
      const o = runs.find(r => r.arm === other && r.country === j.country && r.combatSeed === j.combatSeed && r.status === 'finished');
      return o ? { country: j.country, seed: j.combatSeed, difference: j.ownIndustry - o.ownIndustry } : null;
    }).filter(Boolean);
    paired[`jev-minus-${other}`] = complete.length ? { ...pairedAnalysis(complete.map(r => r.difference)), blocks: complete,
      missingPairs: 8 - complete.length, confirmatoryEndpoint: other === 'heuristic' } : { n: 0, missingPairs: 8 };
  }
  const positions = summarizePositions(JSON.parse(readFileSync(resolve(root, 'data/jev-study/positions/results.private.json'))));
  const result = { study: 'jev-council-v1', phase: manifest.phase, generatedAt: new Date().toISOString(),
    startedAt: manifest.startedAt, finishedAt: manifest.finishedAt ?? null, protocolSha256: manifest.protocolSha256,
    partial: attempts.some(r => r.executionStatus === 'running'), arms, paired, positions, runs, attempts,
    hybridReplacement: hybridReplacement.length ? { startedAt: hybridManifest.startedAt, attempted: 24,
      originalFinished: original.filter(r => r.arm !== 'baseline' && r.status === 'finished').length,
      originalInterrupted: original.filter(r => r.arm !== 'baseline' && r.status !== 'finished' && r.executionStatus !== 'running').length,
      reason: 'Six unfinished original hybrid workers disappeared after the launcher interruption. All 24 hybrid cases repeated durably, using unchanged controller files, to avoid selecting only early finishes. Final hybrid comparisons use only this complete replacement batch.' } : null,
    baselineReplacement: replacement.length ? { startedAt: replacementManifest.startedAt, attempted: replacement.length,
      originalFinished: original.filter(r => r.arm === 'baseline' && r.status === 'finished').length,
      originalInterrupted: original.filter(r => r.arm === 'baseline' && r.status !== 'finished' && r.executionStatus !== 'running').length,
      reason: 'Original launcher exited with SIGTERM; seven baseline workers disappeared without final records. Cause unknown. All eight baseline cases repeated as one later batch. Baseline comparisons are exploratory and have a different concurrency window.' } : null };
  const output = resolve(root, process.argv.includes('--partial') ? 'data/jev-study/progress.json' : 'docs/experiments/jev-results.json');
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, partial: result.partial, arms, paired }, null, 2));
}
