import { observeExecution } from "../../../execution/diagnostics/operation";
import { logicalMaterializationBatchBudget } from "./policy";
import { projectLogicalPointExpectation, type LogicalDocumentPointEvidence } from "./pointEvidence";
import type { LogicalDocumentChange } from "./workingSet";
import { Cause, Data, Effect, Exit, Result } from "effect";
import { acceptApplicationPublication,readAcceptedApplicationPublication } from "../../materialization/publicationAcceptance";
import { prepareApplicationDocumentSettlementFromOriginalsEffect } from "../../materialization/settlementPlan";
import { materializeAcceptedApplicationPublicationRows,captureOriginalApplicationPublicationBuildLocks } from "../../materialization/materialization";
import { invalidateAcceptedApplicationBindingInTransaction } from "../../../application/applicationActivation";
import { runPointCommitPromiseEffect } from "../../../commit/pointCommitPromiseBoundary";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import { SnapshotTokenSchema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { ApplicationDocumentMaterializationOptions, ApplicationDocumentDefinitionCommand, ApplicationDocumentMaterializationCommand,
  PreparedPointCommitApplicationRelations } from "../../materialization/model";
import { validateApplicationUniqueTransitionBudget, lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, loadApplicationDocumentPriorState, validatePointCommitDependenciesResult, preparePointCommitApplicationRelationPlan, maintainPointCommitApplicationRelationsEffect, resetPointCommitDeveloperIndexValidations } from "../../materialization/materialization";
import { PointCommitSqlFailureMarkerV1, PointCommitSqlErrorV1, PointCommitConflictV1Error, AppDocumentInsertionConflictError,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error, mapTransactionFailure } from "../../../commit/pointCommitErrors";
import { AppUniqueKeyConflictError } from "../../unique/appUniqueKeys";
import { ApplicationRelationCommitResourceExhaustionError, ApplicationRelationConstraintError,
  ApplicationRelationTargetDeleteRestrictedError, ApplicationRelationTargetNotLiveError } from "../../../application/relations/applicationRelationCommit";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../unique/appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../../indexes/appIndexDefinitions";
import type { TrustedScopeAuthority } from "../../../scope/scopeAuthorityResolution";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../../scope/scopeClock";
import type { IndexPublicationProfile } from "../../indexes/indexBuildStates";
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
/** Translate expected physical-owner failures at its native accepting boundary. */
export function projectLogicalDocumentMaterializationFailure(cause: unknown): LogicalDocumentMaterializationError {
  if (cause instanceof AppDocumentInsertionConflictError)
    return logicalMaterializationError("uniqueConflict", cause);
  if (cause instanceof PointCommitConflictV1Error)
    return logicalMaterializationError("writeConflict", cause);
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

/** Adapter for the remaining real Promise driver/locking boundaries. */
const participantKernel = <Value,>(work: () => Promise<Value>) =>
  runPointCommitPromiseEffect(work, projectLogicalDocumentMaterializationFailure);

export const enterLogicalDocumentMaterialization = Effect.fnUntraced(
  function* <Failure>(
    prepared: LogicalDocumentMaterializationInput<Failure>,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
    scopeClock: ScopeClockRecord,
  ) {

    yield* prepared.requireAdmission;
    invalidateAcceptedApplicationBindingInTransaction(tx);
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
    let phase: "ready" | "prepared" | "failed" | "complete" = "ready";
    let loweredCommitSeq: CommitSeq | null = null;
    let totalRows = 0;
    let totalPages = 0;
    let totalDocumentBytes = 0;
    const allowed = new Set(prepared.command.rowIntents.map(row => row.tableId));
    const changedIdentities = new Set<string>();
    const coverageSteps: Array<NonNullable<Effect.Success<ReturnType<typeof materializeAcceptedApplicationPublicationRows>>>> = [];
    const prepareDelta = Effect.fnUntraced(function* (
      changes: readonly LogicalDocumentChange[], dependencies: readonly LogicalDocumentPointEvidence[],
    ) {
      if (phase !== "ready" || (prepared.batch !== true && totalPages > 0))
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      phase = "failed";
      yield* prepared.requireAdmission;
      const observed = new Set(dependencies);
      if (dependencies.some(row => !allowed.has(row.tableId)) || new Set(dependencies.map(row => row.documentId)).size !== dependencies.length || changes.some(row => !observed.has(row))) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      if (changes.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1 || totalRows + changes.length > logicalMaterializationBatchBudget.rows ||
        totalPages >= logicalMaterializationBatchBudget.pages) return yield* Effect.fail(logicalMaterializationError("limitExceeded"));
      const pageIdentities = changes.map(row => row.documentId);
      if (new Set(pageIdentities).size !== pageIdentities.length || pageIdentities.some(id => changedIdentities.has(id)))
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      const pageBytes = changes.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0);
      if (totalDocumentBytes + pageBytes > logicalMaterializationBatchBudget.documentBytes)
        return yield* Effect.fail(logicalMaterializationError("limitExceeded"));
      const command = {
        authorityPins,
        rowIntents: changes.map(change => ({ ...change, ...projectLogicalPointExpectation(change) })),
        dependencies: dependencies.map(projectLogicalPointExpectation),
      } satisfies ApplicationDocumentMaterializationCommand;
      yield* Effect.fromResult(
        validateApplicationUniqueTransitionBudget(
          command.rowIntents,
          prepared.unique,
        ),
      ).pipe(Effect.mapError((cause) => logicalMaterializationError("limitExceeded", cause)));
      const heads = yield* participantKernel(() =>
        loadPointCommitHeads(tx, clock, command, prepared.options),
      );
      let firstPointFailure: LogicalDocumentMaterializationError | undefined;
      for (const [index, evidence] of dependencies.entries()) {
        const dependency = command.dependencies[index];
        const head = heads[index];
        if (head === undefined || dependency === undefined || evidence.readAt < 0n || evidence.readAt > scopeClock.lastCommitSeq)
          return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
        if (evidence.dependency.kind === "generatedInsertion") {
          if (head.head.kind !== "missing") firstPointFailure ??= logicalMaterializationError("uniqueConflict",
            new AppDocumentInsertionConflictError({ documentId: evidence.documentId }));
          else {
            const resolved = { ...dependency, readAt: scopeClock.lastCommitSeq };
            command.dependencies[index] = resolved;
          }
          continue;
        }
        yield* Effect.fromResult(validatePointCommitDependenciesResult({
          authorityPins: { ...authorityPins, snapshotToken: { ...authorityPins.snapshotToken, commitSeq: evidence.readAt } },
          dependencies: [dependency],
        }, [head])).pipe(Effect.mapError(cause => logicalMaterializationError(
          cause instanceof PointCommitConflictV1Error ? "writeConflict" : "storedCorruption", cause)));
      }
      if (firstPointFailure !== undefined) return yield* Effect.fail(firstPointFailure);
      const resolvedPoints = new Map(command.dependencies.map(point => [point.documentId, point]));
      command.rowIntents = yield* Effect.forEach(changes, change => {
        const point = resolvedPoints.get(change.documentId);
        return point === undefined ? Effect.fail(logicalMaterializationError("invalidAuthority"))
          : Effect.succeed({ ...change, ...point });
      });
      const changed = new Set(changes.map(row => row.tableId));
      const selectedDeveloper = developer.filter(index => changed.has(index.definition.access.tableId));
      const selectedUnique = prepared.unique.filter(definition => changed.has(definition.tableId));
      const relationDefinitions = prepared.relations?.definitions;
      const relations = relationDefinitions === undefined || relationDefinitions === null || prepared.relations === null
        ? null
        : { port: prepared.relations.port, definitions: relationDefinitions };
      const priorState = yield* loadApplicationDocumentPriorState(
        tx, command, heads, selectedDeveloper, selectedUnique, relations, prepared.options,
      ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectLogicalDocumentMaterializationFailure))));
      const relationPlan = yield* preparePointCommitApplicationRelationPlan(
          tx, command, priorState, relations, scopeClock.lastCommitSeq, prepared.options,
        ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectLogicalDocumentMaterializationFailure))));
      let lowered = false;
      phase = "prepared";
      const lower = Effect.fnUntraced(function* (commitSeq: CommitSeq) {
        if (lowered || phase !== "prepared" ||
          (loweredCommitSeq !== null && commitSeq !== loweredCommitSeq))
          return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
        lowered = true;
        phase = "failed";
        yield* prepared.requireAdmission;
        const selectedIntrinsic=intrinsic.filter(index=>changed.has(index.definition.access.tableId));
        const originalBuildLocks=yield* Effect.fromResult(captureOriginalApplicationPublicationBuildLocks(tx,clock,
          selectedIntrinsic.map(index=>index.definition),selectedDeveloper.map(index=>index.definition)))
          .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
        const settlement=yield* prepareApplicationDocumentSettlementFromOriginalsEffect(command,priorState.originalRows??[],Exit.succeed(priorState),
          selectedDeveloper.map(index=>index.definition),selectedUnique,relations,selectedIntrinsic.map(index=>index.definition));
        const acceptedPublication=yield* acceptApplicationPublication(tx,{clock,settlement,intrinsic:selectedIntrinsic.map(index=>index.definition),
          developer:selectedDeveloper.map(index=>index.definition),unique:selectedUnique,relations,indexRanges:[],relationDependencies:[],
          candidate:false,oldestAvailableCommitSeq:0n,deadline:null,originalBuildLocks,observeQuery:prepared.options.observeQuery,
          pointReadAt:new Map(command.dependencies.map(dependency=>[dependency.documentId,dependency.readAt])),
          generatedInsertions: new Set(dependencies.filter(point => point.dependency.kind === "generatedInsertion").map(point => point.documentId)),
          generatedOnlyPoints: new Set(dependencies.filter(point => point.dependency.kind === "generatedInsertion").map(point => point.documentId))})
          .pipe(Effect.catchCause(cause=>Effect.failCause(Cause.map(cause,projectLogicalDocumentMaterializationFailure))));
        yield* prepared.validateWrites(commitSeq, command.rowIntents);
        const completeCoverage = yield* materializeAcceptedApplicationPublicationRows(tx, {
            accepted:acceptedPublication,commitSeq,
            publicationProfile: prepared.coverage, options: prepared.options, deferCoverage: prepared.batch === true,
            ...(prepared.search === undefined || prepared.search.length === 0 ? {}
              : { searchContribution: Result.succeed({ definitions: prepared.search, changes: command.rowIntents }) }),
          }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectLogicalDocumentMaterializationFailure))));
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
            Effect.catchCause(cause => Effect.failCause(Cause.map(cause, (failure) =>
              failure instanceof ApplicationRelationTargetDeleteRestrictedError
                ? logicalMaterializationError("relationDeleteRestricted", failure)
                : failure instanceof PointCommitSqlFailureMarkerV1
                  ? logicalMaterializationError("statementFailure", failure)
                  : logicalMaterializationError("storedCorruption", failure)))),
          );
        const acceptedState=yield* Effect.fromResult(readAcceptedApplicationPublication(tx,acceptedPublication))
          .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
        yield* resetPointCommitDeveloperIndexValidations(tx,acceptedState.developerValidations)
          .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectLogicalDocumentMaterializationFailure))));

        loweredCommitSeq = commitSeq;
        totalRows += changes.length;
        totalPages++;
        totalDocumentBytes += pageBytes;
        for (const id of pageIdentities) changedIdentities.add(id);
        phase = "ready";

        return relationPlan?.prepared.adjacencyChanges ?? [];
      }, work => observeExecution("LogicalDocumentMaterialization.lower", work));
      return Object.freeze({ lower });
    }, work => observeExecution("LogicalDocumentMaterialization.prepareDelta", work));
    const completeBatch = Effect.fnUntraced(function* () {
      if (prepared.batch !== true || phase !== "ready" || totalPages === 0)
        return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
      phase = "failed";
      yield* prepared.requireAdmission;
      for (const complete of coverageSteps) yield* complete.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectLogicalDocumentMaterializationFailure))));
      phase = "complete";
    }, work => observeExecution("LogicalDocumentMaterialization.completeBatch", work));
    return Object.freeze({ uniqueDefinitions: prepared.unique, indexDefinitions: prepared.developer, prepareDelta, completeBatch });
  }, work => observeExecution("LogicalDocumentMaterialization.enter", work),
);
