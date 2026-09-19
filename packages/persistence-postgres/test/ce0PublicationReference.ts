import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Result, Schema } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import type { AppRowTransaction } from "../src/appRows";
import {
  ScopePublicationCorruptionError,
  ScopePublicationSqlFailure,
  type ScopePublicationContribution,
  type ScopePublicationKernel,
  type ScopePublicationOptions,
  type ScopePublicationSqlOperation,
  type ScopePublicationStep,
} from "../src/commitPublication/scopePublicationModel";
import { rowsFromDriverExecuteResult } from "../src/driverExecuteResult";

const decodeWrites = Schema.decodeUnknownResult(
  Schema.Array(
    Schema.Struct({
      commitSeq: Schema.String,
      changeOrdinal: Schema.optional(Schema.Int),
    }),
  ),
);
const dialect = new PgDialect();
const corrupt = () =>
  new ScopePublicationCorruptionError({
    reason: "publicationInvariantInvalid",
  });

/** Explicit SQL for trusted Application publication persistence only. The caller
 * supplies the locked clock, canonical result and prepared row output, and owns
 * settlement. This reference supplies no admission, materialization or recovery. */
export async function writeCe0PublicationReference(
  tx: AppRowTransaction,
  command: ScopePublicationContribution,
  kernel: ScopePublicationKernel,
  options: ScopePublicationOptions,
): Promise<void> {
  if (
    command.successfulResult.encoding !== "application-value" ||
    command.events !== undefined ||
    command.relationalFacts !== undefined ||
    command.payloadPreferenceDeletionCount !== undefined ||
    kernel.relationAdjacencyChanges.length !== 0
  ) {
    throw new Error("Unsupported CE0 publication reference profile.");
  }
  const scope = kernel.clock.scopeUuid;
  const epoch = kernel.clock.epochUuid;
  const seq = kernel.commitSeq;
  const time = new Date(kernel.publicationTimeMilliseconds);
  const step = async (name: ScopePublicationStep) => {
    await options.afterTransactionStep?.({
      scopeId: command.authorityPins.scopeId,
      step: name,
    });
  };
  const execute = (
    operation: ScopePublicationSqlOperation,
    statement: SQL,
    expectedOrdinals?: { first: number; count: number },
  ) =>
    executeWrites(
      tx,
      operation,
      statement,
      String(seq),
      options,
      expectedOrdinals,
    );

  await execute(
    "writeCommitHeader",
    sql`
    insert into fx_system_commit
      (scope_uuid, epoch_uuid, commit_seq, change_count, relation_adjacency_change_count,
       payload_preference_deletion_count, relational_change_count, event_count, event_sha256, committed_at)
    values (${scope}, ${epoch}, ${seq}, ${command.rowIntents.length}, 0, 0, 0, 0, null, ${time})
    returning commit_seq::text as "commitSeq"`,
  );
  await step("commitHeaderWritten");
  for (let first = 0; first < command.rowIntents.length; first += 500) {
    const rows = command.rowIntents.slice(first, first + 500);
    const values = rows.map(
      (row, offset) => sql`(${scope}, ${epoch}, ${seq},
      ${first + offset}, ${row.tableId}, ${appRowIdHexV1ToBytes(row.rowId)})`,
    );
    await execute(
      "writeCommitChange",
      sql`
      insert into fx_system_commit_app_row_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
      values ${sql.join(values, sql`, `)}
      returning commit_seq::text as "commitSeq", change_ordinal as "changeOrdinal"`,
      { first, count: rows.length },
    );
    await step("commitChangeWritten");
  }
  await execute(
    "writeOutcome",
    sql`
    insert into fx_system_idempotency
      (scope_uuid, request_key, identity_access_policy_sha256, function_path, request_sha256,
       epoch_uuid, commit_seq, result_state, result_encoding, result_value_codec_version,
       result_semantic_bytes, result_bytes, result_sha256, result_expired_at, created_at)
    values (${scope}, ${command.authorityPins.requestKey}, ${Buffer.from(command.identityAccessPolicySha256)},
      ${command.authorityPins.functionPath}, ${Buffer.from(command.requestSha256)}, ${epoch}, ${seq},
      'available', 'application-value', ${FLAREX_VALUE_CODEC_VERSION_V1},
      ${command.successfulResult.semanticSizeBytes}, ${Buffer.from(command.successfulResult.canonicalBytes)},
      ${Buffer.from(command.resultSha256)}, null, ${time})
    returning commit_seq::text as "commitSeq"`,
  );
  await step("outcomeWritten");
  await execute(
    "writeWake",
    sql`
    insert into fx_system_commit_wake
      (scope_uuid, epoch_uuid, commit_seq, delivery_state, created_at, next_attempt_at,
       claim_fence, claim_owner, claimed_at, claim_expires_at, last_failure_code,
       last_failure_summary, last_failed_at, delivered_at, dead_lettered_at)
    values (${scope}, ${epoch}, ${seq}, 'pending', ${time}, ${time}, 0, null, null,
      null, null, null, null, null, null)
    returning commit_seq::text as "commitSeq"`,
  );
  await step("wakeWritten");
}

export async function advanceCe0PublicationReference(
  tx: AppRowTransaction,
  command: ScopePublicationContribution,
  kernel: ScopePublicationKernel,
  options: ScopePublicationOptions,
): Promise<void> {
  await executeWrites(
    tx,
    "advanceScopeClock",
    sql`
    update fx_system_scope_clock
    set last_commit_seq = ${kernel.commitSeq}, updated_at = ${new Date(kernel.publicationTimeMilliseconds)}
    where scope_uuid = ${kernel.clock.scopeUuid} and last_commit_seq = ${kernel.clock.record.lastCommitSeq}
    returning last_commit_seq::text as "commitSeq"`,
    String(kernel.commitSeq),
    options,
  );
  await options.afterTransactionStep?.({
    scopeId: command.authorityPins.scopeId,
    step: "clockAdvanced",
  });
}

async function executeWrites(
  tx: AppRowTransaction,
  operation: ScopePublicationSqlOperation,
  statement: SQL,
  expectedSeq: string,
  options: ScopePublicationOptions,
  ordinals?: { first: number; count: number },
): Promise<void> {
  if (options.observeQuery !== undefined) {
    const compiled = dialect.sqlToQuery(statement);
    options.observeQuery({
      name: operation,
      sql: compiled.sql,
      params: compiled.params,
    });
  }
  // The SQL boundary preserves driver failure provenance; decode failures below
  // remain corruption, and callback failures propagate to the owning runner.
  let result: unknown;
  try {
    result = await tx.execute(statement);
  } catch (cause) {
    throw new ScopePublicationSqlFailure({ operation, cause });
  }
  const rows = Result.getOrThrow(
    decodeWrites(
      rowsFromDriverExecuteResult(result, () => {
        throw corrupt();
      }),
    ).pipe(Result.mapError(corrupt)),
  );
  if (rows.length !== (ordinals?.count ?? 1)) throw corrupt();
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.commitSeq !== expectedSeq) throw corrupt();
    if (ordinals !== undefined) {
      if (
        row.changeOrdinal === undefined ||
        row.changeOrdinal < ordinals.first ||
        row.changeOrdinal >= ordinals.first + ordinals.count ||
        seen.has(row.changeOrdinal)
      )
        throw corrupt();
      seen.add(row.changeOrdinal);
    }
  }
}
