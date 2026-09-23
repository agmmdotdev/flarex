import { validateCmsDocumentContribution } from "./contribution";
import { prepareApplicationDocumentParticipant, enterApplicationDocumentParticipant } from "../applicationDocumentMaterialization/participant";
import { allocatePointCommitKernelResult, readPointCommitDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock } from "../commitPublication/pointCommitProjection";
import type { ApplicationDocumentMaterializationOptions } from "../applicationDocumentMaterialization/model";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../scopeClock";
import type { CmsMaterializationTestHooks } from "./testSupport";
import type { FlarexMetadataDatabase } from "../deployments";

import { PointCommitSqlErrorV1, mapTransactionFailure } from "../pointCommitErrors";

import { type ScopePublicationClock, type ScopePublicationContribution, type ScopePublicationKernel } from "../commitPublication/scopePublicationModel";
import type { ApplicationRelationAdjacencyChange } from "../applicationRelationCommit";
import type { LogicalDocumentChanges } from "../logicalDocuments/workingSet";

import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import { requireCmsAdmission, type CmsAdmission, type PreparedCmsApplication } from "../cmsTransaction/admission";
import { consumeCmsDocumentClosure, type CmsDocumentClosure } from "../cmsTransaction/documents";
import { consumeSourceCmsDocumentClosure, type SourceCmsDocumentClosure } from "../cmsTransaction/documents";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission } from "../logicalDocuments/documentAdmission";
import { prepareSourceCmsDocumentDelta } from "./contribution";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import { applyPayloadPreferenceCleanup, type PayloadPreferenceCleanupClosure } from "../payloadPreferences/cleanup";
import { fxSystemCommitPayloadPreferenceDeletions } from "../payloadPreferences/factsSchema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { cmsError, type CmsTransactionError } from "../cmsTransaction/model";

import { Effect } from "effect";

import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";

import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq, type ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";

import { AppUniqueKeyConflictError } from "../appUniqueKeys";

import { type ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";

import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";

import type { ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
export type CmsMaterializationOptions =
  ApplicationDocumentMaterializationOptions & ScopePublicationOptions;

export const prepareCmsApplicationCommit = Effect.fn("CmsCommit.prepare")(
  function* (application: PreparedCmsApplication, controlDb: FlarexMetadataDatabase, authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1, options: CmsMaterializationOptions) {
    const core = yield* prepareApplicationDocumentParticipant(application.schema, controlDb, authority, ports, options,
      application.schema.writePolicy?.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId) ?? [])
      .pipe(Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
    const prepared = Object.freeze({ application, core, options });
    cmsPreparations.add(prepared);
    return prepared;
  });
const cmsPreparations = new WeakSet<object>();
type PreparedCmsCommit = Effect.Success<ReturnType<typeof prepareCmsApplicationCommit>>;
const cmsKernel = <Value>(work: () => Promise<Value>) => Effect.tryPromise({ try: work, catch: cause => {
  const failure = mapTransactionFailure(cause);
  return cmsError(failure instanceof PointCommitSqlErrorV1 ? "statementFailure" : failure instanceof AppUniqueKeyConflictError ? "uniqueConflict" : "storedCorruption", failure);
}});

type PreferenceFact = Omit<typeof fxSystemCommitPayloadPreferenceDeletions.$inferInsert, "commitSeq" | "changeOrdinal">;

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
  yield* Effect.fromResult(lifetime.charge(receipts.length * 128));
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
  yield* cmsKernel(() => writeScopePublicationPrefix(tx, contribution, kernel, options));
  if (preferenceFacts.length > 0) {
    const written = yield* runDrizzleStatementEffect(tx.insert(fxSystemCommitPayloadPreferenceDeletions)
      .values(preferenceFacts.map((fact, changeOrdinal) => ({ ...fact, changeOrdinal, commitSeq: allocation.commitSeq })))
      .returning({ ordinal: fxSystemCommitPayloadPreferenceDeletions.changeOrdinal }),
    cause => cmsError("statementFailure", cause));
    if (written.length !== preferenceFacts.length || new Set(written.map(row => row.ordinal)).size !== written.length ||
      written.some(row => row.ordinal < 0 || row.ordinal >= preferenceFacts.length))
      return yield* Effect.fail(cmsError("storedCorruption"));
  }
  if (hooks?.afterPreferenceFacts !== undefined) yield* hooks.afterPreferenceFacts();
  yield* cmsKernel(() => advanceScopePublicationClock(tx, contribution, kernel, options));
  return allocation.commitSeq;
});

export const enterCmsApplicationCommit = Effect.fn("CmsCommit.enter")(
  function* (
    prepared: PreparedCmsCommit,
    admission: CmsAdmission,
    lifetime: CmsRequestLifetime,
  ) {
    const state = yield* requireCmsAdmission(admission);
    if (
      !cmsPreparations.has(prepared) ||
      state.schema !== prepared.application.schema ||
      state.authority.scopeId !== prepared.core.command.authorityPins.scopeId
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
        changes: closed.changes, noFinalRows: closed.noFinalRows,
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
      const core = yield* enterApplicationDocumentParticipant(prepared.core, state.tx, state.authority, current, state.schema)
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
      const preferenceFacts: PreferenceFact[] = [];
      for (const cleanup of preferenceEvidence) {
        if (cleanup.preferenceIds.length === 0) continue;
        const content = closed.changes.find(
          (row) => row.documentId === cleanup.documentId,
        );
        const binding = state.frame.payloadLifecycle;
        if (content?.kind !== "deleted" || binding === null)
          return yield* Effect.fail(cmsError("invalidAuthority"));
        for (const preferenceId of cleanup.preferenceIds)
          preferenceFacts.push({
            scopeUuid: scope.scopeUuid,
            epochUuid: epoch.epochUuid,
            codecVersion: 1,
            storageGeneration: state.authority.storageGeneration,
            artifactSha256: binding.installation.artifact.artifactSha256,
            preferenceId,
            contentTableId: content.tableId,
            contentRowId: appRowIdHexV1ToBytes(content.rowId),
          });
      }
      return yield* publishCmsOutcome({ tx: state.tx, scopeId: scope.scopeId, clock, options: prepared.options,
        identity, result, resultSha256, changes: closed.changes, attempts: closed.attempts,
        lifetime, preferenceFacts, lower: commitSeq => delta.lower(commitSeq).pipe(
          Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause)))),
        ...(hooks === undefined ? {} : { hooks }) });
    });
    return Object.freeze({ uniqueDefinitions: prepared.core.unique, indexDefinitions: prepared.core.developer, finalize });
  },
);

/** Source-bound CMS participant; the shared publisher above remains the only
 * allocator and outcome/clock writer for this request. */
export const enterSourceCmsCommit = Effect.fn("CmsCommit.enterSource")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
  lifetime: CmsRequestLifetime, options: CmsMaterializationOptions,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
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
    const closed = yield* consumeSourceCmsDocumentClosure(closure, admission, tx, lifetime);
    if (hooks?.afterDocumentClosure !== undefined) yield* hooks.afterDocumentClosure({
      dependencies: closed.dependencies, scans: closed.scans, uniqueReads: closed.uniqueReads,
      changes: closed.changes, noFinalRows: closed.noFinalRows,
    });
    const current = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, state.authority.scopeId).pipe(
      Effect.mapError(cause => cmsError("statementFailure", cause)));
    if (current.epoch !== state.clock.epoch || current.storageGeneration !== state.clock.storageGeneration ||
      current.storageGenerationFence !== state.clock.storageGenerationFence ||
      current.oldestAvailableCommitSeq !== state.clock.oldestAvailableCommitSeq ||
      current.lastCommitSeq < state.clock.lastCommitSeq) return yield* Effect.fail(cmsError("invalidAuthority"));
    const clock = { record: current, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
    const delta = yield* prepareSourceCmsDocumentDelta(admission, tx, current, closed, options);
    if (hooks?.afterPreferenceCleanup !== undefined) yield* hooks.afterPreferenceCleanup([]);
    return yield* publishCmsOutcome({ tx, scopeId: scope.scopeId, clock, options,
      identity, result, resultSha256, changes: closed.changes, attempts: closed.attempts,
      lifetime, preferenceFacts: [], lower: delta.lower,
      ...(hooks === undefined ? {} : { hooks }) });
  });
  return Object.freeze({ uniqueDefinitions: state.unique,
    indexDefinitions: state.indexes.filter(index => index.access.kind === "developer"), finalize });
});
