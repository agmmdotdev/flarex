import { validateCmsDocumentContribution } from "./contribution";
import { prepareApplicationDocumentParticipant, enterApplicationDocumentParticipant } from "../applicationDocumentMaterialization/participant";
import { allocatePointCommitKernelResult, readPointCommitDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock } from "../commitPublication/pointCommitProjection";
import type { ApplicationDocumentMaterializationOptions } from "../applicationDocumentMaterialization/model";
import type { CmsMaterializationTestHooks } from "./testSupport";

import { PointCommitSqlErrorV1, mapTransactionFailure } from "../pointCommitErrors";

import { type ScopePublicationContribution, type ScopePublicationKernel } from "../commitPublication/scopePublicationModel";

import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import { requireCmsAdmission, type CmsAdmission, type PreparedCmsApplication } from "../cmsTransaction/admission";
import { consumeCmsDocumentClosure, type CmsDocumentClosure } from "../cmsTransaction/documents";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import { consumePayloadPreferenceCleanup, type PayloadPreferenceCleanupClosure } from "../payloadPreferences/cleanup";
import { fxSystemCommitPayloadPreferenceDeletions } from "../payloadPreferences/factsSchema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { cmsError, type CmsTransactionError } from "../cmsTransaction/model";

import { Effect } from "effect";

import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";

import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";

import { AppUniqueKeyConflictError } from "../appUniqueKeys";

import { type ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";

import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";

import type { ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
export type CmsMaterializationOptions =
  ApplicationDocumentMaterializationOptions & ScopePublicationOptions;

export const prepareCmsApplicationCommit = Effect.fn("CmsCommit.prepare")(
  function* (application: PreparedCmsApplication, authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1, options: CmsMaterializationOptions) {
    const core = yield* prepareApplicationDocumentParticipant(application.schema, authority, ports, options,
      application.schema.writePolicy?.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId) ?? [])
      .pipe(Effect.catchTag("ApplicationParticipantError", error => Effect.fail(cmsError(error.reason, error.cause))));
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
    const clock = {
      record: state.clock,
      scopeUuid: scope.scopeUuid,
      epochUuid: epoch.epochUuid,
    };
    const core = yield* enterApplicationDocumentParticipant(prepared.core, state.tx, state.authority, state.clock, state.schema)
      .pipe(Effect.catchTag("ApplicationParticipantError", error => Effect.fail(cmsError(error.reason, error.cause))));
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
        identity.scopeUuid !== clock.scopeUuid ||
        !lifetime.isClosing()
      )
        return yield* Effect.fail(cmsError("invalidAuthority"));
      finalized = true;
      const closed = yield* consumeCmsDocumentClosure(
        closure,
        admission,
        lifetime,
      );
      const preferenceEvidence = yield* consumePayloadPreferenceCleanup(
        preferenceClosure,
        admission,
        lifetime,
        closed.pendingDeletions,
      );
      if (hooks?.afterPreferenceClosure !== undefined)
        yield* hooks.afterPreferenceClosure(preferenceEvidence);
      const preferenceFacts: Omit<
        typeof fxSystemCommitPayloadPreferenceDeletions.$inferInsert,
        "commitSeq" | "changeOrdinal"
      >[] = [];
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
      const { dependencies } = yield* validateCmsDocumentContribution(admission, closed);
      const delta = yield* core.prepareDelta(closed.changes, dependencies)
        .pipe(Effect.catchTag("ApplicationParticipantError", error => Effect.fail(cmsError(error.reason, error.cause))));
      const now = yield* cmsKernel(() =>
        readPointCommitDatabaseTime(state.tx, scope.scopeId, prepared.options),
      );
      const allocation = yield* Effect.fromResult(
        allocatePointCommitKernelResult(clock, now),
      ).pipe(Effect.mapError((cause) => cmsError("resourceFailure", cause)));
      const adjacency = yield* delta.lower(allocation.commitSeq)
        .pipe(Effect.catchTag("ApplicationParticipantError", error => Effect.fail(cmsError(error.reason, error.cause))));
      // Positive receipts exist only after checked Application lowering. This issuer
      // and registry are unique to this physical transaction, admission and closure.
      const receipts = closed.attempts.map((attempt) =>
        Object.freeze({ ordinal: attempt.ordinal }),
      );
      const receiptEvidence = new WeakMap<
        object,
        (typeof closed.attempts)[number]
      >();
      for (const [index, receipt] of receipts.entries()) {
        const attempt = closed.attempts[index];
        if (attempt === undefined)
          return yield* Effect.fail(cmsError("storedCorruption"));
        receiptEvidence.set(receipt, attempt);
      }
      yield* Effect.fromResult(lifetime.charge(receipts.length * 128));
      const presented =
        hooks?.transformReceipts?.(Object.freeze(receipts)) ?? receipts;
      if (!lifetime.isClosing() || presented.length !== receipts.length) {
        return yield* Effect.fail(cmsError("invalidAuthority"));
      }
      for (let index = 0; index < receipts.length; index += 1) {
        const receipt = presented[index];
        if (
          receipt === undefined ||
          receiptEvidence.get(receipt) !== closed.attempts[index]
        )
          return yield* Effect.fail(cmsError("invalidAuthority"));
      }
      for (const receipt of receipts) receiptEvidence.delete(receipt);
      const contribution: ScopePublicationContribution = {
        authorityPins: {
          scopeId: scope.scopeId,
          requestKey: identity.requestKey,
          functionPath: identity.expectedFunctionPath,
        },
        rowIntents: closed.changes,
        identityAccessPolicySha256: identity.expectedIdentityAccessPolicySha256,
        requestSha256: identity.expectedRequestSha256,
        resultSha256,
        successfulResult: { ...result, encoding: "application-value" },
        payloadPreferenceDeletionCount: preferenceFacts.length,
      };
      const kernel: ScopePublicationKernel = {
        clock,
        ...allocation,
        relationAdjacencyChanges: adjacency,
      };
      yield* cmsKernel(() =>
        writeScopePublicationPrefix(
          state.tx,
          contribution,
          kernel,
          prepared.options,
        ),
      );
      if (preferenceFacts.length > 0) {
        const written = yield* runDrizzleStatementEffect(
          state.tx
            .insert(fxSystemCommitPayloadPreferenceDeletions)
            .values(
              preferenceFacts.map((fact, changeOrdinal) => ({
                ...fact,
                changeOrdinal,
                commitSeq: allocation.commitSeq,
              })),
            )
            .returning({
              ordinal: fxSystemCommitPayloadPreferenceDeletions.changeOrdinal,
            }),
          (cause) => cmsError("statementFailure", cause),
        );
        if (
          written.length !== preferenceFacts.length ||
          new Set(written.map((row) => row.ordinal)).size !== written.length ||
          written.some(
            (row) => row.ordinal < 0 || row.ordinal >= preferenceFacts.length,
          )
        )
          return yield* Effect.fail(cmsError("storedCorruption"));
      }
      if (hooks?.afterPreferenceFacts !== undefined)
        yield* hooks.afterPreferenceFacts();
      yield* cmsKernel(() =>
        advanceScopePublicationClock(
          state.tx,
          contribution,
          kernel,
          prepared.options,
        ),
      );
      return allocation.commitSeq;
    });
    return Object.freeze({ uniqueDefinitions: core.uniqueDefinitions, finalize });
  },
);
