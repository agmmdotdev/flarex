import type { CheckpointBudget } from "@flarex/query-sync/internal/checkpoint";

export const FX02B_PROBE_SCOPE_UUID = "93000000-0000-4000-8000-000000000001";
export const FX02B_PROBE_EPOCH_UUID = "93000000-0000-4000-8000-000000000002";
export const FX02B_PROBE_DEPLOYMENT_ID = "fx02b-checkpoint-probe";
export const FX02B_PROBE_SOURCE_ID = "ab".repeat(32);
export const FX02B_PROBE_OBJECT_NAME = `deployment-sync:${FX02B_PROBE_SCOPE_UUID}`;
export const FX02B_INITIAL_PATH = "/fx02b/initialize";
export const FX02B_IDENTITY_PATH = "/fx02b/identity";
export const FX02B_RESUME_PATH = "/fx02b/resume";
export const FX02B_INITIAL_BUDGET: CheckpointBudget = Object.freeze({
  sourceReads: 1, stateTransitions: 1, maximumElapsedMilliseconds: 10_000,
});
export const FX02B_RESUME_BUDGET: CheckpointBudget = Object.freeze({
  sourceReads: 1, stateTransitions: 1, maximumElapsedMilliseconds: 10_000,
});
export const FX02B_PROBE_ROUTE = Object.freeze({ deploymentId: FX02B_PROBE_DEPLOYMENT_ID,
  scopeUuid: FX02B_PROBE_SCOPE_UUID, epochUuid: FX02B_PROBE_EPOCH_UUID });