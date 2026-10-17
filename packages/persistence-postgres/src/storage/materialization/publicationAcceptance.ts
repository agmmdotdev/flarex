import type {
  ApplicationDocumentMaterializationClock,
  LocatedPreparedPointCommitApplicationRelations,
  LoadedPointCommitHeadV1,
} from "./model";
import type {
  PreparedApplicationDocumentSettlement,
} from "./settlementPlan";
import type {
  LocatedAppIndexDefinitionV1,
} from "../indexes/appIndexDefinitions";
import type {
  LocatedAppUniqueConstraintDefinitionV1,
} from "../unique/appUniqueConstraintDefinitions";
import type {
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import {
  type OriginalApplicationPublicationBuildLocks,
  acceptOriginalApplicationPublicationBuildLocks,
} from "./originalBuildLocks";
import {
  Schema,
  Effect,
  Exit,
  Result,
} from "effect";
import {
  AppIndexTransitionLimitExceededError,
  prepareAppIndexKeyTransitionAcceptanceInTransactionEffect,
} from "../indexes/appIndexEntries";
import {
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  corruption,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error,
  AppDocumentInsertionConflictError,
  type PointCommitConflictCauseV1,
  PointCommitConflictV1Error,
  PointCommitStaleAuthorityV1Error,
} from "../../commit/point/errors";
import {
  AppIndexEntryReadPersistenceError,
  AppIndexEntryStorageCorruptionError,
} from "../indexes/appIndexEntryErrors";
import {
  PointCommitSqlFailureMarkerV1,
} from "../../commit/point/sqlFailures";
import type {
  AppRowTransaction,
} from "../documents/appRows";
import {
  requireAdmittedTargetInstallationSchema,
} from "../../installation/installationLifecycle";
import {
  prepareApplicationMaterializationCoverageCapture,
} from "../indexes/indexBuildStates";
import {
  MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1,
} from "./limits";
import {
  prepareAppUniqueOriginalOwnerAcceptanceInTransactionEffect,
} from "../unique/appUniqueKeys";
import {
  mapPointCommitUniqueKeyFailure,
} from "./uniqueKeyFailures";
import {
  preparedUniqueKeyActions,
  compareDeveloperIndexEntryActions,
} from "./sidecarPolicy";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  applicationIndexTransitionScalarArray,
  applicationIndexTransitionByteArray,
  applicationDomainFailureDetail,
} from "./domainApplication";
import { nativeCompositeSelection } from "../../database/nativeCompositeSelection";
import {
  fxAppRowRevisions,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
  fxAppIndexEntryRevisions,
  fxSystemAppSchemaCandidateValidations,
  fxSystemApplicationRevisionSchemasV1,
} from "../../database/schema";
import {
  sql,
} from "drizzle-orm";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
} from "flarex-protocol/index-definition";
import {
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
} from "flarex-protocol/ordered-index";
import {
  fxSystemApplicationActiveHeads,
  fxSystemApplicationActivations,
} from "../../application/applicationActivationSchema";
import {
  fxSystemApplicationRevisionSchemas,
} from "../../application/relations/applicationRelationSchema";
import {
  ApplicationRelationTargetNotLiveError,
} from "../../application/relations/applicationRelationCommit";
import type {
  IndexCoverageWrite,
} from "./domainCoverage";
import {
  exactScopeWriteClockObservationIdentity,
} from "../../scope/scopeClock";
import {
  CatalogIndexDefinitionIdSchema,
} from "flarex-protocol/catalog";
import {
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
import {
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  observeDrizzleQuery,
} from "../../database/drizzleQueryObservation";
import {
  runDrizzleStatementEffect,
} from "../../database/drizzleStatementEffect";
import {
  databaseTimestampFromUnknown,
} from "../../database/databaseTimestamp";
import {
  decodePointCommitHeadResult,
} from "./headEvidence";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";

const publicationTerminalColumn = (name: string) => `CASE WHEN observed.kind IN ('accepted','expired','stopped') THEN observed.${name} ELSE NULL END`;

export interface PublicationAcceptanceInput {
  readonly clock: ApplicationDocumentMaterializationClock;
  readonly settlement: PreparedApplicationDocumentSettlement;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly relations: LocatedPreparedPointCommitApplicationRelations | null;
  readonly indexRanges: readonly LogicalIndexRangeReadDependencyV1[];
  readonly relationDependencies: readonly LogicalApplicationRelationIncomingReadDependencyV1[];
  readonly deadline: Date | null;
  readonly candidate: boolean;
  readonly oldestAvailableCommitSeq: bigint;
  readonly pointReadAt?: ReadonlyMap<string, bigint>;
  /** Issuer-owned graph or authenticated receipt/event carrier only. */
  readonly generatedInsertions?: ReadonlySet<string>;
  readonly generatedOnlyPoints?: ReadonlySet<string>;
  readonly originalBuildLocks?: OriginalApplicationPublicationBuildLocks;
  readonly observeQuery?: import("./model").ApplicationDocumentMaterializationOptions["observeQuery"];
}

export const decodePublicationAcceptanceRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Union([
  Schema.Struct({ phase: Schema.String, reason: Schema.String, ordinal: Schema.Int, actualSequence: Schema.NullOr(Schema.String) }),
  Schema.Struct({ phase: Schema.Literal("range"), reason: Schema.Literal("rangeConflict"), ordinal: Schema.Int,
    actualSequence: Schema.String, encodedKey: Schema.String, rowId: Schema.String }),
])), { onExcessProperty: "error" });

function mapDeveloperPublicationFailure(cause:unknown) {
  return cause instanceof AppIndexTransitionLimitExceededError
    ? new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({reason:"entryRevisionLimitExceeded",observed:cause.observed,maximum:cause.maximum})
    : cause instanceof AppIndexEntryReadPersistenceError ? new PointCommitSqlFailureMarkerV1("loadDeveloperIndexEntryHeads",cause.cause)
      : cause instanceof AppIndexEntryStorageCorruptionError ? cause
      : corruption("developerIndexTransitionInvalid");
}

/** Fixed owner preparation retains local Causes as Exits. The SQL boundary
 * reaches their exact phase before this owner rethrows them. */
export const preparePublicationAcceptance = Effect.fnUntraced(function* (tx: AppRowTransaction, input: PublicationAcceptanceInput) {
  const { settlement, clock } = input;
  const command = settlement.command;
  if (input.originalBuildLocks!==undefined) yield* Effect.fromResult(acceptOriginalApplicationPublicationBuildLocks(tx,clock,
    input.originalBuildLocks,input.intrinsic,input.developer));
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))
    .pipe(Effect.mapError(cause => new PointCommitSqlFailureMarkerV1("acceptPublication", cause)));
  const capture = yield* Effect.fromResult(prepareApplicationMaterializationCoverageCapture(tx, clock.record))
    .pipe(Effect.mapError(() => corruption("developerIndexBuildInvalid")));
  const developer = yield* Effect.exit(Effect.gen(function* () {
    if (Exit.isFailure(settlement.originals)) return yield* Effect.failCause(settlement.originals.cause);
    if (Exit.isFailure(settlement.developer)) return yield* Effect.failCause(settlement.developer.cause);
    return yield* prepareAppIndexKeyTransitionAcceptanceInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId, pairs: settlement.developer.value, maximumActions: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
    }).pipe(Effect.mapError(mapDeveloperPublicationFailure));
  }));
  const unique = Exit.isFailure(developer) || settlement.unique === undefined || Exit.isFailure(settlement.unique) ? undefined :
    yield* Effect.exit(prepareAppUniqueOriginalOwnerAcceptanceInTransactionEffect(tx, command.authorityPins.scopeId, clock.record.epoch,
      settlement.unique.value.map(plan => ({ constraintId: plan.definition.uniqueConstraintDefinitionId, tableId: plan.definition.tableId,
        rowId: plan.rowId, localeKey: plan.previousCanonical?.localeKey ?? plan.nextCanonical?.localeKey ?? "",
        previous: plan.previousCanonical, next: plan.nextCanonical, rowPrevCommitSeq: plan.rowPrevCommitSeq })))
        .pipe(Effect.mapError(mapPointCommitUniqueKeyFailure)));
  const uniqueActions = settlement.unique === undefined || Exit.isFailure(settlement.unique) ? [] : preparedUniqueKeyActions(settlement.unique.value);
  const uniqueBudgetFailure = uniqueActions.length > MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1
    ? new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({ reason: "mutationLimitExceeded",
      observed: uniqueActions.length, maximum: MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 }) : null;
  const stop = Exit.isFailure(settlement.originals) ? "original" : Exit.isFailure(developer) ? "developerTransition" :
    settlement.unique === undefined || Exit.isFailure(settlement.unique) || unique === undefined || Exit.isFailure(unique) ? "uniqueOwner" :
      uniqueBudgetFailure !== null ? "afterUniqueOwner" : settlement.relation === undefined || Exit.isFailure(settlement.relation) ? "relationTarget" : null;
  // Empty packets still belong to the genuine owner; later failure packets
  // cannot require preparation or database work beyond the retained stop.
  const emptyDeveloper = Exit.isFailure(developer) ? yield* prepareAppIndexKeyTransitionAcceptanceInTransactionEffect(tx,
    { scopeId: command.authorityPins.scopeId, pairs: [], maximumActions: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 })
      .pipe(Effect.mapError(mapDeveloperPublicationFailure)) : developer.value;
  const emptyUnique = unique === undefined || Exit.isFailure(unique) ? yield* prepareAppUniqueOriginalOwnerAcceptanceInTransactionEffect(tx,
    command.authorityPins.scopeId, clock.record.epoch, []).pipe(Effect.mapError(mapPointCommitUniqueKeyFailure)) : unique.value;
  const originals = new Map(settlement.originalRows.map(row => [appDocumentIdV1FromRowIdentity(row), row]));
  const changed = new Set(command.rowIntents.map(row => row.documentId));
  const originalTables = new Set([...input.developer.map(definition => definition.access.tableId), ...input.unique.map(definition => definition.tableId),
    ...(input.relations?.definitions.definitions.map(definition => definition.binding.sourceTableId) ?? [])]);
  const targets = settlement.relation === undefined || Exit.isFailure(settlement.relation) ? [] : settlement.relation.value?.prepared.storedTargetChecks ?? [];
  const scalar = applicationIndexTransitionScalarArray;
  const bytes = applicationIndexTransitionByteArray;
  const points = command.dependencies;
  const sequences = points.map(point => { const observed = point.dependency.observed; return observed.kind === "present" ? observed.revisionCommitSeq :
    observed.basis.kind === "tombstone" ? observed.basis.revisionCommitSeq : null; });
  const original = points.map(point => originals.get(point.documentId));
  const originalScope = scalar(original.map(row => row?.scopeUuid ?? null), "uuid", fxAppRowRevisions.scopeUuid);
  const originalEpoch = scalar(original.map(row => row?.writeEpochUuid ?? null), "uuid", fxAppRowRevisions.writeEpochUuid);
  const flags = (selected: readonly boolean[]) => scalar(selected, "boolean", fxAppRowRevisions.isTombstone);
  const times = scalar(original.map(row => row?.creationTime ?? null), "double precision", fxAppRowRevisions.creationTime);
  const source = sql`${sql.identifier(schemaName)}.fx_accept_app_publication(
    ${sql.param(command.authorityPins.scopeId, fxSystemIndexBuildStates.scopeId)}::text,
    ${sql.param(clock.scopeUuid, fxAppRowRevisions.scopeUuid)}::uuid,
    ${sql.param(clock.record.storageGeneration, fxSystemIndexBuildStates.storageGeneration)}::text,
    ${sql.param(clock.record.storageGenerationFence, fxSystemIndexBuildStates.storageGenerationFence)}::bigint,
    ${sql.param(clock.record.epoch, fxSystemIndexBuildStates.epoch)}::text,
    ${sql.param(clock.record.lastCommitSeq, fxAppRowRevisions.commitSeq)}::bigint,
    ${sql.param(command.authorityPins.snapshotToken.commitSeq, fxAppRowRevisions.commitSeq)}::bigint,
    ${sql.param(input.oldestAvailableCommitSeq, fxAppRowRevisions.commitSeq)}::bigint,
    ${sql.param(input.deadline, fxSystemScopeClocks.updatedAt)}::timestamptz, ${capture.snapshot}::boolean, ${input.originalBuildLocks!==undefined}::boolean,
    ${scalar(input.intrinsic.map(definition => definition.indexDefinitionId), "integer", fxSystemIndexBuildStates.indexDefinitionId)},
    ${scalar(input.developer.map(definition => definition.indexDefinitionId), "integer", fxSystemIndexBuildStates.indexDefinitionId)},
    ${scalar(input.developer.map(definition => definition.access.kind), "text", fxSystemIndexBuildStates.scopeId)},
    ${scalar(points.map(point => point.tableId), "integer", fxAppRowRevisions.tableId)},
    ${bytes(points.map(point => appRowIdHexV1ToBytes(point.rowId)), fxAppRowRevisions.rowId)},
    ${scalar(points.map(point => { const observed = point.dependency.observed;
      return input.generatedOnlyPoints?.has(point.documentId) ? "generatedInsertion" :
        input.generatedInsertions?.has(point.documentId) ? "noVisibleRevisionInsertion" :
          observed.kind === "present" ? "present" : observed.basis.kind; }), "text", fxSystemIndexBuildStates.scopeId)},
    ${scalar(sequences, "bigint", fxAppRowRevisions.commitSeq)},
    ${scalar(points.map(point => input.pointReadAt?.get(point.documentId) ?? command.authorityPins.snapshotToken.commitSeq), "bigint", fxAppRowRevisions.commitSeq)},
    ${flags(points.map(point => changed.has(point.documentId)))}, ${flags(points.map(point => originalTables.has(point.tableId)))},
    ${scalar(original.map(row => row?.commitSeq ?? null), "bigint", fxAppRowRevisions.commitSeq)}, ${originalScope}, ${originalEpoch},
    ${scalar(original.map(row => row?.prevCommitSeq ?? null), "bigint", fxAppRowRevisions.prevCommitSeq)},
    ${scalar(original.map(row => row?.schemaVersionId ?? null), "text", fxAppRowRevisions.schemaVersionId)},
    ${scalar(original.map(row => row?.document.canonicalBytes.byteLength ?? null), "integer", fxAppRowRevisions.valueCodecVersion)},
    ${bytes(original.map(row => row?.document.sha256 ?? null), fxAppRowRevisions.valueSha256)}, ${times},
    ${scalar(input.indexRanges.map(dependency => dependency.indexDefinitionId), "integer", fxAppIndexEntryRevisions.indexDefinitionId)},
    ${scalar(input.indexRanges.map(dependency => dependency.tableId), "integer", fxAppIndexEntryRevisions.tableId)},
    ${bytes(input.indexRanges.map(dependency => appIndexPhysicalSpecSha256HexV1ToBytes(dependency.physicalSpecSha256Hex)), fxAppIndexEntryRevisions.physicalSpecSha256)},
    ${bytes(input.indexRanges.map(dependency => dependency.lower === null ? null : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey)), fxAppIndexEntryRevisions.encodedKey)},
    ${scalar(input.indexRanges.map(dependency => dependency.upper?.kind ?? "unbounded"), "text", fxSystemIndexBuildStates.scopeId)},
    ${bytes(input.indexRanges.map(dependency => dependency.upper === null ? null : dependency.upper.kind === "key" ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey) :
      orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey)), fxAppIndexEntryRevisions.encodedKey)},
    ${bytes(input.indexRanges.map(dependency => dependency.upper?.kind === "position" ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId) : null), fxAppIndexEntryRevisions.rowId)},
    ${scalar(input.relationDependencies.map(dependency => dependency.edgeDefinitionId), "integer", fxAppIndexEntryRevisions.indexDefinitionId)},
    ${bytes(input.relationDependencies.map(dependency => appRowIdHexV1ToBytes(dependency.targetRowId)), fxAppRowRevisions.rowId)},
    ${scalar(input.relationDependencies.map(dependency => dependency.observedAdjacencyVersion), "bigint", fxAppRowRevisions.commitSeq)},
    ${emptyDeveloper.keyParameters}, ${MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1}::integer, ${emptyUnique.parameters},
    ${scalar(targets.map(target => target.tableId), "integer", fxAppRowRevisions.tableId)},
    ${bytes(targets.map(target => appRowIdHexV1ToBytes(target.rowId)), fxAppRowRevisions.rowId)}, ${input.candidate}::boolean, ${stop}::text) observed`;
  const query = tx.select({ kind: sql<string>`observed.kind`, ordinal: sql<number | null>`observed.ordinal`,
    pointerCommitSeq: sql`observed.pointer_sequence`.mapWith(fxAppRowRevisions.commitSeq),
    latestCommitSeq: sql`observed.latest_sequence`.mapWith(fxAppRowRevisions.commitSeq),
    latestIsTombstone: sql<boolean | null>`observed.latest_tombstone`, latestCreationTime: sql<number | null>`observed.latest_creation_time`,
    latestInsertionCommitSeq: sql`observed.latest_insertion_commit_seq`.mapWith(fxAppRowRevisions.insertionCommitSeq),
    latestInsertionAttemptOrdinal: sql`observed.latest_insertion_attempt_ordinal`.mapWith(fxAppRowRevisions.insertionAttemptOrdinal),
    transitionReason: sql<string | null>`observed.transition_reason`, pairOrdinal: sql<number | null>`observed.pair_ordinal`,
    keyOrdinal: sql<number | null>`observed.key_ordinal`, transitionKind: sql<string | null>`observed.transition_kind`,
    priorCommitSeqText: sql<string | null>`observed.prior_commit_seq::text`, priorIsTombstone: sql<boolean | null>`observed.prior_is_tombstone`,
    emittedCount: sql<number | null>`observed.emitted_count`, uniqueOwners: sql<number | null>`observed.accepted_unique_owners`,
    validationDefinition:sql`observed.validation_definition`.mapWith(fxSystemIndexBuildStates.indexDefinitionId),
    validationAttempt:sql`observed.validation_attempt`.mapWith(fxSystemIndexBuildStates.attemptFence),
    validationEpoch:sql`observed.validation_epoch`.mapWith(fxSystemIndexBuildStates.epoch),
    validationFence:sql`observed.validation_fence`.mapWith(fxSystemIndexBuildStates.storageGenerationFence),
    databaseNow: sql`${sql.raw(publicationTerminalColumn("database_now"))}`.mapWith(fxSystemScopeClocks.updatedAt),
    candidateHead: nativeCompositeSelection(fxSystemAppSchemaCandidateValidations, publicationTerminalColumn("candidate_head")),
    applicationHead: nativeCompositeSelection(fxSystemApplicationActiveHeads, publicationTerminalColumn("application_head")),
    applicationActivation: nativeCompositeSelection(fxSystemApplicationActivations, publicationTerminalColumn("application_activation")),
    legacySchema: nativeCompositeSelection(fxSystemApplicationRevisionSchemasV1, publicationTerminalColumn("legacy_schema")),
    relationSchema: nativeCompositeSelection(fxSystemApplicationRevisionSchemas, publicationTerminalColumn("relation_schema")),
  }).from(source);
  const mapFailure = (cause: unknown) => {
    if (applicationDomainFailureDetail(cause, "fx_accept_app_index_transitions") !== null) {
      return mapDeveloperPublicationFailure(emptyDeveloper.mapFailure(cause));
    }
    if (applicationDomainFailureDetail(cause, "fx_accept_app_unique_owners") !== null) return mapPointCommitUniqueKeyFailure(emptyUnique.mapFailure(cause));
    const detail = applicationDomainFailureDetail(cause, "fx_accept_app_publication");
    if (detail !== null) return publicationRefusal(input, cause, detail);
    return new PointCommitSqlFailureMarkerV1("acceptPublication", cause);
  };
  return Object.freeze({ query, mapFailure, capture, stop, developer, unique, uniqueActions, uniqueBudgetFailure });
});

function publicationRefusal(input: PublicationAcceptanceInput, cause: unknown, detail: string) {
  return Result.match(decodePublicationAcceptanceRefusal(detail), {
    onFailure: () => new PointCommitSqlFailureMarkerV1("acceptPublication", cause),
    onSuccess: refusal => {
      const command = input.settlement.command;
      if (refusal.phase === "point" && refusal.reason === "generatedInsertionConflict") {
        const selected = command.dependencies[refusal.ordinal];
        if (selected !== undefined && input.generatedInsertions?.has(selected.documentId))
          return new AppDocumentInsertionConflictError({ documentId: selected.documentId });
      }
      let conflict: PointCommitConflictCauseV1 | undefined;
      if (refusal.phase === "point" && refusal.reason === "pointConflict") {
        const selected = command.dependencies[refusal.ordinal];
        if (selected !== undefined) conflict = { kind: "appRowPoint", documentId: selected.documentId };
      } else if (refusal.phase === "range" && (refusal.reason === "rangeConflict" || refusal.reason === "rangeWindowExceeded")) {
        const selected = input.indexRanges[refusal.ordinal];
        if (selected !== undefined) {
          if ("encodedKey" in refusal) {
            return Result.match(Result.all({
              encodedKey: Schema.decodeUnknownResult(OrderedIndexKeyBytesHexV1Schema)(refusal.encodedKey),
              rowId: Schema.decodeUnknownResult(OrderedIndexRowIdHexV1Schema)(refusal.rowId),
            }), {
              onFailure: () => new PointCommitSqlFailureMarkerV1("validateIndexRanges", cause),
              onSuccess: position => new PointCommitConflictV1Error({
                conflict: { kind: "appIndexRange", reason: "overlap", dependencyOrdinal: refusal.ordinal,
                  tableId: selected.tableId, indexDefinitionId: selected.indexDefinitionId, ...position },
                snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
                currentCommitSeq: input.clock.record.lastCommitSeq,
              }),
            });
          } else conflict = { kind: "appIndexRange", reason: "validationWindowExceeded", dependencyOrdinal: refusal.ordinal,
            tableId: selected.tableId, indexDefinitionId: selected.indexDefinitionId };
        }
      } else if (refusal.phase === "relation" && refusal.reason === "relationConflict") {
        const selected = input.relationDependencies[refusal.ordinal];
        if (selected !== undefined) conflict = { kind: "appRelationIncoming", edgeDefinitionId: selected.edgeDefinitionId, targetRowId: selected.targetRowId };
      }
      if (conflict !== undefined) return new PointCommitConflictV1Error({ conflict,
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq, currentCommitSeq: input.clock.record.lastCommitSeq });
      if (refusal.phase === "intrinsicBuild" && refusal.reason === "intrinsicIndexBuildInvalid") return corruption("intrinsicIndexBuildInvalid");
      if (refusal.phase === "developerBuild" && refusal.reason === "developerIndexBuildInvalid") return corruption("developerIndexBuildInvalid");
      if (refusal.phase === "point" && refusal.reason === "rowHeadInvalid") return corruption("rowHeadInvalid");
      if (["point", "range", "relation"].includes(refusal.phase) && refusal.reason === "occEvidenceInvalid") return corruption("occEvidenceInvalid");
      if (refusal.phase === "original" && refusal.reason === "priorDocumentInvalid") return corruption("priorDocumentInvalid");
      if (refusal.phase === "relationTarget") {
        const plan = input.settlement.relation;
        const selected = plan !== undefined && Exit.isSuccess(plan) ? plan.value?.prepared.storedTargetChecks[refusal.ordinal] : undefined;
        if (selected !== undefined && refusal.reason === "relationTargetMissing") return new ApplicationRelationTargetNotLiveError({ targetDocumentId: selected.documentId });
        if (refusal.reason === "relationTargetEvidenceInvalid") return corruption("relationTargetEvidenceInvalid");
      }
      return new PointCommitSqlFailureMarkerV1("acceptPublication", cause);
        },
  });
}

const acceptanceBrand: unique symbol = Symbol("AcceptedApplicationPublication");
export interface AcceptedApplicationPublication { readonly [acceptanceBrand]: true }
interface AcceptedPublicationState {
  readonly tx: AppRowTransaction;
  readonly clockIdentity: symbol;
  readonly input: PublicationAcceptanceInput;
  readonly heads: readonly LoadedPointCommitHeadV1[];
  readonly developerActions: Effect.Success<ReturnType<Effect.Success<ReturnType<typeof prepareAppIndexKeyTransitionAcceptanceInTransactionEffect>>["accept"]>>;
  readonly developerValidations:readonly (IndexCoverageWrite & Readonly<{lifecycle:"validating"}>)[];
  readonly candidateHead: Parameters<typeof import("../catalog/appSchemaCandidateValidation").captureAppSchemaCandidateWriteGuardLockedHead>[3];
  readonly capturedCoverage?: import("../indexes/indexBuildStates").CapturedApplicationMaterializationCoverage;
  readonly databaseNowMilliseconds: number;
}
const acceptedPublications = new WeakMap<AcceptedApplicationPublication, AcceptedPublicationState>();

export function readAcceptedApplicationPublication(tx: AppRowTransaction, accepted: AcceptedApplicationPublication) {
  const state = acceptedPublications.get(accepted);
  return state !== undefined && state.tx === tx && state.clockIdentity === exactScopeWriteClockObservationIdentity(tx, state.input.clock.record.scopeId)
    ? Result.succeed(state) : Result.fail(corruption("occEvidenceInvalid"));
}

const PublicationDeveloperValidationSchema = Schema.Struct({ ordinal: Schema.Int,
  validationDefinition: CatalogIndexDefinitionIdSchema,
  validationAttempt: Schema.toType(IndexBuildAttemptFenceSchema), validationEpoch: ScopeEpochSchema,
  validationFence: Schema.toType(StorageGenerationFenceSchema) });
const decodePublicationDeveloperValidation = Schema.decodeUnknownResult(PublicationDeveloperValidationSchema);

export const acceptApplicationPublication = Effect.fnUntraced(function* (
  tx: AppRowTransaction, input: PublicationAcceptanceInput,
) {
  const identity = exactScopeWriteClockObservationIdentity(tx, input.clock.record.scopeId);
  if (identity === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
  const prepared = yield* preparePublicationAcceptance(tx, input);
  observeDrizzleQuery("acceptPublication",prepared.query,input.observeQuery);
  const rows = yield* runDrizzleStatementEffect(prepared.query, prepared.mapFailure);
  const terminal = rows.at(-1);
  if (terminal === undefined || !["accepted", "expired", "stopped"].includes(terminal.kind)) return yield* Effect.fail(corruption("occEvidenceInvalid"));
  const now = databaseTimestampFromUnknown(terminal.databaseNow);
  if (now === null) return yield* Effect.fail(corruption("sessionInvalid"));
  if (terminal.kind === "expired") return yield* Effect.fail(new PointCommitStaleAuthorityV1Error({ reason: "expired" }));
  if (terminal.kind === "stopped") {
    const settlement = input.settlement;
    if (prepared.stop === "original" && Exit.isFailure(settlement.originals)) return yield* Effect.failCause(settlement.originals.cause);
    if (prepared.stop === "developerTransition" && Exit.isFailure(prepared.developer)) return yield* Effect.failCause(prepared.developer.cause);
    if (prepared.stop === "uniqueOwner") {
      if (settlement.unique !== undefined && Exit.isFailure(settlement.unique)) return yield* Effect.failCause(settlement.unique.cause);
      if (prepared.unique !== undefined && Exit.isFailure(prepared.unique)) return yield* Effect.failCause(prepared.unique.cause);
    }
    if (prepared.stop === "afterUniqueOwner" && prepared.uniqueBudgetFailure !== null) return yield* Effect.fail(prepared.uniqueBudgetFailure);
    if (prepared.stop === "relationTarget" && settlement.relation !== undefined && Exit.isFailure(settlement.relation)) return yield* Effect.failCause(settlement.relation.cause);
    return yield* Effect.die(new Error("Publication stopped at an unissued preparation boundary"));
  }
  if (prepared.stop !== null || Exit.isFailure(prepared.developer) || prepared.unique === undefined || Exit.isFailure(prepared.unique))
    return yield* Effect.fail(corruption("occEvidenceInvalid"));
  const transitions = rows.filter(row => row.kind === "transition").map(row => ({ reason: row.transitionReason, pair_ordinal: row.pairOrdinal,
    key_ordinal: row.keyOrdinal, transition_kind: row.transitionKind, prior_commit_seq: row.priorCommitSeqText,
    prior_is_tombstone: row.priorIsTombstone, emitted_count: row.emittedCount }));
  const developerActions = yield* prepared.developer.value.accept({ rows: transitions }).pipe(Effect.mapError(mapDeveloperPublicationFailure));
  yield* prepared.unique.value.accept({ rows: [{ reason: "accepted", owners: terminal.uniqueOwners }] }).pipe(Effect.mapError(mapPointCommitUniqueKeyFailure));
  const selectedHeads = rows.filter(row => row.kind === "head");
  const validationRows=rows.filter(row=>row.kind==="developerValidation");
  if (selectedHeads.length !== input.settlement.command.dependencies.length || rows.length !== transitions.length + selectedHeads.length + validationRows.length + 1)
    return yield* Effect.fail(corruption("rowHeadInvalid"));
  const heads: LoadedPointCommitHeadV1[] = [];
  for (const [ordinal, row] of selectedHeads.entries()) heads.push(yield* Effect.fromResult(decodePointCommitHeadResult({
    ordinalText: String(row.ordinal), pointerCommitSeqText: row.pointerCommitSeq === null ? null : String(row.pointerCommitSeq),
    latestCommitSeqText: row.latestCommitSeq === null ? null : String(row.latestCommitSeq), latestIsTombstone: row.latestIsTombstone,
    latestCreationTimeText: row.latestCreationTime === null ? null : String(row.latestCreationTime),
    latestInsertionCommitSeqText: row.latestInsertionCommitSeq === null ? null : String(row.latestInsertionCommitSeq),
    latestInsertionAttemptOrdinalText: row.latestInsertionAttemptOrdinal === null ? null : String(row.latestInsertionAttemptOrdinal),
  }, ordinal, input.settlement.command.dependencies[ordinal], input.settlement.command.authorityPins.scopeId, input.clock.record.lastCommitSeq)));
  const capturedCoverage = prepared.capture.snapshot ? yield* Effect.fromResult(prepared.capture.capture({
    applicationHead: terminal.applicationHead.scopeId === null ? null : terminal.applicationHead,
    applicationActivation: terminal.applicationActivation.scopeId === null ? null : terminal.applicationActivation,
    legacySchema: terminal.legacySchema.scopeId === null ? null : terminal.legacySchema,
    relationSchema: terminal.relationSchema.scopeId === null ? null : terminal.relationSchema,
  })).pipe(Effect.mapError(()=>corruption("developerIndexBuildInvalid"))) : undefined;
  const developerValidations:(IndexCoverageWrite & Readonly<{lifecycle:"validating"}>)[]=[];
  let previousOrdinal=-1;
  for (const row of validationRows) {
    const selected=yield* Effect.fromResult(decodePublicationDeveloperValidation(row)).pipe(Effect.mapError(()=>corruption("developerIndexBuildInvalid")));
    if (selected.ordinal<=previousOrdinal || input.developer[selected.ordinal]?.indexDefinitionId!==selected.validationDefinition ||
      selected.validationEpoch!==input.clock.record.epoch || selected.validationFence!==input.clock.record.storageGenerationFence)
      return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    previousOrdinal=selected.ordinal;
    developerValidations.push({scopeId:input.clock.record.scopeId,indexDefinitionId:selected.validationDefinition,attemptFence:selected.validationAttempt,
      epoch:selected.validationEpoch,storageGenerationFence:selected.validationFence,lifecycle:"validating"});
  }
  const accepted = Object.freeze({ [acceptanceBrand]: true as const });
  acceptedPublications.set(accepted, { tx, clockIdentity: identity, input, heads, developerActions: developerActions.toSorted(compareDeveloperIndexEntryActions),developerValidations,
    candidateHead: terminal.candidateHead.scopeId === null ? null : terminal.candidateHead, databaseNowMilliseconds: now.getTime(),
    ...(capturedCoverage === undefined ? {} : { capturedCoverage }) });
  return accepted;
},work=>observeExecution("ApplicationDocument.acceptPublication",work));
