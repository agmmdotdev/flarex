import { createMixedMutationProductFixture as createCoreFixture,
  prepareMixedMutationPerformanceSeries as prepareCoreSeries } from
  "../../../executor/test/performance/support/mixedMutationProductFixture";
import { runMixedMutationWorkerd } from "./mixedMutationWorkerdAdapter";
import { makePointMutationJournalRpcSessionV1 } from "../../../executor/src/mutation/journal/pointMutationJournalRpc";
export type { MixedMutationProductFixture, MixedMutationProductFixtureHooks,
  MixedMutationFinalEntryTestContext, MixedPayloadProfileKind,
  MixedMutationPerformanceSeries } from
  "../../../executor/test/performance/support/mixedMutationProductFixture";
export const createMixedMutationProductFixture = (input: Parameters<typeof createCoreFixture>[0]) =>
  createCoreFixture({ ...input, executionHost: runMixedMutationWorkerd,
    hooks: { ...input.hooks, makeReadRpcSession: makePointMutationJournalRpcSessionV1 } });
export const prepareMixedMutationPerformanceSeries = (input: Parameters<typeof prepareCoreSeries>[0]) =>
  prepareCoreSeries({ ...input, executionHost: runMixedMutationWorkerd });
