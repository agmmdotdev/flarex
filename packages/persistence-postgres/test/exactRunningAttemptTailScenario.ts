import { expect } from "vitest";
import { Result } from "effect";
import { eq } from "drizzle-orm";
import { decodeScopeUuidV1, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { TransactionAttemptFenceSchema, TransactionSessionIdV1Schema } from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexSqlClient } from "../src";
import { readRunningAttemptTail } from "../src/exactRunningAttemptTail";
import { inspectTransactionExecutionClaimV1Result } from "../src/transactionExecutionClaimPersistence";
import { fxSystemTransactionJournals } from "../src/schema";
import { insertExecutionClaimFixture } from "./transactionExecutionClaimSchemaTestSupport";
import { insertOpenTransactionJournalFixture, insertSessionTestScope, insertTransactionSessionFixture,
  SESSION_TEST_SCOPE_UUID, transactionSessionFixture, transactionSessionIdAt } from "./sessionAuthorityTestSupport";

export async function runningAttemptTailScenario(
  persistence: FlarexSqlClient & Readonly<{ drizzle: FlarexMetadataDatabase }>,
): Promise<void> {
  const sessionId = TransactionSessionIdV1Schema.make(transactionSessionIdAt(322));
  const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
  const input = { scopeId, scopeUuid: decodeScopeUuidV1(SESSION_TEST_SCOPE_UUID), sessionId,
    attemptFence: TransactionAttemptFenceSchema.make(1n) };
  const read = () => persistence.drizzle.transaction(tx => readRunningAttemptTail(tx, input));
  await insertSessionTestScope(persistence);
  await insertTransactionSessionFixture(persistence, transactionSessionFixture(sessionId));
  await insertOpenTransactionJournalFixture(persistence, { scopeUuid: SESSION_TEST_SCOPE_UUID, sessionId });
  await insertExecutionClaimFixture(persistence, { claimFence: "9223372036854775807" });

  const open = Result.getOrThrow(await read());
  expect(open.executionClaim.claimFence).toBe(9223372036854775807n);
  expect(open.executionClaim.claimOwner).toBe("61000000-0000-4000-8000-000000000101");
  expect(open.journalRoot.createdAt.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  expect(open.journalRoot.sealedJournalBytes).toBeNull();
  expect(open.journalRoot.sealedAt).toBeNull();
  expect(typeof open.databaseNowEpochMilliseconds).toBe("string");

  const bytes = new Uint8Array([0, 255, 128, 1]);
  const digest = new Uint8Array(32).fill(0xaa);
  // This is a native column-codec fixture, not authenticated seal evidence.
  await persistence.query(`update fx_system_tx_journal set state = 'sealed',
    sealed_journal_bytes = $1, sealed_journal_sha256 = $2,
    sealed_result_value_codec_version = 1, sealed_result_semantic_bytes = 4,
    sealed_result_bytes = $1, sealed_result_sha256 = $2,
    sealed_at = '2030-01-01T00:00:01Z' where session_id = $3`, [bytes, digest, sessionId]);
  const sealed = Result.getOrThrow(await read());
  const native = (await persistence.drizzle.select({
    sealedJournalBytes: fxSystemTransactionJournals.sealedJournalBytes,
    sealedResultSha256: fxSystemTransactionJournals.sealedResultSha256,
  }).from(fxSystemTransactionJournals).where(eq(fxSystemTransactionJournals.sessionId, sessionId)))[0];
  if (native === undefined || sealed.journalRoot.sealedJournalBytes === null ||
    sealed.journalRoot.sealedResultSha256 === null || native.sealedJournalBytes === null ||
    native.sealedResultSha256 === null) throw new Error("Missing native binary codec witness");
  expect(Array.from(sealed.journalRoot.sealedJournalBytes)).toEqual(Array.from(bytes));
  expect(Array.from(sealed.journalRoot.sealedResultSha256)).toEqual(Array.from(digest));
  expect(sealed.journalRoot.sealedJournalBytes).toEqual(native.sealedJournalBytes);
  expect(sealed.journalRoot.sealedResultSha256).toEqual(native.sealedResultSha256);
  expect(sealed.journalRoot.sealedJournalBytes.constructor).toBe(native.sealedJournalBytes.constructor);
  expect(sealed.journalRoot.sealedResultSha256.constructor).toBe(native.sealedResultSha256.constructor);
  expect(sealed.journalRoot.sealedAt?.toISOString()).toBe("2030-01-01T00:00:01.000Z");

  // PostgreSQL finite timestamps outside JavaScript Date's range do not throw
  // in the native codec. The existing claim inspector still owns the refusal.
  await persistence.query(`update fx_system_tx_execution_claim
    set claimed_at = '280000-01-01 UTC', claim_expires_at = '280001-01-01 UTC'
    where session_id = $1`, [sessionId]);
  const extreme = Result.getOrThrow(await read());
  expect(Number.isNaN(extreme.executionClaim.claimedAt.getTime())).toBe(true);
  expect(Result.match(inspectTransactionExecutionClaimV1Result(scopeId, extreme.executionClaim), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("claimEvidenceInvalid");

  // Wrong clock identity makes premature time acquisition observable as a
  // different refusal. Root and claim cardinality retain precedence.
  const missingClockInput = { ...input, scopeId: ScopeIdSchema.make("scope_missing_tail_clock") };
  const missingClockRead = () => persistence.drizzle.transaction(tx => readRunningAttemptTail(tx, missingClockInput));
  await persistence.query("delete from fx_system_tx_execution_claim where session_id = $1", [sessionId]);
  expect(Result.match(await missingClockRead(), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("executionClaimMissingOrDuplicate");
  await persistence.query("delete from fx_system_tx_journal where session_id = $1", [sessionId]);
  expect(Result.match(await missingClockRead(), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("journalRootMissing");
  const definition = (await persistence.query<{ definition: string }>(
    "select pg_get_functiondef('fx_lock_running_attempt_tail(uuid,uuid,bigint,text)'::regprocedure) as definition",
  )).rows[0]?.definition;
  if (definition === undefined) throw new Error("Missing running-attempt tail definition");
  for (const replacement of [
    "disposition := 'unexpectedTailDisposition';",
    "disposition := 'journalRootMissing'; RETURN NEXT;",
  ]) {
    try {
      await persistence.query(definition.replace("disposition := 'journalRootMissing';", replacement));
      expect(Result.match(await missingClockRead(), {
        onFailure: error => error.reason, onSuccess: () => "accepted",
      })).toBe("journalRootInvalid");
    } finally {
      await persistence.query(definition);
    }
  }
  await insertOpenTransactionJournalFixture(persistence, { scopeUuid: SESSION_TEST_SCOPE_UUID, sessionId });
  await insertExecutionClaimFixture(persistence);
  expect(Result.match(await missingClockRead(), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("databaseClockInvalid");

  // Deliberate structural-corruption probes in this disposable owner fixture.
  await persistence.query("alter table fx_system_tx_execution_claim drop constraint fx_system_tx_execution_claim_pk");
  await persistence.query("insert into fx_system_tx_execution_claim select * from fx_system_tx_execution_claim");
  expect(Result.match(await missingClockRead(), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("executionClaimMissingOrDuplicate");
  await persistence.query("alter table fx_system_tx_journal drop constraint fx_system_tx_journal_pk cascade");
  await persistence.query("insert into fx_system_tx_journal select * from fx_system_tx_journal");
  expect(Result.match(await missingClockRead(), {
    onFailure: error => error.reason, onSuccess: () => "accepted",
  })).toBe("journalRootInvalid");
}
