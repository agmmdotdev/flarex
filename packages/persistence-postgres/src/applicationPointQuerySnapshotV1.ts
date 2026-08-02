import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
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
} from "effect";
import {
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1,
  type AppDocumentIdV1Error,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  type CommitSeq,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  ApplicationRevisionActivationCorruptionV1Error,
  ApplicationRevisionActivationIntegrationV1Error,
  ApplicationRevisionActivationStaleV1Error,
  InvalidActiveApplicationRevisionSelectionV1Error,
  validateActiveApplicationRevisionSelectionInTransactionV1,
  type ActiveApplicationRevisionMetadataV1,
  type ApplicationRevisionActivationContextV1,
  type AuthenticatedActiveApplicationRevisionSelectionV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "./applicationRevisionActivationV1";
import {
  claimActiveApplicationRevisionSyscallValidatorBasisV1,
  claimActiveApplicationRevisionRuntimeTargetStateV1,
} from "./applicationRevisionActiveSelectionStateV1";
import {
  getAppRowAtSnapshotInTransactionEffect,
  type AppRowPointReadResultV1,
  type AppRowTransaction,
  type ReadAppRowError,
} from "./appRows";
import {
  decodeCanonicalFunctionMetadataSetV1,
  type FunctionMetadataCodecV1Error,
} from "./functionMetadataCodec";
import {
  hashFunctionMetadataSha256V1,
  type FunctionMetadataSha256V1Error,
} from "./functionMetadataSha256";
import { fxSystemScopeClocks } from "./schema";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "./transactionSessionAttemptKernel";

const CAPABILITY_IDENTITY =
  "flarex.system/application-point-query-snapshot/v1" as const;
const FUNCTION_METADATA_BUDGET = Object.freeze({
  maximumFunctionsVisited: 32_768,
  maximumValidatorNodesVisited: 1_048_576,
  maximumCanonicalUtf8BytesMaterialized: 64 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });
const MAXIMUM_POINT_READS = 16_384;
const MAXIMUM_DOCUMENT_BYTES = 64 * 1_048_576;
const SUPPORTED_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

export interface ApplicationPointQuerySnapshotBudgetV1 {
  readonly maximumPointReads: number;
  readonly maximumDocumentBytes: number;
}

export interface ApplicationPointQuerySnapshotFunctionV1 {
  readonly functionOrdinal: number;
  readonly functionPath: string;
  readonly visibility: "public";
  readonly argsValidator: ValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
  readonly functionMetadataSha256: Uint8Array;
}

export interface ApplicationPointQuerySnapshotMetadataV1 {
  readonly identity: typeof CAPABILITY_IDENTITY;
  readonly scopeAuthority: TrustedScopeAuthority;
  readonly snapshotToken: SnapshotToken;
  readonly activeRevision: ActiveApplicationRevisionMetadataV1;
  readonly function: ApplicationPointQuerySnapshotFunctionV1;
  readonly budget: ApplicationPointQuerySnapshotBudgetV1;
}

declare const querySnapshotBrand: unique symbol;
export interface AuthenticatedApplicationPointQuerySnapshotV1 {
  readonly [querySnapshotBrand]: true;
}

export interface OpenedApplicationPointQuerySnapshotV1 {
  readonly capability: AuthenticatedApplicationPointQuerySnapshotV1;
  readonly metadata: ApplicationPointQuerySnapshotMetadataV1;
}

export interface ReadApplicationPointQueryDocumentV1Input {
  readonly tableName: string;
  readonly documentId: AppDocumentIdV1;
}

export type ReadApplicationPointQueryDocumentV1Result =
  | Readonly<{
      readonly kind: "present";
      readonly document: CanonicalFlarexRuntimeObjectV1;
    }>
  | Readonly<{ readonly kind: "missing" }>;

export class InvalidApplicationPointQuerySnapshotV1Error
  extends Data.TaggedError("InvalidApplicationPointQuerySnapshotV1Error")<{
    readonly reason: "notIssued";
  }> {}

export class InvalidApplicationPointQuerySnapshotInputV1Error
  extends Data.TaggedError(
    "InvalidApplicationPointQuerySnapshotInputV1Error",
  )<{
    readonly reason: "invalidBudget" | "invalidFunctionPath" | "unknownTable";
    readonly field?: string;
  }> {}

export class UnsupportedApplicationPointQuerySnapshotTargetV1Error
  extends Data.TaggedError(
    "UnsupportedApplicationPointQuerySnapshotTargetV1Error",
  )<{
    readonly actual: TrustedScopeAuthority["physicalLocator"];
  }> {}

export class ApplicationPointQuerySnapshotFunctionV1Error
  extends Data.TaggedError("ApplicationPointQuerySnapshotFunctionV1Error")<{
    readonly reason: "unknownFunction" | "unsupportedFunction";
    readonly functionPath: string;
  }> {}

export class ApplicationPointQuerySnapshotStaleV1Error
  extends Data.TaggedError("ApplicationPointQuerySnapshotStaleV1Error")<{
    readonly reason:
      | "scopeAuthority"
      | "activeRevision"
      | "historyUnavailable"
      | "snapshotAhead";
  }> {}

export class ApplicationPointQuerySnapshotCorruptionV1Error
  extends Data.TaggedError("ApplicationPointQuerySnapshotCorruptionV1Error")<{
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class ApplicationPointQuerySnapshotBudgetV1Error
  extends Data.TaggedError("ApplicationPointQuerySnapshotBudgetV1Error")<{
    readonly dimension: "pointReads" | "documentBytes";
    readonly observed: number;
    readonly maximum: number;
  }> {}

export class ApplicationPointQuerySnapshotIntegrationV1Error
  extends Data.TaggedError("ApplicationPointQuerySnapshotIntegrationV1Error")<{
    readonly phase: "retainedFloorRead" | "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export type OpenApplicationPointQuerySnapshotV1Error =
  | InvalidActiveApplicationRevisionSelectionV1Error
  | InvalidApplicationPointQuerySnapshotInputV1Error
  | UnsupportedApplicationPointQuerySnapshotTargetV1Error
  | ApplicationPointQuerySnapshotFunctionV1Error
  | ApplicationPointQuerySnapshotStaleV1Error
  | ApplicationPointQuerySnapshotCorruptionV1Error
  | ApplicationPointQuerySnapshotIntegrationV1Error
  | ApplicationRevisionActivationStaleV1Error
  | ApplicationRevisionActivationCorruptionV1Error
  | ApplicationRevisionActivationIntegrationV1Error
  | FunctionMetadataCodecV1Error
  | FunctionMetadataSha256V1Error
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export type ReadApplicationPointQueryDocumentV1Error =
  | InvalidApplicationPointQuerySnapshotV1Error
  | InvalidApplicationPointQuerySnapshotInputV1Error
  | ApplicationPointQuerySnapshotStaleV1Error
  | ApplicationPointQuerySnapshotCorruptionV1Error
  | ApplicationPointQuerySnapshotBudgetV1Error
  | ApplicationPointQuerySnapshotIntegrationV1Error
  | ApplicationRevisionActivationStaleV1Error
  | ApplicationRevisionActivationCorruptionV1Error
  | ApplicationRevisionActivationIntegrationV1Error
  | InvalidActiveApplicationRevisionSelectionV1Error
  | AppDocumentIdV1Error
  | ReadAppRowError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

interface SnapshotBudgetStateV1 {
  readonly pointReads: number;
  readonly documentBytes: number;
}

interface ApplicationPointQuerySnapshotStateV1 {
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly target: LocatedApplicationRevisionActivationTargetV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly metadata: ApplicationPointQuerySnapshotMetadataV1;
  readonly usage: Ref.Ref<SnapshotBudgetStateV1>;
}

const states = new WeakMap<
  AuthenticatedApplicationPointQuerySnapshotV1,
  ApplicationPointQuerySnapshotStateV1
>();

export const openApplicationPointQuerySnapshotV1 = Effect.fn(
  "ApplicationPointQuerySnapshot.openV1",
)(function* (
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionPath: string,
  budget: ApplicationPointQuerySnapshotBudgetV1,
  context: ApplicationRevisionActivationContextV1,
): Effect.fn.Return<
  OpenedApplicationPointQuerySnapshotV1,
  OpenApplicationPointQuerySnapshotV1Error,
  Scope.Scope
> {
  const capturedBudget = yield* Effect.fromResult(captureBudget(budget));
  if (!isNonBlankString(functionPath)) {
    return yield* new InvalidApplicationPointQuerySnapshotInputV1Error({
      reason: "invalidFunctionPath",
      field: "functionPath",
    });
  }
  const active = yield* Effect.fromResult(
    claimActiveApplicationRevisionRuntimeTargetStateV1(selection),
  );
  const validatorBasis = yield* Effect.fromResult(
    claimActiveApplicationRevisionSyscallValidatorBasisV1(selection),
  );
  const functionEvidence = yield* resolveQueryFunction(
    active.runtimeTarget.functionMetadataBytes,
    active.metadata,
    functionPath,
  );
  if (active.authority.storageGeneration !== "flarexdb_v1") {
    return yield* new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "scopeAuthority",
    });
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSupportedTarget(located.authority);
  yield* requireSameScopeAuthority(active.authority, located.authority);
  const pinned = yield* runLocatedReadEffect(
    located.target,
    tx => openInTransaction(tx, selection, active.authority),
  );
  const usage = yield* Ref.make<SnapshotBudgetStateV1>(Object.freeze({
    pointReads: 0,
    documentBytes: 0,
  }));
  const metadata = captureMetadata({
    scopeAuthority: active.authority,
    snapshotToken: pinned.snapshotToken,
    activeRevision: pinned.activeRevision,
    function: functionEvidence,
    budget: capturedBudget,
  });
  const state = Object.freeze({
    selection,
    target: located.target,
    schemaManifest: validatorBasis.schemaManifest,
    metadata,
    usage,
  });
  const capability = yield* Effect.acquireRelease(
    Effect.sync(() => issueSnapshot(state)),
    issued => Effect.sync(() => {
      states.delete(issued);
    }),
  );
  return Object.freeze({ capability, metadata: copyMetadata(metadata) });
});

export const readApplicationPointQueryDocumentV1 = Effect.fn(
  "ApplicationPointQuerySnapshot.readDocumentV1",
)(function* (
  capability: AuthenticatedApplicationPointQuerySnapshotV1,
  input: ReadApplicationPointQueryDocumentV1Input,
): Effect.fn.Return<
  ReadApplicationPointQueryDocumentV1Result,
  ReadApplicationPointQueryDocumentV1Error
> {
  const state = yield* Effect.fromResult(claimSnapshot(capability));
  yield* chargePointRead(state);
  const table = state.schemaManifest.tableDefinitions.tables.find(
    candidate => candidate.logicalName === input.tableName,
  );
  if (table === undefined) {
    return yield* new InvalidApplicationPointQuerySnapshotInputV1Error({
      reason: "unknownTable",
      field: "tableName",
    });
  }
  const identity = yield* Effect.fromResult(
    requireAppDocumentIdentityV1ForTableResult(input.documentId, table.tableId),
  );
  const result = yield* runLocatedReadEffect(
    state.target,
    tx => readInTransaction(tx, state, table.tableId, identity.rowId),
  );
  if (result.kind === "missing") return Object.freeze({ kind: "missing" });
  yield* chargeDocumentBytes(state, result.document.canonicalBytes.byteLength);
  if (!isCanonicalFlarexRuntimeObjectV1(result.document.value)) {
    return yield* new ApplicationPointQuerySnapshotCorruptionV1Error({
      detail: "the stored application document is not a canonical object",
    });
  }
  return Object.freeze({ kind: "present", document: result.document.value });
});

export function inspectApplicationPointQuerySnapshotV1(
  capability: unknown,
): Result.Result<
  ApplicationPointQuerySnapshotMetadataV1,
  InvalidApplicationPointQuerySnapshotV1Error
> {
  return claimSnapshot(capability).pipe(
    Result.map(state => copyMetadata(state.metadata)),
  );
}

function issueSnapshot(
  state: ApplicationPointQuerySnapshotStateV1,
): AuthenticatedApplicationPointQuerySnapshotV1 {
  const capability = Object.freeze({}) as
    AuthenticatedApplicationPointQuerySnapshotV1;
  states.set(capability, state);
  return capability;
}

function claimSnapshot(
  capability: unknown,
): Result.Result<
  ApplicationPointQuerySnapshotStateV1,
  InvalidApplicationPointQuerySnapshotV1Error
> {
  if (typeof capability !== "object" || capability === null) {
    return Result.fail(new InvalidApplicationPointQuerySnapshotV1Error({
      reason: "notIssued",
    }));
  }
  const state = states.get(
    capability as AuthenticatedApplicationPointQuerySnapshotV1,
  );
  return state === undefined
    ? Result.fail(new InvalidApplicationPointQuerySnapshotV1Error({
      reason: "notIssued",
    }))
    : Result.succeed(state);
}

function captureBudget(
  budget: unknown,
): Result.Result<
  ApplicationPointQuerySnapshotBudgetV1,
  InvalidApplicationPointQuerySnapshotInputV1Error
> {
  if (
    !isNonArrayRecord(budget) ||
    Reflect.ownKeys(budget).length !== 2
  ) return invalidBudget("budget");
  const record = budget;
  if (
    !isPositiveSafeInteger(record.maximumPointReads) ||
    record.maximumPointReads > MAXIMUM_POINT_READS
  ) return invalidBudget("maximumPointReads");
  if (
    !isPositiveSafeInteger(record.maximumDocumentBytes) ||
    record.maximumDocumentBytes > MAXIMUM_DOCUMENT_BYTES
  ) return invalidBudget("maximumDocumentBytes");
  return Result.succeed(Object.freeze({
    maximumPointReads: record.maximumPointReads,
    maximumDocumentBytes: record.maximumDocumentBytes,
  }));
}

function invalidBudget(field: string) {
  return Result.fail(new InvalidApplicationPointQuerySnapshotInputV1Error({
    reason: "invalidBudget",
    field,
  }));
}

const resolveQueryFunction = Effect.fn(
  "ApplicationPointQuerySnapshot.resolveFunction",
)(function* (
  functionMetadataBytes: Uint8Array,
  active: ActiveApplicationRevisionMetadataV1,
  functionPath: string,
): Effect.fn.Return<
  ApplicationPointQuerySnapshotFunctionV1,
  | ApplicationPointQuerySnapshotFunctionV1Error
  | ApplicationPointQuerySnapshotCorruptionV1Error
  | FunctionMetadataCodecV1Error
  | FunctionMetadataSha256V1Error
> {
  const decoded = yield* Effect.fromResult(
    decodeCanonicalFunctionMetadataSetV1(
      functionMetadataBytes,
      FUNCTION_METADATA_BUDGET,
    ),
  );
  const digest = yield* hashFunctionMetadataSha256V1(
    decoded.canonicalBytes,
    HASH_BUDGET,
  );
  if (!bytesEqualFullScan(digest, active.functionMetadataSha256)) {
    return yield* new ApplicationPointQuerySnapshotCorruptionV1Error({
      detail: "canonical function metadata does not match the active revision",
    });
  }
  const selected = decoded.functions.find(
    candidate => candidate.metadata.functionPath === functionPath,
  );
  if (selected === undefined) {
    return yield* new ApplicationPointQuerySnapshotFunctionV1Error({
      reason: "unknownFunction",
      functionPath,
    });
  }
  if (
    selected.metadata.kind !== "query" ||
    selected.metadata.visibility !== "public"
  ) {
    return yield* new ApplicationPointQuerySnapshotFunctionV1Error({
      reason: "unsupportedFunction",
      functionPath,
    });
  }
  return Object.freeze({
    functionOrdinal: selected.ordinal,
    functionPath: selected.metadata.functionPath,
    visibility: "public" as const,
    argsValidator: selected.metadata.argsValidator,
    returnsValidator: selected.metadata.returnsValidator,
    functionMetadataSha256: copyBytes(digest),
  });
});

const openInTransaction = Effect.fn(
  "ApplicationPointQuerySnapshot.openInTransaction",
)(function* (
  tx: AppRowTransaction,
  selection: AuthenticatedActiveApplicationRevisionSelectionV1,
  authority: TrustedScopeAuthority,
) {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactScopeClock(authority, clock);
  const activeRevision = yield*
    validateActiveApplicationRevisionSelectionInTransactionV1(
      selection,
      tx,
      clock,
    );
  const floor = yield* readRetainedFloor(tx, clock);
  if (floor > clock.lastCommitSeq) {
    return yield* new ApplicationPointQuerySnapshotCorruptionV1Error({
      detail: "the retained-history floor is ahead of the scope clock",
    });
  }
  return Object.freeze({
    snapshotToken: Object.freeze(SnapshotTokenSchema.make({
      scopeId: clock.scopeId,
      epoch: clock.epoch,
      commitSeq: clock.lastCommitSeq,
    })),
    activeRevision,
  });
});

const readInTransaction = Effect.fn(
  "ApplicationPointQuerySnapshot.readInTransaction",
)(function* (
  tx: AppRowTransaction,
  state: ApplicationPointQuerySnapshotStateV1,
  tableId: CatalogTableId,
  rowId: Parameters<typeof getAppRowAtSnapshotInTransactionEffect>[1]["rowId"],
): Effect.fn.Return<
  AppRowPointReadResultV1,
  | ApplicationPointQuerySnapshotStaleV1Error
  | ApplicationPointQuerySnapshotCorruptionV1Error
  | ApplicationPointQuerySnapshotIntegrationV1Error
  | ApplicationRevisionActivationStaleV1Error
  | ApplicationRevisionActivationCorruptionV1Error
  | ApplicationRevisionActivationIntegrationV1Error
  | InvalidActiveApplicationRevisionSelectionV1Error
  | ReadAppRowError
  | LockScopeClockForShareError
> {
  const authority = state.metadata.scopeAuthority;
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactScopeClock(authority, clock);
  if (state.metadata.snapshotToken.commitSeq > clock.lastCommitSeq) {
    return yield* new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "snapshotAhead",
    });
  }
  const floor = yield* readRetainedFloor(tx, clock);
  if (floor > state.metadata.snapshotToken.commitSeq) {
    return yield* new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "historyUnavailable",
    });
  }
  yield* validateActiveApplicationRevisionSelectionInTransactionV1(
    state.selection,
    tx,
    clock,
  ).pipe(Effect.mapError(error =>
    error instanceof ApplicationRevisionActivationStaleV1Error
      ? new ApplicationPointQuerySnapshotStaleV1Error({
        reason: "activeRevision",
      })
      : error
  ));
  return yield* getAppRowAtSnapshotInTransactionEffect(tx, {
    snapshotToken: state.metadata.snapshotToken,
    tableId,
    rowId,
  });
});

const readRetainedFloor = Effect.fn(
  "ApplicationPointQuerySnapshot.readRetainedFloor",
)(function* (
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
): Effect.fn.Return<
  CommitSeq,
  | ApplicationPointQuerySnapshotCorruptionV1Error
  | ApplicationPointQuerySnapshotStaleV1Error
  | ApplicationPointQuerySnapshotIntegrationV1Error
> {
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.select({
      scopeId: fxSystemScopeClocks.scopeId,
      oldestAvailableCommitSeq:
        fxSystemScopeClocks.oldestAvailableCommitSeq,
    }).from(fxSystemScopeClocks).where(and(
      eq(fxSystemScopeClocks.scopeId, clock.scopeId),
      eq(fxSystemScopeClocks.storageGeneration, clock.storageGeneration),
      eq(
        fxSystemScopeClocks.storageGenerationFence,
        clock.storageGenerationFence,
      ),
      eq(fxSystemScopeClocks.epoch, clock.epoch),
    )).limit(1),
    catch: cause => new ApplicationPointQuerySnapshotIntegrationV1Error({
      phase: "retainedFloorRead",
      retryable: true,
      cause,
    }),
  }));
  const row = rows[0];
  if (row === undefined || row.scopeId !== clock.scopeId) {
    return yield* new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "scopeAuthority",
    });
  }
  return yield* Effect.fromResult(
    decodeCommitSeqResult(row.oldestAvailableCommitSeq).pipe(
      Result.mapError(cause =>
        new ApplicationPointQuerySnapshotCorruptionV1Error({
          detail: "the retained-history floor is invalid",
          cause,
        })
      ),
    ),
  );
});

const requireExactScopeClock = Effect.fn(
  "ApplicationPointQuerySnapshot.requireExactScopeClock",
)(function* (
  expected: TrustedScopeAuthority,
  actual: ScopeClockRecord,
): Effect.fn.Return<void, ApplicationPointQuerySnapshotStaleV1Error> {
  if (
    expected.scopeId !== actual.scopeId ||
    expected.storageGeneration !== actual.storageGeneration ||
    expected.storageGenerationFence !== actual.storageGenerationFence ||
    expected.epoch !== actual.epoch
  ) {
    return yield* new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "scopeAuthority",
    });
  }
});

function requireSupportedTarget(authority: TrustedScopeAuthority) {
  const locator = authority.physicalLocator;
  return locator.kind === SUPPORTED_LOCATOR.kind &&
      locator.databaseKey === SUPPORTED_LOCATOR.databaseKey &&
      locator.schemaName === SUPPORTED_LOCATOR.schemaName
    ? Effect.void
    : Effect.fail(new UnsupportedApplicationPointQuerySnapshotTargetV1Error({
      actual: Object.freeze({ ...locator }),
    }));
}

function requireSameScopeAuthority(
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
) {
  return expected.scopeId === actual.scopeId &&
      expected.deploymentId === actual.deploymentId &&
      expected.storageGeneration === actual.storageGeneration &&
      expected.storageGenerationFence === actual.storageGenerationFence &&
      expected.epoch === actual.epoch &&
      expected.physicalLocator.kind === actual.physicalLocator.kind &&
      expected.physicalLocator.databaseKey ===
        actual.physicalLocator.databaseKey &&
      expected.physicalLocator.schemaName === actual.physicalLocator.schemaName
    ? Effect.void
    : Effect.fail(new ApplicationPointQuerySnapshotStaleV1Error({
      reason: "scopeAuthority",
    }));
}

const chargePointRead = Effect.fn(
  "ApplicationPointQuerySnapshot.chargePointRead",
)(function* (state: ApplicationPointQuerySnapshotStateV1) {
  const next = yield* Ref.modify(state.usage, current => {
    const pointReads = current.pointReads + 1;
    return [pointReads, Object.freeze({ ...current, pointReads })];
  });
  if (next > state.metadata.budget.maximumPointReads) {
    return yield* new ApplicationPointQuerySnapshotBudgetV1Error({
      dimension: "pointReads",
      observed: next,
      maximum: state.metadata.budget.maximumPointReads,
    });
  }
});

const chargeDocumentBytes = Effect.fn(
  "ApplicationPointQuerySnapshot.chargeDocumentBytes",
)(function* (state: ApplicationPointQuerySnapshotStateV1, byteLength: number) {
  const next = yield* Ref.modify(state.usage, current => {
    const documentBytes = current.documentBytes + byteLength;
    return [documentBytes, Object.freeze({ ...current, documentBytes })];
  });
  if (next > state.metadata.budget.maximumDocumentBytes) {
    return yield* new ApplicationPointQuerySnapshotBudgetV1Error({
      dimension: "documentBytes",
      observed: next,
      maximum: state.metadata.budget.maximumDocumentBytes,
    });
  }
});

function captureMetadata(input: Omit<
  ApplicationPointQuerySnapshotMetadataV1,
  "identity"
>): ApplicationPointQuerySnapshotMetadataV1 {
  return Object.freeze({
    identity: CAPABILITY_IDENTITY,
    scopeAuthority: Object.freeze({
      ...input.scopeAuthority,
      storageGeneration: input.scopeAuthority.storageGeneration,
      physicalLocator: Object.freeze({ ...input.scopeAuthority.physicalLocator }),
    }),
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
    activeRevision: copyActiveMetadata(input.activeRevision),
    function: copyFunction(input.function),
    budget: Object.freeze({ ...input.budget }),
  });
}

function copyMetadata(
  metadata: ApplicationPointQuerySnapshotMetadataV1,
): ApplicationPointQuerySnapshotMetadataV1 {
  return captureMetadata(metadata);
}

function copyFunction(
  value: ApplicationPointQuerySnapshotFunctionV1,
): ApplicationPointQuerySnapshotFunctionV1 {
  return Object.freeze({
    ...value,
    functionMetadataSha256: copyBytes(value.functionMetadataSha256),
  });
}

function copyActiveMetadata(
  metadata: ActiveApplicationRevisionMetadataV1,
): ActiveApplicationRevisionMetadataV1 {
  return Object.freeze({
    ...metadata,
    candidateSha256: copyBytes(metadata.candidateSha256),
    readinessReceiptSha256: copyBytes(metadata.readinessReceiptSha256),
    activationHeadSha256: copyBytes(metadata.activationHeadSha256),
    packageSha256: copyBytes(metadata.packageSha256),
    artifactSha256: copyBytes(metadata.artifactSha256),
    sourceRootSha256: copyBytes(metadata.sourceRootSha256),
    semanticRootSha256: copyBytes(metadata.semanticRootSha256),
    schemaArtifactSha256: copyBytes(metadata.schemaArtifactSha256),
    schemaBindingSha256: copyBytes(metadata.schemaBindingSha256),
    functionMetadataSha256: copyBytes(metadata.functionMetadataSha256),
    validatorRootSha256: copyBytes(metadata.validatorRootSha256),
    declaredHandlerSetSha256: copyBytes(metadata.declaredHandlerSetSha256),
    runtimeProjectionSetSha256: copyBytes(metadata.runtimeProjectionSetSha256),
    functionGroupManifestSha256:
      copyBytes(metadata.functionGroupManifestSha256),
  });
}

interface StartedReadTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

function runLocatedReadEffect<Value, Failure>(
  target: LocatedApplicationRevisionActivationTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | LocatedReadCommittedTransactionFailureV1 |
    ApplicationPointQuerySnapshotIntegrationV1Error
> {
  return Effect.suspend((): Effect.Effect<
    Value,
    Failure | LocatedReadCommittedTransactionFailureV1 |
      ApplicationPointQuerySnapshotIntegrationV1Error
  > => {
    const started = startReadTransaction(target, work);
    const settled = Effect.uninterruptible(Effect.exit(Effect.tryPromise({
      try: () => started.promise,
      catch: cause => cause instanceof LocatedReadCommittedTransactionFailureV1
        ? cause
        : new ApplicationPointQuerySnapshotIntegrationV1Error({
          phase: "targetTransaction",
          retryable: true,
          cause,
        }),
    })));
    return settled.pipe(Effect.flatMap((exit): Effect.Effect<
      Value,
      Failure | LocatedReadCommittedTransactionFailureV1 |
        ApplicationPointQuerySnapshotIntegrationV1Error
    > => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      const error = Cause.findErrorOption(exit.cause);
      if (error._tag === "None") return Effect.failCause(exit.cause);
      const cause = error.value;
      if (
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind === "callbackRolledBack" &&
        cause.issue.callbackCause === started.rollbackSignal
      ) {
        const callbackCause = started.callbackCause();
        return callbackCause === undefined
          ? Effect.die(cause)
          : Effect.failCause(callbackCause);
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
            Cause.die(new ApplicationPointQuerySnapshotIntegrationV1Error({
              phase: "targetTransaction",
              retryable: false,
              cause,
            })),
          ));
      }
      return Effect.fail(cause);
    }));
  });
}

/** Sole Effect runtime bridge for the Promise-only located transaction owner. */
function startReadTransaction<Value, Failure>(
  target: LocatedApplicationRevisionActivationTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedReadTransaction<Value, Failure> {
  let callbackCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error("PQV-A1 read transaction rolled back.");
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      callbackCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => callbackCause,
  });
}
