/** Measures one host-performance interval and clamps unusable durations to zero. */
export function elapsedPerformanceDurationSince(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
