import { sql, type SQL } from "drizzle-orm";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import { Result, Schema } from "effect";
import type { AppRowTransaction } from "./appRows";
import { fxSystemScopeExecutionAuthorities, fxSystemTransactionSessions, fxSystemSnapshotLeases,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "./schema";
import type { ExactRunningAttemptKernelInputV1 } from "./transactionSessionAttemptKernel";

export const FiniteRunningAttemptDispositionSchema = Schema.Literals([
  "loaded", "scopeClockMissing", "scopeClockNativeProjectionInvalid", "unsupportedStorageGeneration", "storageGenerationFenceChanged", "scopeEpochChanged",
  "sessionMissing", "sessionRecordInvalid", "staleAttemptFence", "authorizationRevocationEpochChanged",
  "snapshotLeaseMissing", "snapshotLeaseInvalid", "snapshotAheadOfScopeClock", "terminal",
  "activeJournalRootMissing", "journalRootInvalid", "executionClaimMissingOrDuplicate", "activeAttemptExpired",
]);
export interface FiniteObservationIssue { readonly reason: "invalidFiniteObservation"; readonly cause?: unknown }
const invalidObservation = (cause?: unknown): FiniteObservationIssue => ({ reason: "invalidFiniteObservation", ...(cause === undefined ? {} : { cause }) });
const decodeDisposition = Schema.decodeUnknownResult(FiniteRunningAttemptDispositionSchema);
/** One projection owner for both direct and installed accepting statements. */
export function finiteRunningAttemptFields() {
  return { disposition: sql<string>`finite_attempt.disposition`,
    scopeUuid: sql`finite_attempt.scope_uuid`.mapWith(fxSystemSnapshotLeases.scopeUuid),
    databaseNowEpochMilliseconds: sql<string>`finite_attempt.database_now_epoch_milliseconds`,
    authority: {
      scopeId: sql`(finite_attempt.authority_row).scope_id`.mapWith(fxSystemScopeExecutionAuthorities.scopeId),
      storageGeneration: sql`(finite_attempt.authority_row).storage_generation`.mapWith(fxSystemScopeExecutionAuthorities.storageGeneration),
      storageGenerationFence: sql`(finite_attempt.authority_row).storage_generation_fence`.mapWith(fxSystemScopeExecutionAuthorities.storageGenerationFence),
      oldestAvailableCommitSeq: sql`(finite_attempt.authority_row).oldest_available_commit_seq`.mapWith(fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq),
      authorizationRevocationEpoch: sql`(finite_attempt.authority_row).authorization_revocation_epoch`.mapWith(fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch),
      epoch: sql`(finite_attempt.authority_row).epoch`.mapWith(fxSystemScopeExecutionAuthorities.epoch),
      epochUuid: sql`(finite_attempt.authority_row).epoch_uuid`.mapWith(fxSystemScopeExecutionAuthorities.epochUuid),
      updatedAt: sql`(finite_attempt.authority_row).updated_at`.mapWith(fxSystemScopeExecutionAuthorities.updatedAt),
    }, session: {
      scopeUuid: sql`(finite_attempt.session_row).scope_uuid`.mapWith(fxSystemTransactionSessions.scopeUuid),
      sessionId: sql`(finite_attempt.session_row).session_id`.mapWith(fxSystemTransactionSessions.sessionId),
      storageGeneration: sql`(finite_attempt.session_row).storage_generation`.mapWith(fxSystemTransactionSessions.storageGeneration),
      storageGenerationFence: sql`(finite_attempt.session_row).storage_generation_fence`.mapWith(fxSystemTransactionSessions.storageGenerationFence),
      executionAuthorityGeneration: sql`(finite_attempt.session_row).execution_authority_generation`.mapWith(fxSystemTransactionSessions.executionAuthorityGeneration),
      executionModule: sql`(finite_attempt.session_row).execution_module`.mapWith(fxSystemTransactionSessions.executionModule),
      functionPath: sql`(finite_attempt.session_row).function_path`.mapWith(fxSystemTransactionSessions.functionPath),
      functionKind: sql`(finite_attempt.session_row).function_kind`.mapWith(fxSystemTransactionSessions.functionKind),
      schemaVersionId: sql`(finite_attempt.session_row).schema_version_id`.mapWith(fxSystemTransactionSessions.schemaVersionId),
      identityAccessPolicySha256: sql`(finite_attempt.session_row).identity_access_policy_sha256`.mapWith(fxSystemTransactionSessions.identityAccessPolicySha256),
      authorizationRevocationEpoch: sql`(finite_attempt.session_row).authorization_revocation_epoch`.mapWith(fxSystemTransactionSessions.authorizationRevocationEpoch),
      authorizationGrantExpiresAt: sql`(finite_attempt.session_row).authorization_grant_expires_at`.mapWith(fxSystemTransactionSessions.authorizationGrantExpiresAt),
      requestKey: sql`(finite_attempt.session_row).request_key`.mapWith(fxSystemTransactionSessions.requestKey),
      lifecycle: sql`(finite_attempt.session_row).lifecycle`.mapWith(fxSystemTransactionSessions.lifecycle),
      attemptFence: sql`(finite_attempt.session_row).attempt_fence`.mapWith(fxSystemTransactionSessions.attemptFence),
      protocolVersion: sql`(finite_attempt.session_row).protocol_version`.mapWith(fxSystemTransactionSessions.protocolVersion),
      hardExpiresAt: sql`(finite_attempt.session_row).hard_expires_at`.mapWith(fxSystemTransactionSessions.hardExpiresAt),
      createdAt: sql`(finite_attempt.session_row).created_at`.mapWith(fxSystemTransactionSessions.createdAt),
      updatedAt: sql`(finite_attempt.session_row).updated_at`.mapWith(fxSystemTransactionSessions.updatedAt),
    }, lease: {
      scopeUuid: sql`(finite_attempt.lease_row).scope_uuid`.mapWith(fxSystemSnapshotLeases.scopeUuid),
      sessionId: sql`(finite_attempt.lease_row).session_id`.mapWith(fxSystemSnapshotLeases.sessionId),
      attemptFence: sql`(finite_attempt.lease_row).attempt_fence`.mapWith(fxSystemSnapshotLeases.attemptFence),
      snapshotEpochUuid: sql`(finite_attempt.lease_row).snapshot_epoch_uuid`.mapWith(fxSystemSnapshotLeases.snapshotEpochUuid),
      snapshotCommitSeq: sql`(finite_attempt.lease_row).snapshot_commit_seq`.mapWith(fxSystemSnapshotLeases.snapshotCommitSeq),
      metadataWatermark: sql`(finite_attempt.lease_row).metadata_watermark`.mapWith(fxSystemSnapshotLeases.metadataWatermark),
      finiteMetadataReservationBytes: sql`(finite_attempt.lease_row).finite_metadata_reservation_bytes`.mapWith(fxSystemSnapshotLeases.finiteMetadataReservationBytes),
      finiteMetadataReservationSha256: sql`(finite_attempt.lease_row).finite_metadata_reservation_sha256`.mapWith(fxSystemSnapshotLeases.finiteMetadataReservationSha256),
      leaseExpiresAt: sql`(finite_attempt.lease_row).lease_expires_at`.mapWith(fxSystemSnapshotLeases.leaseExpiresAt),
    }, journalRoot: {
      scopeUuid: sql`(finite_attempt.journal_root).scope_uuid`.mapWith(fxSystemTransactionJournals.scopeUuid),
      sessionId: sql`(finite_attempt.journal_root).session_id`.mapWith(fxSystemTransactionJournals.sessionId),
      attemptFence: sql`(finite_attempt.journal_root).attempt_fence`.mapWith(fxSystemTransactionJournals.attemptFence),
      journalFormat: sql`(finite_attempt.journal_root).journal_format`.mapWith(fxSystemTransactionJournals.journalFormat),
      executionProfile: sql`(finite_attempt.journal_root).execution_profile`.mapWith(fxSystemTransactionJournals.executionProfile),
      state: sql`(finite_attempt.journal_root).state`.mapWith(fxSystemTransactionJournals.state),
      lastSyscallSequence: sql`(finite_attempt.journal_root).last_syscall_sequence`.mapWith(fxSystemTransactionJournals.lastSyscallSequence),
    }, claim: {
      scopeUuid: sql`(finite_attempt.execution_claim).scope_uuid`.mapWith(fxSystemTransactionExecutionClaims.scopeUuid),
      sessionId: sql`(finite_attempt.execution_claim).session_id`.mapWith(fxSystemTransactionExecutionClaims.sessionId),
      attemptFence: sql`(finite_attempt.execution_claim).attempt_fence`.mapWith(fxSystemTransactionExecutionClaims.attemptFence),
      claimFence: sql`(finite_attempt.execution_claim).claim_fence`.mapWith(fxSystemTransactionExecutionClaims.claimFence),
      claimOwner: sql`(finite_attempt.execution_claim).claim_owner`.mapWith(fxSystemTransactionExecutionClaims.claimOwner),
      claimedAt: sql`(finite_attempt.execution_claim).claimed_at`.mapWith(fxSystemTransactionExecutionClaims.claimedAt),
      claimExpiresAt: sql`(finite_attempt.execution_claim).claim_expires_at`.mapWith(fxSystemTransactionExecutionClaims.claimExpiresAt),
    },
  };
}

export type FiniteRunningAttemptProjection = SelectResultFields<ReturnType<typeof finiteRunningAttemptFields>>;

/** The function remains qualified by the admitted installation; placeholders
 * and immediate parameters share this exact owner signature. */
export function finiteRunningAttemptSource(schemaName: string, input: Readonly<{
  scopeId: SQL; sessionId: SQL; attemptFence: SQL;
  storageGeneration: SQL; storageGenerationFence: SQL; epoch: SQL;
}>) {
  return sql`${sql.identifier(schemaName)}.fx_lock_finite_running_attempt(
    ${input.scopeId}, ${input.sessionId}::uuid, ${input.attemptFence}::bigint,
    ${input.storageGeneration}, ${input.storageGenerationFence}::bigint, ${input.epoch})`;
}

export function decodeFiniteRunningAttemptRows(rows: readonly FiniteRunningAttemptProjection[]) {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) return Result.fail(invalidObservation());
  return decodeDisposition(row.disposition).pipe(Result.mapError(invalidObservation),
    Result.map(disposition => ({ ...row, disposition })));
}

export async function readFiniteRunningAttempt(tx: AppRowTransaction, input: ExactRunningAttemptKernelInputV1, admittedSchema: string) {
  const authority = input.preliminaryAuthority;
  const rows = await tx.select(finiteRunningAttemptFields()).from(sql`${finiteRunningAttemptSource(admittedSchema, {
    scopeId: sql`${input.selector.scopeId}`, sessionId: sql`${input.selector.sessionId}`, attemptFence: sql`${input.selector.attemptFence}`,
    storageGeneration: sql`${authority.storageGeneration}`, storageGenerationFence: sql`${authority.storageGenerationFence}`, epoch: sql`${authority.epoch}`,
  })} as finite_attempt`).limit(2);
  return decodeFiniteRunningAttemptRows(rows);
}

export const FINITE_SCOPE_OBSERVATION_FUNCTION_BODY_SHA256 = "be4cecb1334b19b5be35f9c37666a4b95685c78253c28b45e4bff4cb821b4524";
export const FINITE_RUNNING_ATTEMPT_FUNCTION_BODY_SHA256 = "7ac5aa6c12f36b74d70c79953e32b050db47a24d52afb4dfe2b6abfafcc455aa";
