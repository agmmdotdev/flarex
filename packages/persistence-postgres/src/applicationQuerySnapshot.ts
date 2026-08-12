import type { ApplicationManifestV1 } from
  "@flarex/analysis/application-analysis";
import { applicationFunctionEntryPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq } from "drizzle-orm";
import {
  Cause,
  Data,
  Effect,
  Exit,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import {
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1,
  type AppDocumentIdV1Error,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import {
  OrderedIndexBoundHexV1Schema,
  type OrderedIndexBoundsV1,
} from "flarex-protocol/ordered-index";
import {
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  SchemaManifestAppIndexDescriptorSchema,
} from "flarex-protocol/schema-manifest";
import {
  ReplacementScopeIdV1Schema,
  SnapshotTokenSchema,
  type CommitSeq,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";

import {
  getAppRowAtSnapshotInTransactionEffect,
  readLiveAppRowsAtSnapshotInTransactionEffect,
  type AppRowPointReadResultV1,
  type AppRowTransaction,
  type ReadAppRowError,
} from "./appRows";
import {
  scanAppIndexAtSnapshotInTransactionEffect,
  type ReadAppIndexRangeV1Error,
} from "./appIndexEntries";
import {
  type LocatedAppIndexDefinitionV1,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import {
  hasAppDeveloperIndexDefinitionAuthorityForControlDbV1,
  lowerAppDeveloperIndexKeyV1,
  type AppDeveloperIndexDefinitionPortV1,
} from "./appDeveloperIndexCommitV1";
import {
  claimApplicationActiveSelection,
  validateApplicationActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationActiveSelectionBasis,
  type ApplicationActivationError,
} from "./applicationActivation";
import {
  hasApplicationSchemaAuthorityComposition,
  type ApplicationSchemaAuthority,
  type ApplicationSchemaAuthorityError,
  type ApplicationSchemaAuthorityPublisher,
} from "./applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  readFencedIndexBuildStateEffect,
  type ReadFencedIndexBuildStateError,
} from "./indexBuildStates";
import type { ReadSchemaVersionArtifactError } from "./schemaVersionArtifacts";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  fxSystemApplicationFunctionsV1,
  fxSystemScopeClocks,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const decodeIndexDescriptorResult = Schema.decodeUnknownResult(
  Schema.toType(SchemaManifestAppIndexDescriptorSchema),
);
const decodeOrderedBoundResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexBoundHexV1Schema),
);
const decodeReplacementScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ReplacementScopeIdV1Schema),
);
const decodeDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
/**
 * Bound duplicate JSONB/canonical-byte materialization while keeping the
 * 128-entry query page to a small fixed number of set-based reads.
 */
const INDEX_DOCUMENT_MATERIALIZATION_BATCH_SIZE = 8;

export interface ApplicationQueryBudget {
  readonly maximumPointReads: number;
  readonly maximumIndexReads: number;
  readonly maximumDocuments: number;
  readonly maximumSemanticBytes: number;
}

export interface ApplicationQueryFunction {
  readonly path: string;
  readonly moduleName: string;
  readonly exportName: string;
  readonly kind: "query";
  readonly visibility: "public";
  readonly args: ApplicationManifestV1["functions"][number]["args"];
  readonly returns: ApplicationManifestV1["functions"][number]["returns"];
  readonly partition: ApplicationManifestV1["functions"][number]["partition"];
  readonly entrySha256: string;
}

export interface ApplicationQueryTable {
  readonly tableId: CatalogTableId;
  readonly logicalName: string;
}

export interface ApplicationQuerySnapshotMetadata {
  readonly basis: ApplicationActiveSelectionBasis;
  readonly function: ApplicationQueryFunction;
  readonly tables: ReadonlyArray<ApplicationQueryTable>;
  readonly snapshotToken: SnapshotToken;
  readonly budget: ApplicationQueryBudget;
}

declare const applicationQuerySnapshotBrand: unique symbol;
export interface ApplicationQuerySnapshot {
  readonly [applicationQuerySnapshotBrand]: true;
}

export interface OpenedApplicationQuerySnapshot {
  readonly snapshot: ApplicationQuerySnapshot;
  readonly metadata: ApplicationQuerySnapshotMetadata;
}

export type ApplicationQueryPointReadResult =
  | Readonly<{
      readonly kind: "present";
      readonly document: CanonicalFlarexRuntimeObjectV1;
    }>
  | Readonly<{ readonly kind: "missing" }>;

export interface ApplicationQueryIndexPage {
  readonly documents: ReadonlyArray<CanonicalFlarexRuntimeObjectV1>;
  readonly isDone: boolean;
}

export class ApplicationQuerySnapshotError extends Data.TaggedError(
  "ApplicationQuerySnapshotError",
)<{
  readonly operation: "open" | "revalidate" | "pointRead" | "indexRead";
  readonly reason:
    | "invalidComposition"
    | "invalidInput"
    | "unsupportedTarget"
    | "functionMissing"
    | "functionUnsupported"
    | "storedFunction"
    | "schemaMismatch"
    | "indexMissing"
    | "indexUnavailable"
    | "historyUnavailable"
    | "budgetExceeded"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type OpenApplicationQuerySnapshotError =
  | ApplicationQuerySnapshotError
  | ApplicationActivationError
  | ApplicationSchemaAuthorityError
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export type UseApplicationQuerySnapshotError =
  | ApplicationQuerySnapshotError
  | ApplicationActivationError
  | AppDocumentIdV1Error
  | ReadAppRowError
  | ReadAppIndexRangeV1Error
  | ReadFencedIndexBuildStateError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export interface ApplicationQuerySnapshotContext {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly schema: ApplicationSchemaAuthorityPublisher<unknown>;
  readonly developerIndexes: AppDeveloperIndexDefinitionPortV1;
}

interface Usage {
  readonly pointReads: number;
  readonly indexReads: number;
  readonly documents: number;
  readonly semanticBytes: number;
}

interface State {
  readonly selection: ApplicationActiveSelection;
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly schema: ApplicationSchemaAuthority;
  readonly definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>;
  readonly metadata: ApplicationQuerySnapshotMetadata;
  readonly usage: Ref.Ref<Usage>;
  readonly readGate: Semaphore.Semaphore;
  readonly closed: Ref.Ref<boolean>;
}

const states = new WeakMap<ApplicationQuerySnapshot, State>();

export const openApplicationQuerySnapshot = Effect.fn(
  "ApplicationQuerySnapshot.open",
)(function* (
  selection: ApplicationActiveSelection,
  functionPath: string,
  budget: ApplicationQueryBudget,
  context: ApplicationQuerySnapshotContext,
): Effect.fn.Return<
  OpenedApplicationQuerySnapshot,
  OpenApplicationQuerySnapshotError,
  Scope.Scope
> {
  const capturedBudget = yield* Effect.fromResult(captureBudget(budget));
  const basis = yield* Effect.fromResult(claimApplicationActiveSelection(selection));
  if (
    basis.deploymentId !== context.deploymentId ||
    !hasApplicationSchemaAuthorityComposition(context.schema, context.controlDb) ||
    !hasAppDeveloperIndexDefinitionAuthorityForControlDbV1(
      context.developerIndexes,
      context.controlDb,
    )
  ) return yield* failure("open", "invalidComposition");
  const fn = basis.manifest.functions.find(candidate => candidate.path === functionPath);
  if (fn === undefined) return yield* failure("open", "functionMissing");
  if (fn.kind !== "query" || fn.visibility !== "public") {
    return yield* failure("open", "functionUnsupported");
  }
  const schema = yield* context.schema.readPublished({
    deploymentId: context.deploymentId,
    manifest: basis.manifest,
  });
  yield* requireExactSchema(basis, schema);
  const tableIds = Object.freeze(schema.tables.map(table => table.tableId));
  const scopeId = yield* Effect.fromResult(
    decodeReplacementScopeIdResult(basis.authority.scopeId).pipe(
      Result.mapError(cause =>
        failureValue("open", "invalidComposition", false, cause)
      ),
    ),
  );
  const deploymentId = yield* Effect.fromResult(
    decodeDeploymentIdResult(context.deploymentId).pipe(
      Result.mapError(cause =>
        failureValue("open", "invalidComposition", false, cause)
      ),
    ),
  );
  const definitions = yield* context.developerIndexes.locate({
    deploymentId,
    scopeId,
    schemaVersionId: schema.schemaVersionId,
    tableIds,
    maximumDefinitions: MAX_SCHEMA_MANIFEST_APP_INDEXES,
  });
  if (definitions === null) return yield* failure("open", "schemaMismatch");
  yield* requireExactDefinitions(schema, definitions);
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSameAuthority(basis.authority, located.authority);
  const opened = yield* runLocatedRead(
    located.target,
    "open",
    tx => openInTransaction(tx, selection, basis, fn),
  );
  const metadata = snapshotMetadata({
    basis,
    function: opened.function,
    tables: schema.tables.map(table => Object.freeze({
      tableId: table.tableId,
      logicalName: table.logicalName,
    })),
    snapshotToken: opened.snapshotToken,
    budget: capturedBudget,
  });
  const usage = yield* Ref.make<Usage>(Object.freeze({
    pointReads: 0,
    indexReads: 0,
    documents: 0,
    semanticBytes: 0,
  }));
  const closed = yield* Ref.make(false);
  const state = Object.freeze({
    selection,
    target: located.target,
    schema,
    definitions,
    metadata,
    usage,
    readGate: Semaphore.makeUnsafe(1),
    closed,
  });
  const snapshot = yield* Effect.acquireRelease(
    Effect.sync(() => issue(state)),
    issued => Effect.gen(function* () {
      yield* Ref.set(state.closed, true);
      states.delete(issued);
    }),
  );
  return Object.freeze({ snapshot, metadata: snapshotMetadata(metadata) });
});

export const revalidateApplicationQuerySnapshot = Effect.fn(
  "ApplicationQuerySnapshot.revalidate",
)(function* (snapshot: ApplicationQuerySnapshot): Effect.fn.Return<
  ApplicationQuerySnapshotMetadata,
  UseApplicationQuerySnapshotError
> {
  const state = yield* Effect.fromResult(claim(snapshot, "revalidate"));
  yield* state.readGate.withPermit(Effect.gen(function* () {
    yield* requireOpen(state, "revalidate");
    yield* runLocatedRead(
      state.target,
      "revalidate",
      tx => revalidateInTransaction(tx, state),
    );
  }));
  return snapshotMetadata(state.metadata);
});

export const readApplicationQueryPoint = Effect.fn(
  "ApplicationQuerySnapshot.readPoint",
)(function* (
  snapshot: ApplicationQuerySnapshot,
  tableName: string,
  documentId: AppDocumentIdV1,
): Effect.fn.Return<
  ApplicationQueryPointReadResult,
  UseApplicationQuerySnapshotError
> {
  const state = yield* Effect.fromResult(claim(snapshot, "pointRead"));
  return yield* state.readGate.withPermit(Effect.gen(function* () {
    yield* requireOpen(state, "pointRead");
    const table = state.schema.tables.find(candidate => candidate.logicalName === tableName);
    if (table === undefined) return yield* failure("pointRead", "invalidInput");
    const identity = yield* Effect.fromResult(
      requireAppDocumentIdentityV1ForTableResult(documentId, table.tableId),
    );
    yield* charge(state, "pointRead", { pointReads: 1 });
    yield* requireDocumentBudgetRemaining(state, "pointRead");
    const result = yield* runLocatedRead(
      state.target,
      "pointRead",
      tx => Effect.gen(function* () {
        yield* revalidateInTransaction(tx, state, "pointRead");
        return yield* getAppRowAtSnapshotInTransactionEffect(tx, {
          snapshotToken: state.metadata.snapshotToken,
          tableId: table.tableId,
          rowId: identity.rowId,
        });
      }),
    );
    if (result.kind === "missing") return Object.freeze({ kind: "missing" });
    yield* chargeDocument(state, "pointRead", result);
    const document = result.document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(document)) {
      return yield* failure("pointRead", "resourceFailure");
    }
    return Object.freeze({ kind: "present", document });
  }));
});

export const readApplicationQueryIndex = Effect.fn(
  "ApplicationQuerySnapshot.readIndex",
)(function* (
  snapshot: ApplicationQuerySnapshot,
  tableName: string,
  indexDescriptor: unknown,
  bounds: unknown,
  limit: number,
): Effect.fn.Return<ApplicationQueryIndexPage, UseApplicationQuerySnapshotError> {
  const state = yield* Effect.fromResult(claim(snapshot, "indexRead"));
  return yield* state.readGate.withPermit(readIndex(state, tableName, indexDescriptor, bounds, limit));
});

function readIndex(
  state: State,
  tableName: string,
  indexDescriptor: unknown,
  bounds: unknown,
  limit: number,
): Effect.Effect<ApplicationQueryIndexPage, UseApplicationQuerySnapshotError> {
  return Effect.gen(function* () {
  yield* requireOpen(state, "indexRead");
  const table = state.schema.tables.find(candidate => candidate.logicalName === tableName);
  if (
    table === undefined || !isPositiveSafeInteger(limit) ||
    limit > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1
  ) {
    return yield* failure("indexRead", "invalidInput");
  }
  const descriptor = yield* Effect.fromResult(
    decodeIndexDescriptorResult(indexDescriptor).pipe(
      Result.mapError(cause => failureValue("indexRead", "invalidInput", false, cause)),
    ),
  );
  const decodedBounds = yield* Effect.fromResult(captureBounds(bounds));
  const binding = state.schema.indexes.find(index =>
    index.tableId === table.tableId && index.descriptor === descriptor
  );
  if (binding === undefined) return yield* failure("indexRead", "indexMissing");
  const matches = state.definitions.filter(definition =>
    definition.access.kind === "developer" &&
    definition.access.tableId === table.tableId &&
    definition.access.logicalIndexId === binding.logicalIndexId
  );
  if (matches.length !== 1) return yield* failure("indexRead", "indexMissing");
  const definition = matches[0]!;
  yield* charge(state, "indexRead", { indexReads: 1 });
  yield* requireDocumentBudgetRemaining(state, "indexRead");
  const page = yield* runLocatedRead(
    state.target,
    "indexRead",
    tx => Effect.gen(function* () {
      yield* revalidateInTransaction(tx, state, "indexRead");
      const build = yield* readFencedIndexBuildStateEffect(tx, {
        scopeId: state.metadata.basis.authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
      });
      if (build.status !== "current" || build.buildState.lifecycle !== "enabled") {
        return yield* failure("indexRead", "indexUnavailable");
      }
      if (build.buildState.startCommitSeq > state.metadata.snapshotToken.commitSeq) {
        return yield* failure("indexRead", "indexUnavailable");
      }
      const positions = yield* scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId: state.metadata.basis.authority.scopeId,
        definition,
        bounds: decodedBounds,
        limit,
        snapshotCommitSeq: state.metadata.snapshotToken.commitSeq,
      });
      const documents: CanonicalFlarexRuntimeObjectV1[] = [];
      for (
        let offset = 0;
        offset < positions.entries.length;
        offset += INDEX_DOCUMENT_MATERIALIZATION_BATCH_SIZE
      ) {
        const entries = positions.entries.slice(
          offset,
          offset + INDEX_DOCUMENT_MATERIALIZATION_BATCH_SIZE,
        );
        const rows = yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
          scopeId: state.metadata.basis.authority.scopeId,
          tableId: table.tableId,
          rowIds: Object.freeze(entries.map(entry => entry.rowId)),
          snapshotCommitSeq: state.metadata.snapshotToken.commitSeq,
        });
        let semanticBytes = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]!;
          const entry = entries[index]!;
          if (
            entry.tableId !== table.tableId || row.rowId !== entry.rowId ||
            !isCanonicalFlarexRuntimeObjectV1(row.document.value)
          ) return yield* failure("indexRead", "resourceFailure");
          const encodedKey = yield* Effect.fromResult(
            lowerAppDeveloperIndexKeyV1(
              definition,
              row.document,
              row.creationTime,
            ).pipe(Result.mapError(cause =>
              failureValue("indexRead", "resourceFailure", false, cause)
            )),
          );
          if (encodedKey !== entry.encodedKey) {
            return yield* failure("indexRead", "resourceFailure");
          }
          semanticBytes += row.document.semanticSizeBytes;
          documents.push(row.document.value);
        }
        yield* charge(state, "indexRead", {
          documents: rows.length,
          semanticBytes,
        });
      }
      return Object.freeze({ positions, documents: Object.freeze(documents) });
    }),
  );
  return Object.freeze({
    documents: page.documents,
    isDone: page.positions.isDone,
  });
  });
}

function openInTransaction(
  tx: AppRowTransaction,
  selection: ApplicationActiveSelection,
  basis: ApplicationActiveSelectionBasis,
  fn: ApplicationManifestV1["functions"][number],
) {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    );
    yield* validateApplicationActiveSelectionInTransaction(selection, tx, clock);
    yield* requireHistoryAvailable(tx, clock, clock.lastCommitSeq, "open");
  const rows = yield* query(
      tx.select().from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId, basis.authority.scopeId),
        eq(fxSystemApplicationFunctionsV1.revisionId, basis.revisionId),
        eq(fxSystemApplicationFunctionsV1.functionPath, fn.path),
      )).limit(2),
    "open",
    );
    if (rows.length !== 1) return yield* failure("open", "storedFunction");
    const row = rows[0]!;
    const entryBytes = yield* Effect.fromResult(
      applicationFunctionEntryPublicationFrameV1(fn).pipe(
        Result.mapError(cause => failureValue("open", "storedFunction", false, cause)),
      ),
    );
    const digest = yield* sha256(entryBytes, "open");
    if (
      row.functionPath !== fn.path || row.moduleName !== fn.moduleName ||
      row.exportName !== fn.exportName || row.functionKind !== fn.kind ||
      row.visibility !== fn.visibility ||
      !bytesEqualFullScan(row.functionCatalogSha256, basis.functionCatalogSha256) ||
      !bytesEqualFullScan(row.entryBytes, entryBytes) ||
      !bytesEqualFullScan(row.entrySha256, digest)
    ) return yield* failure("open", "storedFunction");
    return Object.freeze({
      function: Object.freeze({
        ...fn,
        kind: "query" as const,
        visibility: "public" as const,
        entrySha256: encodeBytesToLowercaseHex(digest),
      }),
      snapshotToken: Object.freeze(SnapshotTokenSchema.make({
        scopeId: clock.scopeId,
        epoch: clock.epoch,
        commitSeq: clock.lastCommitSeq,
      })),
    });
  });
}

function revalidateInTransaction(
  tx: AppRowTransaction,
  state: State,
  operation: ApplicationQuerySnapshotError["operation"] = "revalidate",
) {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      state.metadata.basis.authority.scopeId,
    );
    yield* validateApplicationActiveSelectionInTransaction(
      state.selection,
      tx,
      clock,
    );
    yield* requireHistoryAvailable(
      tx,
      clock,
      state.metadata.snapshotToken.commitSeq,
      operation,
    );
  });
}

function requireHistoryAvailable(
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  snapshotCommitSeq: CommitSeq,
  operation: ApplicationQuerySnapshotError["operation"],
) {
  return Effect.gen(function* () {
    if (snapshotCommitSeq > clock.lastCommitSeq) {
      return yield* failure(operation, "historyUnavailable");
    }
    const rows = yield* query(
      tx.select({
        oldestAvailableCommitSeq: fxSystemScopeClocks.oldestAvailableCommitSeq,
      }).from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        clock.scopeId,
      )).limit(1),
      operation,
    );
    if (rows[0] === undefined || rows[0].oldestAvailableCommitSeq > snapshotCommitSeq) {
      return yield* failure(operation, "historyUnavailable");
    }
  });
}

function captureBudget(input: unknown) {
  if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 4) {
    return Result.fail(failureValue("open", "invalidInput"));
  }
  const budget = input;
  if (
    !isPositiveSafeInteger(budget.maximumPointReads) ||
    budget.maximumPointReads > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    !isPositiveSafeInteger(budget.maximumIndexReads) ||
    budget.maximumIndexReads > MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 ||
    !isPositiveSafeInteger(budget.maximumDocuments) ||
    budget.maximumDocuments > MAX_COMMIT_READ_DOCUMENTS_V1 ||
    !isPositiveSafeInteger(budget.maximumSemanticBytes) ||
    budget.maximumSemanticBytes > MAX_COMMIT_READ_SEMANTIC_BYTES_V1
  ) return Result.fail(failureValue("open", "invalidInput"));
  return Result.succeed(Object.freeze({
    maximumPointReads: budget.maximumPointReads,
    maximumIndexReads: budget.maximumIndexReads,
    maximumDocuments: budget.maximumDocuments,
    maximumSemanticBytes: budget.maximumSemanticBytes,
  }));
}

function captureBounds(input: unknown): Result.Result<
  OrderedIndexBoundsV1,
  ApplicationQuerySnapshotError
> {
  if (!isNonArrayRecord(input)) {
    return Result.fail(failureValue("indexRead", "invalidInput"));
  }
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => key !== "startInclusive" && key !== "endExclusive")) {
    return Result.fail(failureValue("indexRead", "invalidInput"));
  }
  return Result.gen(function* () {
    const start = input.startInclusive === undefined
      ? undefined
      : yield* decodeOrderedBoundResult(input.startInclusive).pipe(
          Result.mapError(cause =>
            failureValue("indexRead", "invalidInput", false, cause)
          ),
        );
    const end = input.endExclusive === undefined
      ? undefined
      : yield* decodeOrderedBoundResult(input.endExclusive).pipe(
          Result.mapError(cause =>
            failureValue("indexRead", "invalidInput", false, cause)
          ),
        );
    const bounds: OrderedIndexBoundsV1 = Object.freeze({
      ...(start === undefined ? {} : { startInclusive: start }),
      ...(end === undefined ? {} : { endExclusive: end }),
    });
    return bounds;
  });
}

function requireExactSchema(
  basis: ApplicationActiveSelectionBasis,
  schema: ApplicationSchemaAuthority,
) {
  return basis.schemaVersionId === schema.schemaVersionId &&
      encodeBytesToLowercaseHex(basis.applicationSchemaSha256) ===
        schema.applicationSchemaSha256 &&
      encodeBytesToLowercaseHex(basis.schemaManifestSha256) ===
        schema.schemaManifestSha256
    ? Effect.void
    : failure("open", "schemaMismatch");
}

function requireSameAuthority(
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
) {
  const left = expected.physicalLocator;
  const right = actual.physicalLocator;
  return expected.deploymentId === actual.deploymentId &&
      expected.scopeId === actual.scopeId &&
      expected.storageGeneration === actual.storageGeneration &&
      expected.storageGenerationFence === actual.storageGenerationFence &&
      expected.epoch === actual.epoch && left.kind === right.kind &&
      left.databaseKey === right.databaseKey && left.schemaName === right.schemaName
    ? Effect.void
    : failure("open", "unsupportedTarget");
}

function requireExactDefinitions(
  schema: ApplicationSchemaAuthority,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
) {
  if (definitions.length !== schema.indexes.length) {
    return failure("open", "schemaMismatch");
  }
  const definitionIds = new Set<number>();
  for (const binding of schema.indexes) {
    const matches = definitions.filter(definition =>
      definition.access.kind === "developer" &&
      definition.access.tableId === binding.tableId &&
      definition.access.logicalIndexId === binding.logicalIndexId
    );
    if (matches.length !== 1 || definitionIds.has(matches[0]!.indexDefinitionId)) {
      return failure("open", "schemaMismatch");
    }
    definitionIds.add(matches[0]!.indexDefinitionId);
  }
  return Effect.void;
}

function issue(state: State): ApplicationQuerySnapshot {
  const snapshot = Object.freeze({}) as ApplicationQuerySnapshot;
  states.set(snapshot, state);
  return snapshot;
}

function claim(snapshot: unknown, operation: ApplicationQuerySnapshotError["operation"]) {
  const state = typeof snapshot === "object" && snapshot !== null
    ? states.get(snapshot as ApplicationQuerySnapshot)
    : undefined;
  return state === undefined
    ? Result.fail(failureValue(operation, "invalidComposition"))
    : Result.succeed(state);
}

function snapshotMetadata(
  metadata: ApplicationQuerySnapshotMetadata,
): ApplicationQuerySnapshotMetadata {
  return Object.freeze({
    basis: Object.freeze({
      ...metadata.basis,
      authority: Object.freeze({
        ...metadata.basis.authority,
        physicalLocator: Object.freeze({
          ...metadata.basis.authority.physicalLocator,
        }),
      }),
      sourceArtifactRootSha256: copyBytes(metadata.basis.sourceArtifactRootSha256),
      manifestSha256: copyBytes(metadata.basis.manifestSha256),
      publicationSha256: copyBytes(metadata.basis.publicationSha256),
      functionCatalogSha256: copyBytes(metadata.basis.functionCatalogSha256),
      applicationSchemaSha256: copyBytes(metadata.basis.applicationSchemaSha256),
      schemaManifestSha256: copyBytes(metadata.basis.schemaManifestSha256),
      schemaBindingSha256: copyBytes(metadata.basis.schemaBindingSha256),
      taskCatalogSha256: copyBytes(metadata.basis.taskCatalogSha256),
      taskCatalogBindingSha256: copyBytes(metadata.basis.taskCatalogBindingSha256),
      readinessSha256: copyBytes(metadata.basis.readinessSha256),
      activationSha256: copyBytes(metadata.basis.activationSha256),
      headSha256: copyBytes(metadata.basis.headSha256),
    }),
    function: Object.freeze({ ...metadata.function }),
    tables: Object.freeze(metadata.tables.map(table => Object.freeze({ ...table }))),
    snapshotToken: Object.freeze({ ...metadata.snapshotToken }),
    budget: Object.freeze({ ...metadata.budget }),
  });
}

function charge(
  state: State,
  operation: ApplicationQuerySnapshotError["operation"],
  delta: Partial<Usage>,
) {
  return Ref.modify(state.usage, current => {
    const next = Object.freeze({
      pointReads: current.pointReads + (delta.pointReads ?? 0),
      indexReads: current.indexReads + (delta.indexReads ?? 0),
      documents: current.documents + (delta.documents ?? 0),
      semanticBytes: current.semanticBytes + (delta.semanticBytes ?? 0),
    });
    return [next, next] as const;
  }).pipe(Effect.flatMap(next =>
    next.pointReads > state.metadata.budget.maximumPointReads ||
      next.indexReads > state.metadata.budget.maximumIndexReads ||
      next.documents > state.metadata.budget.maximumDocuments ||
      next.semanticBytes > state.metadata.budget.maximumSemanticBytes
      ? failure(operation, "budgetExceeded")
      : Effect.void
  ));
}

function chargeDocument(
  state: State,
  operation: ApplicationQuerySnapshotError["operation"],
  result: Extract<AppRowPointReadResultV1, { readonly kind: "present" }>,
) {
  return isCanonicalFlarexRuntimeObjectV1(result.document.value)
    ? charge(state, operation, {
        documents: 1,
        semanticBytes: result.document.semanticSizeBytes,
      })
    : failure(operation, "resourceFailure");
}

function requireDocumentBudgetRemaining(
  state: State,
  operation: ApplicationQuerySnapshotError["operation"],
) {
  return Ref.get(state.usage).pipe(Effect.flatMap(usage =>
    usage.documents >= state.metadata.budget.maximumDocuments ||
      usage.semanticBytes >= state.metadata.budget.maximumSemanticBytes
      ? failure(operation, "budgetExceeded")
      : Effect.void
  ));
}

function requireOpen(
  state: State,
  operation: ApplicationQuerySnapshotError["operation"],
) {
  return Ref.get(state.closed).pipe(Effect.flatMap(closed => closed
    ? failure(operation, "invalidComposition")
    : Effect.void));
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  operation: ApplicationQuerySnapshotError["operation"],
) {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      operation,
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function sha256(
  bytes: Uint8Array,
  operation: ApplicationQuerySnapshotError["operation"],
) {
  return Effect.promise(
    () => crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
  ).pipe(Effect.map(buffer => new Uint8Array(buffer)));
}

function failure(
  operation: ApplicationQuerySnapshotError["operation"],
  reason: ApplicationQuerySnapshotError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(failureValue(operation, reason, retryable, cause));
}

function failureValue(
  operation: ApplicationQuerySnapshotError["operation"],
  reason: ApplicationQuerySnapshotError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return new ApplicationQuerySnapshotError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

interface StartedRead<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

const runLocatedRead = Effect.fn(
  "ApplicationQuerySnapshot.runLocatedRead",
)(function <Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: ApplicationQuerySnapshotError["operation"],
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | ApplicationQuerySnapshotError |
    LocatedReadCommittedTransactionFailureV1
> {
  return Effect.suspend((): Effect.Effect<
    Value,
    Failure | ApplicationQuerySnapshotError |
      LocatedReadCommittedTransactionFailureV1
  > => {
    const started = startLocatedRead(target, body);
    const settled = Effect.uninterruptible(Effect.exit(Effect.tryPromise({
      try: () => started.promise,
      catch: (cause): unknown => cause,
    })));
    return settled.pipe(Effect.flatMap((exit): Effect.Effect<
      Value,
      Failure | ApplicationQuerySnapshotError |
        LocatedReadCommittedTransactionFailureV1
    > => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      const error = Cause.findErrorOption(exit.cause);
      if (error._tag === "None") return Effect.failCause(
        exit.cause as Cause.Cause<
          Failure | ApplicationQuerySnapshotError |
            LocatedReadCommittedTransactionFailureV1
        >,
      );
      const cause = error.value;
      if (
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind === "callbackRolledBack" &&
        cause.issue.callbackCause === started.rollbackSignal
      ) {
        const callbackCause = started.callbackCause();
        return callbackCause === undefined ? Effect.die(cause) : Effect.failCause(callbackCause);
      }
      if (
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind === "callbackCleanupFailed" &&
        cause.issue.callbackCause === started.rollbackSignal
      ) {
        const callbackCause = started.callbackCause();
        return callbackCause === undefined
          ? Effect.die(cause)
          : Effect.failCause(Cause.combine(
              callbackCause,
              Cause.die(failureValue(operation, "resourceFailure", false, cause)),
            ));
      }
      return cause instanceof LocatedReadCommittedTransactionFailureV1
        ? Effect.fail(cause)
        : Effect.die(cause);
    }));
  });
});

function startLocatedRead<Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedRead<Value, Failure> {
  const rollbackSignal = new Error("Application query transaction rolled back.");
  let callbackCause: Cause.Cause<Failure> | undefined;
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromiseExit(body(tx));
    if (Exit.isSuccess(exit)) return exit.value;
    callbackCause = exit.cause;
    throw rollbackSignal;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => callbackCause,
  });
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}
