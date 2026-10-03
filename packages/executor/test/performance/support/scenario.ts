import type { LogicalCurrencyPreparationTiming } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import type { Pool } from "pg";
import type { MixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";

export type CorePerformanceScenarioName = "payload-create" | "medusa-workflow" |
  "mixed-product" | "mixed-payload" | "mixed-workflow";

export interface CorePerformanceSample {
  run(): Promise<unknown>;
  verify(result: unknown): Promise<void> | void;
  cleanup(): Promise<void>;
}

export interface CorePerformanceScenario {
  readonly timings: Readonly<{ provisionAndPrepareMs: number; runtimeConstructionMs: number | null; initialSeedMs: number;
    installation?: Readonly<{ migrationMs: number; managedSetupMs?: number; coLocatedSetupMs?: number; totalInstallationMs?: number }>;
    fixturePreparation?: LogicalCurrencyPreparationTiming }>;
  readonly pools: Readonly<{ controlPool: Pool; targetPool: Pool }>;
  setTrace?(trace: MixedMutationPerformanceTrace | undefined): void;
  prepareSample(id: string, index: number): Promise<CorePerformanceSample>;
  dispose(): Promise<void>;
}
