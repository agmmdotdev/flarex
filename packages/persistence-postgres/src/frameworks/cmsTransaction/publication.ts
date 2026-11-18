import { validateCmsDocumentContribution } from "./contribution";
import { prepareApplicationDocumentParticipant, enterApplicationDocumentParticipant, readPreparedApplicationDocumentParticipant, type PreparedApplicationParticipant } from "../../storage/materialization/participant";
import { allocatePointCommitKernelResult, readPointCommitDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock,
  reproveScopePublicationPrefix } from "../../commit/publication/pointCommitProjection";
import type { ApplicationDocumentMaterializationOptions } from "../../storage/materialization/model";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../scope/scopeClock";
import type { CmsMaterializationTestHooks } from "./testSupport";
import type { FlarexMetadataDatabase } from "../../application/deployments";

import {
  PointCommitSqlErrorV1,
} from "../../commit/point/errors";
import {
  mapTransactionFailure,
} from "../../commit/point/sqlFailures";
import { ScopePublicationReferenceCapacityError, ScopePublicationReferenceConstraintError,
  ScopePublicationUnsupportedProfileError } from "../../commit/publication/scopePublicationModel";

import { type ScopePublicationClock, type ScopePublicationContribution, type ScopePublicationKernel } from "../../commit/publication/scopePublicationModel";
import type { ApplicationRelationAdjacencyChange } from "../../application/relations/applicationRelationCommit";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";

import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import { requireCmsAdmission, requirePreparedCmsApplication, type CmsAdmission, type PreparedCmsApplication } from "./admission";
import { consumeCmsDocumentClosure, type CmsDocumentClosure } from "./documents";
import { consumeSourceCmsDocumentClosure, type SourceCmsDocumentClosure } from "./documents";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission } from "../../storage/documents/logicalDocuments/documentAdmission";
import { prepareSourceCmsDocumentDelta, requireSourceCmsDocumentMaterialization, type PreparedSourceCmsDocumentMaterialization } from "./contribution";
import type { CmsRequestLifetime } from "./lifetime";
import { applyPayloadPreferenceCleanup, type PayloadPreferenceCleanupClosure } from "../payloadPreferences/cleanup";
import { preparePayloadPreferenceDeletionFacts, writePayloadPreferenceDeletionFacts, type PayloadPreferenceDeletionFact } from "../payloadPreferences/facts";
import { cmsError, type CmsTransactionError } from "./model";

import { Cause, Effect, Result } from "effect";
import { captureHostPreparationLifetime, type PreparedHostPreparationLifetime } from "../../execution/preparation/preparedHostRuntime";
import type { AppSchemaCandidateWriteGuardPlanningHead } from "../../storage/catalog/appSchemaCandidateValidation";


import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq, type ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";

import {
  AppUniqueKeyConflictError,
} from "../../storage/unique/appUniqueKeyErrors";

import { type ResolveCommittedPointOutcomeInputV1 } from "../../commit/committedPointOutcome";

import { type TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";

import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";

import type { ScopePublicationOptions } from "../../commit/publication/scopePublicationModel";
export type CmsMaterializationOptions =
  ApplicationDocumentMaterializationOptions & ScopePublicationOptions;

declare const cmsCommitPreparationBrand: unique symbol;
export interface PreparedCmsCommit { readonly [cmsCommitPreparationBrand]: true }
interface CmsCommitPreparation {
  readonly application: PreparedCmsApplication;
  readonly core: PreparedApplicationParticipant;
  readonly options: CmsMaterializationOptions;
  readonly lifetime: PreparedHostPreparationLifetime;
}
const cmsPreparations = new WeakMap<PreparedCmsCommit, CmsCommitPreparation>();
const commitDisposal = (token: PreparedCmsCommit) => () => { cmsPreparations.delete(token); };
export const readPreparedCmsApplicationCommit = Effect.fn("CmsCommit.readPreparation")(function* (token: PreparedCmsCommit) {
  const state = cmsPreparations.get(token);
  if (state === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* Effect.fromResult(state.lifetime.checkOpen()).pipe(Effect.mapError(cause => cmsError("closed", cause)));
  return state;
});

export const prepareCmsApplicationCommit = Effect.fn("CmsCommit.prepare")(
  function* (application: PreparedCmsApplication, controlDb: FlarexMetadataDatabase, authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1, options: CmsMaterializationOptions,
    planningHead: AppSchemaCandidateWriteGuardPlanningHead | undefined) {
    const state = yield* requirePreparedCmsApplication(application);
    const allocation = yield* captureHostPreparationLifetime();
    if (state.controlDb !== controlDb || allocation === undefined || allocation.charge !== state.lifetime.charge ||
      allocation.onDispose !== state.lifetime.onDispose) return yield* Effect.fail(cmsError("invalidAuthority"));
    const core = yield* prepareApplicationDocumentParticipant(state.schema, controlDb, authority, ports, options,
      [...state.tableIds], { intrinsic: state.intrinsicDefinitions, developer: state.indexDefinitions, unique: state.uniqueDefinitions,
        relations: state.relations, planningHead })
      .pipe(Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
    // SAFETY: only this original private issuer authenticates the inert identity.
    const prepared = Object.freeze({}) as PreparedCmsCommit;
    cmsPreparations.set(prepared, Object.freeze({ application, core, options, lifetime: allocation }));
    const dispose = commitDisposal(prepared);
    const registered = allocation.onDispose(dispose);
    if (Result.isFailure(registered)) dispose();
    yield* Effect.fromResult(registered).pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
    return prepared;
  });
const projectCmsPublicationFailure = (cause: unknown) => {
  if (cause instanceof ScopePublicationUnsupportedProfileError) return cmsError("unsupportedProfile", cause);
  if (cause instanceof ScopePublicationReferenceConstraintError) return cmsError(
    cause.reason === "targetNotLive" ? "relationTargetMissing" :
      cause.reason === "targetDeleteRestricted" ? "relationDeleteRestricted" : "invalidInput", cause);
  if (cause instanceof ScopePublicationReferenceCapacityError) return cmsError("limitExceeded", cause);
  const failure = mapTransactionFailure(cause);
  return cmsError(failure instanceof PointCommitSqlErrorV1 ? "statementFailure" : failure instanceof AppUniqueKeyConflictError ? "uniqueConflict" : "storedCorruption", failure);
};
const cmsKernel = <Value>(work: () => Promise<Value>) => Effect.tryPromise({ try: work, catch: projectCmsPublicationFailure });

type PreferenceFact = PayloadPreferenceDeletionFact;

/** Both CMS admission profiles use this one publication owner. Semantic
 * participants supply a checked delta; only this owner allocates and settles. */
const publishCmsOutcome = Effect.fn("CmsCommit.publishOutcome")(function* (input: Readonly<{
  tx: FlarexMetadataTransaction;
  scopeId: ReplacementScopeIdV1;
  clock: ScopePublicationClock;
  options: CmsMaterializationOptions;
  identity: ResolveCommittedPointOutcomeInputV1;
  result: CanonicalSuccessfulResultV1;
  resultSha256: Uint8Array;
  changes: LogicalDocumentChanges["changes"];
  attempts: LogicalDocumentChanges["attempts"];
  lifetime: CmsRequestLifetime;
  preferenceFacts: readonly PreferenceFact[];
  lower: (commitSeq: CommitSeq) => Effect.Effect<readonly ApplicationRelationAdjacencyChange[], CmsTransactionError>;
  hooks?: CmsMaterializationTestHooks;
}>) {
  const { tx, scopeId, clock, options, identity, result, resultSha256, changes, attempts, lifetime, preferenceFacts, lower, hooks } = input;
  const now = yield* cmsKernel(() => readPointCommitDatabaseTime(tx, scopeId, options));
  const allocation = yield* Effect.fromResult(allocatePointCommitKernelResult(clock, now)).pipe(
    Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const adjacency = yield* lower(allocation.commitSeq);
  // Positive receipts exist only after checked lowering in this transaction.
  const receipts = attempts.map(attempt => Object.freeze({ ordinal: attempt.ordinal }));
  const receiptEvidence = new WeakMap<object, (typeof attempts)[number]>();
  for (const [index, receipt] of receipts.entries()) {
    const attempt = attempts[index];
    if (attempt === undefined) return yield* Effect.fail(cmsError("storedCorruption"));
    receiptEvidence.set(receipt, attempt);
  }
  yield* lifetime.fromResult(lifetime.charge(receipts.length * 128));
  const presented = hooks?.transformReceipts?.(Object.freeze(receipts)) ?? receipts;
  if (!lifetime.isClosing() || presented.length !== receipts.length) return yield* Effect.fail(cmsError("invalidAuthority"));
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = presented[index];
    if (receipt === undefined || receiptEvidence.get(receipt) !== attempts[index])
      return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  for (const receipt of receipts) receiptEvidence.delete(receipt);
  const contribution: ScopePublicationContribution = {
    authorityPins: { scopeId, requestKey: identity.requestKey,
      functionPath: identity.expectedFunctionPath },
    rowIntents: changes,
    identityAccessPolicySha256: identity.expectedIdentityAccessPolicySha256,
    requestSha256: identity.expectedRequestSha256,
    resultSha256, successfulResult: { ...result, encoding: "application-value" },
    payloadPreferenceDeletionCount: preferenceFacts.length,
  };
  const kernel: ScopePublicationKernel = { clock, ...allocation, relationAdjacencyChanges: adjacency };
  const prefix = yield* cmsKernel(() => writeScopePublicationPrefix(tx, contribution, kernel, options));
  yield* writePayloadPreferenceDeletionFacts(tx, allocation.commitSeq, preferenceFacts);
  if (hooks?.afterPreferenceFacts !== undefined) yield* hooks.afterPreferenceFacts();
  if (preferenceFacts.length > 0 || hooks?.afterPreferenceFacts !== undefined)
    yield* cmsKernel(() => reproveScopePublicationPrefix(prefix));
  yield* advanceScopePublicationClock(tx, contribution, kernel, options).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCmsPublicationFailure))));
  return allocation.commitSeq;
});

export const enterCmsApplicationCommit = Effect.fn("CmsCommit.enter")(
  function* (
    prepared: PreparedCmsCommit,
    admission: CmsAdmission,
    lifetime: CmsRequestLifetime,
  ) {
    const state = yield* requireCmsAdmission(admission);
    const preparation = yield* readPreparedCmsApplicationCommit(prepared);
    const application = yield* requirePreparedCmsApplication(preparation.application);
    const participant = yield* readPreparedApplicationDocumentParticipant(preparation.core).pipe(
      Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
    if (
      state.preparation !== application ||
      state.schema !== application.schema ||
      state.authority.scopeId !== participant.command.authorityPins.scopeId
    )
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(state.authority.scopeId),
    ).pipe(Effect.mapError((cause) => cmsError("invalidAuthority", cause)));
    const epoch = yield* Effect.fromResult(
      projectScopeEpochUuidV1Result(state.clock.epoch),
    ).pipe(Effect.mapError((cause) => cmsError("invalidAuthority", cause)));
    let finalized = false;
    const finalize = Effect.fn("CmsCommit.finalize")(function* (
      closure: CmsDocumentClosure,
      preferenceClosure: PayloadPreferenceCleanupClosure,
      identity: ResolveCommittedPointOutcomeInputV1,
      result: CanonicalSuccessfulResultV1,
      resultSha256: Uint8Array,
      hooks?: CmsMaterializationTestHooks,
    ): Effect.fn.Return<CommitSeq, CmsTransactionError> {
      yield* requireCmsAdmission(admission, state.tx);
      if (
        finalized ||
        identity.scopeUuid !== scope.scopeUuid ||
        !lifetime.isClosing()
      )
        return yield* Effect.fail(cmsError("invalidAuthority"));
      finalized = true;
      const closed = yield* consumeCmsDocumentClosure(
        closure,
        admission,
        lifetime,
      );
      if (hooks?.afterDocumentClosure !== undefined) yield* hooks.afterDocumentClosure({
        dependencies: closed.dependencies, scans: closed.scans, uniqueReads: closed.uniqueReads,
        changes: closed.changes, noFinalRows: closed.noFinalRows, observedRows: closed.observedRows,
      });
      // Admission protects lifecycle; only settlement excludes ordinary publishers.
      const current = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(state.tx, state.authority.scopeId)
        .pipe(Effect.mapError(cause => cmsError("statementFailure", cause)));
      if (current.epoch !== state.clock.epoch || current.storageGeneration !== state.clock.storageGeneration ||
        current.storageGenerationFence !== state.clock.storageGenerationFence ||
        current.oldestAvailableCommitSeq !== state.clock.oldestAvailableCommitSeq || current.lastCommitSeq < state.clock.lastCommitSeq) {
        return yield* Effect.fail(cmsError("invalidAuthority"));
      }
      const clock = { record: current, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
      const core = yield* enterApplicationDocumentParticipant(preparation.core, state.tx, state.authority, current, state.schema)
        .pipe(Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
      const { dependencies } = yield* validateCmsDocumentContribution(admission, closed);
      const delta = yield* core.prepareDelta(closed.changes, dependencies)
        .pipe(Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
      const preferenceEvidence = yield* applyPayloadPreferenceCleanup(
        preferenceClosure,
        admission,
        lifetime,
        closed.pendingDeletions,
      );
      if (hooks?.afterPreferenceCleanup !== undefined)
        yield* hooks.afterPreferenceCleanup(preferenceEvidence);
      const binding = state.frame.payloadLifecycle;
      if (preferenceEvidence.length > 0 && binding === null) return yield* Effect.fail(cmsError("invalidAuthority"));
      const preferenceFacts = binding === null ? [] : yield* preparePayloadPreferenceDeletionFacts({
        scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid, storageGeneration: state.authority.storageGeneration,
        artifactSha256: binding.installation.artifact.artifactSha256, changes: closed.changes, evidence: preferenceEvidence });
      return yield* publishCmsOutcome({ tx: state.tx, scopeId: scope.scopeId, clock, options: preparation.options,
        identity, result, resultSha256, changes: closed.changes, attempts: closed.attempts,
        lifetime, preferenceFacts, lower: commitSeq => delta.lower(commitSeq).pipe(
          Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause)))),
        ...(hooks === undefined ? {} : { hooks }) });
    });
    return Object.freeze({ uniqueDefinitions: participant.unique, indexDefinitions: participant.developer, finalize });
  },
);

/** Source-bound CMS participant; the shared publisher above remains the only
 * allocator and outcome/clock writer for this request. */
export const enterSourceCmsCommit = Effect.fn("CmsCommit.enterSource")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
  lifetime: CmsRequestLifetime, options: CmsMaterializationOptions,
  prepared: PreparedSourceCmsDocumentMaterialization,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const template = yield* requireSourceCmsDocumentMaterialization(prepared, admission, tx);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(state.clock.epoch)).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  let finalized = false;
  const finalize = Effect.fn("CmsCommit.finalizeSource")(function* (
    closure: SourceCmsDocumentClosure, identity: ResolveCommittedPointOutcomeInputV1,
    result: CanonicalSuccessfulResultV1, resultSha256: Uint8Array,
    hooks?: CmsMaterializationTestHooks,
  ) {
    yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
      Effect.mapError(cause => cmsError("invalidAuthority", cause)));
    if (finalized || identity.scopeUuid !== scope.scopeUuid || !lifetime.isClosing())
      return yield* Effect.fail(cmsError("invalidAuthority"));
    finalized = true;
    const captured = yield* consumeSourceCmsDocumentClosure(closure, admission, tx, lifetime);
    const closed = captured.changes;
    if (hooks?.afterDocumentClosure !== undefined) yield* hooks.afterDocumentClosure({
      dependencies: closed.dependencies, scans: closed.scans, uniqueReads: closed.uniqueReads,
      changes: closed.changes, noFinalRows: closed.noFinalRows, observedRows: closed.observedRows,
    });
    const current = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, state.authority.scopeId).pipe(
      Effect.mapError(cause => cmsError("statementFailure", cause)));
    if (current.epoch !== state.clock.epoch || current.storageGeneration !== state.clock.storageGeneration ||
      current.storageGenerationFence !== state.clock.storageGenerationFence ||
      current.oldestAvailableCommitSeq !== state.clock.oldestAvailableCommitSeq ||
      current.lastCommitSeq < state.clock.lastCommitSeq) return yield* Effect.fail(cmsError("invalidAuthority"));
    const clock = { record: current, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
    const delta = yield* prepareSourceCmsDocumentDelta(admission, tx, current, closed, prepared);
    const cleanup = captured.preferenceIntents.length === 0 ? { facts: [], evidence: [] } :
      state.preferenceCleanup === undefined ? yield* Effect.fail(cmsError("invalidAuthority")) :
      yield* state.preferenceCleanup.apply(tx, state.authority, current, closed, captured.preferenceIntents);
    if (hooks?.afterPreferenceCleanup !== undefined) yield* hooks.afterPreferenceCleanup(cleanup.evidence);
    return yield* publishCmsOutcome({ tx, scopeId: scope.scopeId, clock, options,
      identity, result, resultSha256, changes: closed.changes, attempts: closed.attempts,
      lifetime, preferenceFacts: cleanup.facts, lower: delta.lower,
      ...(hooks === undefined ? {} : { hooks }) });
  });
  return Object.freeze({ uniqueDefinitions: state.unique,
    indexDefinitions: template.input.developer, finalize });
});
