"""Plot published aggregate Jev evidence, never private chats or run transcripts."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'docs/experiments/jev-results.json').read_text())
assert not data['partial'], 'Do not plot an unfinished study as final evidence.'
arms = ['baseline', 'heuristic', 'jev', 'pure-jev']
labels = ['Current PI', 'LLM + code', 'LLM + Jev', 'Pure Jev']
colors = ['#526779', '#31705d', '#ad632e', '#795f92']
countries = ['britain', 'france', 'germany', 'russia', 'ottoman', 'qing', 'japan', 'usa']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(1, 2, figsize=(16, 6), gridspec_kw={'width_ratios': [1.65, 1]})
fig.patch.set_facecolor('#faf9f6')
for ax in axes:
    ax.set_facecolor('#faf9f6')
    ax.set_axisbelow(True)
    ax.grid(axis='y', color='#deddd8', linewidth=.7)
x = np.arange(len(countries))
for i, (arm, label, color) in enumerate(zip(arms, labels, colors)):
    values = []
    for country in countries:
        run = next(r for r in data['runs'] if r['arm'] == arm and r['country'] == country)
        values.append(run['ownIndustry'] if run['status'] == 'finished' else np.nan)
    axes[0].bar(x + (i - 1.5) * .19, values, .18, label=label, color=color)
    missing = [k for k, value in enumerate(values) if np.isnan(value)]
    axes[0].scatter(x[missing] + (i - 1.5) * .19, [.6] * len(missing), marker='x', color=color, s=25)
axes[0].set_xticks(x, ['Britain', 'France', 'Germany', 'Russia', 'Ottoman', 'Qing', 'Japan', 'USA'], rotation=25)
axes[0].set_ylabel('Final personal industry')
axes[0].set_title('Replacement batch: final industry when completed', loc='left', fontweight='bold')
axes[0].legend(frameon=False, ncol=2, loc='upper left')
axes[0].text(.03, .72, '× = missing result, never a loss\nJev trials stopped: OpenRouter HTTP 402',
             transform=axes[0].transAxes, va='top', fontsize=10)
positions = data['positions']['pairedPositionMeanSeconds']
for i, (field, label, color) in enumerate([('llmSeconds', 'PI LLM', colors[0]), ('jevSeconds', 'Jev', colors[2])]):
    values = [p[field] for p in positions]
    jitter = np.linspace(-.13, .13, len(values))
    axes[1].scatter(i + jitter, values, color=color, alpha=.7, s=25)
    axes[1].plot([i - .23, i + .23], [np.median(values)] * 2, color=color, linewidth=3)
axes[1].set_xticks([0, 1], ['PI LLM', 'Jev'])
axes[1].set_xlim(-.5, 1.5)
axes[1].set_ylabel('Decision response seconds (log scale)')
axes[1].set_yscale('log')
axes[1].set_title('Identical candidate menus', loc='left', fontweight='bold')
axes[1].text(.04, .95, '22 recorded positions\nTwo option permutations each\nDots: each position’s mean latency',
             transform=axes[1].transAxes, va='top', fontsize=10)
fig.suptitle('Jev in Council of Iron: speed and playing results are separate measurements',
             x=.055, ha='left', fontsize=16, fontweight='bold')
finished = sum(r['status'] == 'finished' for r in data['runs'])
fig.text(.055, .025, f'Replacement batch: {finished}/32 completed games. Original interrupted batch retained separately. '
         'Bot opponents; no human diplomacy or balance inference.', fontsize=10, color='#555555')
fig.subplots_adjust(left=.06, right=.975, top=.84, bottom=.2, wspace=.25)
out = ROOT / 'docs/experiments/jev-comparison.png'
fig.savefig(out, dpi=160, facecolor=fig.get_facecolor())
print(out)
