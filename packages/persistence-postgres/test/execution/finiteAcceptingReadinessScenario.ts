import { eq, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import { TransactionSessionIdV1Schema } from "flarex-protocol/transaction-session";
import type { FlarexSqlClient } from "../../src";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { fxSystemTransactionSessions } from "../../src/database/schema";
import { rowsFromDriverExecuteResult } from "../../src/database/driverExecuteResult";
import { captureFiniteAttemptAnchor, prepareFiniteAttemptStorageCaptureBasis,
  projectCapturedFiniteAttemptAnchor, readFiniteAttemptAnchorRow } from "../../src/execution/finiteAttemptAnchor";
import { TransactionExecutionClaimFenceV1Schema, TransactionExecutionClaimOwnerV1Schema } from "../../src/execution/claims/transactionExecutionClaimModel";
import { insertSessionTestScope, insertTransactionSessionFixture, SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID, transactionSessionFixture, transactionSessionIdAt } from "./session/support/sessionStorage";

const decodeNativeAcceptanceRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({
  reason: Schema.String, serving: Schema.NullOr(Schema.String), eligible: Schema.Boolean, replacement: Schema.Boolean,
})));

/** Exercise the actual installed accepting owner with real canonical entry
 * evidence. Intentional native stored-state fixtures isolate its readiness
 * verdict; caller provenance and body consumers retain their separate proofs. */
export async function finiteAcceptingReadinessScenario(
  persistence: Pick<FlarexSqlClient, "query" | "execute">,
  database: FlarexMetadataDatabase,
  schemaName: string,
  interleave?: (scopeId: string, read: () => Promise<readonly { reason: string; serving: string | null }[]>) => Promise<void>,
): Promise<void> {
  await insertSessionTestScope(persistence);
  const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
  const epoch = ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`);
  const sessionId = TransactionSessionIdV1Schema.make(transactionSessionIdAt(141));
  const session = transactionSessionFixture(sessionId);
  await insertTransactionSessionFixture(persistence, session);
  await persistence.query("update fx_system_scope_clock set last_commit_seq=3 where scope_id=$1", [scopeId]);
  const anchor = await Effect.runPromise(captureFiniteAttemptAnchor({ snapshotToken: SnapshotTokenSchema.make({
    scopeId, epoch, commitSeq: CommitSeqSchema.make(3n),
  }) }));
  const owner = TransactionExecutionClaimOwnerV1Schema.make("61000000-0000-4000-8000-000000000142");
  const [stored] = await database.update(fxSystemTransactionSessions).set({
    ...Result.getOrThrow(projectCapturedFiniteAttemptAnchor(anchor)), lifecycle: "running",
    finiteLeaseExpiresAt: new Date("2030-01-01T23:59:00Z"), finiteClaimOwner: owner,
    finiteClaimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
    finiteClaimedAt: new Date("2030-01-01T00:00:00Z"), finiteClaimExpiresAt: new Date("2030-01-01T00:05:00Z"),
  }).where(eq(fxSystemTransactionSessions.sessionId, sessionId)).returning();
  if (stored === undefined) throw new Error("Missing stored finite readiness entry");
  await Effect.runPromise(readFiniteAttemptAnchorRow(stored, anchor));
  const basis = Result.getOrThrow(prepareFiniteAttemptStorageCaptureBasis(anchor));
  const namespace = sql.identifier(schemaName);
  const pinTypes = ["uuid","uuid","bigint","text","integer","text","text","text","text","text",
    "text","text","text","text","integer","integer","text","text","bigint","text","bigint",
    "text","bigint","bigint","bigint","text","text","text","text","text"];
  const pins = Object.values(basis.expected.pins);
  expect(pins).toHaveLength(pinTypes.length);
  const expected = sql`row(${sql.join(pins.map((value, index) => sql`${value}::${sql.raw(pinTypes[index]!)}`), sql`,`)})::${namespace}.fx_finite_capture_expected`;
  const digest = "a".repeat(64), head = "b".repeat(64), activation = "c".repeat(64), manifest = "d".repeat(64);
  const read = async (options: Readonly<{ index?: number | null; unique?: number | null; head?: string; physical?: string; uniquePhysical?: string; readiness?: boolean }> = {}) =>
    database.transaction(async tx => {
      await tx.execute(sql`select pg_catalog.set_config('statement_timeout','30000',true)`);
      const result = await tx.execute(sql`
        with captured as materialized (select ${namespace}.fx_accept_finite_storage_capture(
          ${scopeId},${expected},${basis.expected.bytes}::bytea,${basis.expected.digest}::bytea,
          ${SESSION_TEST_EPOCH_UUID}::uuid,3::bigint,null::bigint,${owner}::uuid,1::bigint,
          'flarexdb_v1',1::bigint,${epoch},${options.index === undefined ? 141 : options.index}::integer,141::integer,
          ${options.unique ?? null}::integer,row('finite-ready','schema_session_v1',1::bigint,
            decode(${manifest},'hex'),decode(${options.head ?? head},'hex'),decode(${activation},'hex'),
            decode(${options.physical ?? digest},'hex'),decode(${options.uniquePhysical ?? digest},'hex'),${options.readiness ?? true}::boolean)::${namespace}.fx_finite_read_expected) as frontier)
        select (frontier).reason as reason,(frontier).serving_commit_seq::text as serving,
          (frontier).body_eligible as eligible,(frontier).session_row is not null as replacement from captured`);
      const rows = rowsFromDriverExecuteResult(result, () => { throw new Error("Invalid native finite acceptance result"); });
      return Effect.runPromise(decodeNativeAcceptanceRows(rows));
    });
  const expectReason = async (reason: string, options?: Parameters<typeof read>[0]) => {
    expect(await read(options)).toMatchObject([{ reason, eligible: reason === "accepted", replacement: false }]);
  };
  await expectReason("notReady");
  await expectReason("accepted", { readiness: false }); // Retirement retains the selected wait, bypassing only readiness.
  await persistence.query(`insert into fx_system_index_build_state
    (scope_id,index_definition_id,storage_generation,storage_generation_fence,epoch,start_commit_seq,
      covered_through_commit_seq,first_readable_commit_seq,lifecycle,cursor_codec_version,attempt_fence)
    values ($1,141,'flarexdb_v1',1,$2,0,3,0,'enabled',1,1)`, [scopeId,epoch]);
  await expectReason("accepted");
  // Native scalar corruption precedes ordinary lifecycle unavailability.
  await persistence.query("update fx_system_index_build_state set start_commit_seq=4,lifecycle='building' where scope_id=$1", [scopeId]);
  await expectReason("storedCorruption");
  await persistence.query("update fx_system_index_build_state set start_commit_seq=0 where scope_id=$1", [scopeId]);
  await expectReason("notReady");
  await persistence.query("update fx_system_index_build_state set lifecycle='enabled' where scope_id=$1", [scopeId]);
  await persistence.query("update fx_system_index_build_state set created_at='infinity',updated_at='infinity' where scope_id=$1", [scopeId]);
  await expectReason("storedCorruption");
  await persistence.query("update fx_system_index_build_state set created_at=current_timestamp,updated_at=current_timestamp where scope_id=$1", [scopeId]);
  // A genuine opening still authenticates table and digest before coverage's
  // early return. Matching activation can cover a retained-history gap.
  await persistence.query(`insert into fx_system_index_maintenance_obligation
    (scope_id,index_definition_id,activation_sequence,storage_generation,storage_generation_fence,epoch,
      attempt_fence,first_readable_commit_seq,opened_commit_seq,table_id,physical_spec_sha256,
      deployment_id,schema_version_id,schema_manifest_sha256,activation_sha256,head_sha256)
    values ($1,141,1,'flarexdb_v1',1,$2,1,0,1,141,decode($3,'hex'),
      'finite-ready','schema_session_v1',decode($4,'hex'),decode($5,'hex'),decode($6,'hex'))`,
    [scopeId,epoch,digest,manifest,activation,head]);
  await persistence.query("update fx_system_index_build_state set covered_through_commit_seq=1,maintenance_activation_sequence=1 where scope_id=$1", [scopeId]);
  await persistence.query(`insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone)
    values ($1::uuid,141,decode('61410000000040008000000000000001','hex'),3,$2::uuid,'schema_session_v1',1,1,true)`,
    [SESSION_TEST_SCOPE_UUID,SESSION_TEST_EPOCH_UUID]);
  await persistence.query(`insert into fx_app_row_current (scope_uuid,table_id,row_id,commit_seq)
    values ($1::uuid,141,decode('61410000000040008000000000000001','hex'),3)`, [SESSION_TEST_SCOPE_UUID]);
  await persistence.query("update fx_system_scope_execution_authority set oldest_available_commit_seq=2 where scope_id=$1", [scopeId]);
  await expectReason("accepted");
  await expectReason("storedCorruption", { physical: "e".repeat(64) });
  await expectReason("notReady", { head: "e".repeat(64) });
  await persistence.query("update fx_system_scope_execution_authority set oldest_available_commit_seq=0 where scope_id=$1", [scopeId]);
  await persistence.query(`insert into fx_system_commit (scope_uuid,epoch_uuid,commit_seq,change_count)
    values ($1::uuid,$2::uuid,3,1)`, [SESSION_TEST_SCOPE_UUID,SESSION_TEST_EPOCH_UUID]);
  await persistence.query(`insert into fx_system_commit_app_row_change
    (scope_uuid,epoch_uuid,commit_seq,change_ordinal,table_id,row_id)
    values ($1::uuid,$2::uuid,3,0,141,decode('61410000000040008000000000000001','hex'))`,
    [SESSION_TEST_SCOPE_UUID,SESSION_TEST_EPOCH_UUID]);
  await expectReason("notReady", { head: "e".repeat(64) }); // Retained history independently proves the coverage gap.
  // A second operation must freshly observe the new serving sequencer value.
  await persistence.query("update fx_system_scope_clock set last_commit_seq=4 where scope_id=$1", [scopeId]);
  expect(await read()).toMatchObject([{ reason: "accepted", serving: "4" }]);
  await expectReason("accepted", { unique: 142 }); // Index fast path precedes a missing unique build.
  await expectReason("notReady", { index: null, unique: 142 });
  await persistence.query(`insert into fx_system_unique_constraint_build
    (scope_id,unique_constraint_definition_id,storage_generation,storage_generation_fence,epoch,
      start_commit_seq,covered_through_commit_seq,lifecycle,attempt_fence)
    values ($1,142,'flarexdb_v1',1,$2,0,3,'enabled',1)`, [scopeId,epoch]);
  await expectReason("accepted", { index: null, unique: 142 });
  await persistence.query("update fx_system_unique_constraint_build set storage_generation_fence=2 where scope_id=$1", [scopeId]);
  await expectReason("notReady", { index: null, unique: 142 });
  await persistence.query("update fx_system_unique_constraint_build set start_commit_seq=5,covered_through_commit_seq=5 where scope_id=$1", [scopeId]);
  await expectReason("storedCorruption", { index: null, unique: 142 });
  await persistence.query("update fx_system_unique_constraint_build set start_commit_seq=0,covered_through_commit_seq=3,storage_generation_fence=1 where scope_id=$1", [scopeId]);
  await persistence.query(`insert into fx_system_unique_maintenance_obligation
    (scope_id,unique_constraint_definition_id,activation_sequence,storage_generation,storage_generation_fence,epoch,
      attempt_fence,start_commit_seq,opened_commit_seq,table_id,physical_spec_sha256,
      deployment_id,schema_version_id,activation_sha256,head_sha256)
    values ($1,142,1,'flarexdb_v1',1,$2,1,0,3,141,decode($3,'hex'),
      'finite-ready','schema_session_v1',decode($4,'hex'),decode($5,'hex'))`, [scopeId,epoch,digest,activation,head]);
  await persistence.query("update fx_system_unique_constraint_build set maintenance_activation_sequence=1 where scope_id=$1", [scopeId]);
  await expectReason("accepted", { index: null, unique: 142 });
  await expectReason("storedCorruption", { index: null, unique: 142, uniquePhysical: "e".repeat(64) });
  if (interleave !== undefined) await interleave(scopeId, () => read());
  await persistence.query("update fx_system_unique_constraint_build set start_commit_seq=999,covered_through_commit_seq=999,maintenance_activation_sequence=null where scope_id=$1", [scopeId]);
  // Earlier attempt refusal is retained even when the selected build is bad.
  await persistence.query("update fx_system_tx_session set lifecycle='aborted',validated_args_json=null,validated_args_canonical_bytes=null,authorization_grant_json=null,authorization_grant_canonical_bytes=null where session_id=$1", [sessionId]);
  await expectReason("lifecycleChanged", { index: null, unique: 142 });
}
