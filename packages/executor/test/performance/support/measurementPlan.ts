/** Sampling belongs to the measurement harness, not runtime operation budgets. */
const plans = {
  short: { warmups: 1, measured: 3 }, full: { warmups: 3, measured: 20 },
  smoke: { warmups: 0, measured: 1 }, acceptance: { warmups: 5, measured: 100 },
} as const;

export const maxCorePerformanceSeriesSamples = plans.acceptance.warmups + plans.acceptance.measured;

export function corePerformanceSamplingPlan(mode: Readonly<{ acceptance: boolean; smoke: boolean; full: boolean }>) {
  return mode.acceptance ? plans.acceptance : mode.smoke ? plans.smoke : mode.full ? plans.full : plans.short;
}
