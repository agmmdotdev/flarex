import type { CorePerformanceScenario } from "./scenario";
import type { CorePerformanceFamily, CorePerformanceScenarioName } from "./scenarioCatalog";

export interface PreparedPerformanceFamily {
  scenario(name: CorePerformanceScenarioName): CorePerformanceScenario;
  dispose(): Promise<void>;
}

/** Vitest/Node resource edge. Shares bounded construction, never an attempt,
 * authority decision or result. Preparation failures retain their exact cause;
 * each factory owns cleanup of a partially constructed family. */
export function performanceFamilyLifetime(
  prepare: (family: CorePerformanceFamily) => Promise<PreparedPerformanceFamily>,
  plannedUses?: ReadonlyMap<CorePerformanceFamily, number>,
): { acquire(family: CorePerformanceFamily, name: CorePerformanceScenarioName): Promise<CorePerformanceScenario>;
  close(): Promise<void> } {
  const retained = new Map<CorePerformanceFamily, Promise<PreparedPerformanceFamily>>();
  const remaining = new Map(plannedUses);
  const releaseFailures: unknown[] = [];
  let closed = false;
  return {
    async acquire(family: CorePerformanceFamily, name: CorePerformanceScenarioName) {
      if (closed) throw new Error("Measurement family lifetime closed");
      let pending = retained.get(family);
      const reused = pending !== undefined;
      if (pending === undefined) { pending = prepare(family); retained.set(family, pending); }
      const prepared = await pending;
      const scenario = prepared.scenario(name);
      let released = false;
      return { ...scenario, preparationReuse: { family, reused },
        async dispose() {
          if (released) return;
          released = true;
          const uses = remaining.get(family);
          if (uses === undefined) return;
          remaining.set(family, uses - 1);
          if (uses === 1) {
            retained.delete(family);
            try { await prepared.dispose(); }
            catch (cause) { releaseFailures.push(cause); throw cause; }
          }
        } } satisfies CorePerformanceScenario;
    },
    async close() {
      if (closed) return;
      closed = true;
      const failures: unknown[] = [...releaseFailures];
      for (const pending of [...retained.values()].toReversed()) {
        const initialized = await Promise.allSettled([pending]);
        const result = initialized[0];
        if (result?.status === "fulfilled") try { await result.value.dispose(); } catch (cause) { failures.push(cause); }
        // Rejected preparation already failed the scenario and cleaned its own
        // partial state. Do not replace that original failure during shutdown.
      }
      retained.clear();
      if (failures.length > 0) throw new AggregateError(failures, "Measurement family shutdown failed");
    },
  };
}
