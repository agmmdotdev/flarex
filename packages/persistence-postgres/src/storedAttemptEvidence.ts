import {
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
} from "flarex-protocol/commit-protocol";
import type { JsonObject } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionSessionIdV1Schema,
  type StoredTransactionSessionScalarsV1,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexValueBytesV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { AppRowTransaction } from "./appRows";
import { detachDriverRows } from "./detachDriverRows";
import {
  observeDrizzleQuery as observeStoredAttemptQuery,
} from "./drizzleQueryObservation";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityPortOperation,
} from "./scopeAuthorityResolution";
import {
  decodeScopeClockRecordResult,
} from "./scopeClock";
import {
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";
import {
  storedAuthorityCorruptionResult,
  storedAuthorityMismatchResult,
  type StoredAuthorityCorruptionResult,
  type StoredAuthorityMismatchResult,
} from "./storedAuthorityLoadResult";
import {
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedRepeatableReadAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import type {
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAuthorityResolutionPortsV1,
} from "./transactionSessionActivation";

type TransactionSessionRow =
  typeof fxSystemTransactionSessions.$inferSelect;
type SnapshotLeaseRow = typeof fxSystemSnapshotLeases.$inferSelect;
type JournalRootRow = typeof fxSystemTransactionJournals.$inferSelect;
type JournalPointRow = typeof fxSystemTransactionJournalPoints.$inferSelect;
type ScopeClockRow = typeof fxSystemScopeClocks.$inferSelect;

const decodeStoredAttemptScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeStoredAttemptScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeStoredAttemptRevocationEpochResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAuthorizationRevocationEpochSchema),
);
const decodeStoredAttemptSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);
const decodeStoredAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodeStoredAttemptStorageGenerationFenceResult =
  Schema.decodeUnknownResult(Schema.toType(StorageGenerationFenceSchema));
const decodeStoredAttemptSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeStoredAttemptCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeStoredAttemptSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);

export interface StoredAttemptEvidenceAuthorityV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly executionClaim?: TransactionExecutionClaimPinV1;
}

export type StoredAttemptNotPlannableReasonV1 =
  | "lifecycle"
  | "rootNotSealed"
  | "expired";

export type StoredAttemptAuthorityMismatchReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "attemptMissing"
  | "attemptReplaced"
  | "generationChanged"
  | "epochChanged"
  | "snapshotChanged"
  | "schemaChanged"
  | "revocationEpochChanged"
  | "executionClaimChanged";

export type StoredAttemptCorruptionReasonV1 =
  | "repeatableReadCapabilityMissing"
  | "scopeClockMissingOrDuplicate"
  | "databaseClockInvalid"
  | "sessionRecordDuplicate"
  | "sessionRecordInvalid"
  | "snapshotLeaseMissingOrDuplicate"
  | "snapshotLeaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "executionClaimInvalid"
  | "pointEvidenceOverflow"
  | "pointEvidenceInvalid";

type StoredAttemptSessionRowScalarFieldV1 =
  | "storageGeneration"
  | "storageGenerationFence"
  | "packageId"
  | "artifactRuntime"
  | "artifactId"
  | "sourcePackageHash"
  | "executionModule"
  | "functionPath"
  | "functionKind"
  | "schemaVersionId"
  | "policyVersion"
  | "validatedArgsValueCodecVersion"
  | "authorizationGrantId"
  | "authorizationGrantValueCodecVersion"
  | "authorizationRevocationEpoch"
  | "requestKey"
  | "protocolVersion";

/** Protocol-owned comparison shape plus persistence-decoded row refinements. */
export type StoredAttemptSessionScalarsV1 =
  StoredTransactionSessionScalarsV1 &
  Readonly<
    Pick<TransactionSessionRow, StoredAttemptSessionRowScalarFieldV1> & {
      readonly lifecycle: Extract<
        TransactionSessionLifecycleV1,
        "running" | "finishing"
      >;
    }
  >;

export interface StoredAttemptLeaseScalarsV1 {
  readonly snapshotToken: SnapshotToken;
  readonly leaseExpiresAtMilliseconds: number;
}

export interface StoredAttemptSealedRootV1 {
  readonly lastSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
  readonly sealedFinalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
}

export interface StoredAttemptPointEvidenceV1 {
  readonly tableId: CatalogTableId;
  readonly rowId: Uint8Array;
  readonly dependencyKind: JournalPointRow["dependencyKind"];
  readonly dependencyRevisionCommitSeq:
    JournalPointRow["dependencyRevisionCommitSeq"];
  readonly overlayKind: JournalPointRow["overlayKind"];
  readonly overlayCreationTime: JournalPointRow["overlayCreationTime"];
  readonly overlayValueCodecVersion:
    JournalPointRow["overlayValueCodecVersion"];
  readonly overlayValueJson: JsonObject | null;
  readonly overlayValueBytes: CanonicalFlarexValueBytesV1 | null;
  readonly overlayValueSha256: FlarexValueSha256V1 | null;
  readonly overlaySemanticBytes: number | null;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export interface StoredAttemptEvidenceV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly databaseNowMilliseconds: number;
  readonly session: StoredAttemptSessionScalarsV1;
  readonly lease: StoredAttemptLeaseScalarsV1;
  readonly root: StoredAttemptSealedRootV1;
  readonly points: ReadonlyArray<StoredAttemptPointEvidenceV1>;
}

export type StoredAttemptEvidenceLoadResultV1 =
  | Readonly<{
      readonly kind: "loaded";
      readonly evidence: StoredAttemptEvidenceV1;
    }>
  | Readonly<{
      readonly kind: "alreadyCommitted";
      readonly updatedAtMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: StoredAttemptNotPlannableReasonV1;
      readonly lifecycle?: TransactionSessionLifecycleV1;
      readonly rootState?: JournalRootRow["state"];
    }>
  | StoredAuthorityMismatchResult<StoredAttemptAuthorityMismatchReasonV1>
  | StoredAuthorityCorruptionResult<StoredAttemptCorruptionReasonV1>;

export interface StoredAttemptEvidenceLoaderV1 {
  readonly loadEffect: (
    authority: StoredAttemptEvidenceAuthorityV1,
  ) => Effect.Effect<
    StoredAttemptEvidenceLoadResultV1,
    StoredAttemptEvidencePersistenceV1Error
  >;
}

export interface StoredAttemptFinishingEvidenceLoaderV1
  extends StoredAttemptEvidenceLoaderV1 {
  readonly loadFinishingEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    StoredAttemptEvidenceLoadResultV1,
    StoredAttemptEvidencePersistenceV1Error
  >;
}

export type StoredAttemptEvidencePersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "repeatableRead"
  | "afterRepeatableRead";

export class StoredAttemptEvidencePersistenceV1Error extends Data.TaggedError(
  "StoredAttemptEvidencePersistenceV1Error",
)<{
  readonly operation: StoredAttemptEvidencePersistenceOperationV1;
  readonly cause: unknown;
}> {}

export interface StoredAttemptEvidenceLoaderOptionsV1 {
  /** Test-only: runs after rows are detached but before the RR callback exits. */
  readonly beforeRepeatableReadClose?: () => void | Promise<void>;
  /** Test-only observation after the read-only transaction has settled. */
  readonly afterRepeatableRead?: () => void | Promise<void>;
  /** Test-only capture of the exact Drizzle statements executed by the loader. */
  readonly observeQuery?: (query: StoredAttemptEvidenceQueryV1) => void;
}

export interface StoredAttemptEvidenceQueryV1 {
  readonly name: "clock" | "databaseTime" | "session" | "lease" | "root" |
    "executionClaim" | "points";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

interface CapturedStoredAttemptRowsV1 {
  readonly clockRows: ReadonlyArray<ScopeClockRow>;
  readonly databaseNowText: string | undefined;
  readonly sessionRows: ReadonlyArray<StoredAttemptSessionProjectionV1>;
  readonly leaseRows: ReadonlyArray<SnapshotLeaseRow>;
  readonly rootRows: ReadonlyArray<JournalRootRow>;
  readonly executionClaimRows: ReadonlyArray<
    typeof fxSystemTransactionExecutionClaims.$inferSelect
  >;
  readonly pointRows: ReadonlyArray<JournalPointRow>;
}

type StoredAttemptSessionProjectionV1 = Readonly<
  Pick<
    TransactionSessionRow,
    | "scopeUuid"
    | "sessionId"
    | "storageGeneration"
    | "storageGenerationFence"
    | "executionAuthorityGeneration"
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "functionPath"
    | "functionKind"
    | "schemaVersionId"
    | "policyVersion"
    | "identityAccessPolicySha256"
    | "validatedArgsValueCodecVersion"
    | "validatedArgsSha256"
    | "authorizationGrantId"
    | "authorizationGrantValueCodecVersion"
    | "authorizationGrantSha256"
    | "authorizationRevocationEpoch"
    | "authorizationGrantExpiresAt"
    | "requestKey"
    | "requestSha256"
    | "lifecycle"
    | "attemptFence"
    | "protocolVersion"
    | "hardExpiresAt"
    | "createdAt"
    | "updatedAt"
  > & {
    readonly validatedArgsCanonicalByteLength: number;
    readonly authorizationGrantCanonicalByteLength: number;
  }
>;

type StoredAttemptEvidenceRequestV1 =
  | Readonly<{
      readonly kind: "expectedAuthority";
      readonly authority: StoredAttemptEvidenceAuthorityV1;
    }>
  | Readonly<{
      readonly kind: "finishingRecovery";
      readonly selector: PointMutationSessionAttemptSelectorV1;
    }>;

export function createStoredAttemptEvidenceLoaderV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: StoredAttemptEvidenceLoaderOptionsV1 = {},
): StoredAttemptFinishingEvidenceLoaderV1 {
  const loadRequestEffect = Effect.fn("StoredAttemptEvidence.load")(
    function* (
    request: StoredAttemptEvidenceRequestV1,
    ): Effect.fn.Return<
      StoredAttemptEvidenceLoadResultV1,
      StoredAttemptEvidencePersistenceV1Error
    > {
    const selector = request.kind === "expectedAuthority"
      ? request.authority
      : request.selector;
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      selector.deploymentId,
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(
      Effect.catchTag(
        "TrustedScopeAuthorityResolutionError",
        () => Effect.succeed(null),
      ),
      Effect.mapError((error) =>
        new StoredAttemptEvidencePersistenceV1Error({
          operation: error.operation,
          cause: error.cause,
        })
      ),
    );
    if (located === null) {
      return authorityMismatch("placementChanged");
    }
    if (located.authority.scopeId !== selector.scopeId) {
      return authorityMismatch("scopeChanged");
    }
    if (request.kind === "expectedAuthority") {
      const authority = request.authority;
      if (
        located.authority.storageGeneration !== authority.storageGeneration ||
        located.authority.storageGenerationFence !==
          authority.storageGenerationFence
      ) {
        return authorityMismatch("generationChanged");
      }
      if (located.authority.epoch !== authority.snapshotToken.epoch) {
        return authorityMismatch("epochChanged");
      }
    }
    const repeatableReadTarget = isLocatedRepeatableReadAttemptTargetV1(
      located.target,
    ) ? located.target : null;
    if (repeatableReadTarget === null) {
      return corrupt("repeatableReadCapabilityMissing");
    }

    const captured = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => repeatableReadTarget[RUN_LOCATED_REPEATABLE_READ_V1](async (tx) => {
        const rows = await captureStoredAttemptRows(
          tx,
          selector,
          options.observeQuery,
        );
        await options.beforeRepeatableReadClose?.();
        return rows;
      }),
      catch: (cause) => new StoredAttemptEvidencePersistenceV1Error({
        operation: "repeatableRead",
        cause,
      }),
    }));
    if (options.afterRepeatableRead !== undefined) {
      yield* Effect.tryPromise({
        try: async () => options.afterRepeatableRead?.(),
        catch: (cause) => new StoredAttemptEvidencePersistenceV1Error({
          operation: "afterRepeatableRead",
          cause,
        }),
      });
    }
    return materializeStoredAttemptEvidence(
      request,
      located.authority,
      captured,
    );
  });

  const loadEffect: StoredAttemptEvidenceLoaderV1["loadEffect"] = Effect.fn(
    "StoredAttemptEvidence.loadExpectedAuthority",
  )(function* (input) {
    return yield* loadRequestEffect(Object.freeze({
      kind: "expectedAuthority" as const,
      authority: captureAuthority(input),
    }));
  });
  const loadFinishingEffect:
    StoredAttemptFinishingEvidenceLoaderV1["loadFinishingEffect"] = Effect.fn(
      "StoredAttemptEvidence.loadFinishing",
    )(function* (input) {
      return yield* loadRequestEffect(Object.freeze({
        kind: "finishingRecovery" as const,
        selector: captureSelector(input),
      }));
    });

  return Object.freeze({
    loadEffect,
    loadFinishingEffect,
  });
}

function captureAuthority(
  input: StoredAttemptEvidenceAuthorityV1,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    sessionId: input.sessionId,
    attemptFence: input.attemptFence,
    storageGeneration: input.storageGeneration,
    storageGenerationFence: input.storageGenerationFence,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
    schemaVersionId: input.schemaVersionId,
    ...(input.executionClaim === undefined
      ? {}
      : { executionClaim: Object.freeze({ ...input.executionClaim }) }),
  });
}

function captureSelector(
  input: PointMutationSessionAttemptSelectorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    sessionId: input.sessionId,
    attemptFence: input.attemptFence,
  });
}

async function captureStoredAttemptRows(
  tx: AppRowTransaction,
  selector: PointMutationSessionAttemptSelectorV1,
  observeQuery: StoredAttemptEvidenceLoaderOptionsV1["observeQuery"],
): Promise<CapturedStoredAttemptRowsV1> {
  const clockQuery = tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, selector.scopeId))
    .limit(2);
  observeStoredAttemptQuery("clock", clockQuery, observeQuery);
  const clockRows = await clockQuery;
  const nowQuery = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, selector.scopeId))
    .limit(1);
  observeStoredAttemptQuery("databaseTime", nowQuery, observeQuery);
  const nowRows = await nowQuery;
  const scopeUuid = clockRows[0]?.scopeUuid;
  if (scopeUuid === undefined || scopeUuid === null) {
    return Object.freeze({
      clockRows: detachDriverRows(clockRows),
      databaseNowText: nowRows[0]?.milliseconds,
      sessionRows: Object.freeze([]),
      leaseRows: Object.freeze([]),
      rootRows: Object.freeze([]),
      executionClaimRows: Object.freeze([]),
      pointRows: Object.freeze([]),
    });
  }

  const sessionRows = await selectStoredAttemptSessionRows(
    tx,
    scopeUuid,
    selector.sessionId,
    observeQuery,
  );
  const leaseQuery = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, selector.sessionId),
    ))
    .limit(2);
  observeStoredAttemptQuery("lease", leaseQuery, observeQuery);
  const leaseRows = await leaseQuery;
  const rootQuery = tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, selector.sessionId),
      eq(
        fxSystemTransactionJournals.attemptFence,
        selector.attemptFence,
      ),
    ))
    .limit(2);
  observeStoredAttemptQuery("root", rootQuery, observeQuery);
  const rootRows = await rootQuery;
  const executionClaimQuery = tx
    .select()
    .from(fxSystemTransactionExecutionClaims)
    .where(and(
      eq(fxSystemTransactionExecutionClaims.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionExecutionClaims.sessionId,
        selector.sessionId,
      ),
      eq(
        fxSystemTransactionExecutionClaims.attemptFence,
        selector.attemptFence,
      ),
    ))
    .limit(2);
  observeStoredAttemptQuery(
    "executionClaim",
    executionClaimQuery,
    observeQuery,
  );
  const executionClaimRows = await executionClaimQuery;
  const pointQuery = tx
    .select()
    .from(fxSystemTransactionJournalPoints)
    .where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournalPoints.sessionId, selector.sessionId),
      eq(
        fxSystemTransactionJournalPoints.attemptFence,
        selector.attemptFence,
      ),
    ))
    .orderBy(
      asc(fxSystemTransactionJournalPoints.tableId),
      asc(fxSystemTransactionJournalPoints.rowId),
    )
    .limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1);
  observeStoredAttemptQuery("points", pointQuery, observeQuery);
  const pointRows = await pointQuery;

  return Object.freeze({
    clockRows: detachDriverRows(clockRows),
    databaseNowText: nowRows[0]?.milliseconds,
    sessionRows: detachDriverRows(sessionRows),
    leaseRows: detachDriverRows(leaseRows),
    rootRows: detachDriverRows(rootRows),
    executionClaimRows: detachDriverRows(executionClaimRows),
    pointRows: detachDriverRows(pointRows),
  });
}

async function selectStoredAttemptSessionRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  observeQuery: StoredAttemptEvidenceLoaderOptionsV1["observeQuery"],
): Promise<ReadonlyArray<StoredAttemptSessionProjectionV1>> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      storageGeneration: fxSystemTransactionSessions.storageGeneration,
      storageGenerationFence:
        fxSystemTransactionSessions.storageGenerationFence,
      executionAuthorityGeneration:
        fxSystemTransactionSessions.executionAuthorityGeneration,
      packageId: fxSystemTransactionSessions.packageId,
      artifactRuntime: fxSystemTransactionSessions.artifactRuntime,
      artifactId: fxSystemTransactionSessions.artifactId,
      sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
      executionModule: fxSystemTransactionSessions.executionModule,
      functionPath: fxSystemTransactionSessions.functionPath,
      functionKind: fxSystemTransactionSessions.functionKind,
      schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
      policyVersion: fxSystemTransactionSessions.policyVersion,
      identityAccessPolicySha256:
        fxSystemTransactionSessions.identityAccessPolicySha256,
      validatedArgsValueCodecVersion:
        fxSystemTransactionSessions.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: sql<number>`
        octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})
      `,
      validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
      authorizationGrantId:
        fxSystemTransactionSessions.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength: sql<number>`
        octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})
      `,
      authorizationGrantSha256:
        fxSystemTransactionSessions.authorizationGrantSha256,
      authorizationRevocationEpoch:
        fxSystemTransactionSessions.authorizationRevocationEpoch,
      authorizationGrantExpiresAt:
        fxSystemTransactionSessions.authorizationGrantExpiresAt,
      requestKey: fxSystemTransactionSessions.requestKey,
      requestSha256: fxSystemTransactionSessions.requestSha256,
      lifecycle: fxSystemTransactionSessions.lifecycle,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      protocolVersion: fxSystemTransactionSessions.protocolVersion,
      hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
      createdAt: fxSystemTransactionSessions.createdAt,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    })
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, sessionId),
    ))
    .limit(2);
  observeStoredAttemptQuery("session", query, observeQuery);
  return query;
}

function decodeStoredAttemptClockAuthorityResult(row: ScopeClockRow) {
  return Result.gen(function* () {
    const clock = yield* decodeScopeClockRecordResult(row);
    const scopeUuid = yield* decodeStoredAttemptScopeUuidResult(row.scopeUuid);
    const epochUuid = yield* decodeStoredAttemptScopeEpochUuidResult(
      row.epochUuid,
    );
    const revocationEpoch = yield* decodeStoredAttemptRevocationEpochResult(
      row.authorizationRevocationEpoch,
    );
    return { clock, scopeUuid, epochUuid, revocationEpoch };
  });
}

function decodeStoredAttemptSessionIdentityResult(
  session: StoredAttemptSessionProjectionV1,
) {
  return Result.gen(function* () {
    const sessionId = yield* decodeStoredAttemptSessionIdResult(
      session.sessionId,
    );
    const attemptFence = yield* decodeStoredAttemptFenceResult(
      session.attemptFence,
    );
    const storageGenerationFence =
      yield* decodeStoredAttemptStorageGenerationFenceResult(
        session.storageGenerationFence,
      );
    return { sessionId, attemptFence, storageGenerationFence };
  });
}

function decodeStoredAttemptLeaseSnapshotResult(
  lease: SnapshotLeaseRow,
  scopeId: ReplacementScopeIdV1,
): Result.Result<SnapshotToken, Schema.SchemaError> {
  return Result.gen(function* () {
    const epochUuid = yield* decodeStoredAttemptScopeEpochUuidResult(
      lease.snapshotEpochUuid,
    );
    const commitSeq = yield* decodeStoredAttemptCommitSeqResult(
      lease.snapshotCommitSeq,
    );
    return yield* decodeStoredAttemptSnapshotTokenResult({
      scopeId,
      epoch: `epoch_${epochUuid}`,
      commitSeq,
    });
  });
}

function materializeStoredAttemptEvidence(
  request: StoredAttemptEvidenceRequestV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedStoredAttemptRowsV1,
): StoredAttemptEvidenceLoadResultV1 {
  const selector = request.kind === "expectedAuthority"
    ? request.authority
    : request.selector;
  if (captured.clockRows.length !== 1) {
    return corrupt("scopeClockMissingOrDuplicate");
  }
  const clockRow = captured.clockRows[0];
  if (clockRow === undefined) {
    return corrupt("scopeClockMissingOrDuplicate");
  }
  const decodedClockAuthority = decodeStoredAttemptClockAuthorityResult(
    clockRow,
  );
  if (Result.isFailure(decodedClockAuthority)) {
    return corrupt("sessionRecordInvalid", decodedClockAuthority.failure);
  }
  const { clock, scopeUuid, epochUuid, revocationEpoch } =
    decodedClockAuthority.success;
  const selectorScopeProjection = projectScopeIdUuidV1Result(selector.scopeId);
  if (Result.isFailure(selectorScopeProjection)) {
    return corrupt("sessionRecordInvalid", selectorScopeProjection.failure);
  }
  const clockEpochProjection = projectScopeEpochUuidV1Result(clock.epoch);
  if (Result.isFailure(clockEpochProjection)) {
    return corrupt("sessionRecordInvalid", clockEpochProjection.failure);
  }
  if (
    scopeUuid !== selectorScopeProjection.success.scopeUuid ||
    epochUuid !== clockEpochProjection.success.epochUuid ||
    clock.scopeId !== selector.scopeId ||
    preliminary.scopeId !== selector.scopeId
  ) {
    return authorityMismatch("scopeChanged");
  }
  const expectedStorageGeneration = request.kind === "expectedAuthority"
    ? request.authority.storageGeneration
    : clock.storageGeneration;
  const expectedStorageGenerationFence = request.kind === "expectedAuthority"
    ? request.authority.storageGenerationFence
    : clock.storageGenerationFence;
  if (
    clock.storageGeneration !== expectedStorageGeneration ||
    clock.storageGenerationFence !== expectedStorageGenerationFence ||
    preliminary.storageGeneration !== expectedStorageGeneration ||
    preliminary.storageGenerationFence !== expectedStorageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  const expectedEpoch = request.kind === "expectedAuthority"
    ? request.authority.snapshotToken.epoch
    : clock.epoch;
  if (
    clock.epoch !== expectedEpoch ||
    preliminary.epoch !== expectedEpoch
  ) {
    return authorityMismatch("epochChanged");
  }
  const databaseNowMilliseconds = decodeDatabaseNow(
    captured.databaseNowText,
  );
  if (databaseNowMilliseconds === undefined) {
    return corrupt("databaseClockInvalid");
  }

  if (captured.sessionRows.length === 0) {
    return authorityMismatch("attemptMissing");
  }
  if (captured.sessionRows.length !== 1) {
    return corrupt("sessionRecordDuplicate");
  }
  const session = captured.sessionRows[0];
  if (session === undefined) {
    return corrupt("sessionRecordDuplicate");
  }
  const decodedSessionIdentity = decodeStoredAttemptSessionIdentityResult(
    session,
  );
  if (Result.isFailure(decodedSessionIdentity)) {
    return corrupt("sessionRecordInvalid", decodedSessionIdentity.failure);
  }
  const { sessionId, attemptFence, storageGenerationFence } =
    decodedSessionIdentity.success;
  if (
    session.scopeUuid !== scopeUuid ||
    sessionId !== selector.sessionId
  ) {
    return authorityMismatch("attemptMissing");
  }
  if (attemptFence !== selector.attemptFence) {
    return authorityMismatch("attemptReplaced");
  }
  if (
    session.storageGeneration !== expectedStorageGeneration ||
    storageGenerationFence !== expectedStorageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  const decodedSchemaVersionId = decodeStoredAttemptSchemaVersionIdResult(
    session.schemaVersionId,
  );
  if (Result.isFailure(decodedSchemaVersionId)) {
    return corrupt("sessionRecordInvalid", decodedSchemaVersionId.failure);
  }
  const schemaVersionId: CatalogSchemaVersionId =
    decodedSchemaVersionId.success;
  if (
    request.kind === "expectedAuthority" &&
    schemaVersionId !== request.authority.schemaVersionId
  ) return authorityMismatch("schemaChanged");
  if (session.authorizationRevocationEpoch !== revocationEpoch) {
    return authorityMismatch("revocationEpochChanged");
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const createdAtMilliseconds = finiteDateMilliseconds(session.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(session.updatedAt);
  if (
    session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds ||
    updatedAtMilliseconds < createdAtMilliseconds ||
    !isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32) ||
    !isUint8ArrayWithByteLength(session.validatedArgsSha256, 32) ||
    !isUint8ArrayWithByteLength(session.authorizationGrantSha256, 32) ||
    !isUint8ArrayWithByteLength(session.requestSha256, 32) ||
    !isPositiveSafeInteger(session.validatedArgsCanonicalByteLength) ||
    !isPositiveSafeInteger(session.authorizationGrantCanonicalByteLength)
  ) {
    return corrupt("sessionRecordInvalid");
  }
  if (
    session.executionAuthorityGeneration !== "legacy_dynamic_worker_v1" ||
    session.packageId === null ||
    session.artifactRuntime === null ||
    session.artifactId === null ||
    session.sourcePackageHash === null ||
    session.executionModule === null
  ) return corrupt("sessionRecordInvalid");
  if (session.lifecycle === "committed") {
    return Object.freeze({
      kind: "alreadyCommitted",
      updatedAtMilliseconds,
    });
  }
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    return Object.freeze({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: session.lifecycle,
    });
  }
  if (
    request.kind === "finishingRecovery" &&
    session.lifecycle !== "finishing"
  ) {
    return Object.freeze({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: session.lifecycle,
    });
  }
  if (
    request.kind === "expectedAuthority" &&
    session.lifecycle !== "running"
  ) {
    return Object.freeze({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: session.lifecycle,
    });
  }
  const observedSealedRoot = captured.rootRows.length === 1
    ? captured.rootRows[0]
    : undefined;
  const observedSealedLease = captured.leaseRows.length === 1
    ? captured.leaseRows[0]
    : undefined;
  const observedSealedLeaseExpiresAtMilliseconds = observedSealedLease ===
      undefined
    ? undefined
    : finiteDateMilliseconds(observedSealedLease.leaseExpiresAt);
  if (
    observedSealedRoot?.state === "sealed" &&
    observedSealedLease !== undefined &&
    observedSealedLeaseExpiresAtMilliseconds !== Math.min(
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
    )
  ) {
    return corrupt("snapshotLeaseInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    return Object.freeze({ kind: "notPlannable", reason: "expired" });
  }

  if (captured.leaseRows.length !== 1) {
    return corrupt("snapshotLeaseMissingOrDuplicate");
  }
  const lease = captured.leaseRows[0];
  if (lease === undefined) {
    return corrupt("snapshotLeaseMissingOrDuplicate");
  }
  const decodedLeaseSnapshot = decodeStoredAttemptLeaseSnapshotResult(
    lease,
    selector.scopeId,
  );
  if (Result.isFailure(decodedLeaseSnapshot)) {
    return corrupt("sessionRecordInvalid", decodedLeaseSnapshot.failure);
  }
  const leaseSnapshot = decodedLeaseSnapshot.success;
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    lease.scopeUuid !== scopeUuid ||
    lease.sessionId !== selector.sessionId ||
    lease.attemptFence !== selector.attemptFence ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds ||
    leaseSnapshot.commitSeq > clock.lastCommitSeq
  ) {
    return corrupt("snapshotLeaseInvalid");
  }
  const expectedSnapshotToken = request.kind === "expectedAuthority"
    ? request.authority.snapshotToken
    : Object.freeze({
        scopeId: selector.scopeId,
        epoch: clock.epoch,
        commitSeq: leaseSnapshot.commitSeq,
      });
  if (
    leaseSnapshot.scopeId !== expectedSnapshotToken.scopeId ||
    leaseSnapshot.epoch !== expectedSnapshotToken.epoch ||
    leaseSnapshot.commitSeq !== expectedSnapshotToken.commitSeq
  ) {
    return authorityMismatch("snapshotChanged");
  }
  if (leaseExpiresAtMilliseconds <= databaseNowMilliseconds) {
    return Object.freeze({ kind: "notPlannable", reason: "expired" });
  }

  if (captured.rootRows.length !== 1) {
    return corrupt("journalRootMissingOrDuplicate");
  }
  const root = captured.rootRows[0];
  if (root === undefined) {
    return corrupt("journalRootMissingOrDuplicate");
  }
  if (root.state !== "sealed") {
    return Object.freeze({
      kind: "notPlannable",
      reason: "rootNotSealed",
      rootState: root.state,
    });
  }
  if (
    leaseExpiresAtMilliseconds !== Math.min(
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
    )
  ) {
    return corrupt("snapshotLeaseInvalid");
  }
  const sealedRoot = captureSealedRoot(root);
  if (sealedRoot === undefined) {
    return corrupt("journalRootInvalid");
  }
  const executionClaimEvidence = classifyExecutionClaimEvidence(
    captured.executionClaimRows,
    request,
    scopeUuid,
    selector.sessionId,
    selector.attemptFence,
    databaseNowMilliseconds,
  );
  if (executionClaimEvidence === "mismatch") {
    return authorityMismatch("executionClaimChanged");
  }
  if (executionClaimEvidence === "expired") {
    return Object.freeze({ kind: "notPlannable", reason: "expired" });
  }
  if (executionClaimEvidence === "corrupt") {
    return corrupt("executionClaimInvalid");
  }
  if (captured.pointRows.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return corrupt("pointEvidenceOverflow");
  }
  if (captured.pointRows.length !== sealedRoot.pointDependencyCount) {
    return corrupt("pointEvidenceInvalid");
  }
  const points = capturePoints(
    captured.pointRows,
    scopeUuid,
    selector.sessionId,
    selector.attemptFence,
  );
  if (points === undefined) {
    return corrupt("pointEvidenceInvalid");
  }

  return Object.freeze({
    kind: "loaded",
    evidence: Object.freeze({
      deploymentId: selector.deploymentId,
      scopeId: selector.scopeId,
      scopeUuid,
      sessionId: selector.sessionId,
      attemptFence: selector.attemptFence,
      databaseNowMilliseconds,
      session: captureSessionScalars(session, {
        packageId: session.packageId,
        artifactRuntime: session.artifactRuntime,
        artifactId: session.artifactId,
        sourcePackageHash: session.sourcePackageHash,
        executionModule: session.executionModule,
        authorizationGrantExpiresAtMilliseconds,
        hardExpiresAtMilliseconds,
        createdAtMilliseconds,
        updatedAtMilliseconds,
      }),
      lease: Object.freeze({
        snapshotToken: Object.freeze({ ...leaseSnapshot }),
        leaseExpiresAtMilliseconds,
      }),
      root: sealedRoot,
      points,
    }),
  });
}

function classifyExecutionClaimEvidence(
  rows: CapturedStoredAttemptRowsV1["executionClaimRows"],
  request: StoredAttemptEvidenceRequestV1,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  databaseNowMilliseconds: number,
): "valid" | "mismatch" | "expired" | "corrupt" {
  if (request.kind === "finishingRecovery") {
    return rows.length === 0 ? "valid" : "corrupt";
  }
  if (rows.length !== 1) return "corrupt";
  const row = rows[0];
  if (row === undefined) return "corrupt";
  const owner = decodeTransactionExecutionClaimOwnerV1(row.claimOwner);
  const fence = decodeTransactionExecutionClaimFenceV1(row.claimFence);
  const claimedAtMilliseconds = finiteDateMilliseconds(row.claimedAt);
  const expiresAtMilliseconds = finiteDateMilliseconds(row.claimExpiresAt);
  if (
    Result.isFailure(owner) ||
    Result.isFailure(fence) ||
    claimedAtMilliseconds === undefined ||
    expiresAtMilliseconds === undefined ||
    row.scopeUuid !== scopeUuid ||
    row.sessionId !== sessionId ||
    row.attemptFence !== attemptFence ||
    expiresAtMilliseconds <= claimedAtMilliseconds ||
    claimedAtMilliseconds > databaseNowMilliseconds
  ) return "corrupt";
  if (expiresAtMilliseconds <= databaseNowMilliseconds) return "expired";
  const expected = request.authority.executionClaim;
  if (expected === undefined) return "corrupt";
  return owner.success === expected.claimOwner &&
      fence.success === expected.claimFence
    ? "valid"
    : "mismatch";
}

function captureSessionScalars(
  session: StoredAttemptSessionProjectionV1,
  timestamps: Readonly<{
    packageId: NonNullable<StoredAttemptSessionProjectionV1["packageId"]>;
    artifactRuntime: NonNullable<
      StoredAttemptSessionProjectionV1["artifactRuntime"]
    >;
    artifactId: NonNullable<StoredAttemptSessionProjectionV1["artifactId"]>;
    sourcePackageHash: NonNullable<
      StoredAttemptSessionProjectionV1["sourcePackageHash"]
    >;
    executionModule: NonNullable<
      StoredAttemptSessionProjectionV1["executionModule"]
    >;
    authorizationGrantExpiresAtMilliseconds: number;
    hardExpiresAtMilliseconds: number;
    createdAtMilliseconds: number;
    updatedAtMilliseconds: number;
  }>,
): StoredAttemptSessionScalarsV1 {
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    throw new Error("Stored attempt session is not active.");
  }
  return Object.freeze({
    lifecycle: session.lifecycle,
    storageGeneration: session.storageGeneration,
    storageGenerationFence: session.storageGenerationFence,
    packageId: timestamps.packageId,
    artifactRuntime: timestamps.artifactRuntime,
    artifactId: timestamps.artifactId,
    sourcePackageHash: timestamps.sourcePackageHash,
    executionModule: timestamps.executionModule,
    functionPath: session.functionPath,
    functionKind: session.functionKind,
    schemaVersionId: session.schemaVersionId,
    policyVersion: session.policyVersion,
    identityAccessPolicySha256: copyBytes(session.identityAccessPolicySha256),
    validatedArgsValueCodecVersion:
      session.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength:
      session.validatedArgsCanonicalByteLength,
    validatedArgsSha256: copyBytes(session.validatedArgsSha256),
    authorizationGrantId: session.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      session.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength:
      session.authorizationGrantCanonicalByteLength,
    authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
    authorizationRevocationEpoch: session.authorizationRevocationEpoch,
    authorizationGrantExpiresAtMilliseconds:
      timestamps.authorizationGrantExpiresAtMilliseconds,
    requestKey: session.requestKey,
    requestSha256: copyBytes(session.requestSha256),
    protocolVersion: session.protocolVersion,
    hardExpiresAtMilliseconds: timestamps.hardExpiresAtMilliseconds,
    createdAtMilliseconds: timestamps.createdAtMilliseconds,
    updatedAtMilliseconds: timestamps.updatedAtMilliseconds,
  });
}

function captureSealedRoot(
  root: JournalRootRow,
): StoredAttemptSealedRootV1 | undefined {
  const createdAtMilliseconds = finiteDateMilliseconds(root.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  const sealedAtMilliseconds = finiteDateMilliseconds(root.sealedAt);
  if (
    root.failureDimension !== null ||
    root.sealedFinalSyscallSequence === null ||
    root.sealedJournalBytes === null ||
    root.sealedJournalSha256 === null ||
    root.sealedResultValueCodecVersion === null ||
    root.sealedResultSemanticBytes === null ||
    root.sealedResultBytes === null ||
    root.sealedResultSha256 === null ||
    root.sealedAt === null ||
    root.sealedFinalSyscallSequence !== root.lastSyscallSequence ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined ||
    sealedAtMilliseconds === undefined ||
    updatedAtMilliseconds < createdAtMilliseconds ||
    sealedAtMilliseconds < createdAtMilliseconds ||
    !isUint8ArrayWithByteLength(root.sealedJournalSha256, 32) ||
    !isUint8ArrayWithByteLength(root.sealedResultSha256, 32) ||
    !isPositiveSafeInteger(root.indexedQuerySyscalls + 1) ||
    root.indexedQuerySyscalls > MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 ||
    !isPositiveSafeInteger(root.indexRangeDependencyCount + 1) ||
    root.indexRangeDependencyCount >
      MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 ||
    !isPositiveSafeInteger(root.indexRangeDependencyEvidenceBytes + 1) ||
    root.indexRangeDependencyEvidenceBytes >
      MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1
  ) {
    return undefined;
  }
  return Object.freeze({
    lastSyscallSequence: root.lastSyscallSequence,
    creationTimeSeed: root.creationTimeSeed,
    nextCreationTime: root.nextCreationTime,
    readDocuments: root.readDocuments,
    readSemanticBytes: root.readSemanticBytes,
    pointDependencyCount: root.pointDependencyCount,
    indexedQuerySyscalls: root.indexedQuerySyscalls,
    indexRangeDependencyCount: root.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes:
      root.indexRangeDependencyEvidenceBytes,
    writeOperations: root.writeOperations,
    writeSemanticBytes: root.writeSemanticBytes,
    materialWriteEventEvidenceBytes: root.materialWriteEventEvidenceBytes,
    sealedFinalSyscallSequence: root.sealedFinalSyscallSequence,
    journalBytes: copyBytes(root.sealedJournalBytes),
    journalSha256: copyBytes(root.sealedJournalSha256),
    resultValueCodecVersion: root.sealedResultValueCodecVersion,
    resultSemanticBytes: root.sealedResultSemanticBytes,
    resultBytes: copyBytes(root.sealedResultBytes),
    resultSha256: copyBytes(root.sealedResultSha256),
    createdAtMilliseconds,
    updatedAtMilliseconds,
    sealedAtMilliseconds,
  });
}

function capturePoints(
  rows: ReadonlyArray<JournalPointRow>,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
): ReadonlyArray<StoredAttemptPointEvidenceV1> | undefined {
  const points: StoredAttemptPointEvidenceV1[] = [];
  for (const row of rows) {
    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
    if (
      row.scopeUuid !== scopeUuid ||
      row.sessionId !== sessionId ||
      row.attemptFence !== attemptFence ||
      createdAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined ||
      updatedAtMilliseconds < createdAtMilliseconds
    ) {
      return undefined;
    }
    let overlayValueBytes: CanonicalFlarexValueBytesV1 | null;
    let overlayValueSha256: FlarexValueSha256V1 | null;
    try {
      overlayValueBytes = row.overlayValueBytes === null
        ? null
        : copyCanonicalFlarexValueBytesV1(row.overlayValueBytes);
      overlayValueSha256 = row.overlayValueSha256 === null
        ? null
        : copyFlarexValueSha256V1(row.overlayValueSha256);
    } catch (cause) {
      if (
        cause instanceof FlarexValueEvidenceV1Error ||
        Schema.isSchemaError(cause)
      ) {
        return undefined;
      }
      throw cause;
    }
    points.push(Object.freeze({
      tableId: row.tableId,
      rowId: copyBytes(row.rowId),
      dependencyKind: row.dependencyKind,
      dependencyRevisionCommitSeq: row.dependencyRevisionCommitSeq,
      overlayKind: row.overlayKind,
      overlayCreationTime: row.overlayCreationTime,
      overlayValueCodecVersion: row.overlayValueCodecVersion,
      overlayValueJson: row.overlayValueJson === null
        ? null
        : structuredClone(row.overlayValueJson),
      overlayValueBytes,
      overlayValueSha256,
      overlaySemanticBytes: row.overlaySemanticBytes,
      createdAtMilliseconds,
      updatedAtMilliseconds,
    }));
  }
  return Object.freeze(points);
}

function decodeDatabaseNow(value: string | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const milliseconds = Number(value);
  if (!isPositiveSafeInteger(milliseconds)) {
    return undefined;
  }
  return milliseconds;
}

function authorityMismatch(
  reason: StoredAttemptAuthorityMismatchReasonV1,
): StoredAttemptEvidenceLoadResultV1 {
  return storedAuthorityMismatchResult(reason);
}

function corrupt(
  reason: StoredAttemptCorruptionReasonV1,
  cause?: unknown,
): StoredAttemptEvidenceLoadResultV1 {
  return storedAuthorityCorruptionResult(reason, cause);
}
