import { sql } from "drizzle-orm";
import { Result, Schema } from "effect";

import type { ScopeId, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";
import type { AppRowTransaction } from "./appRows";
import { fxSystemTransactionExecutionClaims, fxSystemTransactionJournals } from "./schema";

const RunningAttemptTailDispositionSchema = Schema.Literals([
  "loaded", "journalRootMissing", "journalRootInvalid",
  "executionClaimMissingOrDuplicate", "databaseClockInvalid",
]);
const decodeTailObservation = Schema.decodeUnknownResult(Schema.Tuple([
  Schema.Struct({ disposition: RunningAttemptTailDispositionSchema }),
]));

export interface RunningAttemptTail {
  readonly journalRoot: typeof fxSystemTransactionJournals.$inferSelect;
  readonly executionClaim: typeof fxSystemTransactionExecutionClaims.$inferSelect;
  readonly databaseNowEpochMilliseconds: string | null;
}
export interface RunningAttemptTailIssue {
  readonly reason: Exclude<typeof RunningAttemptTailDispositionSchema.Type, "loaded">;
  readonly cause?: unknown;
}

// Expand the function's native composites at the SQL boundary. Existing column
// decoders retain int8 precision, timestamp values, bytea and nullable fields.
const journalRootSelection = {
  scopeUuid: sql`(attempt_tail.journal_root).scope_uuid`.mapWith(fxSystemTransactionJournals.scopeUuid),
  sessionId: sql`(attempt_tail.journal_root).session_id`.mapWith(fxSystemTransactionJournals.sessionId),
  attemptFence: sql`(attempt_tail.journal_root).attempt_fence`.mapWith(fxSystemTransactionJournals.attemptFence),
  journalFormat: sql`(attempt_tail.journal_root).journal_format`.mapWith(fxSystemTransactionJournals.journalFormat),
  executionProfile: sql`(attempt_tail.journal_root).execution_profile`.mapWith(fxSystemTransactionJournals.executionProfile),
  state: sql`(attempt_tail.journal_root).state`.mapWith(fxSystemTransactionJournals.state),
  lastSyscallSequence: sql`(attempt_tail.journal_root).last_syscall_sequence`.mapWith(fxSystemTransactionJournals.lastSyscallSequence),
  receiptEvidenceBytes: sql`(attempt_tail.journal_root).receipt_evidence_bytes`.mapWith(fxSystemTransactionJournals.receiptEvidenceBytes),
  participantWorkBytes: sql`(attempt_tail.journal_root).participant_work_bytes`.mapWith(fxSystemTransactionJournals.participantWorkBytes),
  participantWorkCalls: sql`(attempt_tail.journal_root).participant_work_calls`.mapWith(fxSystemTransactionJournals.participantWorkCalls),
  creationTimeSeed: sql`(attempt_tail.journal_root).creation_time_seed`.mapWith(fxSystemTransactionJournals.creationTimeSeed),
  nextCreationTime: sql`(attempt_tail.journal_root).next_creation_time`.mapWith(fxSystemTransactionJournals.nextCreationTime),
  readDocuments: sql`(attempt_tail.journal_root).read_documents`.mapWith(fxSystemTransactionJournals.readDocuments),
  readSemanticBytes: sql`(attempt_tail.journal_root).read_semantic_bytes`.mapWith(fxSystemTransactionJournals.readSemanticBytes),
  pointDependencyCount: sql`(attempt_tail.journal_root).point_dependency_count`.mapWith(fxSystemTransactionJournals.pointDependencyCount),
  indexedQuerySyscalls: sql`(attempt_tail.journal_root).indexed_query_syscalls`.mapWith(fxSystemTransactionJournals.indexedQuerySyscalls),
  indexRangeDependencyCount: sql`(attempt_tail.journal_root).index_range_dependency_count`.mapWith(fxSystemTransactionJournals.indexRangeDependencyCount),
  indexRangeDependencyEvidenceBytes: sql`(attempt_tail.journal_root).index_range_dependency_evidence_bytes`.mapWith(fxSystemTransactionJournals.indexRangeDependencyEvidenceBytes),
  relationReadSyscalls: sql`(attempt_tail.journal_root).relation_read_syscalls`.mapWith(fxSystemTransactionJournals.relationReadSyscalls),
  relationDependencyCount: sql`(attempt_tail.journal_root).relation_dependency_count`.mapWith(fxSystemTransactionJournals.relationDependencyCount),
  relationBaseOccurrences: sql`(attempt_tail.journal_root).relation_base_occurrences`.mapWith(fxSystemTransactionJournals.relationBaseOccurrences),
  writeOperations: sql`(attempt_tail.journal_root).write_operations`.mapWith(fxSystemTransactionJournals.writeOperations),
  writeSemanticBytes: sql`(attempt_tail.journal_root).write_semantic_bytes`.mapWith(fxSystemTransactionJournals.writeSemanticBytes),
  materialWriteEventEvidenceBytes: sql`(attempt_tail.journal_root).material_write_event_evidence_bytes`.mapWith(fxSystemTransactionJournals.materialWriteEventEvidenceBytes),
  failureDimension: sql`(attempt_tail.journal_root).failure_dimension`.mapWith(fxSystemTransactionJournals.failureDimension),
  sealedJournalBytes: sql`(attempt_tail.journal_root).sealed_journal_bytes`.mapWith(fxSystemTransactionJournals.sealedJournalBytes),
  sealedJournalSha256: sql`(attempt_tail.journal_root).sealed_journal_sha256`.mapWith(fxSystemTransactionJournals.sealedJournalSha256),
  sealedResultValueCodecVersion: sql`(attempt_tail.journal_root).sealed_result_value_codec_version`.mapWith(fxSystemTransactionJournals.sealedResultValueCodecVersion),
  sealedResultSemanticBytes: sql`(attempt_tail.journal_root).sealed_result_semantic_bytes`.mapWith(fxSystemTransactionJournals.sealedResultSemanticBytes),
  sealedResultBytes: sql`(attempt_tail.journal_root).sealed_result_bytes`.mapWith(fxSystemTransactionJournals.sealedResultBytes),
  sealedResultSha256: sql`(attempt_tail.journal_root).sealed_result_sha256`.mapWith(fxSystemTransactionJournals.sealedResultSha256),
  sealedAt: sql`(attempt_tail.journal_root).sealed_at`.mapWith(fxSystemTransactionJournals.sealedAt),
  createdAt: sql`(attempt_tail.journal_root).created_at`.mapWith(fxSystemTransactionJournals.createdAt),
  updatedAt: sql`(attempt_tail.journal_root).updated_at`.mapWith(fxSystemTransactionJournals.updatedAt),
};
const executionClaimSelection = {
  scopeUuid: sql`(attempt_tail.execution_claim).scope_uuid`.mapWith(fxSystemTransactionExecutionClaims.scopeUuid),
  sessionId: sql`(attempt_tail.execution_claim).session_id`.mapWith(fxSystemTransactionExecutionClaims.sessionId),
  attemptFence: sql`(attempt_tail.execution_claim).attempt_fence`.mapWith(fxSystemTransactionExecutionClaims.attemptFence),
  claimFence: sql`(attempt_tail.execution_claim).claim_fence`.mapWith(fxSystemTransactionExecutionClaims.claimFence),
  claimOwner: sql`(attempt_tail.execution_claim).claim_owner`.mapWith(fxSystemTransactionExecutionClaims.claimOwner),
  claimedAt: sql`(attempt_tail.execution_claim).claimed_at`.mapWith(fxSystemTransactionExecutionClaims.claimedAt),
  claimExpiresAt: sql`(attempt_tail.execution_claim).claim_expires_at`.mapWith(fxSystemTransactionExecutionClaims.claimExpiresAt),
};

/** Narrow Drizzle adapter; SQL errors remain with the caller's transaction owner. */
export async function readRunningAttemptTail(
  tx: AppRowTransaction,
  input: Readonly<{
    scopeId: ScopeId; scopeUuid: ScopeUuidV1;
    sessionId: TransactionSessionIdV1; attemptFence: TransactionAttemptFence;
  }>,
): Promise<Result.Result<RunningAttemptTail, RunningAttemptTailIssue>> {
  const rows = await tx.select({
    disposition: sql<string>`attempt_tail.disposition`,
    journalRoot: journalRootSelection,
    executionClaim: executionClaimSelection,
    databaseNowEpochMilliseconds: sql<string | null>`attempt_tail.database_now_epoch_milliseconds`,
  }).from(sql`fx_lock_running_attempt_tail(
    ${input.scopeUuid}, ${input.sessionId}, ${input.attemptFence}, ${input.scopeId}
  ) as attempt_tail`).limit(2);
  return decodeTailObservation(rows).pipe(
    Result.mapError(cause => ({ reason: "journalRootInvalid" as const, cause })),
    Result.flatMap(([observation]): Result.Result<RunningAttemptTail, RunningAttemptTailIssue> => {
      if (observation.disposition !== "loaded") return Result.fail({ reason: observation.disposition });
      const row = rows[0];
      return row === undefined
        ? Result.fail({ reason: "journalRootInvalid" })
        : Result.succeed({ journalRoot: row.journalRoot, executionClaim: row.executionClaim,
          databaseNowEpochMilliseconds: row.databaseNowEpochMilliseconds });
    }),
  );
}

// The only body normalization is line endings and the actual pinned schema
// prefix. Foreign relations, changed predicates and altered statements differ.
export const runningAttemptTailProtectionSql = sql<boolean>`(
  (select count(*) = 1 from pg_catalog.pg_proc p
    where p.pronamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and p.proname = 'fx_lock_running_attempt_tail')
  and exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    join pg_catalog.pg_class r on r.relnamespace = p.pronamespace and r.relname = 'fx_system_tx_journal'
    join pg_catalog.pg_class c on c.relnamespace = p.pronamespace and c.relname = 'fx_system_tx_execution_claim'
    where p.pronamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and p.proname = 'fx_lock_running_attempt_tail'
      and p.pronargs = 4 and p.pronargdefaults = 0
      and p.proargtypes = '2950 2950 20 25'::pg_catalog.oidvector
      and p.proallargtypes = array[2950, 2950, 20, 25, 25, r.reltype, c.reltype, 25]::oid[]
      and p.proargmodes::text = '{i,i,i,i,t,t,t,t}'
      and p.proargnames = array['p_scope_uuid', 'p_session_id', 'p_attempt_fence', 'p_scope_id',
        'disposition', 'journal_root', 'execution_claim', 'database_now_epoch_milliseconds']::text[]
      and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype and p.proretset
      and p.prokind = 'f' and l.lanname = 'plpgsql' and p.provolatile = 'v'
      and not p.prosecdef and not p.proisstrict and not p.proleakproof and p.proparallel = 'u'
      and p.prosupport = 0
      and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.proowner = r.relowner and p.proowner = c.relowner
      and p.proowner <> (select oid from pg_catalog.pg_roles where rolname = session_user)
      and pg_catalog.has_function_privilege(session_user, p.oid, 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
        pg_catalog.replace(p.prosrc, E'\\r\\n', E'\\n'),
        pg_catalog.quote_ident(pg_catalog.current_schema()) || '.', '"__flarex_target__".'
      ), 'UTF8')), 'hex') = '73683de27b07e15c4030d1590b447a7d7625a485244e745325bf9f43b8d43300'
  )
)`;
