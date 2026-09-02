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
  Data,
  Effect,
  HashMap,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import {
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdentityV1,
  type AppDocumentIdV1,
  type AppDocumentIdV1Error,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
} from "flarex-protocol/internal/application-schema-binding";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  type LogicalApplicationRelationIncomingReadDependencyV1,
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
  type StorageGeneration,
  type StorageGenerationFence,
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
  claimApplicationRelationActiveSelection,
  claimApplicationActiveSelection,
  type ApplicationRelationActiveSelectionSnapshot,
  validateApplicationActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationActiveSelectionBasis,
  type ApplicationActivationError,
} from "./applicationActivation";
import {
  type AppRelationEdgeQueryObservation,
  type AppRelationEdgeReadError,
  readIncomingAppRelationEdgePageInTransactionEffect,
} from "./appRelationEdges";
import {
  applicationRelationIncomingReadItemFromEdge,
  hasApplicationRelationReadPortAuthorityForControlDb,
  type ApplicationRelationIncomingReadItem,
  type ApplicationRelationReadCapability,
  type ApplicationRelationReadPort,
  type ApplicationRelationSourceReference,
  type PrepareApplicationRelationReadCapabilityError,
  type ResolveApplicationRelationReadCapabilityInput,
  type ResolvedApplicationRelationReadCapability,
  type ValidateApplicationRelationReadCapabilityError,
} from "./applicationRelationRead";
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
import type {
  LockScopeClockForShareError,
  ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedTrustedScopeAuthority,
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
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import { ScopeExecutionAuthorityError } from
  "./scopeExecution/Errors";
import {
  ScopeExecution,
  type ScopeExecutionApi,
} from "./scopeExecution/ScopeExecution";
import {
  defineScopedReadOperation,
  type ScopedReadOperation,
  type ScopedTransactionContext,
} from "./scopeExecution/ScopedTransaction";

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

interface ApplicationRelationQuerySnapshotMetadata {
  readonly basis: ApplicationRelationActiveSelectionSnapshot;
  readonly relation: ApplicationRelationSourceReference;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly snapshotToken: SnapshotToken;
}

declare const applicationQuerySnapshotBrand: unique symbol;
export interface ApplicationQuerySnapshot {
  readonly [applicationQuerySnapshotBrand]: true;
}

export interface OpenedApplicationQuerySnapshot {
  readonly snapshot: ApplicationQuerySnapshot;
  readonly metadata: ApplicationQuerySnapshotMetadata;
}

declare const applicationRelationQuerySnapshotBrand: unique symbol;
export interface ApplicationRelationQuerySnapshot {
  readonly [applicationRelationQuerySnapshotBrand]: true;
}

export interface OpenedApplicationRelationQuerySnapshot {
  readonly snapshot: ApplicationRelationQuerySnapshot;
}

export interface ApplicationRelationQueryPage {
  readonly sources: ReadonlyArray<ApplicationRelationIncomingReadItem>;
  readonly exhausted: boolean;
}

export interface ApplicationRelationQuerySyncReceipt {
  readonly snapshotToken: SnapshotToken;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly dependency: LogicalApplicationRelationIncomingReadDependencyV1;
}

export interface ApplicationRelationQueryPageWithSyncReceipt {
  readonly page: ApplicationRelationQueryPage;
  readonly receipt: ApplicationRelationQuerySyncReceipt;
}

export interface ApplicationRelationQueryReadOptions {
  /** Test-only receipt of the exact compiled physical page statement. */
  readonly observeQuery?: (query: AppRelationEdgeQueryObservation) => void;
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

export type ApplicationQueryReadDependency =
  | Readonly<{
      readonly kind: "appRowPoint";
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly kind: "appTable";
      readonly tableId: CatalogTableId;
    }>;

export interface ApplicationQueryEvaluationSnapshotReceipt {
  readonly metadata: ApplicationQuerySnapshotMetadata;
  readonly dependencies: ReadonlyArray<ApplicationQueryReadDependency>;
}

export interface ApplicationQueryEvaluationSnapshotOptions {
  readonly dependencyCapture: "evaluation";
}

export class ApplicationQuerySnapshotError extends Data.TaggedError(
  "ApplicationQuerySnapshotError",
)<{
  readonly operation:
    | "open"
    | "revalidate"
    | "pointRead"
    | "indexRead"
    | "finalizeEvaluation";
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

export class ApplicationRelationQuerySnapshotError extends Data.TaggedError(
  "ApplicationRelationQuerySnapshotError",
)<{
  readonly operation: "open" | "read";
  readonly reason:
    | "invalidComposition"
    | "invalidInput"
    | "unsupportedTarget"
    | "historyUnavailable"
    | "snapshotChanged"
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
  | ScopeExecutionAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export type UseApplicationQuerySnapshotError =
  | ApplicationQuerySnapshotError
  | ApplicationActivationError
  | AppDocumentIdV1Error
  | ReadAppRowError
  | ReadAppIndexRangeV1Error
  | ReadFencedIndexBuildStateError
  | ScopeExecutionAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export type OpenApplicationRelationQuerySnapshotError =
  | ApplicationRelationQuerySnapshotError
  | ApplicationActivationError
  | PrepareApplicationRelationReadCapabilityError
  | TrustedScopeAuthorityError
  | ScopeExecutionAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export type UseApplicationRelationQuerySnapshotError =
  | ApplicationRelationQuerySnapshotError
  | AppDocumentIdV1Error
  | ValidateApplicationRelationReadCapabilityError
  | AppRelationEdgeReadError
  | ScopeExecutionAuthorityError
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

export interface ApplicationRelationQuerySnapshotContext {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly relations: ApplicationRelationReadPort;
}

interface Usage {
  readonly pointReads: number;
  readonly indexReads: number;
  readonly documents: number;
  readonly semanticBytes: number;
}

interface State {
  readonly scopeExecution: ScopeExecutionApi;
  readonly selection: ApplicationActiveSelection;
  readonly located: LocatedTrustedScopeAuthority<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly schema: ApplicationSchemaAuthority;
  readonly definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>;
  readonly metadata: ApplicationQuerySnapshotMetadata;
  readonly usage: Ref.Ref<Usage>;
  readonly dependencies: Ref.Ref<
    HashMap.HashMap<string, ApplicationQueryReadDependency>
  > | null;
  readonly readGate: Semaphore.Semaphore;
  readonly phase: Ref.Ref<"open" | "finalized" | "closed">;
}

interface RelationState {
  readonly scopeExecution: ScopeExecutionApi;
  readonly capability: ApplicationRelationReadCapability;
  readonly relations: ApplicationRelationReadPort;
  readonly resolved: ResolvedApplicationRelationReadCapability;
  readonly resolveInput: ResolveApplicationRelationReadCapabilityInput;
  readonly located: LocatedTrustedScopeAuthority<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly metadata: ApplicationRelationQuerySnapshotMetadata;
  readonly readGate: Semaphore.Semaphore;
  readonly closed: Ref.Ref<boolean>;
}

const states = new WeakMap<ApplicationQuerySnapshot, State>();
const relationStates = new WeakMap<
  ApplicationRelationQuerySnapshot,
  RelationState
>();

const openScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly selection: ApplicationActiveSelection;
    readonly basis: ApplicationActiveSelectionBasis;
    readonly fn: ApplicationManifestV1["functions"][number];
  }>) => openInTransaction(
    tx,
    scoped.clock,
    input.selection,
    input.basis,
    input.fn,
  ),
);

const revalidateScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly state: State;
    readonly operation: ApplicationQuerySnapshotError["operation"];
  }>) => revalidateInTransaction(
    tx,
    scoped.clock,
    input.state,
    input.operation,
  ),
);

const pointReadScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly state: State;
    readonly tableId: CatalogTableId;
    readonly rowId: AppDocumentIdentityV1["rowId"];
  }>) => readPointInTransaction(tx, scoped, input),
);

const indexReadScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly state: State;
    readonly table: State["schema"]["tables"][number];
    readonly definition: LocatedAppIndexDefinitionV1;
    readonly bounds: OrderedIndexBoundsV1;
    readonly limit: number;
  }>) => readIndexInTransaction(tx, scoped, input),
);

const relationOpenScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly relations: ApplicationRelationReadPort;
    readonly capability: ApplicationRelationReadCapability;
    readonly deploymentId: ResolveApplicationRelationReadCapabilityInput["deploymentId"];
    readonly basis: ApplicationRelationActiveSelectionSnapshot;
  }>) => Effect.gen(function* () {
    yield* input.relations.validateInTransaction(
      input.capability,
      {
        deploymentId: input.deploymentId,
        scopeId: input.basis.authority.scopeId,
        schemaVersionId: input.basis.schemaVersionId,
      },
      tx,
      scoped.clock,
    );
    yield* requireRelationHistoryAvailable(
      tx,
      scoped.clock,
      scoped.clock.lastCommitSeq,
      "open",
    );
    return Object.freeze(SnapshotTokenSchema.make({
      scopeId: scoped.clock.scopeId,
      epoch: scoped.clock.epoch,
      commitSeq: scoped.clock.lastCommitSeq,
    }));
  }),
);

const relationReadScopedOperation = defineScopedReadOperation(
  (tx, scoped, input: Readonly<{
    readonly state: RelationState;
    readonly targetRowId: AppDocumentIdentityV1["rowId"];
    readonly limit: number;
    readonly options: ApplicationRelationQueryReadOptions;
  }>) => readRelationInTransaction(tx, scoped, input),
);

export const openApplicationQuerySnapshot = Effect.fn(
  "ApplicationQuerySnapshot.open",
)(function* (
  selection: ApplicationActiveSelection,
  functionPath: string,
  budget: ApplicationQueryBudget,
  context: ApplicationQuerySnapshotContext,
  options?: ApplicationQueryEvaluationSnapshotOptions,
): Effect.fn.Return<
  OpenedApplicationQuerySnapshot,
  OpenApplicationQuerySnapshotError,
  Scope.Scope | ScopeExecution
> {
  const capturedBudget = yield* Effect.fromResult(captureBudget(budget));
  const scopeExecution = yield* ScopeExecution;
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
    scopeExecution,
    located,
    "open",
    openScopedOperation,
    Object.freeze({ selection, basis, fn }),
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
  const dependencies = options?.dependencyCapture === "evaluation"
    ? yield* Ref.make(
      HashMap.empty<string, ApplicationQueryReadDependency>(),
    )
    : null;
  const phase = yield* Ref.make<"open" | "finalized" | "closed">("open");
  const state = Object.freeze({
    scopeExecution,
    selection,
    located,
    schema,
    definitions,
    metadata,
    usage,
    dependencies,
    readGate: Semaphore.makeUnsafe(1),
    phase,
  });
  const snapshot = yield* Effect.acquireRelease(
    Effect.sync(() => issue(state)),
    issued => Effect.gen(function* () {
      yield* Ref.set(state.phase, "closed");
      states.delete(issued);
    }),
  );
  return Object.freeze({ snapshot, metadata: snapshotMetadata(metadata) });
});

export const openApplicationRelationQuerySnapshot = Effect.fn(
  "ApplicationQuerySnapshot.openRelation",
)(function* (
  selection: ApplicationActiveSelection,
  relation: ApplicationRelationSourceReference,
  context: ApplicationRelationQuerySnapshotContext,
): Effect.fn.Return<
  OpenedApplicationRelationQuerySnapshot,
  OpenApplicationRelationQuerySnapshotError,
  Scope.Scope | ScopeExecution
> {
  const scopeExecution = yield* ScopeExecution;
  if (
    !hasApplicationRelationReadPortAuthorityForControlDb(
      context.relations,
      context.controlDb,
    )
  ) return yield* relationFailure("open", "invalidComposition");
  const basis = yield* Effect.fromResult(
    claimApplicationRelationActiveSelection(selection),
  );
  const deploymentId = yield* Effect.fromResult(
    decodeDeploymentIdResult(context.deploymentId).pipe(
      Result.mapError(cause =>
        relationFailureValue("open", "invalidComposition", false, cause)
      ),
    ),
  );
  if (basis.deploymentId !== context.deploymentId) {
    return yield* relationFailure("open", "invalidComposition");
  }
  const capability = yield* context.relations.prepareBySource({
    deploymentId,
    selection,
    relation,
  });
  const resolveInput = Object.freeze({
    deploymentId,
    scopeId: basis.authority.scopeId,
    schemaVersionId: basis.schemaVersionId,
  });
  const resolved = yield* Effect.fromResult(
    context.relations.resolve(capability, resolveInput),
  );
  yield* requireResolvedRelationAuthority(basis, resolved);
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSameRelationAuthority(
    basis.authority,
    located.authority,
  );
  const snapshotToken = yield* runLocatedRelationRead(
    scopeExecution,
    located,
    "open",
    relationOpenScopedOperation,
    Object.freeze({
      relations: context.relations,
      capability,
      deploymentId,
      basis,
    }),
  );
  const metadata = relationSnapshotMetadata({
    basis,
    relation,
    sourceTableId: resolved.definition.binding.sourceTableId,
    targetTableId: resolved.definition.binding.targetTableId,
    snapshotToken,
  });
  const closed = yield* Ref.make(false);
  const state = Object.freeze({
    scopeExecution,
    capability,
    relations: context.relations,
    resolved,
    resolveInput,
    located,
    metadata,
    readGate: Semaphore.makeUnsafe(1),
    closed,
  });
  const snapshot = yield* Effect.acquireRelease(
    Effect.sync(() => issueRelationSnapshot(state)),
    issued => Effect.gen(function* () {
      yield* Ref.set(state.closed, true);
      relationStates.delete(issued);
    }),
  );
  return Object.freeze({
    snapshot,
  });
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
      state.scopeExecution,
      state.located,
      "revalidate",
      revalidateScopedOperation,
      Object.freeze({ state, operation: "revalidate" as const }),
    );
  }));
  return snapshotMetadata(state.metadata);
});

export const finalizeApplicationQueryEvaluationSnapshot = Effect.fn(
  "ApplicationQuerySnapshot.finalizeEvaluation",
)(function* (
  snapshot: ApplicationQuerySnapshot,
): Effect.fn.Return<
  ApplicationQueryEvaluationSnapshotReceipt,
  UseApplicationQuerySnapshotError
> {
  const state = yield* Effect.fromResult(claim(snapshot, "finalizeEvaluation"));
  return yield* state.readGate.withPermit(Effect.gen(function* () {
    yield* requireOpen(state, "finalizeEvaluation");
    if (state.dependencies === null) {
      return yield* failure("finalizeEvaluation", "invalidComposition");
    }
    yield* runLocatedRead(
      state.scopeExecution,
      state.located,
      "finalizeEvaluation",
      revalidateScopedOperation,
      Object.freeze({ state, operation: "finalizeEvaluation" as const }),
    );
    const dependencies = yield* Ref.get(state.dependencies);
    const finalized = yield* Ref.modify(state.phase, phase =>
      phase === "open"
        ? [true, "finalized" as const]
        : [false, phase] as const
    );
    if (!finalized) {
      return yield* failure("finalizeEvaluation", "invalidComposition");
    }
    return Object.freeze({
      metadata: snapshotMetadata(state.metadata),
      dependencies: Object.freeze(HashMap.toValues(dependencies).map(
        captureApplicationQueryReadDependency,
      )),
    });
  }));
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
      state.scopeExecution,
      state.located,
      "pointRead",
      pointReadScopedOperation,
      Object.freeze({
        state,
        tableId: table.tableId,
        rowId: identity.rowId,
      }),
    );
    if (result.kind === "missing") {
      yield* recordDependency(state, Object.freeze({
        kind: "appRowPoint",
        documentId,
      }));
      return Object.freeze({ kind: "missing" });
    }
    yield* chargeDocument(state, "pointRead", result);
    const document = result.document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(document)) {
      return yield* failure("pointRead", "resourceFailure");
    }
    yield* recordDependency(state, Object.freeze({
      kind: "appRowPoint",
      documentId,
    }));
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

export const readApplicationRelationQueryIncomingSources = Effect.fn(
  "ApplicationQuerySnapshot.readIncomingRelationSources",
)(function* (
  snapshot: ApplicationRelationQuerySnapshot,
  target: AppDocumentIdV1,
  limit: number,
  options: ApplicationRelationQueryReadOptions = Object.freeze({}),
): Effect.fn.Return<
  ApplicationRelationQueryPage,
  UseApplicationRelationQuerySnapshotError
> {
  const observed = yield* readApplicationRelationQueryIncomingSourcesObserved(
    snapshot,
    target,
    limit,
    options,
  );
  return observed.page;
});

export const readApplicationRelationQueryIncomingSourcesWithSyncReceipt =
  Effect.fn(
    "ApplicationQuerySnapshot.readIncomingRelationSourcesWithSyncReceipt",
  )(function* (
    snapshot: ApplicationRelationQuerySnapshot,
    target: AppDocumentIdV1,
    limit: number,
    options: ApplicationRelationQueryReadOptions = Object.freeze({}),
  ): Effect.fn.Return<
    ApplicationRelationQueryPageWithSyncReceipt,
    UseApplicationRelationQuerySnapshotError
  > {
    const observed = yield*
      readApplicationRelationQueryIncomingSourcesObserved(
        snapshot,
        target,
        limit,
        options,
      );
    return Object.freeze({
      page: observed.page,
      receipt: captureApplicationRelationQuerySyncReceipt(observed),
    });
  });

const readApplicationRelationQueryIncomingSourcesObserved = Effect.fn(
  "ApplicationQuerySnapshot.readIncomingRelationSourcesObserved",
)(function* (
  snapshot: ApplicationRelationQuerySnapshot,
  target: AppDocumentIdV1,
  limit: number,
  options: ApplicationRelationQueryReadOptions,
) {
  const state = yield* Effect.fromResult(claimRelationSnapshot(snapshot));
  return yield* state.readGate.withPermit(Effect.gen(function* () {
    yield* requireRelationOpen(state);
    if (
      !isPositiveSafeInteger(limit) ||
      limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) return yield* relationFailure("read", "invalidInput");
    const identity = yield* Effect.fromResult(
      requireAppDocumentIdentityV1ForTableResult(
        target,
        state.metadata.targetTableId,
      ),
    );
    return yield* runLocatedRelationRead(
      state.scopeExecution,
      state.located,
      "read",
      relationReadScopedOperation,
      Object.freeze({
        state,
        targetRowId: identity.rowId,
        limit,
        options: Object.freeze({ ...options }),
      }),
    );
  }));
});

function captureApplicationRelationQuerySyncReceipt(
  observed: Readonly<{
    readonly state: RelationState;
    readonly targetRowId: AppDocumentIdentityV1["rowId"];
    readonly observedAdjacencyVersion: CommitSeq;
  }>,
): ApplicationRelationQuerySyncReceipt {
  const { state } = observed;
  const dependency = Object.freeze({
    kind: "appRelationIncoming",
    edgeDefinitionId: state.resolved.definition.edge.edgeDefinitionId,
    targetRowId: observed.targetRowId,
    observedAdjacencyVersion: observed.observedAdjacencyVersion,
    activationSequence: ApplicationActivationSequenceV1Schema.make(
      state.metadata.basis.activationSequence,
    ),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      encodeBytesToLowercaseHex(state.metadata.basis.headSha256),
    ),
  }) satisfies LogicalApplicationRelationIncomingReadDependencyV1;
  return Object.freeze({
    snapshotToken: Object.freeze({ ...state.metadata.snapshotToken }),
    storageGeneration: state.metadata.basis.authority.storageGeneration,
    storageGenerationFence:
      state.metadata.basis.authority.storageGenerationFence,
    dependency,
  });
}

const readIndex = Effect.fn(
  "ApplicationQuerySnapshot.readIndexInternal",
)(function* (
  state: State,
  tableName: string,
  indexDescriptor: unknown,
  bounds: unknown,
  limit: number,
): Effect.fn.Return<
  ApplicationQueryIndexPage,
  UseApplicationQuerySnapshotError
> {
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
    state.scopeExecution,
    state.located,
    "indexRead",
    indexReadScopedOperation,
    Object.freeze({
      state,
      table,
      definition,
      bounds: decodedBounds,
      limit,
    }),
  );
  yield* recordDependency(state, Object.freeze({
    kind: "appTable",
    tableId: table.tableId,
  }));
  return Object.freeze({
    documents: page.documents,
    isDone: page.positions.isDone,
  });
});

function openInTransaction(
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  selection: ApplicationActiveSelection,
  basis: ApplicationActiveSelectionBasis,
  fn: ApplicationManifestV1["functions"][number],
) {
  return Effect.gen(function* () {
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
  clock: ScopeClockRecord,
  state: State,
  operation: ApplicationQuerySnapshotError["operation"] = "revalidate",
) {
  return Effect.gen(function* () {
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

function readPointInTransaction(
  tx: AppRowTransaction,
  scoped: ScopedTransactionContext,
  input: Readonly<{
    readonly state: State;
    readonly tableId: CatalogTableId;
    readonly rowId: AppDocumentIdentityV1["rowId"];
  }>,
) {
  return Effect.gen(function* () {
    yield* revalidateInTransaction(
      tx,
      scoped.clock,
      input.state,
      "pointRead",
    );
    return yield* getAppRowAtSnapshotInTransactionEffect(tx, {
      snapshotToken: input.state.metadata.snapshotToken,
      tableId: input.tableId,
      rowId: input.rowId,
    });
  });
}

function readIndexInTransaction(
  tx: AppRowTransaction,
  scoped: ScopedTransactionContext,
  input: Readonly<{
    readonly state: State;
    readonly table: State["schema"]["tables"][number];
    readonly definition: LocatedAppIndexDefinitionV1;
    readonly bounds: OrderedIndexBoundsV1;
    readonly limit: number;
  }>,
) {
  return Effect.gen(function* () {
    const { state, table, definition, bounds, limit } = input;
    yield* revalidateInTransaction(
      tx,
      scoped.clock,
      state,
      "indexRead",
    );
    const build = yield* readFencedIndexBuildStateEffect(tx, {
      scopeId: scoped.authority.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
    });
    if (build.status !== "current" || build.buildState.lifecycle !== "enabled") {
      return yield* failure("indexRead", "indexUnavailable");
    }
    if (build.buildState.startCommitSeq > state.metadata.snapshotToken.commitSeq) {
      return yield* failure("indexRead", "indexUnavailable");
    }
    const positions = yield* scanAppIndexAtSnapshotInTransactionEffect(tx, {
      scopeId: scoped.authority.scopeId,
      definition,
      bounds,
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
        scopeId: scoped.authority.scopeId,
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
  });
}

const readRelationInTransaction = Effect.fn(
  "ApplicationQuerySnapshot.readRelationInTransaction",
)(function* (
  tx: AppRowTransaction,
  scoped: ScopedTransactionContext,
  input: Readonly<{
    readonly state: RelationState;
    readonly targetRowId: AppDocumentIdentityV1["rowId"];
    readonly limit: number;
    readonly options: ApplicationRelationQueryReadOptions;
  }>,
) {
  const { state } = input;
  const basis = state.metadata.basis;
  yield* state.relations.validateInTransaction(
    state.capability,
    state.resolveInput,
    tx,
    scoped.clock,
  );
  yield* requireRelationClock(state, scoped.clock);
  yield* requireRelationHistoryAvailable(
    tx,
    scoped.clock,
    state.metadata.snapshotToken.commitSeq,
    "read",
  );
  const page = yield* readIncomingAppRelationEdgePageInTransactionEffect(
    tx,
    {
      scopeId: basis.authority.scopeId,
      definition: state.resolved.definition.edge,
      targetRowId: input.targetRowId,
      maximumIdentities: input.limit,
      ...(input.options.observeQuery === undefined
        ? {}
        : { observeQuery: input.options.observeQuery }),
    },
  );
  const snapshotCommitSeq = state.metadata.snapshotToken.commitSeq;
  if (
    page.versionAfter < page.versionBefore ||
    page.versionBefore > scoped.clock.lastCommitSeq ||
    page.versionAfter > scoped.clock.lastCommitSeq
  ) {
    return yield* relationFailure("read", "resourceFailure");
  }
  if (
    page.versionBefore !== page.versionAfter ||
    page.versionBefore > snapshotCommitSeq
  ) {
    const newest = page.versionBefore > page.versionAfter
      ? page.versionBefore
      : page.versionAfter;
    return yield* (newest > snapshotCommitSeq
      ? relationFailure("read", "snapshotChanged", true)
      : relationFailure("read", "resourceFailure"));
  }
  return Object.freeze({
    state,
    targetRowId: input.targetRowId,
    observedAdjacencyVersion: page.versionBefore,
    page: Object.freeze({
      sources: Object.freeze(page.items.map(item =>
        applicationRelationIncomingReadItemFromEdge(
          state.metadata.sourceTableId,
          item,
        )
      )),
      exhausted: page.exhausted,
    }),
  });
});

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

const requireRelationHistoryAvailable = Effect.fn(
  "ApplicationQuerySnapshot.requireRelationHistoryAvailable",
)(function* (
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  snapshotCommitSeq: CommitSeq,
  operation: ApplicationRelationQuerySnapshotError["operation"],
) {
  if (snapshotCommitSeq > clock.lastCommitSeq) {
    return yield* relationFailure(operation, "historyUnavailable");
  }
  const rows = yield* relationQuery(
    tx.select({
      oldestAvailableCommitSeq: fxSystemScopeClocks.oldestAvailableCommitSeq,
    }).from(fxSystemScopeClocks).where(eq(
      fxSystemScopeClocks.scopeId,
      clock.scopeId,
    )).limit(1),
    operation,
  );
  if (
    rows[0] === undefined ||
    rows[0].oldestAvailableCommitSeq > snapshotCommitSeq
  ) {
    return yield* relationFailure(operation, "historyUnavailable");
  }
});

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

function requireSameRelationAuthority(
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
    : relationFailure("open", "unsupportedTarget");
}

function requireResolvedRelationAuthority(
  basis: ApplicationRelationActiveSelectionSnapshot,
  resolved: ResolvedApplicationRelationReadCapability,
) {
  const definition = resolved.definition;
  const edge = definition.edge;
  return resolved.storageGenerationFence ===
      basis.authority.storageGenerationFence &&
      resolved.epoch === basis.authority.epoch &&
      resolved.definitions.schemaVersionId === basis.schemaVersionId &&
      resolved.definitions.definitions.length === basis.relationCount &&
      definition.binding.relationId === edge.relationId &&
      definition.binding.sourceTableId === edge.physical.sourceTableId &&
      definition.binding.targetTableId === edge.physical.targetTableId
    ? Effect.void
    : relationFailure("open", "resourceFailure");
}

function requireRelationClock(
  state: RelationState,
  clock: ScopeClockRecord,
) {
  const metadata = state.metadata;
  return clock.scopeId === metadata.snapshotToken.scopeId &&
      clock.epoch === metadata.snapshotToken.epoch &&
      clock.storageGenerationFence === state.resolved.storageGenerationFence &&
      clock.epoch === state.resolved.epoch
    ? Effect.void
    : relationFailure("read", "unsupportedTarget");
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
  // SAFETY: the snapshot is an inert identity token; all state lives in
  // the module-local WeakMap keyed by this object identity.
  const snapshot = Object.freeze({}) as ApplicationQuerySnapshot;
  states.set(snapshot, state);
  return snapshot;
}

function issueRelationSnapshot(
  state: RelationState,
): ApplicationRelationQuerySnapshot {
  // SAFETY: the snapshot is an inert identity token; all state lives in the
  // module-local WeakMap keyed by this object identity.
  const snapshot = Object.freeze({}) as ApplicationRelationQuerySnapshot;
  relationStates.set(snapshot, state);
  return snapshot;
}

function claim(snapshot: unknown, operation: ApplicationQuerySnapshotError["operation"]) {
  // SAFETY: the typeof guard below proves the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
  const state = typeof snapshot === "object" && snapshot !== null
    ? states.get(snapshot as ApplicationQuerySnapshot)
    : undefined;
  return state === undefined
    ? Result.fail(failureValue(operation, "invalidComposition"))
    : Result.succeed(state);
}

function claimRelationSnapshot(snapshot: unknown) {
  // SAFETY: the typeof guard proves a non-null object; WeakMap membership is
  // the process-local relation snapshot authority.
  const state = typeof snapshot === "object" && snapshot !== null
    ? relationStates.get(snapshot as ApplicationRelationQuerySnapshot)
    : undefined;
  return state === undefined
    ? Result.fail(relationFailureValue("read", "invalidComposition"))
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

function relationSnapshotMetadata(
  metadata: ApplicationRelationQuerySnapshotMetadata,
): ApplicationRelationQuerySnapshotMetadata {
  return Object.freeze({
    basis: Object.freeze({
      ...metadata.basis,
      authority: Object.freeze({
        ...metadata.basis.authority,
        physicalLocator: Object.freeze({
          ...metadata.basis.authority.physicalLocator,
        }),
      }),
      readinessSha256: copyBytes(metadata.basis.readinessSha256),
      relationSetReadinessSha256:
        copyBytes(metadata.basis.relationSetReadinessSha256),
      activationSha256: copyBytes(metadata.basis.activationSha256),
      headSha256: copyBytes(metadata.basis.headSha256),
    }),
    relation: Object.freeze({
      source: Object.freeze({
        table: metadata.relation.source.table,
        path: copyRelationSourcePath(metadata.relation.source.path),
      }),
    }),
    sourceTableId: metadata.sourceTableId,
    targetTableId: metadata.targetTableId,
    snapshotToken: Object.freeze({ ...metadata.snapshotToken }),
  });
}

function copyRelationSourcePath(
  path: ApplicationRelationSourceReference["source"]["path"],
): ApplicationRelationSourceReference["source"]["path"] {
  const segment = path[0];
  return Object.freeze([Object.freeze({
    kind: segment.kind,
    name: segment.name,
  })]);
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
  return Ref.get(state.phase).pipe(Effect.flatMap(phase => phase === "open"
    ? Effect.void
    : failure(operation, "invalidComposition")));
}

function recordDependency(
  state: State,
  dependency: ApplicationQueryReadDependency,
): Effect.Effect<void> {
  if (state.dependencies === null) return Effect.void;
  return Ref.update(
    state.dependencies,
    dependencies => HashMap.set(
      dependencies,
      applicationQueryReadDependencyKey(dependency),
      dependency,
    ),
  );
}

function applicationQueryReadDependencyKey(
  dependency: ApplicationQueryReadDependency,
): string {
  return dependency.kind === "appRowPoint"
    ? `point:${dependency.documentId}`
    : `table:${dependency.tableId}`;
}

function captureApplicationQueryReadDependency(
  dependency: ApplicationQueryReadDependency,
): ApplicationQueryReadDependency {
  return dependency.kind === "appRowPoint"
    ? Object.freeze({
        kind: dependency.kind,
        documentId: dependency.documentId,
      })
    : Object.freeze({
        kind: dependency.kind,
        tableId: dependency.tableId,
      });
}

function requireRelationOpen(state: RelationState) {
  return Ref.get(state.closed).pipe(Effect.flatMap(closed => closed
    ? relationFailure("read", "invalidComposition")
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

function relationQuery<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  operation: ApplicationRelationQuerySnapshotError["operation"],
) {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => relationFailureValue(
      operation,
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function sha256(
  bytes: Uint8Array,
  _operation: ApplicationQuerySnapshotError["operation"],
) {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
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

function relationFailure(
  operation: ApplicationRelationQuerySnapshotError["operation"],
  reason: ApplicationRelationQuerySnapshotError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(
    relationFailureValue(operation, reason, retryable, cause),
  );
}

function relationFailureValue(
  operation: ApplicationRelationQuerySnapshotError["operation"],
  reason: ApplicationRelationQuerySnapshotError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return new ApplicationRelationQuerySnapshotError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

const runLocatedRead = Effect.fn(
  "ApplicationQuerySnapshot.runLocatedRead",
)(function <Input, Value, Failure>(
  scopeExecution: ScopeExecutionApi,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  errorOperation: ApplicationQuerySnapshotError["operation"],
  operation: ScopedReadOperation<Input, Value, Failure>,
  input: Input,
): Effect.Effect<
  Value,
  Failure | ApplicationQuerySnapshotError |
    ScopeExecutionAuthorityError | LockScopeClockForShareError |
    LocatedReadCommittedTransactionFailureV1
> {
  return scopeExecution.runRead(located, {
    rollbackMessage: "Application query transaction rolled back.",
    cleanupDefect: cause =>
      failureValue(errorOperation, "resourceFailure", false, cause),
  }, operation, input);
});

const runLocatedRelationRead = Effect.fn(
  "ApplicationQuerySnapshot.runLocatedRelationRead",
)(function <Input, Value, Failure>(
  scopeExecution: ScopeExecutionApi,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  errorOperation: ApplicationRelationQuerySnapshotError["operation"],
  operation: ScopedReadOperation<Input, Value, Failure>,
  input: Input,
): Effect.Effect<
  Value,
  Failure | ApplicationRelationQuerySnapshotError |
    ScopeExecutionAuthorityError | LockScopeClockForShareError |
    LocatedReadCommittedTransactionFailureV1
> {
  return scopeExecution.runRead(located, {
    rollbackMessage: "Application relation query transaction rolled back.",
    cleanupDefect: cause =>
      relationFailureValue(errorOperation, "resourceFailure", false, cause),
  }, operation, input);
});

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}
