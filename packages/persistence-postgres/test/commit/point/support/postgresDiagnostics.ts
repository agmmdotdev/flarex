import { type PostgresExecutionPhase } from "../../../performance/postgresExecutionObservation";
import { type ExecutionDiagnosticPolicy } from "../../../../src/execution/diagnostics/operation";
import { Effect } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
} from "flarex-protocol/ordered-index";
import { expect } from "vitest";
import { type PointCommitTransactionCommandV1 } from "../../../../src/commit/point/contracts";
import { type PostgresFlarexPersistence } from "../../../../src/database/postgres";
import { withPostgresSequentialScansDisabled } from "../../../support/postgresHelpers";

export const installedPublicationDiagnostics = (markPhase: (phase: PostgresExecutionPhase) => void): ExecutionDiagnosticPolicy => ({
  observe: (name, work) => {
    const phase = name === "ApplicationDocument.acceptPublication" ? "acceptPublication" :
      name === "ApplicationDocument.materializeAcceptedPublication" ? "applyPublication" : undefined;
    return phase === undefined ? work : Effect.sync(() => markPhase(phase)).pipe(
      Effect.andThen(work), Effect.ensuring(Effect.sync(() => markPhase("resolveAndLock"))));
  },
});

export function percentileNearestRank(
  sortedValues: ReadonlyArray<number>,
  percentile: number,
): number {
  if (sortedValues.length === 0) {
    throw new Error("Cannot calculate a percentile from no observations.");
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(percentile * sortedValues.length) - 1),
  );
  const value = sortedValues[index];
  if (value === undefined) {
    throw new Error("Missing percentile observation.");
  }
  return value;
}

export function requireObservedQuery<Name extends string>(
  queries: ReadonlyMap<
    Name,
    Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
  >,
  name: Name,
) {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing O06 ${name} query.`);
  return query;
}

export async function explainObserved(
  persistence: PostgresFlarexPersistence,
  query: Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>,
): Promise<string> {
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(`explain (format json) ${query.sql}`, [
      ...query.params,
    ]);
    return JSON.stringify(result.rows);
  });
}

export async function explainHeadLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.dependencies[0];
  if (dependency === undefined) throw new Error("Missing O06 dependency.");
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `
        explain (format json)
        select current_row.commit_seq, latest.commit_seq
        from (values ($1::integer, $2::bytea)) requested(table_id, row_id)
        left join fx_app_row_current current_row
          on current_row.scope_uuid = $3::uuid
          and current_row.table_id = requested.table_id
          and current_row.row_id = requested.row_id
        left join lateral (
          select revision.commit_seq
          from fx_app_row_rev revision
          where revision.scope_uuid = $3::uuid
            and revision.table_id = requested.table_id
            and revision.row_id = requested.row_id
          order by revision.commit_seq desc
          limit 1
        ) latest on true
      `,
      [
        dependency.tableId,
        appRowIdHexV1ToBytes(dependency.rowId),
        command.sealIdentity.scopeUuid,
      ],
    );
    return JSON.stringify(result.rows);
  });
}

export async function explainIndexRangeOccLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.indexRangeDependencies[0];
  if (dependency === undefined) {
    throw new Error("Missing O10 index-range dependency.");
  }
  const lower =
    dependency.lower === null
      ? null
      : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey);
  const upper =
    dependency.upper === null
      ? null
      : dependency.upper.kind === "key"
        ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
        : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey);
  const upperRowId =
    dependency.upper?.kind === "position"
      ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
      : null;
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing O10 scope clock.");
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `
        explain (format json)
        with requested(
          ordinal,
          index_definition_id,
          lower_encoded_key,
          upper_kind,
          upper_encoded_key,
          upper_row_id
        ) as (values (0::integer, $1::integer, $2::bytea, $3::text,
          $4::bytea, $5::bytea))
        select requested.ordinal
        from requested
        join fx_app_index_entry_rev as revision
          on revision.scope_uuid = $6::uuid
          and revision.index_definition_id = requested.index_definition_id
          and revision.commit_seq > $7::bigint
          and revision.commit_seq <= $8::bigint
          and (
            requested.lower_encoded_key is null or
            revision.encoded_key >= requested.lower_encoded_key
          )
          and (
            requested.upper_kind = 'unbounded' or
            (
              requested.upper_kind = 'key' and
              revision.encoded_key < requested.upper_encoded_key
            ) or
            (
              requested.upper_kind = 'position' and
              (
                revision.encoded_key < requested.upper_encoded_key or
                (
                  revision.encoded_key = requested.upper_encoded_key and
                  revision.row_id <= requested.upper_row_id
                )
              )
            )
          )
        order by requested.ordinal asc, revision.commit_seq asc,
          revision.encoded_key asc, revision.row_id asc
        limit 1
      `,
      [
        dependency.indexDefinitionId,
        lower,
        dependency.upper?.kind ?? "unbounded",
        upper,
        upperRowId,
        command.sealIdentity.scopeUuid,
        command.authorityPins.snapshotToken.commitSeq,
        clock.lastCommitSeq,
      ],
    );
    return JSON.stringify(result.rows);
  });
}

export async function expectSequentialScansEnabled(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const client = await persistence.pool.connect();
  try {
    const result = await client.query<{ enable_seqscan: string }>(
      "show enable_seqscan",
    );
    expect(result.rows).toEqual([{ enable_seqscan: "on" }]);
  } finally {
    client.release();
  }
}
