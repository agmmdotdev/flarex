import {
  allocatePointCommitKernelResult,
  readPointCommitDatabaseTime,
  writeScopePublicationPrefix,
  advanceScopePublicationClock,
} from "../commitPublication/pointCommitProjection";
import {
  ApplicationDocumentMaterializationOptions,
  PointCommitDependencyV1,
  ApplicationDocumentDefinitionCommand,
  ApplicationDocumentMaterializationCommand,
  PreparedPointCommitCandidateSchemaWriteGuard,
  PreparedPointCommitApplicationRelations,
} from "../applicationDocumentMaterialization/model";
import type { CmsMaterializationTestHooks } from "./testSupport";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "../applicationRelationCommit";
import { hasAppSchemaCandidateWriteGuardComposition } from "../appSchemaCandidateValidation";
import {
  prepareIntrinsicIndexDefinitions,
  prepareDeveloperIndexDefinitions,
  MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  prepareUniqueConstraintDefinitions,
  validateApplicationUniqueTransitionBudget,
  prepareCandidateSchemaWriteGuard,
  prepareApplicationRelationDefinitions,
  lockPointCommitIntrinsicIndexBuilds,
  lockPointCommitDeveloperIndexBuilds,
  loadPointCommitHeads,
  validatePointCommitDependenciesResult,
  preparePointCommitApplicationRelationPlan,
  preparePointCommitDeveloperIndexActions,
  preparePointCommitUniqueKeyActions,
  runCandidateSchemaWriteGuard,
  materializeApplicationDocumentRows,
  maintainPointCommitApplicationRelationsEffect,
  resetPointCommitDeveloperIndexValidation,
} from "../applicationDocumentMaterialization/materialization";
import {
  PointCommitSqlFailureMarkerV1,
  PointCommitSqlErrorV1,
  mapTransactionFailure,
} from "../pointCommitErrors";

import {
  type ScopePublicationContribution,
  type ScopePublicationKernel,
} from "../commitPublication/scopePublicationModel";
import { SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import {
  requireCmsAdmission,
  type CmsAdmission,
  type PreparedCmsApplication,
} from "../cmsTransaction/admission";
import {
  consumeCmsDocumentClosure,
  type CmsDocumentClosure,
} from "../cmsTransaction/documents";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import {
  consumePayloadPreferenceCleanup,
  type PayloadPreferenceCleanupClosure,
} from "../payloadPreferences/cleanup";
import { fxSystemCommitPayloadPreferenceDeletions } from "../payloadPreferences/factsSchema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { cmsError, type CmsTransactionError } from "../cmsTransaction/model";

import { Effect, Schema } from "effect";

import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";

import {
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
} from "flarex-protocol/storage-authority";

import { type LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";

import { AppUniqueKeyConflictError } from "../appUniqueKeys";

import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";

import {
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationConstraintError,
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationTargetNotLiveError,
} from "../applicationRelationCommit";

import { type ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";

import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";

import type { ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
export type CmsMaterializationOptions =
  ApplicationDocumentMaterializationOptions & ScopePublicationOptions;

interface PreparedCmsCommit {
  readonly application: PreparedCmsApplication;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly candidate: PreparedPointCommitCandidateSchemaWriteGuard;
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: CmsMaterializationOptions;
}

const cmsPreparations = new WeakSet<object>();

const decodeCmsDeploymentId = Schema.decodeUnknownResult(
  TransactionGrantDeploymentIdV1Schema,
);

/** Source-private second participant. It never manufactures executor/session authority. */
export const prepareCmsApplicationCommit = Effect.fn("CmsCommit.prepare")(
  function* (
    application: PreparedCmsApplication,
    authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1,
    options: CmsMaterializationOptions,
  ) {
    if (
      options.intrinsicCreationTimeIndexes === undefined ||
      options.developerIndexes === undefined ||
      options.uniqueConstraints === undefined ||
      options.candidateSchemaWriteGuard === undefined
    ) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    const tableIds =
      application.schema.writePolicy?.writePolicies
        .filter((policy) => policy.owner === "payload")
        .map((policy) => policy.tableId) ?? [];
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    );
    const deploymentId = yield* Effect.fromResult(
      decodeCmsDeploymentId(application.schema.deploymentId),
    );
    const command: ApplicationDocumentDefinitionCommand = {
      authorityPins: {
        deploymentId,
        scopeId: scope.scopeId,
        schemaVersionId: application.schema.schemaVersionId,
      },
      rowIntents: tableIds
        .toSorted((a, b) => a - b)
        .map((tableId) => ({ tableId })),
    };
    const intrinsic = yield* prepareIntrinsicIndexDefinitions(command, options);
    const developer = yield* prepareDeveloperIndexDefinitions(command, options);
    const unique = yield* prepareUniqueConstraintDefinitions(command, options);
    const candidate = yield* prepareCandidateSchemaWriteGuard(
      command,
      {
        hasRelationAuthority: (port) =>
          hasApplicationRelationCommitAuthorityForPointCommit(port, ports),
        hasCandidateGuardAuthority: (port) =>
          hasAppSchemaCandidateWriteGuardComposition(port, ports),
      },
      options,
    );
    if (candidate === null)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const relations =
      application.schema.relations.length === 0
        ? null
        : yield* prepareApplicationRelationDefinitions(
            command,
            {
              hasRelationAuthority: (port) =>
                hasApplicationRelationCommitAuthorityForPointCommit(
                  port,
                  ports,
                ),
              hasCandidateGuardAuthority: (port) =>
                hasAppSchemaCandidateWriteGuardComposition(port, ports),
            },
            options,
          );
    if (
      application.schema.relations.length > 0 &&
      (relations?.definitions === null ||
        relations === null ||
        relations.definitions.applicationSchemaSha256 !==
          application.schema.applicationSchemaSha256 ||
        relations.definitions.schemaManifestSha256 !==
          application.schema.schemaManifestSha256 ||
        relations.definitions.boundPublicationSha256 !==
          application.schema.boundPublicationSha256 ||
        relations.definitions.definitions.length !==
          application.schema.relations.length)
    )
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const prepared: PreparedCmsCommit = Object.freeze({
      application,
      command,
      intrinsic,
      developer,
      unique,
      candidate,
      relations,
      options,
    });
    cmsPreparations.add(prepared);
    return prepared;
  },
);

/** Only the physical owner calls this bridge into its existing Promise-based kernel. */
function projectCmsKernelFailure(cause: unknown): CmsTransactionError {
  if (cause instanceof ApplicationRelationConstraintError)
    return cmsError("relationInvalid", cause);
  if (cause instanceof ApplicationRelationTargetNotLiveError)
    return cmsError("relationTargetMissing", cause);
  if (cause instanceof ApplicationRelationTargetDeleteRestrictedError)
    return cmsError("relationDeleteRestricted", cause);
  if (cause instanceof ApplicationRelationCommitResourceExhaustionError)
    return cmsError("limitExceeded", cause);
  const failure = mapTransactionFailure(cause);
  return cmsError(
    failure instanceof PointCommitSqlErrorV1
      ? "statementFailure"
      : failure instanceof AppUniqueKeyConflictError
        ? "uniqueConflict"
        : "storedCorruption",
    failure,
  );
}

/** Participant boundary over the existing shared Promise transaction kernel. */
const cmsKernel = <Value,>(work: () => Promise<Value>) =>
  Effect.tryPromise({ try: work, catch: projectCmsKernelFailure });

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
      state.authority.scopeId !== prepared.command.authorityPins.scopeId
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
    const authorityPins = {
      ...prepared.command.authorityPins,
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: state.authority.scopeId,
        epoch: state.clock.epoch,
        commitSeq: state.clock.lastCommitSeq,
      }),
    };
    const empty: ApplicationDocumentMaterializationCommand = {
      authorityPins,
      rowIntents: [],
      dependencies: [],
    };
    const intrinsic = yield* cmsKernel(() =>
      lockPointCommitIntrinsicIndexBuilds(
        state.tx,
        clock,
        prepared.intrinsic,
        empty,
      ),
    );
    const developer = yield* cmsKernel(() =>
      lockPointCommitDeveloperIndexBuilds(
        state.tx,
        clock,
        prepared.developer,
        empty,
      ),
    );
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
      const allowed = new Set(
        state.frame.payloadContent?.tables.map((table) => table.tableId),
      );
      const noFinal = yield* Effect.forEach(closed.noFinalRows, (documentId) =>
        Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId)).pipe(
          Effect.mapError((cause) => cmsError("storedCorruption", cause)),
          Effect.map(
            (row) =>
              ({
                documentId: row.id,
                tableId: row.tableId,
                rowId: row.rowId,
                dependency: {
                  kind: "appRowPoint",
                  documentId: row.id,
                  observed: {
                    kind: "missing",
                    basis: { kind: "noVisibleRevision" },
                  },
                },
              }) satisfies PointCommitDependencyV1,
          ),
        ),
      );
      const dependencies = [...closed.changes, ...noFinal].toSorted(
        (a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId),
      );
      const dispositions = new Map(
        dependencies.map((row) => [row.documentId, row]),
      );
      if (
        dispositions.size !== dependencies.length ||
        dependencies.some((row) => !allowed.has(row.tableId.toString())) ||
        closed.attempts.some(
          (attempt, index) =>
            attempt.ordinal !== index || !dispositions.has(attempt.documentId),
        ) ||
        dependencies.some(
          (row) =>
            !closed.attempts.some(
              (attempt) => attempt.documentId === row.documentId,
            ),
        )
      ) {
        return yield* Effect.fail(cmsError("invalidAuthority"));
      }
      const command: ApplicationDocumentMaterializationCommand = {
        authorityPins,
        rowIntents: closed.changes,
        dependencies,
      };
      yield* Effect.fromResult(
        validateApplicationUniqueTransitionBudget(
          closed.changes,
          prepared.unique,
        ),
      ).pipe(Effect.mapError((cause) => cmsError("limitExceeded", cause)));
      const minimumIndexRevisions = prepared.developer.reduce(
        (total, definition) =>
          total +
          closed.changes.filter(
            (row) => row.tableId === definition.access.tableId,
          ).length,
        0,
      );
      if (
        minimumIndexRevisions >
        MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
      )
        return yield* Effect.fail(cmsError("limitExceeded"));
      const heads = yield* cmsKernel(() =>
        loadPointCommitHeads(state.tx, clock, command, prepared.options),
      );
      yield* Effect.fromResult(
        validatePointCommitDependenciesResult(command, heads),
      ).pipe(Effect.mapError((cause) => cmsError("storedCorruption", cause)));
      const relationDefinitions = prepared.relations?.definitions;
      const relationPlan = yield* cmsKernel(() =>
        preparePointCommitApplicationRelationPlan(
          state.tx,
          command,
          heads,
          relationDefinitions === undefined ||
            relationDefinitions === null ||
            prepared.relations === null
            ? null
            : {
                port: prepared.relations.port,
                definitions: relationDefinitions,
              },
          state.clock.lastCommitSeq,
          prepared.options,
        ),
      );
      const now = yield* cmsKernel(() =>
        readPointCommitDatabaseTime(state.tx, scope.scopeId, prepared.options),
      );
      const allocation = yield* Effect.fromResult(
        allocatePointCommitKernelResult(clock, "publish", now),
      ).pipe(Effect.mapError((cause) => cmsError("resourceFailure", cause)));
      if (allocation.outboxSeq === null)
        return yield* Effect.fail(cmsError("storedCorruption"));
      const changed = new Set(closed.changes.map((row) => row.tableId));
      const selectedDeveloper = developer.filter((index) =>
        changed.has(index.definition.access.tableId),
      );
      const indexActions = yield* cmsKernel(() =>
        preparePointCommitDeveloperIndexActions(
          state.tx,
          command,
          heads,
          selectedDeveloper,
        ),
      );
      const uniqueActions = yield* cmsKernel(() =>
        preparePointCommitUniqueKeyActions(
          state.tx,
          command,
          heads,
          prepared.unique.filter((definition) =>
            changed.has(definition.tableId),
          ),
        ),
      );
      yield* runCandidateSchemaWriteGuard(
        state.tx,
        prepared.candidate,
        state.authority,
        state.clock,
        allocation.commitSeq,
        closed.changes.flatMap((row) =>
          row.kind === "live"
            ? [
                {
                  tableId: row.tableId,
                  rowId: row.rowId,
                  document: row.document,
                },
              ]
            : [],
        ),
      ).pipe(Effect.mapError(projectCmsKernelFailure));
      yield* cmsKernel(() =>
        materializeApplicationDocumentRows(
          state.tx,
          command,
          allocation.commitSeq,
          state.clock.epoch,
          heads,
          intrinsic.filter((index) =>
            changed.has(index.definition.access.tableId),
          ),
          indexActions,
          uniqueActions,
          prepared.options,
        ),
      );
      if (relationPlan !== null)
        yield* maintainPointCommitApplicationRelationsEffect(
          state.tx,
          command,
          allocation.commitSeq,
          relationPlan,
          prepared.options,
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof ApplicationRelationTargetDeleteRestrictedError
              ? cmsError("relationDeleteRestricted", cause)
              : cause instanceof PointCommitSqlFailureMarkerV1
                ? cmsError("statementFailure", cause)
                : cmsError("storedCorruption", cause),
          ),
        );
      for (const index of selectedDeveloper)
        yield* cmsKernel(() =>
          resetPointCommitDeveloperIndexValidation(state.tx, index.build),
        );

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
        successfulResult: result,
        payloadPreferenceDeletionCount: preferenceFacts.length,
      };
      const kernel: ScopePublicationKernel = {
        clock,
        ...allocation,
        outboxSeq: allocation.outboxSeq,
        relationAdjacencyChanges: relationPlan?.prepared.adjacencyChanges ?? [],
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
    return Object.freeze({ uniqueDefinitions: prepared.unique, finalize });
  },
);
