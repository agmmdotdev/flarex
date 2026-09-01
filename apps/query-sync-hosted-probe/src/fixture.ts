import type { CatchUpTurnBudget } from
  "@flarex/query-sync/internal/orchestration";

export const FX02B_PROBE_SCOPE_UUID =
  "93000000-0000-4000-8000-000000000001";
export const FX02B_PROBE_EPOCH_UUID =
  "93000000-0000-4000-8000-000000000002";
export const FX02B_PROBE_OBJECT_NAME =
  `deployment-sync:${FX02B_PROBE_SCOPE_UUID}`;
export const FX02B_INITIAL_PATH = "/fx02b/initialize";
export const FX02B_IDENTITY_PATH = "/fx02b/identity";
export const FX02B_RESUME_PATH = "/fx02b/resume";

const COMMON_BUDGET = Object.freeze({
  sourceReads: 8,
  sourceTransportBytes: 256 * 1_024,
  modelSemanticWorkUnits: 1_024,
  modelSemanticBytes: 256 * 1_024,
  dependencyKeyExaminations: 1_024,
  canonicalDependencyBytes: 256 * 1_024,
  newWorkWindowMilliseconds: 10_000,
});

export const FX02B_INITIAL_BUDGET: CatchUpTurnBudget = Object.freeze({
  ...COMMON_BUDGET,
  admittedBatches: 1,
});

export const FX02B_RESUME_BUDGET: CatchUpTurnBudget = Object.freeze({
  ...COMMON_BUDGET,
  admittedBatches: 8,
});

export const FX02B_PROBE_OBSERVATION = Object.freeze({
  format: "flarex.scope-sync-active-head-observation",
  version: 1,
  scopeUuid: FX02B_PROBE_SCOPE_UUID,
  epochUuid: FX02B_PROBE_EPOCH_UUID,
  storageGeneration: "flarexdb_v1",
  storageGenerationFence: "1",
  observedAtCommitSeq: "0",
  activationSequence: "1",
  activeHeadSha256Hex: "00".repeat(32),
});
