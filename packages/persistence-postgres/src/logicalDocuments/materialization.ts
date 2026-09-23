import { Data, Effect } from "effect";
import { SnapshotTokenSchema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { ApplicationDocumentMaterializationOptions, ApplicationDocumentDefinitionCommand, ApplicationDocumentMaterializationCommand,
  ApplicationDocumentObservation, PointCommitDependencyV1, PreparedPointCommitApplicationRelations } from "../applicationDocumentMaterialization/model";
import { MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1, validateApplicationUniqueTransitionBudget,
  lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, loadApplicationDocumentPriorState,
  validatePointCommitDependenciesResult, preparePointCommitApplicationRelationPlan, preparePointCommitDeveloperIndexActions,
  preparePointCommitUniqueKeyActions, materializeApplicationDocumentRows, maintainPointCommitApplicationRelationsEffect,
  resetPointCommitDeveloperIndexValidation } from "../applicationDocumentMaterialization/materialization";
import { PointCommitSqlFailureMarkerV1, PointCommitSqlErrorV1, PointCommitConflictV1Error, mapTransactionFailure } from "../pointCommitErrors";
import { AppUniqueKeyConflictError } from "../appUniqueKeys";
import { ApplicationRelationCommitResourceExhaustionError, ApplicationRelationConstraintError,
  ApplicationRelationTargetDeleteRestrictedError, ApplicationRelationTargetNotLiveError } from "../applicationRelationCommit";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { IndexPublicationProfile } from "../indexBuildStates";

export class LogicalDocumentMaterializationError extends Data.TaggedError("LogicalDocumentMaterializationError")<{
  readonly reason: "invalidAuthority" | "storedCorruption" | "limitExceeded" | "statementFailure" | "uniqueConflict" | "writeConflict" | "relationInvalid" | "relationTargetMissing" | "relationDeleteRestricted";
  readonly cause?: unknown;
}> {}
export const logicalMaterializationError = (reason: LogicalDocumentMaterializationError["reason"], cause?: unknown) =>
  new LogicalDocumentMaterializationError({ reason, ...(cause === undefined ? {} : { cause }) });

/** Source-private kernel inputs from the trusted semantic participant. These
 * are not authority tokens or an admission API. Both semantic gates are required;
 * the owner supplies its admitted definitions and borrows its settlement transaction. */
export interface LogicalDocumentMaterializationInput<Failure> {
  readonly coverage: IndexPublicationProfile;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">;
  readonly requireAdmission: Effect.Effect<void, Failure>;
  readonly validateWrites: (commitSeq: CommitSeq, changes: ApplicationDocumentMaterializationCommand["rowIntents"]) => Effect.Effect<void, Failure>;
}
/** Only the physical owner calls this bridge into its existing Promise-based kernel. */
export function projectLogicalDocumentMaterializationFailure(cause: unknown): LogicalDocumentMaterializationError {
  if (cause instanceof ApplicationRelationConstraintError)
    return logicalMaterializationError("relationInvalid", cause);
  if (cause instanceof ApplicationRelationTargetNotLiveError)
    return logicalMaterializationError("relationTargetMissing", cause);
  if (cause instanceof ApplicationRelationTargetDeleteRestrictedError)
    return logicalMaterializationError("relationDeleteRestricted", cause);
  if (cause instanceof ApplicationRelationCommitResourceExhaustionError)
    return logicalMaterializationError("limitExceeded", cause);
  const failure = mapTransactionFailure(cause);
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
  Effect.tryPromise({ try: work, catch: projectLogicalDocumentMaterializationFailure });

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
    const prepareDelta = Effect.fn("LogicalDocumentMaterialization.prepareDelta")(function* (
      changes: ApplicationDocumentMaterializationCommand["rowIntents"], dependencies: readonly ApplicationDocumentObservation[],
    ) {
      if (preparedDelta) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      preparedDelta = true;
      yield* prepared.requireAdmission;
      const allowed = new Set(prepared.command.rowIntents.map(row => row.tableId));
      const observed = new Set<PointCommitDependencyV1>(dependencies);
      if (dependencies.some(row => !allowed.has(row.tableId)) || new Set(dependencies.map(row => row.documentId)).size !== dependencies.length || changes.some(row => !observed.has(row))) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
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
        return yield* Effect.fail(logicalMaterializationError("limitExceeded"));
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
      const lower = Effect.fn("LogicalDocumentMaterialization.lower")(function* (commitSeq: CommitSeq) {
        if (lowered) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
        lowered = true;
        yield* prepared.requireAdmission;
        const indexActions = yield* participantKernel(() =>
          preparePointCommitDeveloperIndexActions(
            tx,
            command,
            priorState,
            selectedDeveloper,
          ),
        );
        const uniqueActions = yield* participantKernel(() =>
          preparePointCommitUniqueKeyActions(
            tx,
            command,
            priorState,
            selectedUnique,
          ),
        );
        yield* prepared.validateWrites(commitSeq, changes);
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
            selectedUnique,
            prepared.coverage,
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
                ? logicalMaterializationError("relationDeleteRestricted", cause)
                : cause instanceof PointCommitSqlFailureMarkerV1
                  ? logicalMaterializationError("statementFailure", cause)
                  : logicalMaterializationError("storedCorruption", cause),
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
    return Object.freeze({ uniqueDefinitions: prepared.unique, indexDefinitions: prepared.developer, prepareDelta });
  },
);
