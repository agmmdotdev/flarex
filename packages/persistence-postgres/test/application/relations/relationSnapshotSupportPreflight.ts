import { Data, Effect, Result } from "effect";

export type RelationSnapshotSupportCandidate =
  | "edgeHistory"
  | "adjacencyVersion";

export type RelationSnapshotPreflightOwner =
  | RelationSnapshotSupportCandidate
  | "shared";

export type RelationSnapshotPreflightPhase =
  | "provision"
  | "seed"
  | "read"
  | "write"
  | "explain"
  | "measure"
  | "contend"
  | "vacuum";

export class RelationSnapshotPreflightSqlError extends Data.TaggedError(
  "RelationSnapshotPreflightSqlError",
)<{
  readonly owner: RelationSnapshotPreflightOwner;
  readonly phase: RelationSnapshotPreflightPhase;
  readonly operation: string;
  readonly cause: unknown;
}> {}

export class RelationSnapshotPreflightContractError extends Data.TaggedError(
  "RelationSnapshotPreflightContractError",
)<{
  readonly issue:
    | "invalidTransition"
    | "invalidPageInput"
    | "invalidPageBounds"
    | "invalidDriverResult";
  readonly detail: string;
}> {}

export interface RelationSnapshotPreflightQueryRequest {
  readonly owner: RelationSnapshotPreflightOwner;
  readonly phase: RelationSnapshotPreflightPhase;
  readonly operation: string;
  readonly sql: string;
  readonly parameters?: ReadonlyArray<unknown>;
}

export interface RelationSnapshotPreflightDatabase {
  readonly query: <Row extends Readonly<Record<string, unknown>>>(
    request: RelationSnapshotPreflightQueryRequest,
  ) => Effect.Effect<ReadonlyArray<Row>, RelationSnapshotPreflightSqlError>;
}

const relationSnapshotPreflightTransaction = Symbol(
  "RelationSnapshotPreflightTransactionDatabase",
);

export interface RelationSnapshotPreflightTransactionDatabase
  extends RelationSnapshotPreflightDatabase {
  readonly [relationSnapshotPreflightTransaction]: true;
}

export interface RelationSnapshotPreflightDriver {
  readonly query: <Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<Row>>;
}

/**
 * Creates one local Effect boundary around a Promise SQL driver. The resulting
 * value is deliberately a plain instance: a proof may own several concurrent
 * PostgreSQL clients and must not force them into one singleton Context tag.
 */
export function makeRelationSnapshotPreflightDatabase(
  driver: RelationSnapshotPreflightDriver,
): RelationSnapshotPreflightDatabase {
  return Object.freeze({
    query: <Row extends Readonly<Record<string, unknown>>>(
      request: RelationSnapshotPreflightQueryRequest,
    ) =>
      Effect.tryPromise({
        try: () => driver.query<Row>(
          request.sql,
          request.parameters === undefined ? [] : [...request.parameters],
        ),
        catch: cause => new RelationSnapshotPreflightSqlError({
          owner: request.owner,
          phase: request.phase,
          operation: request.operation,
          cause,
        }),
      }).pipe(
        Effect.map(rows => Object.freeze([...rows])),
      ),
  });
}

/**
 * Brands a session-pinned driver for use only while its caller-owned SQL
 * transaction is open. The caller retains begin/commit/rollback ownership.
 */
export function makeRelationSnapshotPreflightTransactionDatabase(
  driver: RelationSnapshotPreflightDriver,
): RelationSnapshotPreflightTransactionDatabase {
  return Object.freeze({
    ...makeRelationSnapshotPreflightDatabase(driver),
    [relationSnapshotPreflightTransaction]: true as const,
  });
}

export const RELATION_SNAPSHOT_PREFLIGHT_PROFILE = Object.freeze({
  pageSize: 128,
  historyScanCeiling: 512,
  transactionOccurrenceCeiling: 4_096,
  highFanout: 20_000,
  ordinaryEndpointCount: 64,
  ordinaryFanout: 32,
  skewScopeCount: 8,
  skewEdgesPerLargestScope: 4_096,
  retainedHistoryIdentityCount: 512,
  retainedHistoryDepth: 32,
  churnEventCount: 1_024,
  contentionWriters: 8,
  contentionWritesPerWriter: 16,
} as const);

export interface RelationEdgeOccurrence {
  readonly scopeId: number;
  /** Synthetic proof identity. It is not a catalog or analyzer ordinal. */
  readonly edgeDefinitionKey: number;
  readonly sourceDocumentId: number;
  readonly targetDocumentId: number;
  readonly duplicateOrdinal: number;
  readonly position: number | null;
}

export interface RelationEdgeTransition {
  readonly before: RelationEdgeOccurrence | null;
  readonly after: RelationEdgeOccurrence | null;
}

export interface RelationConsumedFrontier {
  readonly sourceDocumentId: number;
  readonly duplicateOrdinal: number;
}

export interface RelationIncomingPageInput {
  readonly scopeId: number;
  readonly edgeDefinitionKey: number;
  readonly targetDocumentId: number;
  readonly snapshotCommitSeq: number;
  readonly pageSize: number;
  readonly consumedFrontier: RelationConsumedFrontier | null;
}

export interface RelationIncomingOccurrence {
  readonly sourceDocumentId: number;
  readonly targetDocumentId: number;
  readonly duplicateOrdinal: number;
  readonly position: number | null;
  readonly commitSeq: number;
}

export interface RelationIncomingPage {
  readonly occurrences: ReadonlyArray<RelationIncomingOccurrence>;
  readonly consumedFrontier: RelationConsumedFrontier | null;
  readonly exhausted: boolean;
  readonly inspectedOccurrenceCount: number;
}

export type AdjacencyVersionIncomingPageResult =
  | Readonly<{
    readonly status: "success";
    readonly expectedAdjacencyVersion: number;
    readonly page: RelationIncomingPage;
  }>
  | Readonly<{
    readonly status: "conflict";
    readonly reason: "changedDuringRead" | "newerThanSnapshot";
    readonly beforeVersion: number;
    readonly afterVersion: number;
  }>;

export interface AdjacencyReadHooks {
  readonly afterPage?: () => Effect.Effect<
    void,
    RelationSnapshotPreflightContractError | RelationSnapshotPreflightSqlError
  >;
}

interface HistoryCandidateRow extends Readonly<Record<string, unknown>> {
  readonly source_document_id: string;
  readonly target_document_id: string;
  readonly duplicate_ordinal: number;
  readonly position: number | null;
  readonly commit_seq: string;
  readonly is_present: boolean;
}

interface AdjacencyVersionRow extends Readonly<Record<string, unknown>> {
  readonly adjacency_version: string;
}

interface CurrentEdgeRow extends Readonly<Record<string, unknown>> {
  readonly source_document_id: string;
  readonly target_document_id: string;
  readonly duplicate_ordinal: number;
  readonly position: number | null;
  readonly commit_seq: string;
}

interface ScopeClockRow extends Readonly<Record<string, unknown>> {
  readonly last_commit_seq: string;
}

const PREFLIGHT_SCHEMA_STATEMENTS = Object.freeze([
  `create table r01p_scope_clock (
     scope_id integer primary key,
     last_commit_seq bigint not null check (last_commit_seq >= 0)
   )`,
  `create table r01p_edge_current (
     scope_id integer not null,
     edge_definition_key bigint not null,
     source_document_id bigint not null,
     target_document_id bigint not null,
     duplicate_ordinal integer not null,
     position integer,
     commit_seq bigint not null,
     primary key (
       scope_id, edge_definition_key, source_document_id,
       target_document_id, duplicate_ordinal
     )
   )`,
  `create index r01p_edge_current_incoming_idx
     on r01p_edge_current (
       scope_id, edge_definition_key, target_document_id,
       source_document_id, duplicate_ordinal
     ) include (position, commit_seq)`,
  `create table r01p_edge_history (
     scope_id integer not null,
     edge_definition_key bigint not null,
     source_document_id bigint not null,
     target_document_id bigint not null,
     duplicate_ordinal integer not null,
     position integer,
     commit_seq bigint not null,
     is_present boolean not null,
     primary key (
       scope_id, edge_definition_key, source_document_id,
       target_document_id, duplicate_ordinal, commit_seq
     )
   )`,
  `create index r01p_edge_history_snapshot_idx
     on r01p_edge_history (
       scope_id, edge_definition_key, target_document_id,
       source_document_id, duplicate_ordinal,
       commit_seq desc
     ) include (position, is_present)`,
  `create table r01p_adjacency_version (
     scope_id integer not null,
     edge_definition_key bigint not null,
     direction text not null check (direction in ('incoming', 'outgoing')),
     endpoint_document_id bigint not null,
     last_changed_commit_seq bigint not null,
     primary key (
       scope_id, edge_definition_key, direction, endpoint_document_id
     )
   )`,
] as const);

export const installRelationSnapshotPreflightSchema = Effect.fn(
  "RelationSnapshotPreflight.installSchema",
)(function* (database: RelationSnapshotPreflightDatabase) {
  for (const [index, sql] of PREFLIGHT_SCHEMA_STATEMENTS.entries()) {
    yield* database.query({
      owner: "shared",
      phase: "provision",
      operation: `create proof relation ${index + 1}`,
      sql,
    });
  }
});

export const seedRelationSnapshotPreflightProfile = Effect.fn(
  "RelationSnapshotPreflight.seedProfile",
)(function* (database: RelationSnapshotPreflightDatabase) {
  const profile = RELATION_SNAPSHOT_PREFLIGHT_PROFILE;
  yield* database.query({
    owner: "shared",
    phase: "seed",
    operation: "seed high-fanout current edges",
    sql: `insert into r01p_edge_current
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq)
          select 1, 1, source_id, 1, 0,
                 case when source_id <= $2::integer
                   then mod($3::integer, 2)
                   else 0
                 end,
                 case when source_id <= $2::integer
                   then $3::integer
                   else 1
                 end
          from generate_series(1, $1::integer) as source(source_id)`,
    parameters: [
      profile.highFanout,
      profile.retainedHistoryIdentityCount,
      profile.retainedHistoryDepth,
    ],
  });
  yield* database.query({
    owner: "shared",
    phase: "seed",
    operation: "seed ordinary endpoint distribution",
    sql: `insert into r01p_edge_current
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq)
          select 1, 1,
                 1000000 + endpoint.value * $2::integer + member.value,
                 100000 + endpoint.value, 0, 0, 1
          from generate_series(1, $1::integer) as endpoint(value)
          cross join generate_series(1, $2::integer) as member(value)`,
    parameters: [profile.ordinaryEndpointCount, profile.ordinaryFanout],
  });
  yield* database.query({
    owner: "shared",
    phase: "seed",
    operation: "seed tenant-skew distribution",
    sql: `insert into r01p_edge_current
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq)
          select scope.value, 1,
                 scope.value::bigint * 1000000000 + member.value,
                 scope.value::bigint * 1000000 + mod(member.value, 32),
                 0, 0, 1
          from generate_series(2, $1::integer + 1) as scope(value)
          cross join lateral generate_series(
            1,
            greatest(1, floor($2::numeric / (scope.value - 1)))::integer
          ) as member(value)`,
    parameters: [profile.skewScopeCount, profile.skewEdgesPerLargestScope],
  });
  yield* database.query({
    owner: "edgeHistory",
    phase: "seed",
    operation: "seed immutable edge history",
    sql: `insert into r01p_edge_history
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq, is_present)
          select scope_id, edge_definition_key, source_document_id,
                 target_document_id, duplicate_ordinal,
                 case when scope_id = 1 and edge_definition_key = 1
                            and target_document_id = 1
                            and source_document_id between 1 and $1::integer
                   then 0
                   else position
                 end,
                 case when scope_id = 1 and edge_definition_key = 1
                            and target_document_id = 1
                            and source_document_id between 1 and $1::integer
                   then 1
                   else commit_seq
                 end,
                 true
          from r01p_edge_current`,
    parameters: [profile.retainedHistoryIdentityCount],
  });
  yield* database.query({
    owner: "edgeHistory",
    phase: "seed",
    operation: "seed retained history depth",
    sql: `insert into r01p_edge_history
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq, is_present)
          select 1, 1, source.value, 1, 0,
                 mod(revision.value, 2), revision.value, true
          from generate_series(1, $1::integer) as source(value)
          cross join generate_series(2, $2::integer) as revision(value)`,
    parameters: [
      profile.retainedHistoryIdentityCount,
      profile.retainedHistoryDepth,
    ],
  });
  yield* database.query({
    owner: "adjacencyVersion",
    phase: "seed",
    operation: "seed endpoint adjacency versions",
    sql: `insert into r01p_adjacency_version
            (scope_id, edge_definition_key, direction, endpoint_document_id,
             last_changed_commit_seq)
          select scope_id, edge_definition_key, 'outgoing', source_document_id,
                 max(commit_seq)
          from r01p_edge_current
          group by scope_id, edge_definition_key, source_document_id
          union all
          select scope_id, edge_definition_key, 'incoming', target_document_id,
                 max(commit_seq)
          from r01p_edge_current
          group by scope_id, edge_definition_key, target_document_id`,
  });
  yield* database.query({
    owner: "shared",
    phase: "seed",
    operation: "seed proof scope clocks",
    sql: `insert into r01p_scope_clock (scope_id, last_commit_seq)
          select scope_id, max(commit_seq)
          from r01p_edge_current
          group by scope_id`,
  });
  for (const relation of [
    "r01p_edge_current",
    "r01p_edge_history",
    "r01p_adjacency_version",
  ] as const) {
    yield* database.query({
      owner: "shared",
      phase: "seed",
      operation: `analyze ${relation}`,
      sql: `analyze ${relation}`,
    });
  }
});

export const applyRelationEdgeTransitions = Effect.fn(
  "RelationSnapshotPreflight.applyEdgeTransitions",
)(function* (
  database: RelationSnapshotPreflightTransactionDatabase,
  transitions: ReadonlyArray<RelationEdgeTransition>,
) {
  const firstOccurrence = transitions[0]?.after ?? transitions[0]?.before ?? null;
  if (firstOccurrence === null) {
    return yield* Effect.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidTransition",
      detail: "A proof scope commit requires at least one edge transition.",
    }));
  }
  for (const transition of transitions) {
    const before = transition.before;
    const after = transition.after;
    if (before === null && after === null) {
      return yield* Effect.fail(new RelationSnapshotPreflightContractError({
        issue: "invalidTransition",
        detail: "A proof scope commit cannot contain an empty edge transition.",
      }));
    }
    for (const occurrence of [before, after]) {
      if (occurrence !== null) {
        yield* Effect.fromResult(validateEdgeOccurrence(occurrence));
      }
    }
    if (before !== null && after !== null) {
      yield* Effect.fromResult(validateSameRelation(before, after));
    }
    for (const occurrence of [before, after]) {
      if (occurrence !== null && occurrence.scopeId !== firstOccurrence.scopeId) {
        return yield* Effect.fail(new RelationSnapshotPreflightContractError({
          issue: "invalidTransition",
          detail: "A proof scope commit cannot cross scope identity.",
        }));
      }
    }
  }
  const commitSeq = yield* lockAndAdvanceScopeClock(
    database,
    firstOccurrence.scopeId,
  );
  for (const transition of transitions) {
    yield* applyRelationEdgeTransitionAtCommit(
      database,
      transition,
      commitSeq,
    );
  }
  yield* advanceAffectedAdjacencyVersions(
    database,
    transitions,
    commitSeq,
  );
  return commitSeq;
});

function lockAndAdvanceScopeClock(
  database: RelationSnapshotPreflightTransactionDatabase,
  scopeId: number,
) {
  if (!Number.isSafeInteger(scopeId) || scopeId < 1) {
    return Effect.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidTransition",
      detail: "A proof scope commit requires a positive safe scope identity.",
    }));
  }
  return Effect.gen(function* () {
    yield* database.query({
      owner: "shared",
      phase: "write",
      operation: "ensure relation proof scope clock",
      sql: `insert into r01p_scope_clock (scope_id, last_commit_seq)
            values ($1, 0)
            on conflict (scope_id) do nothing`,
      parameters: [scopeId],
    });
    const rows = yield* database.query<ScopeClockRow>({
      owner: "shared",
      phase: "write",
      operation: "allocate relation proof scope commit sequence",
      sql: `update r01p_scope_clock
            set last_commit_seq = last_commit_seq + 1
            where scope_id = $1
            returning last_commit_seq::text as last_commit_seq`,
      parameters: [scopeId],
    });
    return yield* Effect.fromResult(parsePositiveSafeInteger(
      rows[0]?.last_commit_seq,
      "scope commit sequence",
    ));
  });
}

const applyRelationEdgeTransitionAtCommit = Effect.fn(
  "RelationSnapshotPreflight.applyEdgeTransitionAtCommit",
)(function* (
  database: RelationSnapshotPreflightTransactionDatabase,
  transition: RelationEdgeTransition,
  commitSeq: number,
) {
  const before = transition.before;
  const after = transition.after;
  if (before !== null && (after === null || !sameOccurrenceKey(before, after))) {
    yield* deleteCurrentOccurrence(database, before);
  }
  if (after !== null) {
    yield* upsertCurrentOccurrence(database, after, commitSeq);
  }
  yield* appendEdgeHistory(database, transition, commitSeq);
});

export const readHistoryIncomingPage = Effect.fn(
  "RelationSnapshotPreflight.readHistoryIncomingPage",
)(function* (
  database: RelationSnapshotPreflightDatabase,
  input: RelationIncomingPageInput,
  historyScanCeiling = RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling,
) {
  yield* Effect.fromResult(validateIncomingPageInput(input, historyScanCeiling));
  const frontier = input.consumedFrontier;
  const rows = yield* (frontier === null
    ? database.query<HistoryCandidateRow>({
      owner: "edgeHistory",
      phase: "read",
      operation: "read initial bounded incoming history candidates",
      sql: `select source_document_id::text as source_document_id,
                   target_document_id::text as target_document_id,
                   duplicate_ordinal, position,
                   commit_seq::text as commit_seq, is_present
            from (
              select distinct on (
                       source_document_id, duplicate_ordinal
                     )
                     source_document_id, target_document_id,
                     duplicate_ordinal, position, is_present, commit_seq
              from r01p_edge_history
              where scope_id = $1
                and edge_definition_key = $2
                and target_document_id = $3
                and commit_seq <= $4
              order by source_document_id, duplicate_ordinal, commit_seq desc
            ) as latest
            order by source_document_id, duplicate_ordinal
            limit $5`,
      parameters: [
        input.scopeId,
        input.edgeDefinitionKey,
        input.targetDocumentId,
        input.snapshotCommitSeq,
        historyScanCeiling + 1,
      ],
    })
    : database.query<HistoryCandidateRow>({
      owner: "edgeHistory",
      phase: "read",
      operation: "resume bounded incoming history candidates",
      sql: `select source_document_id::text as source_document_id,
                   target_document_id::text as target_document_id,
                   duplicate_ordinal, position,
                   commit_seq::text as commit_seq, is_present
            from (
              select distinct on (
                       source_document_id, duplicate_ordinal
                     )
                     source_document_id, target_document_id,
                     duplicate_ordinal, position, is_present, commit_seq
              from r01p_edge_history
              where scope_id = $1
                and edge_definition_key = $2
                and target_document_id = $3
                and commit_seq <= $4
                and (source_document_id, duplicate_ordinal) >
                    ($5::bigint, $6::integer)
              order by source_document_id, duplicate_ordinal, commit_seq desc
            ) as latest
            order by source_document_id, duplicate_ordinal
            limit $7`,
      parameters: [
        input.scopeId,
        input.edgeDefinitionKey,
        input.targetDocumentId,
        input.snapshotCommitSeq,
        frontier.sourceDocumentId,
        frontier.duplicateOrdinal,
        historyScanCeiling + 1,
      ],
    }));
  return yield* Effect.fromResult(
    buildHistoryPage(rows, input.pageSize, historyScanCeiling),
  );
});

export const readAdjacencyVersionIncomingPage = Effect.fn(
  "RelationSnapshotPreflight.readAdjacencyVersionIncomingPage",
)(function* (
  database: RelationSnapshotPreflightDatabase,
  input: RelationIncomingPageInput,
  hooks: AdjacencyReadHooks = {},
) {
  yield* Effect.fromResult(validateIncomingPageInput(input, input.pageSize));
  const beforeVersion = yield* readIncomingAdjacencyVersion(database, input);
  const frontier = input.consumedFrontier;
  const rows = yield* (frontier === null
    ? database.query<CurrentEdgeRow>({
      owner: "adjacencyVersion",
      phase: "read",
      operation: "read initial bounded current incoming page",
      sql: `select source_document_id::text as source_document_id,
                   target_document_id::text as target_document_id,
                   duplicate_ordinal, position,
                   commit_seq::text as commit_seq
            from r01p_edge_current
            where scope_id = $1
              and edge_definition_key = $2
              and target_document_id = $3
            order by source_document_id, duplicate_ordinal
            limit $4`,
      parameters: [
        input.scopeId,
        input.edgeDefinitionKey,
        input.targetDocumentId,
        input.pageSize + 1,
      ],
    })
    : database.query<CurrentEdgeRow>({
      owner: "adjacencyVersion",
      phase: "read",
      operation: "resume bounded current incoming page",
      sql: `select source_document_id::text as source_document_id,
                   target_document_id::text as target_document_id,
                   duplicate_ordinal, position,
                   commit_seq::text as commit_seq
            from r01p_edge_current
            where scope_id = $1
              and edge_definition_key = $2
              and target_document_id = $3
              and (source_document_id, duplicate_ordinal) >
                  ($4::bigint, $5::integer)
            order by source_document_id, duplicate_ordinal
            limit $6`,
      parameters: [
        input.scopeId,
        input.edgeDefinitionKey,
        input.targetDocumentId,
        frontier.sourceDocumentId,
        frontier.duplicateOrdinal,
        input.pageSize + 1,
      ],
    }));
  if (hooks.afterPage !== undefined) yield* hooks.afterPage();
  const afterVersion = yield* readIncomingAdjacencyVersion(database, input);

  if (beforeVersion !== afterVersion) {
    return Object.freeze({
      status: "conflict" as const,
      reason: "changedDuringRead" as const,
      beforeVersion,
      afterVersion,
    });
  }
  if (beforeVersion > input.snapshotCommitSeq) {
    return Object.freeze({
      status: "conflict" as const,
      reason: "newerThanSnapshot" as const,
      beforeVersion,
      afterVersion,
    });
  }

  const pageRows = rows.slice(0, input.pageSize);
  const occurrences = yield* Effect.fromResult(Result.all(
    pageRows.map(decodeCurrentOccurrence),
  ));
  const lastOccurrence = occurrences.at(-1);
  return Object.freeze({
    status: "success" as const,
    expectedAdjacencyVersion: beforeVersion,
    page: freezePage(
      occurrences,
      lastOccurrence === undefined
        ? null
        : frontierFromOccurrence(lastOccurrence),
      rows.length <= input.pageSize,
      pageRows.length,
    ),
  });
});

function readIncomingAdjacencyVersion(
  database: RelationSnapshotPreflightDatabase,
  input: RelationIncomingPageInput,
): Effect.Effect<
  number,
  RelationSnapshotPreflightContractError | RelationSnapshotPreflightSqlError
> {
  return database.query<AdjacencyVersionRow>({
    owner: "adjacencyVersion",
    phase: "read",
    operation: "read incoming endpoint adjacency version",
    sql: `select coalesce((
                   select last_changed_commit_seq
                   from r01p_adjacency_version
                   where scope_id = $1
                     and edge_definition_key = $2
                     and direction = 'incoming'
                     and endpoint_document_id = $3
                 ), 0)::text as adjacency_version`,
    parameters: [
      input.scopeId,
      input.edgeDefinitionKey,
      input.targetDocumentId,
    ],
  }).pipe(
    Effect.flatMap(rows => Effect.fromResult(parseSafeInteger(
      rows[0]?.adjacency_version,
      "adjacency version",
    ))),
  );
}

function buildHistoryPage(
  rows: ReadonlyArray<HistoryCandidateRow>,
  pageSize: number,
  scanCeiling: number,
): Result.Result<RelationIncomingPage, RelationSnapshotPreflightContractError> {
  return Result.gen(function* () {
    const inspectedRows = rows.slice(0, scanCeiling);
    const visible: RelationIncomingOccurrence[] = [];
    let inspectedOccurrenceCount = 0;
    let consumedFrontier: RelationConsumedFrontier | null = null;

    for (const row of inspectedRows) {
      const occurrence = yield* decodeHistoryOccurrence(row);
      const isPresent = yield* decodeBoolean(
        row.is_present,
        "history presence flag",
      );
      inspectedOccurrenceCount += 1;
      consumedFrontier = frontierFromOccurrence(occurrence);
      if (isPresent) visible.push(occurrence);
      if (visible.length === pageSize) break;
    }

    const exhausted = inspectedOccurrenceCount === rows.length &&
      rows.length <= scanCeiling;
    return freezePage(
      visible,
      consumedFrontier,
      exhausted,
      inspectedOccurrenceCount,
    );
  });
}

function freezePage(
  occurrences: ReadonlyArray<RelationIncomingOccurrence>,
  consumedFrontier: RelationConsumedFrontier | null,
  exhausted: boolean,
  inspectedOccurrenceCount: number,
): RelationIncomingPage {
  return Object.freeze({
    occurrences: Object.freeze([...occurrences]),
    consumedFrontier: consumedFrontier === null
      ? null
      : Object.freeze({ ...consumedFrontier }),
    exhausted,
    inspectedOccurrenceCount,
  });
}

function decodeHistoryOccurrence(
  row: HistoryCandidateRow,
): Result.Result<
  RelationIncomingOccurrence,
  RelationSnapshotPreflightContractError
> {
  return Result.gen(function* () {
    const sourceDocumentId = yield* parsePositiveSafeInteger(
      row.source_document_id,
      "history source document ID",
    );
    const targetDocumentId = yield* parsePositiveSafeInteger(
      row.target_document_id,
      "history target document ID",
    );
    const duplicateOrdinal = yield* decodeNonNegativeInteger(
      row.duplicate_ordinal,
      "history duplicate ordinal",
    );
    const position = yield* decodeNullableNonNegativeInteger(
      row.position,
      "history position",
    );
    const commitSeq = yield* parsePositiveSafeInteger(
      row.commit_seq,
      "history commit sequence",
    );
    return Object.freeze({
      sourceDocumentId,
      targetDocumentId,
      duplicateOrdinal,
      position,
      commitSeq,
    });
  });
}

function decodeCurrentOccurrence(
  row: CurrentEdgeRow,
): Result.Result<
  RelationIncomingOccurrence,
  RelationSnapshotPreflightContractError
> {
  return Result.gen(function* () {
    const sourceDocumentId = yield* parsePositiveSafeInteger(
      row.source_document_id,
      "current source document ID",
    );
    const targetDocumentId = yield* parsePositiveSafeInteger(
      row.target_document_id,
      "current target document ID",
    );
    const duplicateOrdinal = yield* decodeNonNegativeInteger(
      row.duplicate_ordinal,
      "current duplicate ordinal",
    );
    const position = yield* decodeNullableNonNegativeInteger(
      row.position,
      "current position",
    );
    const commitSeq = yield* parsePositiveSafeInteger(
      row.commit_seq,
      "current commit sequence",
    );
    return Object.freeze({
      sourceDocumentId,
      targetDocumentId,
      duplicateOrdinal,
      position,
      commitSeq,
    });
  });
}

function frontierFromOccurrence(
  occurrence: RelationIncomingOccurrence,
): RelationConsumedFrontier {
  return Object.freeze({
    sourceDocumentId: occurrence.sourceDocumentId,
    duplicateOrdinal: occurrence.duplicateOrdinal,
  });
}

function deleteCurrentOccurrence(
  database: RelationSnapshotPreflightDatabase,
  occurrence: RelationEdgeOccurrence,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  return database.query({
    owner: "shared",
    phase: "write",
    operation: "delete current edge occurrence",
    sql: `delete from r01p_edge_current
          where scope_id = $1 and edge_definition_key = $2
            and source_document_id = $3 and target_document_id = $4
            and duplicate_ordinal = $5`,
    parameters: occurrenceKeyParameters(occurrence),
  }).pipe(Effect.asVoid);
}

function upsertCurrentOccurrence(
  database: RelationSnapshotPreflightDatabase,
  occurrence: RelationEdgeOccurrence,
  commitSeq: number,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  return database.query({
    owner: "shared",
    phase: "write",
    operation: "upsert current edge occurrence",
    sql: `insert into r01p_edge_current
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position, commit_seq)
          values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (
            scope_id, edge_definition_key, source_document_id,
            target_document_id, duplicate_ordinal
          ) do update
          set position = excluded.position,
              commit_seq = excluded.commit_seq`,
    parameters: [
      ...occurrenceKeyParameters(occurrence),
      occurrence.position,
      commitSeq,
    ],
  }).pipe(Effect.asVoid);
}

function appendEdgeHistory(
  database: RelationSnapshotPreflightDatabase,
  transition: RelationEdgeTransition,
  commitSeq: number,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  const before = transition.before;
  const after = transition.after;
  if (after !== null && (before === null || sameOccurrenceKey(before, after))) {
    return insertHistoryRevision(database, after, true, commitSeq);
  }
  if (before === null) return Effect.void;
  return insertHistoryRevision(database, before, false, commitSeq).pipe(
    Effect.andThen(after === null
      ? Effect.void
      : insertHistoryRevision(
        database,
        after,
        true,
        commitSeq,
      )),
  );
}

function insertHistoryRevision(
  database: RelationSnapshotPreflightDatabase,
  occurrence: RelationEdgeOccurrence,
  isPresent: boolean,
  commitSeq: number,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  return database.query({
    owner: "edgeHistory",
    phase: "write",
    operation: "append edge-history revision",
    sql: `insert into r01p_edge_history
            (scope_id, edge_definition_key, source_document_id,
             target_document_id, duplicate_ordinal, position,
             commit_seq, is_present)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    parameters: [
      occurrence.scopeId,
      occurrence.edgeDefinitionKey,
      occurrence.sourceDocumentId,
      occurrence.targetDocumentId,
      occurrence.duplicateOrdinal,
      occurrence.position,
      commitSeq,
      isPresent,
    ],
  }).pipe(Effect.asVoid);
}

function advanceAffectedAdjacencyVersions(
  database: RelationSnapshotPreflightDatabase,
  transitions: ReadonlyArray<RelationEdgeTransition>,
  commitSeq: number,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  const keys = new Map<string, Readonly<{
    direction: "incoming" | "outgoing";
    occurrence: RelationEdgeOccurrence;
  }>>();
  for (const transition of transitions) {
    for (const occurrence of [transition.before, transition.after]) {
      if (occurrence === null) continue;
      const keyPrefix = `${occurrence.scopeId}:${occurrence.edgeDefinitionKey}`;
      keys.set(
        `${keyPrefix}:outgoing:${occurrence.sourceDocumentId}`,
        Object.freeze({ direction: "outgoing", occurrence }),
      );
      keys.set(
        `${keyPrefix}:incoming:${occurrence.targetDocumentId}`,
        Object.freeze({ direction: "incoming", occurrence }),
      );
    }
  }
  return Effect.forEach(keys.values(), ({ direction, occurrence }) =>
    advanceAdjacencyVersion(
      database,
      direction,
      occurrence,
      commitSeq,
    ), { concurrency: 1, discard: true });
}

function advanceAdjacencyVersion(
  database: RelationSnapshotPreflightDatabase,
  direction: "incoming" | "outgoing",
  occurrence: RelationEdgeOccurrence,
  commitSeq: number,
): Effect.Effect<void, RelationSnapshotPreflightSqlError> {
  const endpointDocumentId = direction === "incoming"
    ? occurrence.targetDocumentId
    : occurrence.sourceDocumentId;
  return database.query({
    owner: "adjacencyVersion",
    phase: "write",
    operation: `advance ${direction} endpoint adjacency version`,
    sql: `insert into r01p_adjacency_version
            (scope_id, edge_definition_key, direction, endpoint_document_id,
             last_changed_commit_seq)
          values ($1, $2, $3, $4, $5)
          on conflict (
            scope_id, edge_definition_key, direction, endpoint_document_id
          ) do update
          set last_changed_commit_seq = greatest(
            r01p_adjacency_version.last_changed_commit_seq,
            excluded.last_changed_commit_seq
          )`,
    parameters: [
      occurrence.scopeId,
      occurrence.edgeDefinitionKey,
      direction,
      endpointDocumentId,
      commitSeq,
    ],
  }).pipe(Effect.asVoid);
}

function occurrenceKeyParameters(
  occurrence: RelationEdgeOccurrence,
): ReadonlyArray<unknown> {
  return [
    occurrence.scopeId,
    occurrence.edgeDefinitionKey,
    occurrence.sourceDocumentId,
    occurrence.targetDocumentId,
    occurrence.duplicateOrdinal,
  ];
}

function validateSameRelation(
  before: RelationEdgeOccurrence,
  after: RelationEdgeOccurrence,
): Result.Result<void, RelationSnapshotPreflightContractError> {
  if (
    before.scopeId !== after.scopeId ||
    before.edgeDefinitionKey !== after.edgeDefinitionKey
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidTransition",
      detail:
        "A proof edge transition cannot cross scope or physical-definition identity.",
    }));
  }
  return Result.succeed(undefined);
}

function validateEdgeOccurrence(
  occurrence: RelationEdgeOccurrence,
): Result.Result<void, RelationSnapshotPreflightContractError> {
  const positiveFields = [
    ["scope identity", occurrence.scopeId],
    ["physical edge-definition identity", occurrence.edgeDefinitionKey],
    ["source document identity", occurrence.sourceDocumentId],
    ["target document identity", occurrence.targetDocumentId],
  ] as const;
  for (const [name, value] of positiveFields) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return Result.fail(new RelationSnapshotPreflightContractError({
        issue: "invalidTransition",
        detail: `A proof edge occurrence requires a positive safe ${name}.`,
      }));
    }
  }
  if (
    !Number.isSafeInteger(occurrence.duplicateOrdinal) ||
    occurrence.duplicateOrdinal < 0
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidTransition",
      detail: "A proof edge occurrence requires a non-negative safe duplicate ordinal.",
    }));
  }
  if (
    occurrence.position !== null &&
    (!Number.isSafeInteger(occurrence.position) || occurrence.position < 0)
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidTransition",
      detail: "A proof edge occurrence requires a nullable non-negative safe position.",
    }));
  }
  return Result.succeed(undefined);
}

function sameOccurrenceKey(
  left: RelationEdgeOccurrence,
  right: RelationEdgeOccurrence,
): boolean {
  return left.scopeId === right.scopeId &&
    left.edgeDefinitionKey === right.edgeDefinitionKey &&
    left.sourceDocumentId === right.sourceDocumentId &&
    left.targetDocumentId === right.targetDocumentId &&
    left.duplicateOrdinal === right.duplicateOrdinal;
}

function validateIncomingPageInput(
  input: RelationIncomingPageInput,
  scanCeiling: number,
): Result.Result<void, RelationSnapshotPreflightContractError> {
  const positiveFields = [
    ["scope identity", input.scopeId],
    ["physical edge-definition identity", input.edgeDefinitionKey],
    ["target document identity", input.targetDocumentId],
  ] as const;
  for (const [name, value] of positiveFields) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return Result.fail(new RelationSnapshotPreflightContractError({
        issue: "invalidPageInput",
        detail: `A relation page requires a positive safe ${name}.`,
      }));
    }
  }
  if (
    !Number.isSafeInteger(input.snapshotCommitSeq) ||
    input.snapshotCommitSeq < 0
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidPageInput",
      detail: "A relation page requires a non-negative safe snapshot sequence.",
    }));
  }
  if (
    input.consumedFrontier !== null &&
    (
      !Number.isSafeInteger(input.consumedFrontier.sourceDocumentId) ||
      input.consumedFrontier.sourceDocumentId < 1 ||
      !Number.isSafeInteger(input.consumedFrontier.duplicateOrdinal) ||
      input.consumedFrontier.duplicateOrdinal < 0
    )
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidPageInput",
      detail: "A relation page requires a positive source and non-negative duplicate frontier.",
    }));
  }
  if (
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 ||
    input.pageSize > RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidPageBounds",
      detail: "Relation proof page size is outside the frozen ceiling.",
    }));
  }
  if (
    !Number.isSafeInteger(scanCeiling) || scanCeiling < input.pageSize ||
    scanCeiling > RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling
  ) {
    return Result.fail(new RelationSnapshotPreflightContractError({
      issue: "invalidPageBounds",
      detail: "Relation proof history scan ceiling is invalid.",
    }));
  }
  return Result.succeed(undefined);
}

function parseSafeInteger(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightContractError> {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return invalidDriverResult(name);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return invalidDriverResult(name);
  }
  return Result.succeed(parsed);
}

function parsePositiveSafeInteger(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightContractError> {
  return Result.gen(function* () {
    const parsed = yield* parseSafeInteger(value, name);
    if (parsed < 1) return yield* invalidDriverResult(name);
    return parsed;
  });
}

function decodeNonNegativeInteger(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightContractError> {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
  ) {
    return invalidDriverResult(name);
  }
  return Result.succeed(value);
}

function decodeNullableNonNegativeInteger(
  value: unknown,
  name: string,
): Result.Result<number | null, RelationSnapshotPreflightContractError> {
  return value === null
    ? Result.succeed(null)
    : decodeNonNegativeInteger(value, name);
}

function decodeBoolean(
  value: unknown,
  name: string,
): Result.Result<boolean, RelationSnapshotPreflightContractError> {
  return typeof value === "boolean"
    ? Result.succeed(value)
    : invalidDriverResult(name);
}

function invalidDriverResult(
  name: string,
): Result.Result<never, RelationSnapshotPreflightContractError> {
  return Result.fail(new RelationSnapshotPreflightContractError({
    issue: "invalidDriverResult",
    detail: `The SQL driver returned an invalid ${name}.`,
  }));
}
