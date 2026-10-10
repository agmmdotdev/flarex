import {
  Effect,
  Exit,
  Result,
  Cause,
} from "effect";
import type {
  AppRowTransaction,
} from "../../storage/documents/appRows";
import type {
  CatalogTableId,
} from "flarex-protocol/catalog";
import type {
  LockedPointCommitClockV1,
  PointCommitKernelResultV1,
  PointCommitReadyForPublicationV1,
} from "./lockedState";
import {
  type AcceptedApplicationPublication,
  readAcceptedApplicationPublication,
} from "../../storage/materialization/publicationAcceptance";
import type {
  PreparedPointCommitCandidateSchemaWriteGuard,
} from "../../storage/materialization/model";
import type {
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import {
  type LogicalSearchDefinition,
  LogicalSearchMaintenanceError,
} from "../../storage/documents/logicalDocuments/searchEntries";
import type {
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import {
  invalidateAcceptedApplicationBindingInTransaction,
} from "../../application/activation/acceptedBinding";
import {
  corruption,
  type PointCommitCorruptionV1Error,
} from "./errors";
import {
  allocatePointCommitKernelResult,
} from "../publication/pointCommitProjection";
import {
  runPointCommitPromiseEffect,
} from "./promiseBoundary";
import {
  emitTransactionStep,
  runCandidateSchemaWriteGuard,
  materializeAcceptedApplicationPublicationRows,
  maintainPointCommitApplicationRelationsEffect,
  resetPointCommitDeveloperIndexValidations,
} from "../../storage/materialization/materialization";
import {
  mapPointCommitCallbackFailure,
  PointCommitSqlFailureMarkerV1,
} from "./sqlFailures";
import {
  captureAppSchemaCandidateWriteGuardLockedHead,
} from "../../storage/catalog/appSchemaCandidateValidation";
import {
  observePointCommitPublicationEffect,
} from "./observation";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";

/** Application and finite settlement share one row/index/unique/relation lowering owner.
 * The command carries material graph facts; no durable seal is needed here. */
export const lowerAcceptedPointCommit = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  command: import("../../storage/materialization/model").ApplicationDocumentMaterializationCommand & Readonly<{
    attemptedTableIds: readonly CatalogTableId[] | null; participantMaterialDocumentIds: ReadonlySet<string>;
  }>,
  clock: LockedPointCommitClockV1,
  acceptedPublication:AcceptedApplicationPublication,
  candidateSchemaWriteGuard: PreparedPointCommitCandidateSchemaWriteGuard | null,
  preliminaryAuthority: TrustedScopeAuthority,
  admittedParticipants: readonly Readonly<{search: readonly LogicalSearchDefinition[]}>[],
  options: PointCommitTransactionProofOptionsV1,
) {
  options.publicationObservation?.record({ kind: "phase", phase: "lowering", edge: "begin" });
  return yield* Effect.gen(function* () {
    invalidateAcceptedApplicationBindingInTransaction(tx);
    const state=yield* Effect.fromResult(readAcceptedApplicationPublication(tx,acceptedPublication));
    if (state.input.settlement.command!==command) return yield* Effect.fail(corruption("commandInvalid"));
    const developerDefinitions=state.input.developer;
    const allocation = (yield* Effect.fromResult(allocatePointCommitKernelResult(
        clock,
        state.databaseNowMilliseconds,
      )));
    const relation=state.input.settlement.relation;
    if (relation===undefined) return yield* Effect.die(new Error("Accepted relation preparation was not reached"));
    if (Exit.isFailure(relation)) return yield* Effect.failCause(relation.cause);
    const relationPlan=relation.value;
    if (
      relationPlan !== null &&
      relationPlan.prepared.distinctFinalTargetCount > 0
    ) {
      yield* runPointCommitPromiseEffect(() => emitTransactionStep(options, command, "relationTargetsValidated"), mapPointCommitCallbackFailure);
    }
    if (candidateSchemaWriteGuard !== null) {
      const lockedHead=yield* Effect.fromResult(captureAppSchemaCandidateWriteGuardLockedHead(tx,candidateSchemaWriteGuard.guard,
        preliminaryAuthority,state.candidateHead)).pipe(Effect.mapError(()=>corruption("candidateSchemaValidationInvalid")));
      const guardResult = (yield* runCandidateSchemaWriteGuard(
        tx,
        candidateSchemaWriteGuard,
        preliminaryAuthority,
        clock.record,
        allocation.commitSeq,
        command.rowIntents.flatMap((intent) => intent.kind === "live" &&
          !command.participantMaterialDocumentIds.has(intent.documentId)
          ? [Object.freeze({
              tableId: intent.tableId,
              rowId: intent.rowId,
              document: intent.document,
            })]
          : []),lockedHead,
      ));
      if (guardResult.status === "candidateFailed") {
        yield* runPointCommitPromiseEffect(() => emitTransactionStep(options, command, "candidateSchemaValidationFailed"), mapPointCommitCallbackFailure);
      }
    }
    const applicationTables = new Set(command.attemptedTableIds ?? []);
    const indexPublicationProfile = command.participantMaterialDocumentIds.size === 0 ? "activeApplication" as const :
      Object.freeze({ kind: "mixedSelectedSources" as const, activeApplicationTables: applicationTables,
        activeApplicationDeveloperIndexDefinitionIds: new Set(developerDefinitions.filter(definition =>
          definition.access.kind === "developer" && applicationTables.has(definition.access.tableId))
          .map(definition => definition.indexDefinitionId)) });
    const searchContribution = admittedParticipants.length === 0 ? undefined : Result.gen(function* () {
      const searchByIdentity = new Map<string, LogicalSearchDefinition>();
      for (const member of admittedParticipants) for (const definition of member.search) {
        const key = `${definition.tableId}:${definition.logicalIndexId}`;
        const prior = searchByIdentity.get(key);
        if (prior !== undefined && prior.sourceSha256 !== definition.sourceSha256)
          return yield* Result.fail(corruption("developerIndexBuildInvalid"));
        searchByIdentity.set(key, definition);
      }
      return Object.freeze({ definitions: Object.freeze([...searchByIdentity.values()]),
        changes: Object.freeze(command.rowIntents.filter(row => command.participantMaterialDocumentIds.has(row.documentId))) });
    });
    yield* materializeAcceptedApplicationPublicationRows(tx, {
        accepted:acceptedPublication,commitSeq:allocation.commitSeq,
        publicationProfile: indexPublicationProfile, options,
        ...(searchContribution === undefined ? {} : { searchContribution }),
      }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure => failure instanceof LogicalSearchMaintenanceError
      ? failure.reason === "statementFailure"
        ? mapPointCommitCallbackFailure(new PointCommitSqlFailureMarkerV1("writeCommitChange", failure.cause ?? failure))
        : corruption("rowWriteInvalid")
      : mapPointCommitCallbackFailure(failure)))));
    if (relationPlan !== null) {
      yield* observePointCommitPublicationEffect(options.publicationObservation, "relationWrites", maintainPointCommitApplicationRelationsEffect(
          tx,
          command,
          allocation.commitSeq,
          relationPlan,
          options,
        ));
    }
    yield* resetPointCommitDeveloperIndexValidations(tx,state.developerValidations,options.publicationObservation);
    return Object.freeze({
      kind: "ready",
      clock,
      relationAdjacencyChanges:
        relationPlan?.prepared.adjacencyChanges ?? Object.freeze([]),
      ...allocation,
    });
  }).pipe(Effect.ensuring(Effect.sync(() => {
    options.publicationObservation?.record({ kind: "phase", phase: "lowering", edge: "end" });
  })));
}, work => observeExecution("PointCommitTransaction.lowerAccepted", work));

export function requirePointCommitReadyForPublicationResult(
  kernel: Extract<PointCommitKernelResultV1, { readonly kind: "ready" }>,
): Result.Result<
  PointCommitReadyForPublicationV1,
  PointCommitCorruptionV1Error
> {
  const commitSeq = kernel.commitSeq;
  if (commitSeq === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  const publicationTimeMilliseconds = kernel.publicationTimeMilliseconds;
  if (publicationTimeMilliseconds === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(Object.freeze({
    ...kernel,
    commitSeq,
    publicationTimeMilliseconds,
  }));
}
