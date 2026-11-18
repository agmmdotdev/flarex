import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  decodeScopeClockRecord,
  selectScopeClockRows,
  type ScopeClockRecord,
  type ScopeClockRow,
} from "../../scope/scopeClock";
import { ScopeClockNotFoundError } from "../../scope/scopeClockErrors";
import type {
  LocatedPointMutationSessionActivationInputV1,
  LocatedPointMutationSessionAttemptLoadInputV1,
  PointMutationSessionAttemptLoadLockStepV1,
} from "./constructionContracts";
import type {
  CheckedTransactionSessionRow,
  PointMutationSessionAttemptSelectorV1,
  SnapshotLeaseRow,
} from "./contracts";
import {
  activationError,
  attemptLoadError,
  corruptionError,
  projectTransactionSessionActivationResult,
  type PointMutationSessionActivationV1Error,
  type PointMutationSessionAuthorityCorruptionV1Error,
} from "./errors";
import type { ExactRunningAttemptKernelInputV1 } from "./kernelContracts";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, eq, sql } from "drizzle-orm";
import { Result } from "effect";
import {
  CommitSeqSchema,
  StorageGenerationFenceSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type CommitSeq,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

export const INITIAL_ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(1n);

export const checkedTransactionSessionSelection = {
  executionProfile: fxSystemTransactionSessions.executionProfile,
  executionAuthorityGeneration: fxSystemTransactionSessions.executionAuthorityGeneration,
  functionPath: fxSystemTransactionSessions.functionPath,
  functionKind: fxSystemTransactionSessions.functionKind,
  executionModule: sql`coalesce(${fxSystemTransactionSessions.executionModule}, ${fxSystemTransactionSessions.applicationExecutionAuthorityJson} #>> '{runtimeTarget,executionModulePath}')`.mapWith(fxSystemTransactionSessions.executionModule).as("execution_module"),
  sessionId: fxSystemTransactionSessions.sessionId,
  attemptFence: fxSystemTransactionSessions.attemptFence,
  storageGeneration: fxSystemTransactionSessions.storageGeneration,
  storageGenerationFence: fxSystemTransactionSessions.storageGenerationFence,
  authorizationRevocationEpoch:
    fxSystemTransactionSessions.authorizationRevocationEpoch,
  authorizationGrantExpiresAt:
    fxSystemTransactionSessions.authorizationGrantExpiresAt,
  hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
  createdAt: fxSystemTransactionSessions.createdAt,
  updatedAt: fxSystemTransactionSessions.updatedAt,
  protocolVersion: fxSystemTransactionSessions.protocolVersion,
  lifecycle: fxSystemTransactionSessions.lifecycle,
  schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
  identityAccessPolicySha256: fxSystemTransactionSessions.identityAccessPolicySha256,
  requestKey: fxSystemTransactionSessions.requestKey,
};

export interface LockedPointMutationSessionClockV1 {
  readonly record: ScopeClockRecord;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export interface PointMutationSessionAttemptAuthorityFailureFactoryV1<
  Failure extends Error = Error,
> {
  readonly unsupportedStorageGeneration: () => Failure;
  readonly storageGenerationFenceChanged: () => Failure;
  readonly authorizationRevocationEpochChanged: () => Failure;
  readonly scopeEpochChanged: () => Failure;
}

export interface PointMutationSessionAttemptFailureFactoryV1<Failure extends Error>
  extends PointMutationSessionAttemptAuthorityFailureFactoryV1<Failure> {
  readonly terminal: (
    lifecycle: Exclude<TransactionSessionLifecycleV1, "running">,
  ) => Failure;
  readonly activeAttemptExpired: () => Failure;
  readonly executionClaimUnavailable: () => Failure;
}

export interface PointMutationSessionExactSessionFailureFactoryV1 {
  readonly sessionMissing: () => Error;
  readonly staleAttemptFence: () => Error;
}

export async function lockExactPointMutationSession(
  tx: FlarexMetadataDatabase,
  selector: PointMutationSessionAttemptSelectorV1,
  clock: LockedPointMutationSessionClockV1,
  failures: PointMutationSessionExactSessionFailureFactoryV1,
  afterSessionLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<CheckedTransactionSessionRow> {
  const sessions = await tx
    .select(checkedTransactionSessionSelection)
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
    ))
    .limit(2)
    .for("update");
  const session = sessions[0];
  if (session === undefined) {
    throw failures.sessionMissing();
  }
  if (sessions.length !== 1) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  await afterSessionLock?.("sessionLocked");

  let persistedAttemptFence: TransactionAttemptFence;
  try {
    persistedAttemptFence = TransactionAttemptFenceSchema.make(
      session.attemptFence,
    );
  } catch (cause) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid", cause);
  }
  if (persistedAttemptFence !== selector.attemptFence) {
    throw failures.staleAttemptFence();
  }
  return session;
}

export interface LockedPointMutationSessionAttemptLoadV1<Failure extends Error> {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly failures: PointMutationSessionAttemptFailureFactoryV1<Failure>;
  readonly afterLeaseLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined;
  readonly claimRequirement: "live" | "present";
  readonly executionClaim?: ExactRunningAttemptKernelInputV1["executionClaim"];
}

export async function requireExactPointMutationSessionJournalRoot(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  afterRootLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<typeof fxSystemTransactionJournals.$inferSelect> {
  const roots = await tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, sessionId),
      eq(fxSystemTransactionJournals.attemptFence, attemptFence),
    ))
    .limit(2)
    .for("update");
  const root = roots[0];
  if (root === undefined) {
    throw corruptionError(scopeId, "activeJournalRootMissing");
  }
  if (roots.length !== 1) {
    throw corruptionError(scopeId, "journalRootInvalid");
  }
  await afterRootLock?.("journalRootLocked");
  return root;
}

interface LockedPointMutationSessionAttemptStructureBaseV1 {
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGenerationFence: StorageGenerationFence;
}

export type LockedPointMutationSessionAttemptStructureV1 =
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "absent";
    })
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "present";
      readonly lease: SnapshotLeaseRow;
      readonly leaseExpiresAtMilliseconds: number;
      readonly snapshotEpoch: ScopeEpoch;
      readonly snapshotCommitSeq: CommitSeq;
    });

export async function lockPointMutationSessionAttemptStructure(
  tx: FlarexMetadataDatabase,
  input: {
    readonly scopeId: ReplacementScopeIdV1;
    readonly authorityProfile: "liveExecution" | "terminalCleanup";
    readonly failures: PointMutationSessionAttemptAuthorityFailureFactoryV1;
    readonly afterLeaseLock:
      | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
          void | Promise<void>)
      | undefined;
  },
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
  snapshotRetentionFloorPolicy:
    | "requireRetainedSnapshot"
    | "allowExpiredTerminalization",
): Promise<LockedPointMutationSessionAttemptStructureV1> {
  if (session.storageGeneration !== "flarexdb_v1") {
    throw input.failures.unsupportedStorageGeneration();
  }
  if (
    session.storageGenerationFence !== clock.record.storageGenerationFence
  ) {
    throw input.failures.storageGenerationFenceChanged();
  }
  if (
    session.authorizationRevocationEpoch !==
    clock.authorizationRevocationEpoch &&
    (input.authorityProfile === "liveExecution" ||
      session.authorizationRevocationEpoch > clock.authorizationRevocationEpoch)
  ) {
    throw input.failures.authorizationRevocationEpochChanged();
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    finiteDateMilliseconds(session.createdAt) === undefined ||
    finiteDateMilliseconds(session.updatedAt) === undefined ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  let sessionId: TransactionSessionIdV1;
  let attemptFence: TransactionAttemptFence;
  let storageGenerationFence: StorageGenerationFence;
  try {
    sessionId = TransactionSessionIdV1Schema.make(session.sessionId);
    attemptFence = TransactionAttemptFenceSchema.make(session.attemptFence);
    storageGenerationFence = StorageGenerationFenceSchema.make(
      session.storageGenerationFence,
    );
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "sessionRecordInvalid",
      cause,
    );
  }
  if (session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  const leases = await tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, sessionId),
    ))
    .limit(2)
    .for("update");
  if (leases.length > 1) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }
  const lease = leases[0];
  if (lease === undefined) {
    return Object.freeze({
      leaseState: "absent",
      sessionId,
      attemptFence,
      storageGenerationFence,
    } satisfies LockedPointMutationSessionAttemptStructureV1);
  }
  await input.afterLeaseLock?.("leaseLocked");
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    lease.attemptFence !== attemptFence ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }

  let snapshotEpoch: ScopeEpoch;
  let snapshotCommitSeq: CommitSeq;
  try {
    snapshotEpoch = replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid);
    snapshotCommitSeq = CommitSeqSchema.make(lease.snapshotCommitSeq);
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "snapshotLeaseInvalid",
      cause,
    );
  }
  if (snapshotEpoch !== clock.record.epoch) {
    throw input.failures.scopeEpochChanged();
  }
  if (snapshotCommitSeq > clock.record.lastCommitSeq) {
    throw corruptionError(input.scopeId, "snapshotAheadOfScopeClock");
  }
  if (snapshotRetentionFloorPolicy === "requireRetainedSnapshot") {
    projectTransactionSessionActivationResult(
      validateSnapshotRetentionFloorResult(
        input.scopeId,
        snapshotCommitSeq,
        clock.record.oldestAvailableCommitSeq,
      ),
    );
  }

  return Object.freeze({
    leaseState: "present",
    sessionId,
    attemptFence,
    storageGenerationFence,
    lease,
    leaseExpiresAtMilliseconds,
    snapshotEpoch,
    snapshotCommitSeq,
  } satisfies LockedPointMutationSessionAttemptStructureV1);
}

function validateSnapshotRetentionFloorResult(
  scopeId: ReplacementScopeIdV1,
  snapshotCommitSeq: CommitSeq,
  oldestAvailableCommitSeq: CommitSeq,
): Result.Result<void, PointMutationSessionAuthorityCorruptionV1Error> {
  return snapshotCommitSeq < oldestAvailableCommitSeq
    ? Result.fail(corruptionError(scopeId, "snapshotLeaseInvalid"))
    : Result.succeed(undefined);
}

const attemptLoadStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptLoadError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptLoadError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

export async function lockPointMutationSessionClock(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
): Promise<LockedPointMutationSessionClockV1> {
  return lockPointMutationSessionClockWithMode(tx, scopeId, "attempt");
}

export async function lockPointMutationSessionClockForShare(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
): Promise<LockedPointMutationSessionClockV1> {
  return lockPointMutationSessionClockWithMode(tx, scopeId, "share");
}

export async function lockPointMutationSessionClockWithMode(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
  lockMode: "share" | "attempt" | "terminalCleanup",
): Promise<LockedPointMutationSessionClockV1> {
  await tx.select({ scopeId: fxSystemScopeExecutionAuthorities.scopeId }).from(fxSystemScopeExecutionAuthorities)
    .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId)).limit(1)
    .for(lockMode === "terminalCleanup" ? "update" : "share");
  const query = selectScopeClockRows(tx)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const rows = lockMode === "share"
    ? await query.for("share", { of: fxSystemScopeClocks })
    : lockMode === "terminalCleanup"
    ? await query.for("update", { of: fxSystemScopeClocks })
    : await query.for("no key update", { of: fxSystemScopeClocks });
  const row = rows[0];
  if (row === undefined) throw new ScopeClockNotFoundError(scopeId);
  return decodeLockedPointMutationSessionClock(row);
}

export function decodeLockedPointMutationSessionClock(row: ScopeClockRow): LockedPointMutationSessionClockV1 {
  const scopeId = row.scopeId;
  const record = decodeScopeClockRecord(row);
  try {
    const scopeProjection = projectScopeIdUuidV1(record.scopeId);
    const epochProjection = projectScopeEpochUuidV1(record.epoch);
    const scopeUuid = decodeScopeUuidV1(row.scopeUuid);
    const epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
    if (
      scopeUuid !== scopeProjection.scopeUuid ||
      epochUuid !== epochProjection.epochUuid
    ) {
      throw new Error("Native scope-clock projection mismatch.");
    }
    return Object.freeze({
      record,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          row.authorizationRevocationEpoch,
        ),
    });
  } catch (cause) {
    throw corruptionError(
      scopeId,
      "scopeClockNativeProjectionInvalid",
      cause,
    );
  }
}

export function requireStableAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionActivationInputV1,
): Result.Result<void, PointMutationSessionActivationV1Error> {
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== input.prepared.scopeId ||
    preliminary.scopeId !== input.prepared.scopeId
  ) {
    return Result.fail(activationError({ reason: "scopeMismatch" }));
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    return Result.fail(activationError({ reason: "unsupportedStorageGeneration" }));
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    return Result.fail(activationError({ reason: "storageGenerationChanged" }));
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    return Result.fail(activationError({ reason: "storageGenerationFenceChanged" }));
  }
  if (clock.record.epoch !== preliminary.epoch) {
    return Result.fail(activationError({ reason: "scopeEpochChanged" }));
  }
  if (
    clock.authorizationRevocationEpoch !==
    input.prepared.evidence.authorizationRevocationEpoch
  ) {
    return Result.fail(activationError({
      reason: "authorizationRevocationEpochChanged",
    }));
  }
  return Result.succeed(undefined);
}

export function requireStableAttemptLoadAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
) {
  return requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptLoadStableAuthorityFailures,
  );
}

export interface PointMutationSessionStableAuthorityFailureFactoryV1<Failure extends Error = Error> {
  readonly selectorScopeMismatch: () => Failure;
  readonly unsupportedStorageGeneration: () => Failure;
  readonly storageGenerationChanged: () => Failure;
  readonly storageGenerationFenceChanged: () => Failure;
  readonly scopeEpochChanged: () => Failure;
}

export function requireStablePointMutationSessionAttemptAuthority<Failure extends Error>(
  clock: LockedPointMutationSessionClockV1,
  input: {
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
  },
  failures: PointMutationSessionStableAuthorityFailureFactoryV1<Failure>,
): Result.Result<void, Failure> {
  const selector = input.selector;
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== selector.scopeId ||
    preliminary.scopeId !== selector.scopeId ||
    preliminary.deploymentId !== selector.deploymentId
  ) {
    return Result.fail(failures.selectorScopeMismatch());
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    return Result.fail(failures.unsupportedStorageGeneration());
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    return Result.fail(failures.storageGenerationChanged());
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    return Result.fail(failures.storageGenerationFenceChanged());
  }
  if (clock.record.epoch !== preliminary.epoch) {
    return Result.fail(failures.scopeEpochChanged());
  }
  return Result.succeed(undefined);
}

export async function readDatabaseNow(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<Date> {
  const rows = await tx
    .select({
      databaseNowEpochMilliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  return databaseNowFromEpochMilliseconds(scopeId, rows[0]?.databaseNowEpochMilliseconds);
}

export function databaseNowFromEpochMilliseconds(scopeId: ScopeId, epochMillisecondsText: unknown): Date {
  return projectTransactionSessionActivationResult(databaseNowFromEpochMillisecondsResult(scopeId, epochMillisecondsText));
}

function databaseNowFromEpochMillisecondsResult(scopeId: ScopeId, epochMillisecondsText: unknown) {
  if (typeof epochMillisecondsText !== "string") {
    return Result.fail(corruptionError(scopeId, "databaseClockInvalid"));
  }
  const epochMilliseconds = Number(epochMillisecondsText);
  const databaseNow = new Date(epochMilliseconds);
  if (
    !isPositiveSafeInteger(epochMilliseconds) ||
    finiteDateMilliseconds(databaseNow) === undefined
  ) {
    return Result.fail(corruptionError(scopeId, "databaseClockInvalid"));
  }
  return Result.succeed(databaseNow);
}

export function deriveInitialLeaseExpiry(
  databaseNow: Date,
  hardExpiresAt: Date,
  leaseDurationMilliseconds: number,
): Result.Result<Date, PointMutationSessionActivationV1Error> {
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  const hardExpiryMilliseconds = finiteDateMilliseconds(hardExpiresAt);
  if (
    databaseNowMilliseconds === undefined ||
    hardExpiryMilliseconds === undefined
  ) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  const remainingMilliseconds =
    hardExpiryMilliseconds - databaseNowMilliseconds;
  if (remainingMilliseconds <= 0) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  const leaseExpiresAt = new Date(
    databaseNowMilliseconds +
      Math.min(leaseDurationMilliseconds, remainingMilliseconds),
  );
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(leaseExpiresAt);
  if (
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  return Result.succeed(leaseExpiresAt);
}
