import { observeExecution } from "../../execution/diagnostics/operation";
// Quiet calls retain lazy operation bodies; actual caller/SDK policy owns diagnostic spans.
import { copyFiniteDate } from "@flarex/utils/dates";
import { bytesEqualFullScan, encodeBytesToLowercaseHex, copyBytes } from "@flarex/utils/bytes";
import { and, asc, eq, getTableColumns, gt, lte, sql, type SQLWrapper } from "drizzle-orm";
import { Effect, Encoding, Option, Result, Schema } from "effect";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  IndexBuildAttemptFenceSchema,
  IndexBuildBackfillCursorV1Schema,
  IndexBuildCursorCodecVersionV1Schema,
  IndexBuildLifecycleV1Schema,
  type IndexBuildAttemptFence,
  type IndexBuildBackfillCursorV1,
  type IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import {
  orderedIndexRowIdHexV1FromBytesResult,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import { readAppTableWriteFrontierInTransactionEffect, readAppTableWriteFrontiersInTransactionEffect,
  decodeCapturedAppTableWriteFrontierResult,
  AppRowTableFrontierCorruptionError, type AppRowTransaction, type AppRowReadPersistenceError,
  type InvalidAppRowReadInputError } from "../documents/appRows";
import type { AppIndexDefinitionRecord, LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import { prepareSelectedIndexBuildLockAcceptance, prepareRequiredIndexBuildReadinessAcceptance, prepareRequiredIndexBuildProgressCapture } from "./nativeIndexBuildAcceptance";
import { hasExactOwnDataKeys } from "../../values/exactOwnDataKeys";
import {
  decodeScopeClockRecordResult,
  scopeClockSelection,
  scopeClockExecutionAuthorityJoin,
  exactScopeWriteClockObservationIdentity,
  readExactScopeWriteClockObservation,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import {
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  readApplicationSchemaForHeadForShareInTransactionEffect,
  readCheckedApplicationSchemaForHeadForShareInTransactionEffect,
} from "../../application/applicationActiveHeadRead";
import {
  readCheckedApplicationActiveHead,
  type ApplicationIndexCoveragePins,
} from "../../application/activeHead/identity";
import {
  type CheckedApplicationActiveHead,
  type CoherentApplicationActiveHead,
} from "../../application/activeHead/contracts";
import {
  decodeApplicationMaterializationObservation,
} from "../../application/applicationActiveHeadRead";
import {
  readRegisteredManagedMetadataPairFinalGuards,
} from "../../execution/preparation/preparedMetadataEpoch";
import {
  decodeIndexMaintenanceObligationResult,
  IndexMaintenanceError,
  type IndexMaintenanceObligation,
} from "./indexMaintenanceModel";
import {
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemUniqueMaintenanceObligations,
  fxSystemCommitAppRowChanges,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../database/schema";

import { readBindingCoverageSelectedEvidence } from "../../installation/frameworkSchema/binding/repository";


const READ_INPUT_KEYS = Object.freeze(["scopeId", "indexDefinitionId"]);
const decodeCatalogIndexDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);
const decodeIndexBuildAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildAttemptFenceSchema),
);
const decodeIndexBuildBackfillCursorResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildBackfillCursorV1Schema),
);
const decodeIndexBuildCursorCodecVersionResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildCursorCodecVersionV1Schema),
);
const decodeIndexBuildLifecycleResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildLifecycleV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

const decodeFlarexDbV1StorageGenerationResult = Schema.decodeUnknownResult(
  Schema.toType(FlarexDbV1StorageGenerationSchema),
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeStorageGenerationFenceResult = Schema.decodeUnknownResult(
  Schema.toType(StorageGenerationFenceSchema),
);

export interface ReadFencedIndexBuildStateInput {
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
}

export interface IndexBuildStorageAuthority {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
}

interface IndexBuildStateRecordBase {
  readonly maintenance: IndexMaintenanceObligation | null;
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly startCommitSeq: CommitSeq;
  readonly coveredThroughCommitSeq: CommitSeq | null;
  readonly firstReadableCommitSeq: CommitSeq | null;
  readonly attemptFence: IndexBuildAttemptFence;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type IndexBuildPreBackfillLifecycleV1 = Extract<
  IndexBuildLifecycleV1,
  "declared" | "building"
>;
type IndexBuildCursorCapableLifecycleV1 = Exclude<
  IndexBuildLifecycleV1,
  IndexBuildPreBackfillLifecycleV1
>;
type IndexBuildPreBackfillCursorV1 = Readonly<{
  codecVersion: IndexBuildBackfillCursorV1["codecVersion"];
  afterRowId: null;
}>;

interface IndexBuildPreBackfillStateRecord
  extends IndexBuildStateRecordBase {
  readonly lifecycle: IndexBuildPreBackfillLifecycleV1;
  readonly backfillCursor: IndexBuildPreBackfillCursorV1;
}

interface IndexBuildCursorCapableStateRecord
  extends IndexBuildStateRecordBase {
  readonly lifecycle: IndexBuildCursorCapableLifecycleV1;
  readonly backfillCursor: IndexBuildBackfillCursorV1;
}

export type IndexBuildStateRecord =
  | IndexBuildPreBackfillStateRecord
  | IndexBuildCursorCapableStateRecord;

export type IndexBuildAuthorityMismatch =
  | "storageGeneration"
  | "storageGenerationFence"
  | "epoch";
export type IndexBuildAuthorityMismatches = readonly [
  IndexBuildAuthorityMismatch,
  ...IndexBuildAuthorityMismatch[],
];

export type FencedIndexBuildStateReadResult =
  | {
      readonly status: "absent";
      readonly currentAuthority: IndexBuildStorageAuthority;
    }
  | {
      readonly status: "current";
      readonly buildState: IndexBuildStateRecord;
    }
  | {
      readonly status: "stale";
      readonly buildState: IndexBuildStateRecord;
      readonly currentAuthority: IndexBuildStorageAuthority;
      readonly mismatches: IndexBuildAuthorityMismatches;
    };

export type InvalidIndexBuildStateReadInputIssue =
  | { readonly reason: "invalidInputShape" }
  | { readonly reason: "invalidScopeId" }
  | { readonly reason: "invalidIndexDefinitionId" };

export class InvalidIndexBuildStateReadInputError extends Error {
  readonly _tag = "InvalidIndexBuildStateReadInputError" as const;

  constructor(
    readonly issue: InvalidIndexBuildStateReadInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidIndexBuildStateReadInputError";
  }
}

export class IndexBuildStateCorruptionError extends Error {
  readonly _tag = "IndexBuildStateCorruptionError" as const;

  constructor(
    readonly scopeId: string,
    readonly indexDefinitionId: CatalogIndexDefinitionId,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Index build state ${scopeId}/${indexDefinitionId} is corrupt: ${detail}`,
      options,
    );
    this.name = "IndexBuildStateCorruptionError";
  }
}

export class IndexBuildStateClockNotFoundError extends Error {
  readonly _tag = "IndexBuildStateClockNotFoundError" as const;

  constructor(
    readonly scopeId: ScopeId,
    readonly indexDefinitionId: CatalogIndexDefinitionId,
  ) {
    super(
      `Index build-state read has no local scope clock: ${scopeId}/${indexDefinitionId}`,
    );
    this.name = "IndexBuildStateClockNotFoundError";
  }
}

export class IndexBuildStatePersistenceError extends Error {
  readonly _tag = "IndexBuildStatePersistenceError" as const;

  constructor(
    readonly operation: "readFencedIndexBuildState" | "readRequiredIndexBuildStates",
    readonly cause: unknown,
  ) {
    super("Failed to read index build state.", { cause });
    this.name = "IndexBuildStatePersistenceError";
  }
}

export const MAX_REQUIRED_INDEX_BUILDS = 512;

const decodeSelectedBuildLockVerdict = Schema.decodeUnknownEffect(Schema.Struct({
  reason: Schema.Literals(["accepted", "missing", "invalid", "unavailable", "frontier"]),
  ordinal: Schema.NullOr(Schema.String),
  indexDefinitionId: Schema.NullOr(CatalogIndexDefinitionIdSchema),
}));

/** The ordinary materialization owner retains full live SHARE validation and
 * exclusion while discarding successful build records that no caller uses. */
export const acceptSelectedIndexBuildLocksInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction, clock: ScopeClockRecord,
  definitions: readonly Pick<LocatedAppIndexDefinitionV1, "indexDefinitionId" | "access">[],
  order: "input" | "definition",
) {
  const definitionIds = definitions.map(definition => definition.indexDefinitionId);
  if (definitionIds.length > MAX_REQUIRED_INDEX_BUILDS || new Set(definitionIds).size !== definitionIds.length)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  if (definitionIds.length === 0) return;
  const rows = yield* Effect.uninterruptible(runDrizzleStatementEffect(
    prepareSelectedIndexBuildLockAcceptance(tx, clock, definitions, order),
    cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", cause),
  ));
  if (rows.length !== 1 || rows[0] === undefined)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const row = rows[0];
  const verdict = yield* decodeSelectedBuildLockVerdict(row).pipe(Effect.mapError(cause =>
    new IndexMaintenanceError({ reason: "storedState", cause })));
  if (verdict.reason === "accepted") {
    if (verdict.ordinal !== null || verdict.indexDefinitionId !== null)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    return;
  }
  const ordinal = verdict.ordinal === null ? -1 : Number(verdict.ordinal) - 1;
  const definitionId = definitionIds[ordinal];
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || String(ordinal + 1) !== verdict.ordinal ||
    definitionId === undefined || verdict.indexDefinitionId !== definitionId)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  if (verdict.reason === "missing") return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const decoded = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row.build, clock.scopeId,
    definitionId, row.maintenance.scopeId === null ? null : row.maintenance));
  if (verdict.reason === "unavailable") return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  yield* Effect.fromResult(validateIndexBuildStateFrontierResult(decoded, clock.lastCommitSeq));
  return yield* Effect.die(new Error("Native index build acceptance rejected valid evidence"));
}, work => observeExecution("IndexBuildState.acceptSelectedBuildLocks", work, "caller"));

const decodeRequiredIndexReadinessVerdict = Schema.decodeUnknownEffect(Schema.Struct({
  phase: Schema.Literals(["availability", "coverage"]),
  reason: Schema.Literals(["accepted", "missing", "stale", "notEnabled", "invalid", "frontier", "maintenance", "notCovered", "tableFrontier"]),
  ordinal: Schema.NullOr(Schema.String),
  indexDefinitionId: Schema.NullOr(CatalogIndexDefinitionIdSchema),
}));

/** The original writer observation brackets this complete native read. The
 * returned accepting closure lends neither a checked head nor a writer grant. */
export const captureRequiredIndexReadinessInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction, inputClock: ScopeClockRecord, inputDefinitions: readonly IndexCoverageDefinition[],
  activePins: ApplicationIndexCoveragePins | null,
) {
  const clock = Object.freeze({ ...inputClock, updatedAt: new Date(inputClock.updatedAt.getTime()) });
  const definitions = Object.freeze(inputDefinitions.map(definition => Object.freeze({
    indexDefinitionId: definition.indexDefinitionId, tableId: definition.tableId,
    physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
  })));
  const identity = exactScopeWriteClockObservationIdentity(tx, clock.scopeId);
  if (identity === undefined || definitions.length > MAX_REQUIRED_INDEX_BUILDS ||
    new Set(definitions.map(definition => definition.indexDefinitionId)).size !== definitions.length)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(clock.scopeId)).pipe(
    Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
  const pins = activePins === null ? null : Object.freeze({ ...activePins,
    activationSha256: copyBytes(activePins.activationSha256), headSha256: copyBytes(activePins.headSha256) });
  const rows = definitions.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(
    prepareRequiredIndexBuildReadinessAcceptance(tx, clock, definitions, pins, scope.scopeUuid),
    cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", cause)));
  const raw = rows[0];
  if (definitions.length !== 0 && (rows.length !== 1 || raw === undefined))
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const verdict = raw === undefined ? { phase: "coverage" as const, reason: "accepted" as const,
    ordinal: null, indexDefinitionId: null } : yield* decodeRequiredIndexReadinessVerdict(raw).pipe(
    Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
  const ordinal = verdict.ordinal === null ? -1 : Number(verdict.ordinal) - 1;
  const definition = definitions[ordinal];
  if (verdict.reason === "accepted" ? verdict.ordinal !== null || verdict.indexDefinitionId !== null || verdict.phase !== "coverage"
    : !Number.isSafeInteger(ordinal) || ordinal < 0 || String(ordinal + 1) !== verdict.ordinal ||
      definition === undefined || verdict.indexDefinitionId !== definition.indexDefinitionId)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const availability = yield* Effect.gen(function* () {
    if (verdict.phase !== "availability") return null;
    if (definition === undefined || raw === undefined)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    if (verdict.reason === "missing" || verdict.reason === "stale")
      return Object.freeze({ status: "not_ready" as const, reason: verdict.reason, indexDefinitionId: definition.indexDefinitionId });
    if (verdict.reason === "notEnabled") return Object.freeze({ status: "not_ready" as const, reason: "notEnabled" as const,
      indexDefinitionId: definition.indexDefinitionId, lifecycle: raw.build.lifecycle });
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  });
  const acceptCoverage = Effect.fnUntraced(function* (context: IndexCoverageContext) {
    const writer = readExactScopeWriteClockObservation(tx, clock.scopeId);
    if (identity !== exactScopeWriteClockObservationIdentity(tx, clock.scopeId) || writer === undefined ||
      writer.lastCommitSeq !== clock.lastCommitSeq || writer.oldestAvailableCommitSeq !== clock.oldestAvailableCommitSeq ||
      writer.lastMetadataSequence !== clock.lastMetadataSequence ||
      writer.storageGeneration !== clock.storageGeneration || writer.storageGenerationFence !== clock.storageGenerationFence ||
      writer.epoch !== clock.epoch || writer.updatedAt.getTime() !== clock.updatedAt.getTime() ||
      context.clock.lastMetadataSequence !== clock.lastMetadataSequence ||
      !(yield* Effect.fromResult(matchIndexCoverageContextInTransaction(tx, clock, context))))
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const issued = coverageContextTransactions.get(context);
    const matchesPins = (active: IndexCoverageContext["active"]) => pins === null ? active === null : active !== null &&
      pins.activationSequence === active.head.activationSequence &&
      bytesEqualFullScan(pins.activationSha256, active.head.activationSha256) &&
      bytesEqualFullScan(pins.headSha256, active.head.headSha256) &&
      pins.deploymentId === active.schema.deploymentId && pins.schemaVersionId === active.schema.schemaVersionId &&
      pins.schemaManifestSha256 === active.schema.schemaManifestSha256;
    if (issued === undefined || issued.clock.lastMetadataSequence !== clock.lastMetadataSequence ||
      !matchesPins(context.active) || !matchesPins(issued.active))
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    if (availability !== null) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    if (verdict.reason === "accepted") return Object.freeze({ status: "ready" as const });
    if (raw === undefined || definition === undefined) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(raw.build, clock.scopeId,
      definition.indexDefinitionId, raw.maintenance.scopeId === null ? null : raw.maintenance));
    yield* Effect.fromResult(validateIndexBuildStateFrontierResult(state, clock.lastCommitSeq));
    if (state.maintenance === null && state.coveredThroughCommitSeq !== null &&
      state.coveredThroughCommitSeq < clock.lastCommitSeq && state.firstReadableCommitSeq !== null &&
      state.firstReadableCommitSeq <= clock.lastCommitSeq) {
      const frontier = decodeCapturedAppTableWriteFrontierResult(clock.scopeId, definition.tableId, 0,
        { ordinal: 0, commitSeqText: raw.tableFrontier }, 1, 1);
      coverageTableFrontiers.set(context, { tx, frontiers: new Map([[definition.tableId, frontier]]) });
    }
    if (yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, state, definition, clock.lastCommitSeq, context))
      return yield* Effect.die(new Error("Native required index readiness rejected valid coverage"));
    return Object.freeze({ status: "not_ready" as const, reason: "notCovered" as const,
      indexDefinitionId: definition.indexDefinitionId });
  });
  return Object.freeze({ availability, acceptCoverage });
}, work => observeExecution("IndexBuildState.captureRequiredReadiness", work, "caller"));

/** The existing frontier/coverage owners consume this projection, not a
 * fabricated full build record. Full native decoders remain full consumers. */
export type IndexBuildCoverageState = Pick<IndexBuildStateRecord,
  "scopeId" | "indexDefinitionId" | "storageGeneration" | "storageGenerationFence" | "epoch" |
  "lifecycle" | "startCommitSeq" | "coveredThroughCommitSeq" | "firstReadableCommitSeq"> & {
  readonly maintenance: Pick<IndexMaintenanceObligation, "authorityKind" | "candidateSha256" | "tableId" | "physicalSpecSha256" | "deploymentId" |
    "schemaVersionId" | "schemaManifestSha256" | "activationSequence" | "activationSha256" | "headSha256"> | null;
};

const decodeProgressHeader = Schema.decodeUnknownEffect(Schema.Struct({
  reason: Schema.Literals(["captured","invalid","missing","stale","notEnabled"]),
  ordinal: Schema.NullOr(Schema.String),lockedCount: Schema.String,
  indexDefinitionId: Schema.NullOr(CatalogIndexDefinitionIdSchema),progress: Schema.NullOr(Schema.String),
}));
const OrdinaryIndexProgressSchema = Schema.Tuple([
  CommitSeqSchema, Schema.NullOr(CommitSeqSchema), Schema.NullOr(CommitSeqSchema),
  Schema.NullOr(Schema.Boolean), Schema.NullOr(Schema.String),
]).check(Schema.makeFilter(state =>
  (state[2] === null || (state[1] !== null && state[2] <= state[1])) &&
  (state[3] === null) === (state[4] === null) ? undefined : "Invalid captured index progress"));
const decodeOrdinaryIndexProgressEnvelope = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Schema.Unknown)));
const decodeOrdinaryIndexProgress = Schema.decodeUnknownResult(OrdinaryIndexProgressSchema);
const OrdinaryIndexMaintenanceKeySchema = Schema.Tuple([
  Schema.NonEmptyString, Schema.NonEmptyString, Schema.String,
  CommitSeqSchema.check(Schema.makeFilter(value => value > 0n ? undefined : "Expected positive activation sequence")),
  Schema.String, Schema.String, Schema.Literals(["application", "binding"]), Schema.NullOr(Schema.String),
]);
const decodeOrdinaryIndexMaintenanceKey = Schema.decodeUnknownResult(Schema.fromJsonString(OrdinaryIndexMaintenanceKeySchema));
/** Capture once, retain typed invalid results, then consume compact intrinsic
 * progress locally at its ordered canonical-context frontier. */
export const readRequiredIndexBuildProgressInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction,inputClock: ScopeClockRecord,inputDefinitions: readonly IndexCoverageDefinition[],
) {
  const clock=Object.freeze({...inputClock,updatedAt:new Date(inputClock.updatedAt.getTime())});
  const definitions=Object.freeze(inputDefinitions.map(definition=>Object.freeze({indexDefinitionId:definition.indexDefinitionId,
    tableId:definition.tableId,physicalSpecSha256Hex:definition.physicalSpecSha256Hex})));
  if (definitions.length>MAX_REQUIRED_INDEX_BUILDS || new Set(definitions.map(value => value.indexDefinitionId)).size!==definitions.length)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const rows = definitions.length===0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(
    prepareRequiredIndexBuildProgressCapture(tx,clock,definitions),cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates",cause)));
  let capture = "[]",previousOrdinal = 0;
  const invalidRows: Readonly<{ ordinal: number; definition: IndexCoverageDefinition; raw: typeof rows[number] }>[] = [];
  for (const [index,raw] of rows.entries()) {
    const header = yield* decodeProgressHeader(raw).pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState",cause })));
    const locked = Number(header.lockedCount),ordinal = header.ordinal===null ? 0 : Number(header.ordinal);
    if (!Number.isSafeInteger(locked) || locked<0 || locked>definitions.length || String(locked)!==header.lockedCount ||
      !Number.isSafeInteger(ordinal) || ordinal<0 || (ordinal!==0 && String(ordinal)!==header.ordinal))
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    if (header.reason==="captured") {
      if (index!==0 || ordinal!==0 || header.indexDefinitionId!==null || locked!==definitions.length || header.progress===null)
        return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      capture=header.progress;
      continue;
    }
    const definition=definitions[ordinal-1];
    if (definition===undefined || header.indexDefinitionId!==definition.indexDefinitionId || header.progress!==null)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    if (header.reason!=="invalid") {
      if (rows.length!==1 || (header.reason==="missing" ? locked>=definitions.length : locked===0))
        return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      return Object.freeze({ status: "not_ready" as const,reason: header.reason,indexDefinitionId: definition.indexDefinitionId,
        ...(header.reason==="notEnabled" ? { lifecycle: raw.lifecycle } : {}) });
    }
    if (index===0 || ordinal<=previousOrdinal || locked!==definitions.length)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    previousOrdinal=ordinal;
    invalidRows.push({ordinal,definition,raw});
  }
  if (definitions.length!==0 && rows.length===0) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const invalid = new Map<number,Result.Result<IndexBuildStateRecord,IndexBuildStateCorruptionError>>();
  let intrinsicsDecoded=false;
  const decodeIntrinsics = Effect.sync(() => {
    // Header identity was validated above in the stored-state failure channel.
    // Retain that identity rather than rereading a mutable foreign header.
    for (const {ordinal,definition,raw} of invalidRows) {
      invalid.set(ordinal,decodeIndexBuildStateRowResult(raw.rawBuild,clock.scopeId,definition.indexDefinitionId,
        raw.rawMaintenance.scopeId===null ? null : raw.rawMaintenance));
    }
    intrinsicsDecoded=true;
  });
  const acceptCoverage = Effect.fnUntraced(function* (context: IndexCoverageContext,searchTableIds: readonly CatalogTableId[]=[]) {
    if (!intrinsicsDecoded || context.clock.scopeId!==clock.scopeId || context.clock.storageGeneration!==clock.storageGeneration ||
      context.clock.storageGenerationFence!==clock.storageGenerationFence || context.clock.epoch!==clock.epoch ||
      context.clock.lastCommitSeq<clock.lastCommitSeq || !(yield* Effect.fromResult(matchIndexCoverageContextInTransaction(tx,context.clock,context))))
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const issued=coverageContextTransactions.get(context);
    if (issued===undefined) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    // Interpretation begins only after the actual canonical context and eager
    // native invalid getters. Compact progress never issues a capability.
    const capturedProgress = yield* Effect.fromResult(decodeOrdinaryIndexProgressEnvelope(capture).pipe(
      Result.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause }))));
    if (capturedProgress.length !== definitions.length)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const progress = capturedProgress.map(state => state === null ? null : decodeOrdinaryIndexProgress(state).pipe(
      Result.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause }))));
    let requiredChecked = issued.binding === null || requiredBindingMaintenance.has(context);
    const consume = (startAt: number,frontiers: ReturnType<typeof coverageTableFrontiers.get>) => Result.gen(function* () {
      for (let index=startAt;index<definitions.length;index++) {
        const definition=definitions[index],capturedState=progress[index];
        if (definition===undefined || capturedState===undefined)
          return yield* Result.fail(new IndexMaintenanceError({reason:"storedState"}));
        if (capturedState===null) {
          const decoded=invalid.get(index+1);
          if (decoded===undefined) return yield* Result.fail(new IndexMaintenanceError({reason:"storedState"}));
          yield* decoded;
          throw new Error("Native intrinsic refusal accepted by complete decoder");
        }
        if (invalid.has(index+1)) return yield* Result.fail(new IndexMaintenanceError({reason:"storedState"}));
        const [start,covered,firstReadable,maintenanceMatches,maintenanceActive]=yield* capturedState;
        const frontier=start>context.clock.lastCommitSeq ? {name:"start",value:start} :
          covered!==null && covered>context.clock.lastCommitSeq ? {name:"coverage",value:covered}:null;
        if (frontier!==null) return yield* Result.fail(new IndexBuildStateCorruptionError(clock.scopeId,
          definition.indexDefinitionId,`${frontier.name} commit sequence ${frontier.value} is ahead of scope clock ${context.clock.lastCommitSeq}`));
        if (covered===null || firstReadable===null || firstReadable>clock.lastCommitSeq)
          return Object.freeze({status:"not_ready" as const,reason:"notCovered" as const,indexDefinitionId:definition.indexDefinitionId});
        if (maintenanceActive!==null) {
          const key=yield* decodeOrdinaryIndexMaintenanceKey(maintenanceActive).pipe(
            Result.mapError(cause=>new IndexMaintenanceError({reason:"storedState",cause})));
          const authority = key[6] === "binding" ? issued.binding : issued.active === null ? null : {
            ...issued.active.schema, ...issued.active.head, candidateSha256: null };
          if (maintenanceMatches!==true || authority===null || key[0]!==authority.deploymentId ||
            key[1]!==authority.schemaVersionId || key[2]!==authority.schemaManifestSha256 ||
            key[3]!==authority.activationSequence || key[4]!==encodeBytesToLowercaseHex(authority.activationSha256) ||
            key[5]!==encodeBytesToLowercaseHex(authority.headSha256) ||
            key[7] !== (authority.candidateSha256 === null ? null : encodeBytesToLowercaseHex(authority.candidateSha256)))
            return yield* Result.fail(new IndexMaintenanceError({reason:"storedState"}));
        } else if (!requiredChecked) {
          return Object.freeze({ status: "bindingMaintenanceRequired" as const, index });
        } else if (hasRequiredBindingMaintenance(context, "index", definition.indexDefinitionId)) {
          return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
        } else if (covered<clock.lastCommitSeq) {
          if (frontiers===undefined) return Object.freeze({status:"frontiersRequired" as const,index});
          const capturedFrontier=frontiers.frontiers.get(definition.tableId);
          if (capturedFrontier===undefined) throw new Error("Index frontier batch missing a selected table");
          const value=yield* capturedFrontier;
          if (value!==null && value>covered)
            return Object.freeze({status:"not_ready" as const,reason:"notCovered" as const,indexDefinitionId:definition.indexDefinitionId});
        }
      }
      return Object.freeze({status:"ready" as const});
    });
    const consumeWithRequiredMaintenance = Effect.fnUntraced(function* (
      startAt: number, frontiers: ReturnType<typeof coverageTableFrontiers.get>,
    ) {
      const observed = yield* Effect.fromResult(consume(startAt, frontiers));
      if (observed.status !== "bindingMaintenanceRequired") return observed;
      yield* prepareMissingBindingMaintenanceCheck(tx, context);
      requiredChecked = true;
      const resumed = yield* Effect.fromResult(consume(observed.index, frontiers));
      if (resumed.status === "bindingMaintenanceRequired")
        return yield* Effect.die("Required binding maintenance repeated its capture demand");
      return resumed;
    });
    const first=yield* consumeWithRequiredMaintenance(0,undefined);
    if (first.status!=="frontiersRequired") return first;
    const needed=definitions.filter((_value,ordinal)=> {
      const candidate=progress[ordinal];
      return candidate!==undefined && candidate!==null && Result.match(candidate, {
        onFailure:()=>false,onSuccess:value=>value[4]===null && value[1]!==null &&
          value[1]<clock.lastCommitSeq && value[2]!==null && value[2]<=clock.lastCommitSeq,
      });
    }).map(value=>value.tableId);
    yield* readIndexCoverageTableFrontiersInTransactionEffect(tx,context,[...new Set([...needed,...searchTableIds])]);
    const frontiers=coverageTableFrontiers.get(context);
    if (frontiers===undefined) return yield* Effect.die("Index frontier batch missing");
    const accepted=yield* consumeWithRequiredMaintenance(first.index,frontiers);
    if (accepted.status==="frontiersRequired") return yield* Effect.die("Index frontier consumption repeated its capture demand");
    return accepted;
  });
  return Object.freeze({status:"ready" as const,decodeIntrinsics,acceptCoverage});
},work => observeExecution("IndexBuildState.readRequiredProgress",work,"caller"));

export const readRequiredEnabledIndexBuildsInTransactionEffect = Effect.fnUntraced(
  function* (tx: AppRowTransaction, clock: IndexBuildStorageAuthority, definitionIds: readonly CatalogIndexDefinitionId[], lock: "key share" | "share" | "update") {
    if (definitionIds.length > MAX_REQUIRED_INDEX_BUILDS || new Set(definitionIds).size !== definitionIds.length)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const rows = definitionIds.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(
      requiredBuildReads[lock](tx, { scopeId: clock.scopeId, definitionIds: [...definitionIds] }),
      cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", cause),
    ));
    const rowsByDefinitionId = new Map(rows.map(row => [row.indexDefinitionId, row]));
    for (const indexDefinitionId of definitionIds) {
      const build = rowsByDefinitionId.get(indexDefinitionId);
      if (build === undefined) return Object.freeze({ status: "not_ready" as const, reason: "missing" as const, indexDefinitionId });
      if (build.storageGeneration !== clock.storageGeneration || build.storageGenerationFence !== clock.storageGenerationFence || build.epoch !== clock.epoch)
        return Object.freeze({ status: "not_ready" as const, reason: "stale" as const, indexDefinitionId });
      if (build.lifecycle !== "enabled") return Object.freeze({ status: "not_ready" as const, reason: "notEnabled" as const, indexDefinitionId, lifecycle: build.lifecycle });
    }
    return Object.freeze({ status: "ready" as const, rows: Object.freeze(rows) });
  },
  work => observeExecution("IndexBuildState.readRequiredEnabled", work, "caller"));

export type ReadFencedIndexBuildStateError =
  | InvalidIndexBuildStateReadInputError
  | IndexBuildStateClockNotFoundError
  | IndexBuildStateCorruptionError
  | IndexBuildStatePersistenceError;

/**
 * Read one build row and its current scope clock from one SQL statement.
 *
 * `current` means only that generation, fence, and epoch still match. It does
 * not mean the index is enabled or that a schema is activation-ready.
 */
export const readFencedIndexBuildStateEffect = Effect.fn(
  "IndexBuildState.readFenced",
)(function* (
  db: FlarexMetadataDatabase,
  input: unknown,
): Effect.fn.Return<
  FencedIndexBuildStateReadResult,
  ReadFencedIndexBuildStateError
> {
  const decoded = yield* Effect.fromResult(decodeReadInput(input));
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => selectFencedIndexBuildStateRows(db, decoded),
    catch: (cause) => new IndexBuildStatePersistenceError(
      "readFencedIndexBuildState",
      cause,
    ),
  }));
  return yield* Effect.fromResult(materializeFencedIndexBuildState(
    rows,
    decoded,
  ));
});

function selectFencedIndexBuildStateRows(
  db: FlarexMetadataDatabase,
  input: ReadFencedIndexBuildStateInput,
) {
  return readFencedBuild(db, { scopeId: input.scopeId, indexDefinitionId: input.indexDefinitionId });
}

type FencedIndexBuildStateRows = Awaited<
  ReturnType<typeof selectFencedIndexBuildStateRows>
>;

function materializeFencedIndexBuildState(
  rows: FencedIndexBuildStateRows,
  input: ReadFencedIndexBuildStateInput,
): Result.Result<
  FencedIndexBuildStateReadResult,
  IndexBuildStateClockNotFoundError | IndexBuildStateCorruptionError
> {
  return Result.gen(function* () {
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(new IndexBuildStateClockNotFoundError(
        input.scopeId,
        input.indexDefinitionId,
      ));
    }
    const clock = yield* decodeScopeClockRecordResult(row.clock).pipe(
      Result.mapError((cause) => new IndexBuildStateCorruptionError(
        input.scopeId,
        input.indexDefinitionId,
        "stored scope clock is invalid",
        { cause },
      )),
    );
    const currentAuthority = freezeAuthority({
      scopeId: clock.scopeId,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
    });
    if (row.buildState === null) {
      return Object.freeze({
        status: "absent",
        currentAuthority,
      });
    }

    const buildState = yield* decodeIndexBuildStateRowResult(
      row.buildState,
      input.scopeId,
      input.indexDefinitionId,
      row.maintenanceObligation,
    );
    yield* validateIndexBuildStateFrontierResult(
      buildState,
      clock.lastCommitSeq,
    );
    const mismatches = collectAuthorityMismatches(
      buildState,
      currentAuthority,
    );
    if (mismatches !== null) {
      return Object.freeze({
        status: "stale",
        buildState,
        currentAuthority,
        mismatches,
      });
    }
    return Object.freeze({ status: "current", buildState });
  });
}

export type IndexBuildStateRow = typeof fxSystemIndexBuildStates.$inferSelect & {
  readonly maintenanceObligation: typeof fxSystemIndexMaintenanceObligations.$inferSelect | null;
};

/** Read the immutable opening binding with its build in the existing statement. */
const indexBuildColumns = Object.freeze({ ...getTableColumns(fxSystemIndexBuildStates) });
const indexMaintenanceColumns = Object.freeze({ ...getTableColumns(fxSystemIndexMaintenanceObligations) });
const indexBuildProjection = Object.freeze({ ...indexBuildColumns, maintenanceObligation: indexMaintenanceColumns });
export function indexBuildStateSelection() {
  return indexBuildProjection;
}

function composeIndexMaintenanceBindingPredicate(scopeId: SQLWrapper, definitionId: SQLWrapper, activationSequence: SQLWrapper, authorityKind: SQLWrapper) {
  return and(eq(fxSystemIndexMaintenanceObligations.authorityKind, authorityKind), eq(fxSystemIndexMaintenanceObligations.scopeId, scopeId),
    eq(fxSystemIndexMaintenanceObligations.indexDefinitionId, definitionId),
    eq(fxSystemIndexMaintenanceObligations.activationSequence, activationSequence));
}
const fixedIndexMaintenanceBindingPredicate = composeIndexMaintenanceBindingPredicate(fxSystemIndexBuildStates.scopeId,
  fxSystemIndexBuildStates.indexDefinitionId, fxSystemIndexBuildStates.maintenanceActivationSequence, fxSystemIndexBuildStates.maintenanceAuthorityKind);

/** Also accepts a native observed build's real composite-column projections. */
export function indexMaintenanceBindingPredicate(
  scopeId: SQLWrapper = fxSystemIndexBuildStates.scopeId,
  definitionId: SQLWrapper = fxSystemIndexBuildStates.indexDefinitionId,
  activationSequence: SQLWrapper = fxSystemIndexBuildStates.maintenanceActivationSequence,
  authorityKind: SQLWrapper = fxSystemIndexBuildStates.maintenanceAuthorityKind,
) {
  return scopeId === fxSystemIndexBuildStates.scopeId && definitionId === fxSystemIndexBuildStates.indexDefinitionId &&
    activationSequence === fxSystemIndexBuildStates.maintenanceActivationSequence && authorityKind === fxSystemIndexBuildStates.maintenanceAuthorityKind
    ? fixedIndexMaintenanceBindingPredicate : composeIndexMaintenanceBindingPredicate(scopeId, definitionId, activationSequence, authorityKind);
}

function defineRequiredBuildRead(lock: "key share" | "share" | "update") {
  return defineNativeMetadataRead(db => db.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
    .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(and(
      eq(fxSystemIndexBuildStates.scopeId, sql.placeholder("scopeId")),
      sql`${fxSystemIndexBuildStates.indexDefinitionId} = any(${sql.placeholder("definitionIds")}::integer[])`,
    )).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for(lock, { of: fxSystemIndexBuildStates }));
}
const requiredBuildReads = {
  "key share": defineRequiredBuildRead("key share"),
  share: defineRequiredBuildRead("share"),
  update: defineRequiredBuildRead("update"),
};
const readFencedBuild = defineNativeMetadataRead(db => db.select({
  clock: scopeClockSelection(), buildState: indexBuildColumns, maintenanceObligation: indexMaintenanceColumns,
}).from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, scopeClockExecutionAuthorityJoin)
  .leftJoin(fxSystemIndexBuildStates, and(eq(fxSystemIndexBuildStates.scopeId, fxSystemScopeClocks.scopeId),
    eq(fxSystemIndexBuildStates.indexDefinitionId, sql.placeholder("indexDefinitionId"))))
  .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
  .where(eq(fxSystemScopeClocks.scopeId, sql.placeholder("scopeId"))).limit(1));

/** Native projections guarantee their keys, while every scalar remains evidence
 * for the ordered field decoders, including a NULL composite's null scalars. */
type RawIndexBuildStateRow = {
  readonly [Field in keyof typeof fxSystemIndexBuildStates.$inferSelect]: unknown;
};

/** Package-internal decoder shared by the C4 read and S03-D3 transaction. */
export function decodeIndexBuildStateRowResult(
  row: RawIndexBuildStateRow,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
  maintenanceObligation: unknown,
): Result.Result<IndexBuildStateRecord, IndexBuildStateCorruptionError> {
  return Result.gen(function* () {
    const cursorCodecVersion = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildCursorCodecVersionResult(row.cursorCodecVersion),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const scopeId = yield* decodeStoredBuildStateFieldResult(
      decodeScopeIdResult(row.scopeId),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const indexDefinitionId = yield* decodeStoredBuildStateFieldResult(
      decodeCatalogIndexDefinitionIdResult(row.indexDefinitionId),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const storageGeneration = yield* decodeStoredBuildStateFieldResult(
      decodeFlarexDbV1StorageGenerationResult(row.storageGeneration),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const storageGenerationFence = yield* decodeStoredBuildStateFieldResult(
      decodeStorageGenerationFenceResult(row.storageGenerationFence),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const epoch = yield* decodeStoredBuildStateFieldResult(
      decodeScopeEpochResult(row.epoch),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const startCommitSeq = yield* decodeStoredBuildStateFieldResult(
      decodeCommitSeqResult(row.startCommitSeq),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const coveredThroughCommitSeq = row.coveredThroughCommitSeq === null ? null
      : yield* decodeStoredBuildStateFieldResult(
        decodeCommitSeqResult(row.coveredThroughCommitSeq), expectedScopeId, expectedIndexDefinitionId,
      );
    const firstReadableCommitSeq = row.firstReadableCommitSeq === null ? null
      : yield* decodeStoredBuildStateFieldResult(
        decodeCommitSeqResult(row.firstReadableCommitSeq), expectedScopeId, expectedIndexDefinitionId,
      );
    if (firstReadableCommitSeq !== null &&
      (coveredThroughCommitSeq === null || firstReadableCommitSeq > coveredThroughCommitSeq)) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId, indexDefinitionId, "readable frontier exceeds completed coverage",
      ));
    }
    const lifecycle = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildLifecycleResult(row.lifecycle),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const rawBackfillCursorRowId = row.backfillCursorRowId;
    const afterRowId = rawBackfillCursorRowId === null
      ? null
      : yield* decodeStoredBuildStateFieldResult(
        orderedIndexRowIdHexV1FromBytesResult(rawBackfillCursorRowId),
        expectedScopeId,
        expectedIndexDefinitionId,
      );
    const decodedBackfillCursor = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildBackfillCursorResult({
        codecVersion: cursorCodecVersion,
        afterRowId,
      }),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const backfillCursor = Object.freeze({
      codecVersion: decodedBackfillCursor.codecVersion,
      afterRowId: decodedBackfillCursor.afterRowId,
    });
    const attemptFence = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildAttemptFenceResult(row.attemptFence),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    if (
      scopeId !== expectedScopeId ||
      indexDefinitionId !== expectedIndexDefinitionId
    ) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        expectedScopeId,
        expectedIndexDefinitionId,
        "point query returned another build identity",
      ));
    }
    if (
      (lifecycle === "declared" || lifecycle === "building") &&
      backfillCursor.afterRowId !== null
    ) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId,
        indexDefinitionId,
        `${lifecycle} build unexpectedly carries a backfill cursor`,
      ));
    }
    const createdAt = yield* decodeTimestamp(
      row.createdAt,
      scopeId,
      indexDefinitionId,
      "created",
    );
    const updatedAt = yield* decodeTimestamp(
      row.updatedAt,
      scopeId,
      indexDefinitionId,
      "updated",
    );
    if (updatedAt < createdAt) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId,
        indexDefinitionId,
        "updated timestamp precedes creation",
      ));
    }

    if ((row.maintenanceActivationSequence === null) !== (maintenanceObligation === null) ||
      (row.maintenanceAuthorityKind === null) !== (maintenanceObligation === null)) {
      return yield* Result.fail(storedBuildStateCorruption(scopeId, indexDefinitionId,
        "Maintenance binding and obligation presence disagree"));
    }
    const maintenance = maintenanceObligation === null ? null : yield* decodeIndexMaintenanceObligationResult(
      maintenanceObligation,
    ).pipe(Result.mapError(cause => storedBuildStateCorruption(scopeId, indexDefinitionId, cause)));
    if (maintenance !== null && (lifecycle !== "enabled" ||
      maintenance.authorityKind !== row.maintenanceAuthorityKind || maintenance.activationSequence !== row.maintenanceActivationSequence || maintenance.scopeId !== scopeId ||
      maintenance.indexDefinitionId !== indexDefinitionId || maintenance.storageGeneration !== storageGeneration ||
      maintenance.storageGenerationFence !== storageGenerationFence || maintenance.epoch !== epoch ||
      maintenance.attemptFence !== attemptFence || maintenance.firstReadableCommitSeq !== firstReadableCommitSeq ||
      maintenance.openedCommitSeq !== coveredThroughCommitSeq)) {
      return yield* Result.fail(storedBuildStateCorruption(scopeId, indexDefinitionId,
        "Maintenance obligation does not match build opening"));
    }
    const common = {
      maintenance,
      scopeId,
      indexDefinitionId,
      storageGeneration,
      storageGenerationFence,
      epoch,
      startCommitSeq,
      coveredThroughCommitSeq,
      firstReadableCommitSeq,
      attemptFence,
      createdAt,
      updatedAt,
    } satisfies IndexBuildStateRecordBase;
    if (lifecycle === "declared" || lifecycle === "building") {
      const preBackfillCursor: IndexBuildPreBackfillCursorV1 = Object.freeze({
        codecVersion: backfillCursor.codecVersion,
        afterRowId: null,
      });
      return Object.freeze({
        ...common,
        lifecycle,
        backfillCursor: preBackfillCursor,
      });
    }
    return Object.freeze({ ...common, lifecycle, backfillCursor });
  });
}

/** Package-internal frontier invariant shared by fenced reads and readiness. */
export function validateIndexBuildStateFrontierResult(
  state: Pick<IndexBuildCoverageState, "scopeId" | "indexDefinitionId" | "startCommitSeq" | "coveredThroughCommitSeq">,
  lastCommitSeq: CommitSeq,
): Result.Result<void, IndexBuildStateCorruptionError> {
  for (const [name, frontier] of [
    ["start", state.startCommitSeq],
    ["coverage", state.coveredThroughCommitSeq],
  ] as const) {
    if (frontier !== null && frontier > lastCommitSeq) {
      return Result.fail(new IndexBuildStateCorruptionError(
        state.scopeId, state.indexDefinitionId,
        `${name} commit sequence ${frontier} is ahead of scope clock ${lastCommitSeq}`,
      ));
    }
  }
  return Result.succeed(undefined);
}

type IndexCoverageDefinition = Pick<AppIndexDefinitionRecord, "indexDefinitionId" | "physicalSpecSha256Hex"> & {
  readonly tableId: AppIndexDefinitionRecord["access"]["tableId"];
};

export interface BindingIndexCoveragePins {
  readonly deploymentId: string;
  readonly schemaVersionId: string;
  readonly schemaManifestSha256: string;
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
}
const digestFromHex = Encoding.decodeHex;
const readBindingCoveragePins = Effect.fn("IndexBuildState.readBindingCoveragePins")(function* (tx: AppRowTransaction, clock: ScopeClockRecord) {
  const selected = yield* readBindingCoverageSelectedEvidence(tx, { scopeId: clock.scopeId, storageGeneration: clock.storageGeneration })
    .pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: cause.reason === "resourceFailure" ? "resourceFailure" : "storedState", cause })));
  if (Option.isNone(selected) || selected.value.candidate.frame.logicalSchema === null) return null;
  const { candidate, head, activation } = selected.value;
  const logical = candidate.frame.logicalSchema;
  if (logical === null) return null;
  const digest = (value: string) => Effect.fromResult(digestFromHex(value)).pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
  return Object.freeze({ deploymentId: candidate.frame.application.deploymentId,
    schemaVersionId: logical.schemaVersionId,
    schemaManifestSha256: logical.manifestSha256,
    activationSequence: BigInt(head.frame.sequence), activationSha256: yield* digest(activation.sha256),
    headSha256: yield* digest(head.sha256), candidateSha256: yield* digest(candidate.sha256) });
});

/** These comparisons consume only the context issuer's freshly authenticated selection. */
export function maintenanceMatchesCoverageContext(obligation: Pick<IndexMaintenanceObligation,
  "authorityKind" | "deploymentId" | "schemaVersionId" | "activationSequence" | "activationSha256" | "headSha256" | "candidateSha256"> &
  { readonly schemaManifestSha256?: Uint8Array | null }, context: IndexCoverageContext): boolean {
  if (obligation.authorityKind === "binding") {
    const issued = coverageContextTransactions.get(context);
    if (issued === undefined) return false;
    const binding = issued.binding;
    return binding !== null && obligation.candidateSha256 !== null && obligation.schemaManifestSha256 != null &&
      obligation.deploymentId === binding.deploymentId && obligation.schemaVersionId === binding.schemaVersionId &&
      obligation.activationSequence === binding.activationSequence && bytesEqualFullScan(obligation.activationSha256, binding.activationSha256) &&
      bytesEqualFullScan(obligation.headSha256, binding.headSha256) && bytesEqualFullScan(obligation.candidateSha256, binding.candidateSha256) &&
      encodeBytesToLowercaseHex(obligation.schemaManifestSha256) === binding.schemaManifestSha256;
  }
  const active = coverageContextTransactions.get(context)?.active;
  return active != null && obligation.candidateSha256 === null && obligation.deploymentId === active.schema.deploymentId &&
    obligation.schemaVersionId === active.schema.schemaVersionId && obligation.activationSequence === active.head.activationSequence &&
    bytesEqualFullScan(obligation.activationSha256, active.head.activationSha256) && bytesEqualFullScan(obligation.headSha256, active.head.headSha256) &&
    (obligation.schemaManifestSha256 == null || encodeBytesToLowercaseHex(obligation.schemaManifestSha256) === active.schema.schemaManifestSha256);
}

/** Compact native readiness keeps its source bytes opaque and compares only
 * against issuer-held selection pins, never a caller-mutated public projection. */
export function maintenanceKeyMatchesCoverageContext(key: Readonly<{
  authorityKind: "application" | "binding"; deploymentId: string; schemaVersionId: string;
  activationSequence: bigint; activationSha256: string; headSha256: string;
  candidateSha256: string | null; schemaManifestSha256: string | null;
}>, context: IndexCoverageContext): boolean {
  const issued = coverageContextTransactions.get(context);
  if (issued === undefined) return false;
  const selected = key.authorityKind === "binding" ? issued.binding : issued.active === null ? null : {
    ...issued.active.schema, ...issued.active.head, candidateSha256: null };
  return selected !== null && key.deploymentId === selected.deploymentId && key.schemaVersionId === selected.schemaVersionId &&
    key.activationSequence === selected.activationSequence && key.activationSha256 === encodeBytesToLowercaseHex(selected.activationSha256) &&
    key.headSha256 === encodeBytesToLowercaseHex(selected.headSha256) &&
    key.candidateSha256 === (selected.candidateSha256 === null ? null : encodeBytesToLowercaseHex(selected.candidateSha256)) &&
    (key.authorityKind === "application" && key.schemaManifestSha256 === null || key.schemaManifestSha256 === selected.schemaManifestSha256);
}

export interface IndexCoverageContext {
  readonly binding: BindingIndexCoveragePins | null;
  readonly clock: ScopeClockRecord;
  readonly active: (CoherentApplicationActiveHead & { readonly schema: { readonly deploymentId: string; readonly schemaVersionId: string; readonly schemaManifestSha256: string } }) | null;
}

const coverageTableFrontiers = new WeakMap<IndexCoverageContext, Readonly<{
  tx: AppRowTransaction;
  frontiers: ReadonlyMap<CatalogTableId, Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>;
}>>();
const coverageContextTransactions = new WeakMap<IndexCoverageContext, Readonly<{
  tx: AppRowTransaction; clock: ScopeClockRecord; active: IndexCoverageContext["active"]; binding: IndexCoverageContext["binding"];
}>>();
const requiredBindingMaintenance = new WeakMap<IndexCoverageContext, Readonly<{
  indexes: ReadonlySet<number>; unique: ReadonlySet<number>;
}>>();
const RequiredBindingMaintenanceInventorySchema = Schema.Array(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("index"), id: Schema.toType(CatalogIndexDefinitionIdSchema) }),
  Schema.Struct({ kind: Schema.Literal("unique"), id: Schema.toType(CatalogUniqueConstraintDefinitionIdSchema) }),
]));
const decodeRequiredBindingMaintenanceInventory = Schema.decodeUnknownEffect(RequiredBindingMaintenanceInventorySchema);

/** Only bounded fallback needs this inventory. Healthy maintained definitions
 * already carry their immutable opening and compare the issued selection pins. */
export const prepareMissingBindingMaintenanceCheck = Effect.fn("IndexBuildState.prepareMissingBindingMaintenanceCheck")(function* (
  tx: AppRowTransaction, context: IndexCoverageContext,
) {
  const issued = coverageContextTransactions.get(context);
  if (issued === undefined || issued.tx !== tx)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  if (issued.binding === null || requiredBindingMaintenance.has(context)) return;
  const binding = issued.binding;
  const selected = (table: typeof fxSystemIndexMaintenanceObligations | typeof fxSystemUniqueMaintenanceObligations) => and(
    eq(table.scopeId, issued.clock.scopeId), eq(table.authorityKind, "binding"),
    eq(table.activationSequence, binding.activationSequence), eq(table.candidateSha256, binding.candidateSha256),
    eq(table.activationSha256, binding.activationSha256), eq(table.headSha256, binding.headSha256),
    eq(table.deploymentId, binding.deploymentId), eq(table.schemaVersionId, binding.schemaVersionId),
    eq(table.schemaManifestSha256, sql`decode(${binding.schemaManifestSha256},'hex')`));
  const nativeRows = yield* runDrizzleStatementEffect(tx.select({ kind: sql<string>`'index'`,
    id: sql<number>`${fxSystemIndexMaintenanceObligations.indexDefinitionId}` }).from(fxSystemIndexMaintenanceObligations)
    .where(selected(fxSystemIndexMaintenanceObligations)).unionAll(tx.select({ kind: sql<string>`'unique'`,
      id: sql<number>`${fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId}` }).from(fxSystemUniqueMaintenanceObligations)
      .where(selected(fxSystemUniqueMaintenanceObligations))),
    cause => new IndexMaintenanceError({ reason: "resourceFailure", cause }));
  const rows = yield* decodeRequiredBindingMaintenanceInventory(nativeRows).pipe(
    Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
  requiredBindingMaintenance.set(context, { indexes: new Set(rows.filter(row => row.kind === "index").map(row => row.id)),
    unique: new Set(rows.filter(row => row.kind === "unique").map(row => row.id)) });
});

export function hasRequiredBindingMaintenance(context: IndexCoverageContext, kind: "index" | "unique", id: number): boolean {
  const required = requiredBindingMaintenance.get(context);
  return (kind === "index" ? required?.indexes : required?.unique)?.has(id) === true;
}
const registerCoverageContext = (context: IndexCoverageContext, tx: AppRowTransaction, clock: ScopeClockRecord): void => {
  coverageContextTransactions.set(context, { tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
    active: context.active === null ? null : structuredClone(context.active), binding: context.binding === null ? null : structuredClone(context.binding) });
};

/** Only an exact, still-current snapshot can lend a coverage observation to another owner. */
export function matchIndexCoverageContextInTransaction(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
): Result.Result<boolean, IndexMaintenanceError> {
  const issued = coverageContextTransactions.get(context);
  if (issued === undefined || issued.tx !== tx) return Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const observed = issued.clock;
  if (context.clock.scopeId !== observed.scopeId ||
    context.clock.storageGeneration !== observed.storageGeneration ||
    context.clock.storageGenerationFence !== observed.storageGenerationFence ||
    context.clock.epoch !== observed.epoch ||
    context.clock.lastCommitSeq !== observed.lastCommitSeq ||
    context.clock.oldestAvailableCommitSeq !== observed.oldestAvailableCommitSeq ||
    context.clock.updatedAt.getTime() !== observed.updatedAt.getTime() ||
    observed.scopeId !== clock.scopeId ||
    observed.storageGeneration !== clock.storageGeneration ||
    observed.storageGenerationFence !== clock.storageGenerationFence || observed.epoch !== clock.epoch ||
    clock.lastCommitSeq < observed.lastCommitSeq ||
    clock.oldestAvailableCommitSeq < observed.oldestAvailableCommitSeq)
    return Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  return Result.succeed(observed.lastCommitSeq === clock.lastCommitSeq &&
    observed.oldestAvailableCommitSeq === clock.oldestAvailableCommitSeq &&
    observed.updatedAt.getTime() === clock.updatedAt.getTime());
}

/** Cross-owner reuse receives a fresh projection from the issuer-held evidence, never the caller's mutable context. */
export function borrowIndexCoverageContextInTransaction(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
): Result.Result<IndexCoverageContext | null, IndexMaintenanceError> {
  return Result.gen(function* () {
    if (!(yield* matchIndexCoverageContextInTransaction(tx, clock, context))) return null;
    const issued = coverageContextTransactions.get(context);
    if (issued === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const borrowed = Object.freeze({ clock: { ...issued.clock, updatedAt: new Date(issued.clock.updatedAt.getTime()) },
      active: issued.active === null ? null : structuredClone(issued.active), binding: issued.binding === null ? null : structuredClone(issued.binding) });
    registerCoverageContext(borrowed, tx, clock);
    const required = requiredBindingMaintenance.get(context);
    if (required !== undefined) requiredBindingMaintenance.set(borrowed, required);
    return borrowed;
  });
}

/** Borrow only the exact selected table frontiers already read under this clock. */
export function readPreparedIndexCoverageTableFrontiers(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
  tableIds: ReadonlyArray<CatalogTableId>,
): Result.Result<ReadonlyMap<CatalogTableId,
  Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>> | null, IndexMaintenanceError> {
  return Result.gen(function* () {
    const matched = yield* matchIndexCoverageContextInTransaction(tx, clock, context);
    if (!matched) return null;
    const cached = coverageTableFrontiers.get(context);
    if (cached === undefined || cached.tx !== tx || tableIds.some(tableId => !cached.frontiers.has(tableId)))
      return null;
    const detached = new Map<CatalogTableId,
      Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>();
    for (const tableId of tableIds) {
      const result = cached.frontiers.get(tableId);
      if (result === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
      const detachedResult = Result.match(result, {
        onSuccess: frontier => Result.succeed(frontier),
        onFailure: error => Result.fail(new AppRowTableFrontierCorruptionError(
          error.scopeId, error.tableId, error)),
      });
      detached.set(tableId, detachedResult);
    }
    return detached;
  });
}

/** Application and data-binding activation own distinct maintained suffixes.
 * A joint command names its Application-owned definitions; source-bound serving
 * validates genuine current binding maintenance or an admitted shared App view.
 * Unbound candidates retain explicit build progress before activation. */
export type IndexPublicationProfile = "activeApplication" | "sourceBound" |
  Readonly<{ kind: "mixedSelectedSources"; activeApplicationTables: ReadonlySet<CatalogTableId>;
    activeApplicationDeveloperIndexDefinitionIds: ReadonlySet<CatalogIndexDefinitionId> }>;
export const publicationModeForTable = (profile: IndexPublicationProfile, tableId: CatalogTableId) =>
  typeof profile === "string" ? profile : profile.activeApplicationTables.has(tableId) ? "activeApplication" : "sourceBound";
export const publicationModeForIndex = (profile: IndexPublicationProfile, definition: AppIndexDefinitionRecord) =>
  typeof profile === "string" ? profile : definition.access.kind === "by_creation_time"
    ? publicationModeForTable(profile, definition.access.tableId)
    : profile.activeApplicationDeveloperIndexDefinitionIds.has(definition.indexDefinitionId) ? "activeApplication" : "sourceBound";

type MaterializationObservation = Parameters<typeof decodeApplicationMaterializationObservation>[2];
const materializationCaptureBrand: unique symbol = Symbol("MaterializationCoverageCapture");
export interface CapturedApplicationMaterializationCoverage { readonly [materializationCaptureBrand]: true }
class CapturedMaterializationCoverage implements CapturedApplicationMaterializationCoverage {
  readonly [materializationCaptureBrand] = true;
  #tx: AppRowTransaction;
  #clockIdentity: NonNullable<ReturnType<typeof exactScopeWriteClockObservationIdentity>>;
  #observation: MaterializationObservation;
  constructor(tx: AppRowTransaction, clockIdentity: NonNullable<ReturnType<typeof exactScopeWriteClockObservationIdentity>>, observation: MaterializationObservation) {
    this.#tx = tx; this.#clockIdentity = clockIdentity; this.#observation = observation;
  }
  read(tx: AppRowTransaction, clock: ScopeClockRecord) {
    return this.#tx === tx && this.#clockIdentity === exactScopeWriteClockObservationIdentity(tx, clock.scopeId)
      ? Result.succeed(this.#observation) : Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  }
}
/** The fixed publication stage lends its observation to this original issuer.
 * Only the current accepting clock and genuine registered protection choose
 * the observation profile; callers cannot manufacture a snapshot verdict. */
export interface ApplicationMaterializationCoverageCapture {
  readonly snapshot: boolean;
  readonly capture: (observation: Omit<MaterializationObservation, "snapshot">) => Result.Result<CapturedApplicationMaterializationCoverage, IndexMaintenanceError>;
}
export function prepareApplicationMaterializationCoverageCapture(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<ApplicationMaterializationCoverageCapture, IndexMaintenanceError> {
  return Result.gen(function* () {
    const pair = yield* readRegisteredManagedMetadataPairFinalGuards(tx).pipe(Result.mapError(cause =>
      new IndexMaintenanceError({ reason: "storedState", cause })));
    const identity = exactScopeWriteClockObservationIdentity(tx, clock.scopeId);
    if (identity === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const snapshot = pair !== null;
    return Object.freeze({ snapshot,
      capture(observation: Omit<MaterializationObservation, "snapshot">) {
        return exactScopeWriteClockObservationIdentity(tx, clock.scopeId) === identity
          ? Result.succeed(new CapturedMaterializationCoverage(tx, identity, { ...observation, snapshot }))
          : Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
      },
    });
  });
}


/** Keep this value within the guarded transaction that produced it. */
export const readIndexCoverageContextInTransactionEffect = Effect.fnUntraced(
  function* (tx: AppRowTransaction, clock: ScopeClockRecord,
    checkedActive?: CheckedApplicationActiveHead,
    capturedCoverage?: CapturedApplicationMaterializationCoverage): Effect.fn.Return<IndexCoverageContext, IndexMaintenanceError> {
    return yield* Effect.gen(function* () {
      if (capturedCoverage !== undefined) {
        if (!(capturedCoverage instanceof CapturedMaterializationCoverage))
          return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
        const observation = yield* Effect.fromResult(capturedCoverage.read(tx, clock));
        const active = yield* decodeApplicationMaterializationObservation(tx, clock.scopeId, observation);
        const context = Object.freeze({ clock, active, binding: yield* readBindingCoveragePins(tx, clock) });
        registerCoverageContext(context, tx, clock);
        return context;
      }
      const checked = checkedActive === undefined ? "refresh" as const
        : yield* Effect.fromResult(readCheckedApplicationActiveHead(checkedActive, tx, clock));
      const active = checked === "refresh"
        ? yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock.scopeId)
        : checked;
      if (active === null) {
        const context = Object.freeze({ clock, active: null, binding: yield* readBindingCoveragePins(tx, clock) });
        registerCoverageContext(context, tx, clock);
        return context;
      }
      const checkedSchema = checkedActive === undefined || checked === "refresh" ? "refresh" as const
        : yield* readCheckedApplicationSchemaForHeadForShareInTransactionEffect(checkedActive, tx, clock);
      const schema = checkedSchema === "refresh"
        ? yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head)
        : checkedSchema;
      const context = Object.freeze({ clock, active: Object.freeze({ ...active, schema }), binding: yield* readBindingCoveragePins(tx, clock) });
      registerCoverageContext(context, tx, clock);
      return context;
    }).pipe(Effect.mapError(cause => cause instanceof IndexMaintenanceError ? cause :
      new IndexMaintenanceError({ reason: cause.reason, retryable: cause.retryable, cause: cause.cause })));
  },
  work => observeExecution("IndexBuildState.readCoverageContext", work, "caller"));

/** Prepare only selected, uncovered source-table pointers in the accepting
 * transaction. The context is the sole holder of the batch result; callers
 * cannot supply a substitute frontier to the coverage decision. */
export const readIndexCoverageTableFrontiersInTransactionEffect = Effect.fn(
  "IndexBuildState.readCoverageTableFrontiers",
)(function* (tx: AppRowTransaction, context: IndexCoverageContext,
  tableIds: ReadonlyArray<CatalogTableId>): Effect.fn.Return<void,
    InvalidAppRowReadInputError | AppRowReadPersistenceError | IndexMaintenanceError> {
  if (coverageContextTransactions.get(context)?.tx !== tx)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const frontiers = yield* readAppTableWriteFrontiersInTransactionEffect(tx, context.clock.scopeId, tableIds);
  coverageTableFrontiers.set(context, { tx, frontiers });
});

/** Call under the caller's scope-clock/snapshot transaction before admitting a read. */
export const isIndexBuildSnapshotCoveredInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  state: IndexBuildCoverageState,
  definition: IndexCoverageDefinition,
  snapshotCommitSeq: CommitSeq,
  context: IndexCoverageContext,
  pendingPublicationCommitSeq?: CommitSeq,
): Effect.fn.Return<
  boolean,
  AppRowReadPersistenceError | InvalidAppRowReadInputError | AppRowTableFrontierCorruptionError | IndexMaintenanceError
> {
  if (state.indexDefinitionId !== definition.indexDefinitionId || state.scopeId !== context.clock.scopeId || state.storageGeneration !== context.clock.storageGeneration ||
    state.storageGenerationFence !== context.clock.storageGenerationFence || state.epoch !== context.clock.epoch ||
    snapshotCommitSeq > context.clock.lastCommitSeq ||
    (state.coveredThroughCommitSeq !== null && state.coveredThroughCommitSeq > context.clock.lastCommitSeq)) {
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  }
  const covered = state.coveredThroughCommitSeq;
  if (
    state.lifecycle !== "enabled" ||
    covered === null ||
    state.firstReadableCommitSeq === null ||
    state.firstReadableCommitSeq > snapshotCommitSeq
  )
    return false;
  if (state.maintenance !== null) {
    const obligation = state.maintenance;
    if (obligation.tableId !== definition.tableId || encodeBytesToLowercaseHex(obligation.physicalSpecSha256) !== definition.physicalSpecSha256Hex || !maintenanceMatchesCoverageContext(obligation, context)) {
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    }
    return true;
  }
  yield* prepareMissingBindingMaintenanceCheck(tx, context);
  if (hasRequiredBindingMaintenance(context, "index", definition.indexDefinitionId))
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  if (covered >= snapshotCommitSeq) return true;
  if (pendingPublicationCommitSeq !== undefined) {
    if (pendingPublicationCommitSeq !== context.clock.lastCommitSeq + 1n ||
      snapshotCommitSeq !== context.clock.lastCommitSeq)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.scopeId))
      .pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
    // Current pointers already include this transaction's writes. The
    // immutable published fact prefix is the indexed proof of whether an
    // older build missed any committed source-table write before this one.
    const published = yield* Effect.uninterruptible(runDrizzleStatementEffect(
      tx.select({ commitSeq: fxSystemCommitAppRowChanges.commitSeq })
        .from(fxSystemCommitAppRowChanges).where(and(
          eq(fxSystemCommitAppRowChanges.scopeUuid, scope.scopeUuid),
          eq(fxSystemCommitAppRowChanges.tableId, definition.tableId),
          gt(fxSystemCommitAppRowChanges.commitSeq, covered),
          lte(fxSystemCommitAppRowChanges.commitSeq, snapshotCommitSeq),
        )).limit(1), cause => new IndexMaintenanceError({ reason: "resourceFailure", cause })));
    return published.length === 0;
  }
  const batch = coverageTableFrontiers.get(context);
  if (batch !== undefined && batch.tx !== tx)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const batched = batch?.frontiers.get(definition.tableId);
  const latest = batch === undefined
    ? yield* readAppTableWriteFrontierInTransactionEffect(tx, state.scopeId, definition.tableId)
    : batched === undefined
      ? yield* Effect.die("Selected index table frontier missing from transaction batch")
      : yield* Effect.fromResult(batched);
  return latest === null || latest <= covered;
}, work => observeExecution("IndexBuildState.isSnapshotCovered", work, "caller"));

function decodeReadInput(
  value: unknown,
): Result.Result<
  ReadFencedIndexBuildStateInput,
  InvalidIndexBuildStateReadInputError
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(value, READ_INPUT_KEYS)) {
      return yield* Result.fail(new InvalidIndexBuildStateReadInputError({
        reason: "invalidInputShape",
      }));
    }
    if (typeof value.scopeId !== "string") {
      return yield* Result.fail(new InvalidIndexBuildStateReadInputError({
        reason: "invalidScopeId",
      }));
    }
    const rawScopeId = value.scopeId;
    const scopeId = yield* decodeReadInputFieldResult(
      decodeScopeIdResult(rawScopeId),
      "invalidScopeId",
    );
    const indexDefinitionId = yield* decodeReadInputFieldResult(
      decodeCatalogIndexDefinitionIdResult(value.indexDefinitionId),
      "invalidIndexDefinitionId",
    );
    return Object.freeze({ scopeId, indexDefinitionId });
  });
}

function decodeReadInputFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  reason: Extract<
    InvalidIndexBuildStateReadInputIssue["reason"],
    "invalidScopeId" | "invalidIndexDefinitionId"
  >,
): Result.Result<Value, InvalidIndexBuildStateReadInputError> {
  return result.pipe(Result.mapError((cause) =>
    new InvalidIndexBuildStateReadInputError({ reason }, { cause })
  ));
}

function decodeStoredBuildStateFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
): Result.Result<Value, IndexBuildStateCorruptionError> {
  return result.pipe(Result.mapError((cause) => storedBuildStateCorruption(
    expectedScopeId,
    expectedIndexDefinitionId,
    cause,
  )));
}

function storedBuildStateCorruption(
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
  cause: unknown,
): IndexBuildStateCorruptionError {
  return new IndexBuildStateCorruptionError(
    expectedScopeId,
    expectedIndexDefinitionId,
    "stored identity, authority pin, lifecycle, or cursor is invalid",
    { cause },
  );
}

function freezeAuthority(
  authority: IndexBuildStorageAuthority,
): IndexBuildStorageAuthority {
  return Object.freeze({
    scopeId: authority.scopeId,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
  });
}

function collectAuthorityMismatches(
  buildState: IndexBuildStateRecord,
  currentAuthority: IndexBuildStorageAuthority,
): IndexBuildAuthorityMismatches | null {
  const mismatches: IndexBuildAuthorityMismatch[] = [];
  if (buildState.storageGeneration !== currentAuthority.storageGeneration) {
    mismatches.push("storageGeneration");
  }
  if (
    buildState.storageGenerationFence !==
      currentAuthority.storageGenerationFence
  ) {
    mismatches.push("storageGenerationFence");
  }
  if (buildState.epoch !== currentAuthority.epoch) {
    mismatches.push("epoch");
  }
  const first = mismatches[0];
  if (first === undefined) return null;
  const nonEmpty: [
    IndexBuildAuthorityMismatch,
    ...IndexBuildAuthorityMismatch[],
  ] = [first, ...mismatches.slice(1)];
  return Object.freeze(nonEmpty);
}

function decodeTimestamp(
  value: unknown,
  scopeId: ScopeId,
  indexDefinitionId: CatalogIndexDefinitionId,
  field: "created" | "updated",
): Result.Result<Date, IndexBuildStateCorruptionError> {
  const timestamp = copyFiniteDate(value);
  if (timestamp === undefined) {
    return Result.fail(new IndexBuildStateCorruptionError(
      scopeId,
      indexDefinitionId,
      `${field} timestamp is invalid`,
    ));
  }
  return Result.succeed(timestamp);
}

function invalidInputMessage(
  issue: InvalidIndexBuildStateReadInputIssue,
): string {
  switch (issue.reason) {
    case "invalidInputShape":
      return "Index build-state read input must contain only scopeId and indexDefinitionId.";
    case "invalidScopeId":
      return "Index build-state scope ID is invalid.";
    case "invalidIndexDefinitionId":
      return "Index build-state physical definition ID is invalid.";
  }
}
