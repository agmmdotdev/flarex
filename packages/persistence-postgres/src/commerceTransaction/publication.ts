import { runOwnedPromise } from "../ownedPromise";
import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import { fxSystemFrameworkInitializations } from "../frameworkSchema/installation/initializationSchema";
import { requireCommerceAdmission, type CommerceAdmission } from "./admission";
import { consumeCommerceRows, type CommerceRowClosure } from "./store";
import { commerceError, type CommerceTransactionError } from "./model";
import type { BoundedRequestLifetime } from "../boundedRequestLifetime";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { Effect } from "effect";
import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import { type ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import { allocateScopePublicationResult, readScopePublicationDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock } from "../commitPublication/publication";
import type { ScopePublicationContribution, ScopePublicationKernel } from "../commitPublication/scopePublicationModel";

const publishCommerceAtoms = Effect.fn("CommerceCommit.publishAtoms")(<Value>(work: (signal: AbortSignal) => Promise<Value>) =>
  runOwnedPromise(work, cause => commerceError("statementFailure", cause)));

export const finalizeCommerceCommit = Effect.fn("CommerceCommit.finalize")(function* (
  admission: CommerceAdmission,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  closure: CommerceRowClosure,
  identity: ResolveCommittedPointOutcomeInputV1,
  result: CanonicalSuccessfulResultV1,
  resultSha256: Uint8Array,
): Effect.fn.Return<CommitSeq, CommerceTransactionError> {
  const state = yield* requireCommerceAdmission(admission);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(state.clock.epoch)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  if (identity.scopeUuid !== scope.scopeUuid || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
  const facts = yield* consumeCommerceRows(closure, admission, lifetime);
  const clock = { record: state.clock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
  const now = yield* publishCommerceAtoms(() => readScopePublicationDatabaseTime(state.tx, scope.scopeId, {}));
  const allocation = yield* Effect.fromResult(allocateScopePublicationResult(clock, "publish", now))
    .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
  if (allocation.outboxSeq === null) return yield* Effect.fail(commerceError("storedCorruption"));
  const contribution: ScopePublicationContribution = {
    authorityPins: { scopeId: scope.scopeId, requestKey: identity.requestKey, functionPath: identity.expectedFunctionPath },
    rowIntents: [], identityAccessPolicySha256: identity.expectedIdentityAccessPolicySha256,
    requestSha256: identity.expectedRequestSha256, resultSha256, successfulResult: result,
    relationalFacts: facts.map(fact => ({ ...fact,
      installationSha256: state.reference.installation.installationSha256, artifactSha256: state.descriptor.artifact.identity.artifactSha256 })),
  };
  const kernel: ScopePublicationKernel = { clock, ...allocation, outboxSeq: allocation.outboxSeq, relationAdjacencyChanges: [] };
  // The existing owner bridges its Promise-based publication kernel once.
  yield* publishCommerceAtoms(signal => writeScopePublicationPrefix(state.tx, contribution, kernel, {}, signal));
  if (state.bootstrap) {
    const initialization = state.descriptor.initialization;
    if (initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (facts.length !== initialization.expectedRowCount || facts.some(fact => fact.operation !== "insert")) return yield* Effect.fail(commerceError("seedMismatch"));
    const stored = yield* runDrizzleStatementEffect(state.tx.insert(fxSystemFrameworkInitializations).values({
      scopeUuid: scope.scopeUuid, installationSha256: state.reference.installation.installationSha256,
      artifactSha256: state.descriptor.artifact.identity.artifactSha256, stepId: initialization.stepId,
      contractSha256: state.descriptor.contractSha256, datasetSha256: initialization.datasetSha256,
      rowCount: initialization.expectedRowCount, commitSeq: allocation.commitSeq,
    }).returning({ stepId: fxSystemFrameworkInitializations.stepId }), cause => commerceError("statementFailure", cause));
    if (stored.length !== 1 || stored[0]?.stepId !== initialization.stepId) return yield* Effect.fail(commerceError("storedCorruption"));
  }
  yield* publishCommerceAtoms(() => advanceScopePublicationClock(state.tx, contribution, kernel, {}));
  return allocation.commitSeq;
});
