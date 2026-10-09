import type { LogicalCurrencyPreparationTiming } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import type { Pool } from "pg";
import type { MixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import type { PointCommitPublicationObservation } from "../../../../persistence-postgres/src/commit/pointCommitPublicationObservation";
import type { MixedMutationEffectDiagnostics } from "./measurement";

export type { CorePerformanceScenarioName } from "./scenarioCatalog";

export interface CorePerformanceSample {
  run(publicationObservation?: PointCommitPublicationObservation, cleanupFailures?: unknown[]): Promise<unknown>;
  verify(result: unknown): Promise<void> | void;
  cleanup(): Promise<void>;
}

export interface CorePerformanceScenario {
  readonly workload?: Readonly<{ flow: string; cardinality: Readonly<Record<string, number>>;
    limitations?: readonly string[] }>;
  readonly preparationReuse?: Readonly<{ family: string; reused: boolean }>;
  readonly timings: Readonly<{ provisionAndPrepareMs: number; runtimeConstructionMs: number | null; initialSeedMs: number;
    installation?: Readonly<{ migrationMs: number; managedSetupMs?: number; coLocatedSetupMs?: number; totalInstallationMs?: number }>;
    fixturePreparation?: LogicalCurrencyPreparationTiming }>;
  readonly pools?: Readonly<{ controlPool: Pool; targetPool: Pool }>;
  setTrace?(trace: MixedMutationPerformanceTrace | undefined): void;
  setEffectDiagnostics?(diagnostics: MixedMutationEffectDiagnostics | undefined): void;
  prepareSample(id: string, index: number): Promise<CorePerformanceSample>;
  dispose(): Promise<void>;
}
