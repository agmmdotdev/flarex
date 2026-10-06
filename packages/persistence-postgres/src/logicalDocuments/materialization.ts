import { logicalMaterializationBatchBudget } from "./policy";
import { Data, Effect, Result } from "effect";
import { runPointCommitPromiseEffect } from "../pointCommitPromiseBoundary";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import { SnapshotTokenSchema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { ApplicationDocumentMaterializationOptions, ApplicationDocumentDefinitionCommand, ApplicationDocumentMaterializationCommand,
  ApplicationDocumentObservation, PointCommitDependencyV1, PreparedPointCommitApplicationRelations } from "../applicationDocumentMaterialization/model";
import { validateApplicationUniqueTransitionBudget,
  lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, loadApplicationDocumentPriorState,
  validatePointCommitDependenciesResult, preparePointCommitApplicationRelationPlan, preparePointCommitDeveloperIndexActions,
  acceptPreparedUniqueKeyPairsEffect, materializeApplicationDocumentRows, maintainPointCommitApplicationRelationsEffect,
  resetPointCommitDeveloperIndexValidations } from "../applicationDocumentMaterialization/materialization";
import { prepareUniqueKeyPairsResult } from "../applicationDocumentMaterialization/settlementPlan";
import { PointCommitSqlFailureMarkerV1, PointCommitSqlErrorV1, PointCommitConflictV1Error,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error, mapTransactionFailure } from "../pointCommitErrors";
import { AppUniqueKeyConflictError } from "../appUniqueKeys";
import { ApplicationRelationCommitResourceExhaustionError, ApplicationRelationConstraintError,
  ApplicationRelationTargetDeleteRestrictedError, ApplicationRelationTargetNotLiveError } from "../applicationRelationCommit";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { IndexPublicationProfile } from "../indexBuildStates";
import { LogicalSearchMaintenanceError, type LogicalSearchDefinition } from "./searchEntries";

export class LogicalDocumentMaterializationError extends Data.TaggedError("LogicalDocumentMaterializationError")<{
  readonly reason: "invalidAuthority" | "storedCorruption" | "limitExceeded" | "statementFailure" | "uniqueConflict" | "writeConflict" | "relationInvalid" | "relationTargetMissing" | "relationDeleteRestricted";
  readonly cause?: unknown;
}> {}
export const logicalMaterializationError = (reason: LogicalDocumentMaterializationError["reason"], cause?: unknown) =>
  new LogicalDocumentMaterializationError({ reason, ...(cause === undefined ? {} : { cause }) });

export { logicalMaterializationBatchBudget } from "./policy";


/** Source-private kernel inputs from the trusted semantic participant. These
 * are not authority tokens or an admission API. Both semantic gates are required;
 * the owner supplies its admitted definitions and borrows its settlement transaction. */
export interface LogicalDocumentMaterializationInput<Failure> {
  readonly coverage: IndexPublicationProfile;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly search?: readonly LogicalSearchDefinition[];
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">;
  /** Trusted settlement only: retain build coverage until all pages share one sequence. */
  readonly batch?: true;
  readonly requireAdmission: Effect.Effect<void, Failure>;
  readonly validateWrites: (commitSeq: CommitSeq, changes: ApplicationDocumentMaterializationCommand["rowIntents"]) => Effect.Effect<void, Failure>;
}
/** Only the physical owner calls this bridge into its existing Promise-based kernel. */
export function projectLogicalDocumentMaterializationFailure(cause: unknown): LogicalDocumentMaterializationError {
  if (cause instanceof LogicalSearchMaintenanceError)
    return logicalMaterializationError(cause.reason, cause);
  if (cause instanceof ApplicationRelationConstraintError)
    return logicalMaterializationError("relationInvalid", cause);
  if (cause instanceof ApplicationRelationTargetNotLiveError)
    return logicalMaterializationError("relationTargetMissing", cause);
  if (cause instanceof ApplicationRelationTargetDeleteRestrictedError)
    return logicalMaterializationError("relationDeleteRestricted", cause);
  if (cause instanceof ApplicationRelationCommitResourceExhaustionError)
    return logicalMaterializationError("limitExceeded", cause);
  const failure = mapTransactionFailure(cause);
  if (failure instanceof PointCommitDeveloperIndexMaintenanceUnavailableV1Error &&
    failure.reason === "entryRevisionLimitExceeded")
    return logicalMaterializationError("limitExceeded", failure);
  return logicalMaterializationError(
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
  runPointCommitPromiseEffect(work, projectLogicalDocumentMaterializationFailure);

export const enterLogicalDocumentMaterialization = Effect.fn("LogicalDocumentMaterialization.enter")(
  function* <Failure>(
    prepared: LogicalDocumentMaterializationInput<Failure>,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
    scopeClock: ScopeClockRecord,
  ) {

    yield* prepared.requireAdmission;
    if (prepared.command.authorityPins.scopeId !== authority.scopeId || prepared.command.authorityPins.deploymentId !== authority.deploymentId ||
      scopeClock.scopeId !== authority.scopeId || scopeClock.epoch !== authority.epoch ||
      scopeClock.storageGeneration !== authority.storageGeneration || scopeClock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    ).pipe(Effect.mapError((cause) => logicalMaterializationError("invalidAuthority", cause)));
    const epoch = yield* Effect.fromResult(
      projectScopeEpochUuidV1Result(scopeClock.epoch),
    ).pipe(Effect.mapError((cause) => logicalMaterializationError("invalidAuthority", cause)));
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
    let intrinsic = yield* participantKernel(() =>
      lockPointCommitIntrinsicIndexBuilds(
        tx,
        clock,
        prepared.intrinsic,
        empty,
      ),
    );
    let developer = yield* participantKernel(() =>
      lockPointCommitDeveloperIndexBuilds(
        tx,
        clock,
        prepared.developer,
        empty,
      ),
    );
    let phase: "ready" | "prepared" | "failed" | "complete" = "ready";
    let loweredCommitSeq: CommitSeq | null = null;
    let totalRows = 0;
    let totalPages = 0;
    let totalDocumentBytes = 0;
    const changedIdentities = new Set<string>();
    const coverageSteps: Array<() => Promise<void>> = [];
    const prepareDelta = Effect.fn("LogicalDocumentMaterialization.prepareDelta")(function* (
      changes: ApplicationDocumentMaterializationCommand["rowIntents"], dependencies: readonly ApplicationDocumentObservation[],
    ) {
      if (phase !== "ready" || (prepared.batch !== true && totalPages > 0))
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      phase = "failed";
      yield* prepared.requireAdmission;
      const allowed = new Set(prepared.command.rowIntents.map(row => row.tableId));
      const observed = new Set<PointCommitDependencyV1>(dependencies);
      if (dependencies.some(row => !allowed.has(row.tableId)) || new Set(dependencies.map(row => row.documentId)).size !== dependencies.length || changes.some(row => !observed.has(row))) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      if (changes.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1 || totalRows + changes.length > logicalMaterializationBatchBudget.rows ||
        totalPages >= logicalMaterializationBatchBudget.pages) return yield* Effect.fail(logicalMaterializationError("limitExceeded"));
      const pageIdentities = changes.map(row => row.documentId);
      if (new Set(pageIdentities).size !== pageIdentities.length || pageIdentities.some(id => changedIdentities.has(id)))
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      const pageBytes = changes.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0);
      if (totalDocumentBytes + pageBytes > logicalMaterializationBatchBudget.documentBytes)
        return yield* Effect.fail(logicalMaterializationError("limitExceeded"));
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
      ).pipe(Effect.mapError((cause) => logicalMaterializationError("limitExceeded", cause)));
      const heads = yield* participantKernel(() =>
        loadPointCommitHeads(tx, clock, command, prepared.options),
      );
      for (const [index, dependency] of dependencies.entries()) {
        const head = heads[index];
        if (head === undefined || dependency.readAt < 0n || dependency.readAt > scopeClock.lastCommitSeq)
          return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
        yield* Effect.fromResult(validatePointCommitDependenciesResult({
          authorityPins: { ...authorityPins, snapshotToken: { ...authorityPins.snapshotToken, commitSeq: dependency.readAt } },
          dependencies: [dependency],
        }, [head])).pipe(Effect.mapError(cause => logicalMaterializationError(
          cause instanceof PointCommitConflictV1Error ? "writeConflict" : "storedCorruption", cause)));
      }
      const changed = new Set(changes.map(row => row.tableId));
      const selectedDeveloper = developer.filter(index => changed.has(index.definition.access.tableId));
      const selectedUnique = prepared.unique.filter(definition => changed.has(definition.tableId));
      const relationDefinitions = prepared.relations?.definitions;
      const relations = relationDefinitions === undefined || relationDefinitions === null || prepared.relations === null
        ? null
        : { port: prepared.relations.port, definitions: relationDefinitions };
      const priorState = yield* loadApplicationDocumentPriorState(
        tx, command, heads, selectedDeveloper, selectedUnique, relations, prepared.options,
      ).pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
      const relationPlan = yield* participantKernel(() =>
        preparePointCommitApplicationRelationPlan(
          tx, command, priorState, relations, scopeClock.lastCommitSeq, prepared.options,
        ),
      );
      let lowered = false;
      phase = "prepared";
      const lower = Effect.fn("LogicalDocumentMaterialization.lower")(function* (commitSeq: CommitSeq) {
        if (lowered || phase !== "prepared" ||
          (loweredCommitSeq !== null && commitSeq !== loweredCommitSeq))
          return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
        lowered = true;
        phase = "failed";
        yield* prepared.requireAdmission;
        const indexActions = yield* participantKernel(() =>
          preparePointCommitDeveloperIndexActions(
            tx,
            command,
            priorState,
            selectedDeveloper,
          ),
        );
        const uniquePairs = yield* Effect.fromResult(prepareUniqueKeyPairsResult(command, priorState, selectedUnique))
          .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
        const uniqueActions = yield* acceptPreparedUniqueKeyPairsEffect(tx, command, uniquePairs, scopeClock.epoch)
          .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
        yield* prepared.validateWrites(commitSeq, changes);
        const completeCoverage = yield* participantKernel(() =>
          materializeApplicationDocumentRows(tx, {
            command, commitSeq, clock: scopeClock, loadedHeads: heads,
            intrinsicBuilds: intrinsic.filter(index => changed.has(index.definition.access.tableId)),
            developerIndexActions: indexActions, developerBuilds: selectedDeveloper,
            uniqueKeyActions: uniqueActions, uniqueDefinitions: selectedUnique, canonicalUniquePairs: uniquePairs,
            publicationProfile: prepared.coverage, options: prepared.options, deferCoverage: prepared.batch === true,
            ...(prepared.search === undefined || prepared.search.length === 0 ? {}
              : { searchContribution: Result.succeed({ definitions: prepared.search, changes }) }),
          }),
        );
        if (prepared.batch === true && completeCoverage === undefined)
          return yield* Effect.fail(logicalMaterializationError("storedCorruption"));
        if (completeCoverage !== undefined) coverageSteps.push(completeCoverage);
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
                ? logicalMaterializationError("relationDeleteRestricted", cause)
                : cause instanceof PointCommitSqlFailureMarkerV1
                  ? logicalMaterializationError("statementFailure", cause)
                  : logicalMaterializationError("storedCorruption", cause),
            ),
          );
        yield* participantKernel(() =>
          resetPointCommitDeveloperIndexValidations(tx, selectedDeveloper.map(index => index.build)),
        );

        loweredCommitSeq = commitSeq;
        if (prepared.batch === true) {
          // All writes in this transaction are lowered by this trusted batch.
          // Carry its proved source-bound baseline across pages while the
          // persisted coverage watermark waits for completeBatch().
          const advance = <T extends (typeof developer)[number]>(index: T): T =>
            changed.has(index.definition.access.tableId) && index.build.lifecycle === "enabled" &&
              index.build.maintenance === null && index.build.coveredThroughCommitSeq !== null &&
              index.build.coveredThroughCommitSeq < scopeClock.lastCommitSeq
              ? { ...index, build: { ...index.build, coveredThroughCommitSeq: scopeClock.lastCommitSeq } } : index;
          developer = developer.map(advance);
          intrinsic = intrinsic.map(advance);
        }
        totalRows += changes.length;
        totalPages++;
        totalDocumentBytes += pageBytes;
        for (const id of pageIdentities) changedIdentities.add(id);
        phase = "ready";

        return relationPlan?.prepared.adjacencyChanges ?? [];
      });
      return Object.freeze({ lower });
    });
    const completeBatch = Effect.fn("LogicalDocumentMaterialization.completeBatch")(function* () {
      if (prepared.batch !== true || phase !== "ready" || totalPages === 0)
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      phase = "failed";
      yield* prepared.requireAdmission;
      for (const complete of coverageSteps) yield* participantKernel(complete);
      phase = "complete";
    });
    return Object.freeze({ uniqueDefinitions: prepared.unique, indexDefinitions: prepared.developer, prepareDelta, completeBatch });
  },
);
