import assert from 'node:assert/strict';
import type { reduceContinuationCampaigns } from './continuation-evidence';
import type { DispatchCalibration } from './dispatch-calibration-evidence';

// Presentation only: callers supply the evidence owners' decoded/validated values.
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const median = (values: readonly number[]) => { const sorted = values.toSorted((a, b) => a - b), n = sorted.length; assert(n > 0);
  const upper = sorted[Math.floor(n / 2)]; assert(upper !== undefined);
  if(n % 2) return upper; const lower = sorted[n / 2 - 1]; assert(lower !== undefined); return (lower + upper) / 2; };
export function summarizeDispatch(reports: Awaited<ReturnType<typeof reduceContinuationCampaigns>>, calibration: DispatchCalibration) {
const rows = reports.map(report => {
  const state = report.states.find(s => s.observed); assert(state);
  const gaps = state.sites.filter(s => s.site.startsWith('Gap.'));
  const gapFamily = (site: string) => site.endsWith(' -> enter:Node.callback:TCPWRAP') || site.endsWith(' -> enter:Driver.pgReceive') ? 'before-response-callback' :
    /^Gap\.leave:VM\..* -> enter:VM\./.test(site) ? 'between-promise-reactions' :
    site.startsWith('Gap.leave:Node.') ? 'after-node-callback' : 'other';
  const gapGroups = [...new Set(gaps.map(s => gapFamily(s.site)))].map(name => ({ name,
    cyclePercent: sum(gaps.filter(s => gapFamily(s.site) === name).map(s => s.cyclePercent)),
    callsPerWorkflow: sum(gaps.filter(s => gapFamily(s.site) === name).map(s => s.calls)) }));
  const totalGaps = state.groups.find(g => g.name === 'boundary-gaps'); assert(totalGaps);
  assert(Math.abs(sum(gapGroups.map(g => g.cyclePercent)) - totalGaps.cyclePercent) < 1e-8);
  return { label: report.label, groups: state.groups, gapGroups,
    topGaps: gaps.toSorted((a, b) => b.cyclePercent - a.cyclePercent).slice(0,12),
    nodeSites: state.sites.filter(s => s.site.startsWith('Node.')),
    rootMeans: report.states.map(s => ({ observed: s.observed, n: s.n, flarexMs: s.flarexMs, nativeMs: s.nativeMs })) };
});
const observed = calibration.blocks.filter(b => b.observed), bare = calibration.blocks.filter(b => !b.observed);
assert.equal(observed.length, 10); assert.equal(bare.length, 10);
const residual = observed.map(b => ({ block: b.block,
  emptyCyclesPerBoundary: sum(b.record.cycles.buckets.filter(s => s.site === 'Empty.boundary').map(s => s.cycles)) / b.iterations,
  gapCyclesPerBoundary: sum(b.record.cycles.buckets.filter(s => s.site.startsWith('Gap.')).map(s => s.cycles)) / b.iterations,
  probeCyclesPerBoundary: b.record.probeCycles / b.iterations,
  gcCyclesPerBoundary: b.record.gcCycles / b.iterations,
  rawCyclesPerBoundary: b.record.totalCycles / b.iterations,
  threadMs: b.threadMs }));
const summary = { rows, emptyCalibration: { blocks: residual,
  medianEmptyCycles: median(residual.map(b => b.emptyCyclesPerBoundary)),
  medianGapCycles: median(residual.map(b => b.gapCyclesPerBoundary)),
  medianProbeCycles: median(residual.map(b => b.probeCyclesPerBoundary)),
  observedMedianThreadMs: median(observed.map(b => b.threadMs)), bareMedianThreadMs: median(bare.map(b => b.threadMs)),
  warning: 'All empty-body and gap cycles here are diagnostic edges, loop/dispatch and measurement perturbation. Do not subtract this replay from actual workflows.' } };
return summary;
}
