
import { ApplicationDocumentMaterializationOptions, PointCommitDependencyV1, ApplicationDocumentDefinitionCommand, ApplicationDocumentMaterializationCommand, PreparedPointCommitCandidateSchemaWriteGuard, PreparedPointCommitApplicationRelations } from "../applicationDocumentMaterialization/model";

import { hasApplicationRelationCommitAuthorityForPointCommit } from "../applicationRelationCommit";
import { hasAppSchemaCandidateWriteGuardComposition } from "../appSchemaCandidateValidation";
import { prepareIntrinsicIndexDefinitions, prepareDeveloperIndexDefinitions, MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1, prepareUniqueConstraintDefinitions, validateApplicationUniqueTransitionBudget, prepareCandidateSchemaWriteGuard, prepareApplicationRelationDefinitions, lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, validatePointCommitDependenciesResult, preparePointCommitApplicationRelationPlan, preparePointCommitDeveloperIndexActions, preparePointCommitUniqueKeyActions, runCandidateSchemaWriteGuard, materializeApplicationDocumentRows, maintainPointCommitApplicationRelationsEffect, resetPointCommitDeveloperIndexValidation } from "../applicationDocumentMaterialization/materialization";
import { PointCommitSqlFailureMarkerV1, PointCommitSqlErrorV1, mapTransactionFailure } from "../pointCommitErrors";

import { SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";

import { Data, Effect, Schema } from "effect";

import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";

import { type LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";

import { AppUniqueKeyConflictError } from "../appUniqueKeys";

import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";

import { ApplicationRelationCommitResourceExhaustionError, ApplicationRelationConstraintError, ApplicationRelationTargetDeleteRestrictedError, ApplicationRelationTargetNotLiveError } from "../applicationRelationCommit";

import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";

import type { ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
export type ApplicationParticipantOptions =
  ApplicationDocumentMaterializationOptions & ScopePublicationOptions;

import type { ApplicationRelationSchemaAuthority } from "../applicationRelationSchemaAuthority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { CatalogTableId } from "flarex-protocol/catalog";
export class ApplicationParticipantError extends Data.TaggedError("ApplicationParticipantError")<{
 readonly reason: "invalidAuthority" | "storedCorruption" | "limitExceeded" | "statementFailure" | "uniqueConflict" | "relationInvalid" | "relationTargetMissing" | "relationDeleteRestricted";
 readonly cause?: unknown;
}> {}
const participantError = (reason: ApplicationParticipantError["reason"], cause?: unknown) => new ApplicationParticipantError({ reason, ...(cause === undefined ? {} : { cause }) });
export interface PreparedApplicationParticipant {
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly candidate: PreparedPointCommitCandidateSchemaWriteGuard;
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: ApplicationParticipantOptions;
}

const preparations = new WeakSet<object>();

const decodeParticipantDeploymentId = Schema.decodeUnknownResult(
  TransactionGrantDeploymentIdV1Schema,
);

/** Source-private document lowering; domain participants retain write authority. */
export const prepareApplicationDocumentParticipant = Effect.fn("ApplicationParticipant.prepare")(
  function* (
    schema: ApplicationRelationSchemaAuthority,
    authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1,
    options: ApplicationParticipantOptions,
    tableIds: readonly CatalogTableId[],
  ) {
    if (
      options.intrinsicCreationTimeIndexes === undefined ||
      options.developerIndexes === undefined ||
      options.uniqueConstraints === undefined ||
      options.candidateSchemaWriteGuard === undefined
    ) {
      return yield* Effect.fail(participantError("invalidAuthority"));
    }
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    );
    const deploymentId = yield* Effect.fromResult(
      decodeParticipantDeploymentId(schema.deploymentId),
    );
    const command: ApplicationDocumentDefinitionCommand = {
      authorityPins: {
        deploymentId,
        scopeId: scope.scopeId,
        schemaVersionId: schema.schemaVersionId,
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
      return yield* Effect.fail(participantError("invalidAuthority"));
    const relations =
      schema.relations.length === 0
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
      schema.relations.length > 0 &&
      (relations?.definitions === null ||
        relations === null ||
        relations.definitions.applicationSchemaSha256 !==
          schema.applicationSchemaSha256 ||
        relations.definitions.schemaManifestSha256 !==
          schema.schemaManifestSha256 ||
        relations.definitions.boundPublicationSha256 !==
          schema.boundPublicationSha256 ||
        relations.definitions.definitions.length !==
          schema.relations.length)
    )
      return yield* Effect.fail(participantError("invalidAuthority"));
    const prepared: PreparedApplicationParticipant = Object.freeze({
      schema,
      command,
      intrinsic,
      developer,
      unique,
      candidate,
      relations,
      options,
    });
    preparations.add(prepared);
    return prepared;
  },
);

/** Only the physical owner calls this bridge into its existing Promise-based kernel. */
function projectParticipantKernelFailure(cause: unknown): ApplicationParticipantError {
  if (cause instanceof ApplicationRelationConstraintError)
    return participantError("relationInvalid", cause);
  if (cause instanceof ApplicationRelationTargetNotLiveError)
    return participantError("relationTargetMissing", cause);
  if (cause instanceof ApplicationRelationTargetDeleteRestrictedError)
    return participantError("relationDeleteRestricted", cause);
  if (cause instanceof ApplicationRelationCommitResourceExhaustionError)
    return participantError("limitExceeded", cause);
  const failure = mapTransactionFailure(cause);
  return participantError(
    failure instanceof PointCommitSqlErrorV1
      ? "statementFailure"
      : failure instanceof AppUniqueKeyConflictError
        ? "uniqueConflict"
        : "storedCorruption",
    failure,
  );
}

/** Participant boundary over the existing shared Promise transaction kernel. */
const participantKernel = <Value,>(work: () => Promise<Value>) =>
  Effect.tryPromise({ try: work, catch: projectParticipantKernelFailure });

export const enterApplicationDocumentParticipant = Effect.fn("ApplicationParticipant.enter")(
  function* (
    prepared: PreparedApplicationParticipant,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
    scopeClock: ScopeClockRecord,
    schema: ApplicationRelationSchemaAuthority,
  ) {

    if (
      !preparations.has(prepared) ||
      schema !== prepared.schema ||
      authority.scopeId !== prepared.command.authorityPins.scopeId
    )
      return yield* Effect.fail(participantError("invalidAuthority"));
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    ).pipe(Effect.mapError((cause) => participantError("invalidAuthority", cause)));
    const epoch = yield* Effect.fromResult(
      projectScopeEpochUuidV1Result(scopeClock.epoch),
    ).pipe(Effect.mapError((cause) => participantError("invalidAuthority", cause)));
    const clock = {
      record: scopeClock,
      scopeUuid: scope.scopeUuid,
      epochUuid: epoch.epochUuid,
    };
    const authorityPins = {
      ...prepared.command.authorityPins,
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: authority.scopeId,
        epoch: scopeClock.epoch,
        commitSeq: scopeClock.lastCommitSeq,
      }),
    };
    const empty: ApplicationDocumentMaterializationCommand = {
      authorityPins,
      rowIntents: [],
      dependencies: [],
    };
    const intrinsic = yield* participantKernel(() =>
      lockPointCommitIntrinsicIndexBuilds(
        tx,
        clock,
        prepared.intrinsic,
        empty,
      ),
    );
    const developer = yield* participantKernel(() =>
      lockPointCommitDeveloperIndexBuilds(
        tx,
        clock,
        prepared.developer,
        empty,
      ),
    );
    let preparedDelta = false;
    const prepareDelta = Effect.fn("ApplicationParticipant.prepareDelta")(function* (
      changes: ApplicationDocumentMaterializationCommand["rowIntents"], dependencies: readonly PointCommitDependencyV1[],
    ) {
      if (preparedDelta) return yield* Effect.fail(participantError("invalidAuthority"));
      preparedDelta = true;
      const allowed = new Set(prepared.command.rowIntents.map(row => row.tableId));
      if (dependencies.some(row => !allowed.has(row.tableId)) || new Set(dependencies.map(row => row.documentId)).size !== dependencies.length || changes.some(row => !dependencies.includes(row))) return yield* Effect.fail(participantError("invalidAuthority"));
      const command: ApplicationDocumentMaterializationCommand = {
        authorityPins,
        rowIntents: changes,
        dependencies,
      };
      yield* Effect.fromResult(
        validateApplicationUniqueTransitionBudget(
          changes,
          prepared.unique,
        ),
      ).pipe(Effect.mapError((cause) => participantError("limitExceeded", cause)));
      const minimumIndexRevisions = prepared.developer.reduce(
        (total, definition) =>
          total +
          changes.filter(
            (row) => row.tableId === definition.access.tableId,
          ).length,
        0,
      );
      if (
        minimumIndexRevisions >
        MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
      )
        return yield* Effect.fail(participantError("limitExceeded"));
      const heads = yield* participantKernel(() =>
        loadPointCommitHeads(tx, clock, command, prepared.options),
      );
      yield* Effect.fromResult(
        validatePointCommitDependenciesResult(command, heads),
      ).pipe(Effect.mapError((cause) => participantError("storedCorruption", cause)));
      const relationDefinitions = prepared.relations?.definitions;
      const relationPlan = yield* participantKernel(() =>
        preparePointCommitApplicationRelationPlan(
          tx,
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
          scopeClock.lastCommitSeq,
          prepared.options,
        ),
      );
      let lowered = false;
      const lower = Effect.fn("ApplicationParticipant.lower")(function* (commitSeq: CommitSeq) {
        if (lowered) return yield* Effect.fail(participantError("invalidAuthority"));
        lowered = true;
      const changed = new Set(changes.map((row) => row.tableId));
      const selectedDeveloper = developer.filter((index) =>
        changed.has(index.definition.access.tableId),
      );
      const indexActions = yield* participantKernel(() =>
        preparePointCommitDeveloperIndexActions(
          tx,
          command,
          heads,
          selectedDeveloper,
        ),
      );
      const uniqueActions = yield* participantKernel(() =>
        preparePointCommitUniqueKeyActions(
          tx,
          command,
          heads,
          prepared.unique.filter((definition) =>
            changed.has(definition.tableId),
          ),
        ),
      );
      yield* runCandidateSchemaWriteGuard(
        tx,
        prepared.candidate,
        authority,
        scopeClock,
        commitSeq,
        changes.flatMap((row) =>
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
      ).pipe(Effect.mapError(projectParticipantKernelFailure));
      yield* participantKernel(() =>
        materializeApplicationDocumentRows(
          tx,
          command,
          commitSeq,
          scopeClock,
          heads,
          intrinsic.filter((index) =>
            changed.has(index.definition.access.tableId),
          ),
          indexActions,
          selectedDeveloper,
          uniqueActions,
          prepared.unique.filter(definition => changed.has(definition.tableId)),
          prepared.options,
        ),
      );
      if (relationPlan !== null)
        yield* maintainPointCommitApplicationRelationsEffect(
          tx,
          command,
          commitSeq,
          relationPlan,
          prepared.options,
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof ApplicationRelationTargetDeleteRestrictedError
              ? participantError("relationDeleteRestricted", cause)
              : cause instanceof PointCommitSqlFailureMarkerV1
                ? participantError("statementFailure", cause)
                : participantError("storedCorruption", cause),
          ),
        );
      for (const index of selectedDeveloper)
        yield* participantKernel(() =>
          resetPointCommitDeveloperIndexValidation(tx, index.build),
        );

        return relationPlan?.prepared.adjacencyChanges ?? [];
      });
      return Object.freeze({ lower });
    });
    return Object.freeze({ uniqueDefinitions: prepared.unique, prepareDelta });
  },
);
