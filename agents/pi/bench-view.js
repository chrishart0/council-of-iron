/** Read-only campaign ledger. All model-supplied strings are rendered with textContent. */
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const fmt = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—';
const date = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const record = list => ['win', 'draw', 'loss'].map(result => list.filter(run => run.result === result).length).join(' / ');
const median = list => list.length ? [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)] : null;
const svgNode = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const palette = { deepseek: '#6fd8dc', qwen: '#eec877', luna: '#9babfa', grok: '#e89189',
  sonnet: '#c79ce9', opus: '#c7b0dc', sol: '#9fdcae', external: '#b7c9d1' };
const color = run => palette[run.modelGroup] || '#b7c9d1';
const dash = run => run.harness === 'Pi' ? '' : run.harness === 'Codex' || run.harness === 'Codex CLI' ? '8 5'
  : run.harness === 'Grok CLI' ? '2 5' : '10 4 2 4';
const styleName = run => dash(run) ? run.harness === 'Grok CLI' ? 'dotted' : 'dashed' : '';
const harness = run => run.harness || run.client;
let runs = [], tasks = [];

export function selectRuns(items, filters) {
  return items.filter(run => (filters.model === 'all' || run.modelId === filters.model) &&
    (filters.harness === 'all' || harness(run) === filters.harness) &&
    (filters.arena === 'all' || run.arena === filters.arena) &&
    (filters.country === 'all' || run.country === filters.country) &&
    (filters.preset === 'all' || run.preset === filters.preset) &&
    (filters.seed === 'all' || run.combatSeed === filters.seed));
}

function appendCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value == null ? '—' : String(value);
  if (className) cell.className = className;
  row.append(cell);
}
function emptyRow(body, span, message) {
  const row = document.createElement('tr');
  appendCell(row, message);
  row.firstChild.colSpan = span;
  body.append(row);
}
function legend(root, entries) {
  root.replaceChildren();
  for (const [label, run] of entries) {
    const item = document.createElement('span');
    item.className = styleName(run);
    item.style.setProperty('--series', color(run));
    const line = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = label;
    item.append(line, text);
    root.append(item);
  }
}
function axes(svg, values, xLabel, xMin, xMax) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', '0 0 960 340');
  const left = 70, right = 924, top = 35, bottom = 284;
  const max = Math.max(1, ...values);
  const y = value => bottom - value / max * (bottom - top);
  const x = value => xMax === xMin ? (left + right) / 2 : left + (value - xMin) / (xMax - xMin) * (right - left);
  for (let index = 0; index <= 4; index++) {
    const value = max * index / 4, yy = y(value);
    svg.append(svgNode('line', { x1: left, y1: yy, x2: right, y2: yy, stroke: '#375464',
      'stroke-dasharray': index ? '3 5' : '' }));
    const tick = svgNode('text', { x: left - 12, y: yy + 4, 'text-anchor': 'end', fill: '#96abb8', 'font-size': 12 });
    tick.textContent = fmt(value);
    svg.append(tick);
  }
  for (const [value, anchor] of [[xMin, 'start'], [xMax, 'end']]) {
    const tick = svgNode('text', { x: x(value), y: 317, 'text-anchor': anchor,
      fill: '#96abb8', 'font-size': 12 });
    tick.textContent = xLabel(value);
    svg.append(tick);
  }
  return { x, y };
}
function noData(svg, message) {
  svg.replaceChildren(); svg.setAttribute('viewBox', '0 0 960 340');
  const label = svgNode('text', { x: 480, y: 170, 'text-anchor': 'middle', fill: '#96abb8', 'font-size': 18 });
  label.textContent = message;
  svg.append(label);
}

function drawTrend(selected) {
  const metric = $('measure').value;
  const measured = selected.filter(run => Number.isFinite(run[metric])).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  $('plot-detail').textContent = measured.length
    ? `${measured.length} completed runs with ${$('measure').selectedOptions[0].text.toLowerCase()}. Filled marks won; rings lost.`
    : 'No completed runs recorded this measure.';
  const svg = $('plot');
  if (!measured.length) { noData(svg, 'No measured runs in this selection'); legend($('trend-legend'), []); return; }
  const times = measured.map(run => Date.parse(run.startedAt));
  const { x, y } = axes(svg, measured.map(run => run[metric]), value => date(new Date(value).toISOString()),
    Math.min(...times), Math.max(...times));
  const series = new Map();
  for (const run of measured) {
    const key = `${run.modelId}\u0000${harness(run)}\u0000${run.arena}`;
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(run);
  }
  for (const group of series.values()) {
    const first = group[0];
    if (group.length > 1) svg.append(svgNode('polyline', {
      points: group.map(run => `${x(Date.parse(run.startedAt))},${y(run[metric])}`).join(' '),
      fill: 'none', stroke: color(first), 'stroke-width': 2.5,
      'stroke-dasharray': dash(first), 'stroke-linecap': 'round', opacity: .9,
    }));
    for (const run of group) {
      const point = svgNode('circle', { cx: x(Date.parse(run.startedAt)), cy: y(run[metric]), r: 6,
        fill: run.result === 'win' ? color(run) : '#0d202b', stroke: color(run), 'stroke-width': 2.5 });
      const title = svgNode('title');
      title.textContent = `${date(run.startedAt)} · ${run.modelId} · ${harness(run)} · ${run.country} · ${run.result} · ${fmt(run[metric])}`;
      point.append(title); svg.append(point);
    }
  }
  legend($('trend-legend'), [...series.values()].map(group => [`${group[0].modelId} · ${harness(group[0])} · ${group[0].arena}`, group[0]]));
}

function drawProgress(selected) {
  const eligible = selected.filter(run => Array.isArray(run.progress) && run.progress.length > 1);
  const shown = eligible.slice(-8), svg = $('progress-plot');
  $('progress-detail').textContent = eligible.length
    ? `Own industry by game tick. Showing ${shown.length} most recent of ${eligible.length} runs with samples.`
    : 'No per-turn position samples for this selection.';
  if (!shown.length) { noData(svg, 'No position samples in this selection'); legend($('progress-legend'), []); return; }
  const showSide = $('show-side').checked;
  const points = shown.flatMap(run => run.progress);
  const values = points.flatMap(point => [point.ownIndustry, ...(showSide && Number.isFinite(point.sideIndustry) ? [point.sideIndustry] : [])]);
  const { x, y } = axes(svg, values, value => `Tick ${fmt(value)}`, 0, Math.max(...points.map(point => point.tick)));
  for (const run of shown) {
    const own = run.progress.filter(point => Number.isFinite(point.ownIndustry));
    if (own.length > 1) svg.append(svgNode('polyline', { points: own.map(point => `${x(point.tick)},${y(point.ownIndustry)}`).join(' '),
      fill: 'none', stroke: color(run), 'stroke-width': 2.5, 'stroke-dasharray': dash(run), opacity: .9 }));
    if (showSide) {
      const side = run.progress.filter(point => Number.isFinite(point.sideIndustry));
      if (side.length > 1) svg.append(svgNode('polyline', { points: side.map(point => `${x(point.tick)},${y(point.sideIndustry)}`).join(' '),
        fill: 'none', stroke: color(run), 'stroke-width': 1.5, 'stroke-dasharray': '3 6', opacity: .7 }));
    }
    const last = own.at(-1), mark = svgNode('circle', { cx: x(last.tick), cy: y(last.ownIndustry), r: 5,
      fill: run.result === 'win' ? color(run) : '#0d202b', stroke: color(run), 'stroke-width': 2 });
    const title = svgNode('title');
    title.textContent = `${run.modelId} · ${harness(run)} · ${run.country} · ${run.result} · ${fmt(last.ownIndustry)} industry at tick ${last.tick}`;
    mark.append(title); svg.append(mark);
  }
  legend($('progress-legend'), shown.map(run => [`${run.modelId} · ${harness(run)} · ${run.country} · ${run.match}`, run]));
}

function drawScorecard(selected) {
  const groups = new Map();
  for (const run of selected) {
    const key = `${run.modelId}\u0000${harness(run)}\u0000${run.arena}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const body = $('scorecard'); body.replaceChildren();
  for (const group of groups.values()) {
    const first = group[0], row = document.createElement('tr');
    const failed = group.reduce((sum, run) => sum + (run.failedToolCalls || 0), 0);
    const calls = group.reduce((sum, run) => sum + (run.toolCalls || 0), 0);
    const tokens = group.map(run => run.tokensPerAction).filter(Number.isFinite);
    for (const value of [first.modelId, harness(first), first.arena, group.length, record(group),
      fmt(median(group.map(run => run.industry))), `${failed} / ${calls}`, fmt(median(tokens))]) appendCell(row, value);
    body.append(row);
  }
  if (!groups.size) emptyRow(body, 8, 'No completed runs in this selection.');
}

function drawLedger(selected) {
  const body = $('rows'); body.replaceChildren();
  for (const run of [...selected].reverse()) {
    const row = document.createElement('tr');
    const cells = [date(run.startedAt), run.modelId, harness(run), run.arena, run.country, run.preset,
      run.combatSeed || '—', run.sourceRevision?.slice(0, 8) || '—', run.result,
      fmt(run.industry), fmt(run.acceptedActions), fmt(run.rejectedActions),
      `${fmt(run.failedToolCalls)} / ${fmt(run.toolCalls)}`, fmt(run.totalTokens),
      fmt(run.firstActionSeconds), fmt(run.meanTurnSeconds), fmt(run.timedOutTurns)];
    for (const [index, value] of cells.entries()) appendCell(row, value,
      index === 8 ? run.result === 'win' ? 'positive' : run.result === 'loss' ? 'negative' : ''
        : index >= 9 ? 'numeric' : '');
    body.append(row);
  }
  if (!selected.length) emptyRow(body, 17, 'No completed runs in this selection.');
}

function drawPairs(selected) {
  const groups = new Map();
  for (const run of selected.filter(run => run.combatSeed && run.sourceRevision)) {
    const key = [run.modelId, run.country, run.preset, run.combatSeed, run.sourceRevision].join('\u0000');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const body = $('pairs'); body.replaceChildren();
  for (const group of groups.values()) {
    const unique = [...new Map(group.map(run => [harness(run), run])).values()];
    if (unique.length < 2) continue;
    const first = unique[0];
    for (const second of unique.slice(1)) {
      const row = document.createElement('tr');
      const delta = key => Number.isFinite(first[key]) && Number.isFinite(second[key]) ? fmt(second[key] - first[key]) : '—';
      for (const value of [first.modelId, first.country, first.combatSeed, first.sourceRevision.slice(0, 8),
        harness(first), `${first.result} / ${first.industry}`, harness(second), `${second.result} / ${second.industry}`,
        delta('industry'), delta('failedToolCalls'), delta('totalTokens')]) appendCell(row, value);
      body.append(row);
    }
  }
  if (!body.children.length) emptyRow(body, 11, 'No cross-harness runs with the same model, country, clock, seed and code yet.');
}

function drawTasks() {
  const model = $('model').value, harnessFilter = $('harness').value;
  const selected = tasks.filter(run => (model === 'all' || run.modelGroup === runs.find(item => item.modelId === model)?.modelGroup) &&
    (harnessFilter === 'all' || run.client === harnessFilter));
  const body = $('task-rows'); body.replaceChildren();
  for (const run of [...selected].reverse()) {
    const row = document.createElement('tr');
    const cells = [date(run.startedAt), run.modelGroup.toUpperCase(), `${run.client} ${run.access}`,
      run.success ? 'Yes' : 'No', `${fmt(run.correctSteps)} / ${fmt(run.requiredSteps)}`,
      fmt(run.acceptedOrders), fmt(run.rejectedOrders), `${fmt(run.failedToolCalls)} / ${fmt(run.toolCalls)}`,
      fmt(run.firstActionSeconds), fmt(run.completionSeconds), fmt(run.totalTokens), fmt(run.uncachedTokens)];
    for (const [index, value] of cells.entries()) appendCell(row, value, index === 3 ? run.success ? 'positive' : 'negative' : '');
    body.append(row);
  }
  if (!selected.length) emptyRow(body, 12, 'No fixed-board task for this selection.');
}

function draw() {
  const filters = Object.fromEntries(['model', 'harness', 'arena', 'country', 'preset', 'seed'].map(id => [id, $(id).value]));
  const selected = selectRuns(runs, filters);
  $('count').textContent = selected.length;
  $('record').textContent = selected.length ? record(selected) : '—';
  $('industry').textContent = fmt(median(selected.map(run => run.industry)));
  $('failures').textContent = `${selected.reduce((sum, run) => sum + (run.failedToolCalls || 0), 0)} / ${selected.reduce((sum, run) => sum + (run.toolCalls || 0), 0)}`;
  drawScorecard(selected); drawTrend(selected); drawProgress(selected); drawLedger(selected); drawPairs(selected); drawTasks();
}

function addOptions(id, values) {
  for (const value of [...new Set(values.filter(Boolean))].sort()) {
    const option = document.createElement('option'); option.value = value; option.textContent = value;
    $(id).append(option);
  }
}
for (const id of ['model', 'harness', 'arena', 'country', 'preset', 'seed', 'measure', 'show-side'])
  $(id).addEventListener('change', draw);
try {
  const response = await fetch('./benchmarks.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.schemaVersion !== 4 || !data.mapId || !Array.isArray(data.runs) || data.runs.some(run => run.mapId !== data.mapId))
    throw new Error('Unsupported benchmark file');
  $('map-id').textContent = data.mapId;
  runs = data.runs;
  addOptions('model', runs.map(run => run.modelId));
  addOptions('harness', runs.map(harness));
  addOptions('arena', runs.map(run => run.arena));
  addOptions('country', runs.map(run => run.country));
  addOptions('seed', runs.map(run => run.combatSeed));
  draw();
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = `Could not load benchmarks.json (${error.message}). Serve this folder with: python -m http.server 8000`;
}
try {
  const response = await fetch('./task-benchmarks.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.schemaVersion !== 1 || !Array.isArray(data.runs)) throw new Error('Unsupported fixed-board benchmark file');
  tasks = data.runs; drawTasks();
} catch (error) {
  $('task-error').hidden = false;
  $('task-error').textContent = `Could not load task-benchmarks.json (${error.message}).`;
}
