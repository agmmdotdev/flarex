import { copyBytes } from "@flarex/utils/bytes";
import { and, asc, eq, sql } from "drizzle-orm";

import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
} from "flarex-protocol/commit-protocol";
import type { JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
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
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
  type CanonicalFlarexValueBytesV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { AppRowTransaction } from "./appRows";
import {
  resolveLocatedTrustedScopeAuthority,
  TrustedScopeAuthorityResolutionError,
  type TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import { decodeScopeClockRecord } from "./scopeClock";
import {
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
import {
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedRepeatableReadAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "./transactionSessionActivation";

type TransactionSessionRow =
  typeof fxSystemTransactionSessions.$inferSelect;
type SnapshotLeaseRow = typeof fxSystemSnapshotLeases.$inferSelect;
type JournalRootRow = typeof fxSystemTransactionJournals.$inferSelect;
type JournalPointRow = typeof fxSystemTransactionJournalPoints.$inferSelect;
type ScopeClockRow = typeof fxSystemScopeClocks.$inferSelect;

export interface StoredAttemptEvidenceAuthorityV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
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
  | "revocationEpochChanged";

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
  | "pointEvidenceOverflow"
  | "pointEvidenceInvalid";

export interface StoredAttemptSessionScalarsV1 {
  readonly lifecycle: Extract<
    TransactionSessionLifecycleV1,
    "running" | "finishing"
  >;
  readonly storageGeneration: TransactionSessionRow["storageGeneration"];
  readonly storageGenerationFence:
    TransactionSessionRow["storageGenerationFence"];
  readonly packageId: TransactionSessionRow["packageId"];
  readonly artifactRuntime: TransactionSessionRow["artifactRuntime"];
  readonly artifactId: TransactionSessionRow["artifactId"];
  readonly sourcePackageHash: TransactionSessionRow["sourcePackageHash"];
  readonly executionModule: TransactionSessionRow["executionModule"];
  readonly functionPath: TransactionSessionRow["functionPath"];
  readonly functionKind: TransactionSessionRow["functionKind"];
  readonly schemaVersionId: TransactionSessionRow["schemaVersionId"];
  readonly policyVersion: TransactionSessionRow["policyVersion"];
  readonly identityAccessPolicySha256: Uint8Array;
  readonly validatedArgsValueCodecVersion:
    TransactionSessionRow["validatedArgsValueCodecVersion"];
  readonly validatedArgsCanonicalByteLength: number;
  readonly validatedArgsSha256: Uint8Array;
  readonly authorizationGrantId:
    TransactionSessionRow["authorizationGrantId"];
  readonly authorizationGrantValueCodecVersion:
    TransactionSessionRow["authorizationGrantValueCodecVersion"];
  readonly authorizationGrantCanonicalByteLength: number;
  readonly authorizationGrantSha256: Uint8Array;
  readonly authorizationRevocationEpoch:
    TransactionSessionRow["authorizationRevocationEpoch"];
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly requestKey: TransactionSessionRow["requestKey"];
  readonly requestSha256: Uint8Array;
  readonly protocolVersion: TransactionSessionRow["protocolVersion"];
  readonly hardExpiresAtMilliseconds: number;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

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
  | Readonly<{
      readonly kind: "authorityMismatch";
      readonly reason: StoredAttemptAuthorityMismatchReasonV1;
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredAttemptCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export interface StoredAttemptEvidenceLoaderV1 {
  readonly load: (
    authority: StoredAttemptEvidenceAuthorityV1,
  ) => Promise<StoredAttemptEvidenceLoadResultV1>;
}

export interface StoredAttemptEvidenceLoaderOptionsV1 {
  /** Test-only observation after the read-only transaction has settled. */
  readonly afterRepeatableRead?: () => void | Promise<void>;
  /** Test-only capture of the exact Drizzle statements executed by the loader. */
  readonly observeQuery?: (query: StoredAttemptEvidenceQueryV1) => void;
}

export interface StoredAttemptEvidenceQueryV1 {
  readonly name: "clock" | "databaseTime" | "session" | "lease" | "root" |
    "points";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

interface CapturedStoredAttemptRowsV1 {
  readonly clockRows: ReadonlyArray<ScopeClockRow>;
  readonly databaseNowText: string | undefined;
  readonly sessionRows: ReadonlyArray<StoredAttemptSessionProjectionV1>;
  readonly leaseRows: ReadonlyArray<SnapshotLeaseRow>;
  readonly rootRows: ReadonlyArray<JournalRootRow>;
  readonly pointRows: ReadonlyArray<JournalPointRow>;
}

type StoredAttemptSessionProjectionV1 = Readonly<
  Pick<
    TransactionSessionRow,
    | "scopeUuid"
    | "sessionId"
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

export function createStoredAttemptEvidenceLoaderV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: StoredAttemptEvidenceLoaderOptionsV1 = {},
): StoredAttemptEvidenceLoaderV1 {
  return Object.freeze({
    load: async (
      input: StoredAttemptEvidenceAuthorityV1,
    ): Promise<StoredAttemptEvidenceLoadResultV1> => {
      const authority = captureAuthority(input);
      let located: Awaited<
        ReturnType<typeof resolveLocatedTrustedScopeAuthority>
      >;
      try {
        located = await resolveLocatedTrustedScopeAuthority(
          authority.deploymentId,
          {
            scopeMetadata: ports.scopeMetadata,
            provisioningReceipts: ports.provisioningReceipts,
            scopeClockTargets: ports.scopeSessionTargets,
          },
        );
      } catch (cause) {
        if (cause instanceof TrustedScopeAuthorityResolutionError) {
          return authorityMismatch("placementChanged");
        }
        throw cause;
      }
      if (located.authority.scopeId !== authority.scopeId) {
        return authorityMismatch("scopeChanged");
      }
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
      if (!isLocatedRepeatableReadAttemptTargetV1(located.target)) {
        return corrupt("repeatableReadCapabilityMissing");
      }

      const captured = await located.target[RUN_LOCATED_REPEATABLE_READ_V1](
        (tx) => captureStoredAttemptRows(
          tx,
          authority,
          options.observeQuery,
        ),
      );
      await options.afterRepeatableRead?.();
      return materializeStoredAttemptEvidence(
        authority,
        located.authority,
        captured,
      );
    },
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
  });
}

async function captureStoredAttemptRows(
  tx: AppRowTransaction,
  authority: StoredAttemptEvidenceAuthorityV1,
  observeQuery: StoredAttemptEvidenceLoaderOptionsV1["observeQuery"],
): Promise<CapturedStoredAttemptRowsV1> {
  const clockQuery = tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, authority.scopeId))
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
    .where(eq(fxSystemScopeClocks.scopeId, authority.scopeId))
    .limit(1);
  observeStoredAttemptQuery("databaseTime", nowQuery, observeQuery);
  const nowRows = await nowQuery;
  const scopeUuid = clockRows[0]?.scopeUuid;
  if (scopeUuid === undefined || scopeUuid === null) {
    return Object.freeze({
      clockRows: Object.freeze(structuredClone(clockRows)),
      databaseNowText: nowRows[0]?.milliseconds,
      sessionRows: Object.freeze([]),
      leaseRows: Object.freeze([]),
      rootRows: Object.freeze([]),
      pointRows: Object.freeze([]),
    });
  }

  const sessionRows = await selectStoredAttemptSessionRows(
    tx,
    scopeUuid,
    authority.sessionId,
    observeQuery,
  );
  const leaseQuery = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, authority.sessionId),
    ))
    .limit(2);
  observeStoredAttemptQuery("lease", leaseQuery, observeQuery);
  const leaseRows = await leaseQuery;
  const rootQuery = tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, authority.sessionId),
      eq(
        fxSystemTransactionJournals.attemptFence,
        authority.attemptFence,
      ),
    ))
    .limit(2);
  observeStoredAttemptQuery("root", rootQuery, observeQuery);
  const rootRows = await rootQuery;
  const pointQuery = tx
    .select()
    .from(fxSystemTransactionJournalPoints)
    .where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournalPoints.sessionId, authority.sessionId),
      eq(
        fxSystemTransactionJournalPoints.attemptFence,
        authority.attemptFence,
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
    clockRows: Object.freeze(structuredClone(clockRows)),
    databaseNowText: nowRows[0]?.milliseconds,
    sessionRows: Object.freeze(structuredClone(sessionRows)),
    leaseRows: Object.freeze(structuredClone(leaseRows)),
    rootRows: Object.freeze(structuredClone(rootRows)),
    pointRows: Object.freeze(structuredClone(pointRows)),
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

function observeStoredAttemptQuery(
  name: StoredAttemptEvidenceQueryV1["name"],
  query: Readonly<{
    toSQL: () => Readonly<{ sql: string; params: ReadonlyArray<unknown> }>;
  }>,
  observer: StoredAttemptEvidenceLoaderOptionsV1["observeQuery"],
): void {
  if (observer === undefined) return;
  const compiled = query.toSQL();
  observer(Object.freeze({
    name,
    sql: compiled.sql,
    params: Object.freeze(structuredClone(compiled.params)),
  }));
}

function materializeStoredAttemptEvidence(
  expected: StoredAttemptEvidenceAuthorityV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedStoredAttemptRowsV1,
): StoredAttemptEvidenceLoadResultV1 {
  try {
    return materializeStoredAttemptEvidenceUnsafe(
      expected,
      preliminary,
      captured,
    );
  } catch (cause) {
    return corrupt("sessionRecordInvalid", cause);
  }
}

function materializeStoredAttemptEvidenceUnsafe(
  expected: StoredAttemptEvidenceAuthorityV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedStoredAttemptRowsV1,
): StoredAttemptEvidenceLoadResultV1 {
  if (captured.clockRows.length !== 1) {
    return corrupt("scopeClockMissingOrDuplicate");
  }
  const clockRow = captured.clockRows[0];
  if (clockRow === undefined) {
    return corrupt("scopeClockMissingOrDuplicate");
  }
  const clock = decodeScopeClockRecord(clockRow);
  const scopeUuid = decodeScopeUuidV1(clockRow.scopeUuid);
  const epochUuid = decodeScopeEpochUuidV1(clockRow.epochUuid);
  const revocationEpoch = TransactionAuthorizationRevocationEpochSchema.make(
    clockRow.authorizationRevocationEpoch,
  );
  if (
    scopeUuid !== projectScopeIdUuidV1(expected.scopeId).scopeUuid ||
    epochUuid !== projectScopeEpochUuidV1(clock.epoch).epochUuid ||
    clock.scopeId !== expected.scopeId ||
    preliminary.scopeId !== expected.scopeId
  ) {
    return authorityMismatch("scopeChanged");
  }
  if (
    clock.storageGeneration !== expected.storageGeneration ||
    clock.storageGenerationFence !== expected.storageGenerationFence ||
    preliminary.storageGeneration !== expected.storageGeneration ||
    preliminary.storageGenerationFence !== expected.storageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  if (
    clock.epoch !== expected.snapshotToken.epoch ||
    preliminary.epoch !== expected.snapshotToken.epoch
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
  const sessionId = TransactionSessionIdV1Schema.make(session.sessionId);
  const attemptFence = TransactionAttemptFenceSchema.make(
    session.attemptFence,
  );
  const storageGenerationFence = StorageGenerationFenceSchema.make(
    session.storageGenerationFence,
  );
  if (
    session.scopeUuid !== scopeUuid ||
    sessionId !== expected.sessionId
  ) {
    return authorityMismatch("attemptMissing");
  }
  if (attemptFence !== expected.attemptFence) {
    return authorityMismatch("attemptReplaced");
  }
  if (
    session.storageGeneration !== expected.storageGeneration ||
    storageGenerationFence !== expected.storageGenerationFence
  ) {
    return authorityMismatch("generationChanged");
  }
  if (session.schemaVersionId !== expected.schemaVersionId) {
    return authorityMismatch("schemaChanged");
  }
  if (session.authorizationRevocationEpoch !== revocationEpoch) {
    return authorityMismatch("revocationEpochChanged");
  }
  if (
    session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    !validDate(session.authorizationGrantExpiresAt) ||
    !validDate(session.hardExpiresAt) ||
    !validDate(session.createdAt) ||
    !validDate(session.updatedAt) ||
    session.hardExpiresAt.getTime() !==
      session.authorizationGrantExpiresAt.getTime() ||
    session.updatedAt.getTime() < session.createdAt.getTime() ||
    !validByteLength(session.identityAccessPolicySha256, 32) ||
    !validByteLength(session.validatedArgsSha256, 32) ||
    !validByteLength(session.authorizationGrantSha256, 32) ||
    !validByteLength(session.requestSha256, 32) ||
    !positiveSafeInteger(session.validatedArgsCanonicalByteLength) ||
    !positiveSafeInteger(session.authorizationGrantCanonicalByteLength)
  ) {
    return corrupt("sessionRecordInvalid");
  }
  if (session.lifecycle === "committed") {
    return Object.freeze({
      kind: "alreadyCommitted",
      updatedAtMilliseconds: session.updatedAt.getTime(),
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
    session.authorizationGrantExpiresAt.getTime() <= databaseNowMilliseconds ||
    session.hardExpiresAt.getTime() <= databaseNowMilliseconds
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
  const leaseSnapshot = SnapshotTokenSchema.make({
    scopeId: expected.scopeId,
    epoch: replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid),
    commitSeq: CommitSeqSchema.make(lease.snapshotCommitSeq),
  });
  if (
    lease.scopeUuid !== scopeUuid ||
    lease.sessionId !== expected.sessionId ||
    lease.attemptFence !== expected.attemptFence ||
    !validDate(lease.leaseExpiresAt) ||
    lease.leaseExpiresAt.getTime() > session.hardExpiresAt.getTime() ||
    leaseSnapshot.commitSeq > clock.lastCommitSeq
  ) {
    return corrupt("snapshotLeaseInvalid");
  }
  if (
    leaseSnapshot.scopeId !== expected.snapshotToken.scopeId ||
    leaseSnapshot.epoch !== expected.snapshotToken.epoch ||
    leaseSnapshot.commitSeq !== expected.snapshotToken.commitSeq
  ) {
    return authorityMismatch("snapshotChanged");
  }
  if (lease.leaseExpiresAt.getTime() <= databaseNowMilliseconds) {
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
  const sealedRoot = captureSealedRoot(root);
  if (sealedRoot === undefined) {
    return corrupt("journalRootInvalid");
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
    expected.sessionId,
    expected.attemptFence,
  );
  if (points === undefined) {
    return corrupt("pointEvidenceInvalid");
  }

  return Object.freeze({
    kind: "loaded",
    evidence: Object.freeze({
      deploymentId: expected.deploymentId,
      scopeId: expected.scopeId,
      scopeUuid,
      sessionId: expected.sessionId,
      attemptFence: expected.attemptFence,
      databaseNowMilliseconds,
      session: captureSessionScalars(session),
      lease: Object.freeze({
        snapshotToken: Object.freeze({ ...leaseSnapshot }),
        leaseExpiresAtMilliseconds: lease.leaseExpiresAt.getTime(),
      }),
      root: sealedRoot,
      points,
    }),
  });
}

function captureSessionScalars(
  session: StoredAttemptSessionProjectionV1,
): StoredAttemptSessionScalarsV1 {
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    throw new Error("Stored attempt session is not active.");
  }
  return Object.freeze({
    lifecycle: session.lifecycle,
    storageGeneration: session.storageGeneration,
    storageGenerationFence: session.storageGenerationFence,
    packageId: session.packageId,
    artifactRuntime: session.artifactRuntime,
    artifactId: session.artifactId,
    sourcePackageHash: session.sourcePackageHash,
    executionModule: session.executionModule,
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
      session.authorizationGrantExpiresAt.getTime(),
    requestKey: session.requestKey,
    requestSha256: copyBytes(session.requestSha256),
    protocolVersion: session.protocolVersion,
    hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
    createdAtMilliseconds: session.createdAt.getTime(),
    updatedAtMilliseconds: session.updatedAt.getTime(),
  });
}

function captureSealedRoot(
  root: JournalRootRow,
): StoredAttemptSealedRootV1 | undefined {
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
    !validDate(root.createdAt) ||
    !validDate(root.updatedAt) ||
    !validDate(root.sealedAt) ||
    root.updatedAt.getTime() < root.createdAt.getTime() ||
    root.sealedAt.getTime() < root.createdAt.getTime() ||
    !validByteLength(root.sealedJournalSha256, 32) ||
    !validByteLength(root.sealedResultSha256, 32)
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
    createdAtMilliseconds: root.createdAt.getTime(),
    updatedAtMilliseconds: root.updatedAt.getTime(),
    sealedAtMilliseconds: root.sealedAt.getTime(),
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
    if (
      row.scopeUuid !== scopeUuid ||
      row.sessionId !== sessionId ||
      row.attemptFence !== attemptFence ||
      !validDate(row.createdAt) ||
      !validDate(row.updatedAt) ||
      row.updatedAt.getTime() < row.createdAt.getTime()
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
    } catch {
      return undefined;
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
      createdAtMilliseconds: row.createdAt.getTime(),
      updatedAtMilliseconds: row.updatedAt.getTime(),
    }));
  }
  return Object.freeze(points);
}

function decodeDatabaseNow(value: string | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    return undefined;
  }
  return milliseconds;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validByteLength(value: Uint8Array, length: number): boolean {
  return value instanceof Uint8Array && value.byteLength === length;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function authorityMismatch(
  reason: StoredAttemptAuthorityMismatchReasonV1,
): StoredAttemptEvidenceLoadResultV1 {
  return Object.freeze({ kind: "authorityMismatch", reason });
}

function corrupt(
  reason: StoredAttemptCorruptionReasonV1,
  cause?: unknown,
): StoredAttemptEvidenceLoadResultV1 {
  return Object.freeze({
    kind: "corrupt",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
