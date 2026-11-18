import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { asNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  type Pool,
  type PoolClient,
  type QueryResultRow,
} from "pg";

import {
  applyRelationEdgeTransitions,
  installRelationSnapshotPreflightSchema,
  makeRelationSnapshotPreflightDatabase,
  makeRelationSnapshotPreflightTransactionDatabase,
  readAdjacencyVersionIncomingPage,
  readHistoryIncomingPage,
  RELATION_SNAPSHOT_PREFLIGHT_PROFILE,
  RelationSnapshotPreflightSqlError,
  seedRelationSnapshotPreflightProfile,
  type RelationIncomingPageInput,
  type RelationEdgeTransition,
  type RelationSnapshotPreflightDatabase,
  type RelationSnapshotPreflightOwner,
  type RelationSnapshotPreflightPhase,
  type RelationSnapshotSupportCandidate,
} from "./relationSnapshotSupportPreflight";

export class RelationSnapshotPreflightEvidenceError extends Data.TaggedError(
  "RelationSnapshotPreflightEvidenceError",
)<{
  readonly issue:
    | "invalidPostgresVersion"
    | "invalidMeasurement"
    | "invalidPlan"
    | "unboundedPlan"
    | "snapshotMismatch"
    | "contentionIncomplete"
    | "invalidAcceptanceEnvironment"
    | "acceptanceThresholdExceeded"
    | "registrationRaceNotObserved";
  readonly detail: string;
}> {}

export interface RelationPlanMeasurement {
  readonly name: string;
  readonly planningMilliseconds: number;
  readonly executionMilliseconds: number;
  readonly actualRows: number;
  readonly maximumNodeActualRows: number;
  readonly maximumNodeActualLoops: number;
  readonly rowsRemovedByFilter: number;
  readonly sharedHitBlocks: number;
  readonly sharedReadBlocks: number;
  readonly sharedDirtiedBlocks: number;
  readonly sharedWrittenBlocks: number;
  readonly nodeTypes: ReadonlyArray<string>;
  readonly indexNames: ReadonlyArray<string>;
  readonly sequentialScanRelations: ReadonlyArray<string>;
}

export interface RelationStorageMeasurement {
  readonly relation: string;
  readonly tableBytes: number;
  readonly indexBytes: number;
  readonly totalBytes: number;
}

export interface RelationWalMeasurement {
  readonly candidate: RelationSnapshotSupportCandidate;
  readonly roundBytes: ReadonlyArray<number>;
  readonly averageBytes: number;
  readonly logicalMutationsPerRound: number;
  readonly averageBytesPerLogicalMutation: number;
}

export interface RelationContentionMeasurement {
  readonly candidate: RelationSnapshotSupportCandidate;
  readonly includesScopeClock: boolean;
  readonly writerCount: number;
  readonly writesPerWriter: number;
  readonly completedTransactions: number;
  readonly elapsedMilliseconds: number;
  readonly p50Milliseconds: number;
  readonly p95Milliseconds: number;
  readonly p99Milliseconds: number;
}

export interface RelationTableActivityMeasurement {
  readonly relation: string;
  readonly insertedTuples: number;
  readonly updatedTuples: number;
  readonly deletedTuples: number;
  readonly hotUpdatedTuples: number;
  readonly liveTupleEstimate: number;
  readonly deadTupleEstimate: number;
  readonly vacuumCount: number;
  readonly autovacuumCount: number;
}

export interface RelationRegistrationRaceMeasurement {
  readonly finalValidationBlockedByWriter: boolean;
  readonly expectedVersion: number;
  readonly observedVersionAfterLock: number;
  readonly staleDependencyRejected: boolean;
}

export interface RelationSnapshotPostgresReceipt {
  readonly format: "flarex.r01-p/relation-snapshot-comparison-receipt/v1";
  readonly postgresVersion: string;
  readonly plannerSettings: Readonly<{
    readonly planCacheMode: string;
    readonly randomPageCost: string;
    readonly effectiveCacheSize: string;
    readonly fullPageWrites: string;
    readonly walCompression: string;
  }>;
  readonly profile: typeof RELATION_SNAPSHOT_PREFLIGHT_PROFILE;
  readonly seededCurrentEdgeCount: number;
  readonly seededHistoryRevisionCount: number;
  readonly seededAdjacencyVersionCount: number;
  readonly semanticParity: Readonly<{
    readonly highFanoutPageCount: number;
    readonly historyOldSnapshotSourceCount: number;
    readonly adjacencyOldSnapshotDisposition: "conflict";
    readonly rolledBackTransitionInvisible: true;
    readonly rolledBackScopeClockAbsent: true;
  }>;
  readonly preparedPlans: ReadonlyArray<RelationPlanMeasurement>;
  readonly storageBeforeChurn: ReadonlyArray<RelationStorageMeasurement>;
  readonly wal: ReadonlyArray<RelationWalMeasurement>;
  readonly contention: ReadonlyArray<RelationContentionMeasurement>;
  readonly registrationRace: RelationRegistrationRaceMeasurement;
  readonly activityBeforeVacuum: ReadonlyArray<RelationTableActivityMeasurement>;
  readonly storageAfterVacuum: ReadonlyArray<RelationStorageMeasurement>;
  readonly activityAfterVacuum: ReadonlyArray<RelationTableActivityMeasurement>;
  readonly cleanupOwner: "temporarySchemaFixture";
}

interface CountRow extends QueryResultRow {
  readonly current_edges: string;
  readonly history_revisions: string;
  readonly adjacency_versions: string;
}

interface SettingRow extends QueryResultRow {
  readonly plan_cache_mode: string;
  readonly random_page_cost: string;
  readonly effective_cache_size: string;
  readonly full_page_writes: string;
  readonly wal_compression: string;
}

interface VersionRow extends QueryResultRow {
  readonly server_version: string;
}

interface ExplainRow extends QueryResultRow {
  readonly "QUERY PLAN": unknown;
}

interface StorageRow extends QueryResultRow {
  readonly table_bytes: string;
  readonly index_bytes: string;
  readonly total_bytes: string;
}

interface WalLsnRow extends QueryResultRow {
  readonly lsn: string;
}

interface WalBytesRow extends QueryResultRow {
  readonly wal_bytes: string;
}

interface ScopeClockRow extends QueryResultRow {
  readonly last_commit_seq: string;
}

interface ScopeClockPresenceRow extends QueryResultRow {
  readonly scope_clock_exists: boolean;
}

interface ActivityRow extends QueryResultRow {
  readonly inserted_tuples: string;
  readonly updated_tuples: string;
  readonly deleted_tuples: string;
  readonly hot_updated_tuples: string;
  readonly live_tuple_estimate: string;
  readonly dead_tuple_estimate: string;
  readonly vacuum_count: string;
  readonly autovacuum_count: string;
}

interface BackendPidRow extends QueryResultRow {
  readonly pid: number;
}

interface ExternalActivityRow extends QueryResultRow {
  readonly external_activity_count: string;
}

type RelationWalMutationKind = "insert" | "delete" | "retarget" | "reorder";

const SUPPORT_RELATIONS = Object.freeze([
  "r01p_edge_current",
  "r01p_edge_history",
  "r01p_adjacency_version",
] as const);

const HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID =
  RELATION_SNAPSHOT_PREFLIGHT_PROFILE.highFanout -
  (RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1);

const REQUIRED_PREPARED_PLAN_NAMES = Object.freeze([
  "history-auto-initial-hot",
  "history-auto-initial-ordinary",
  "history-auto-resume-tail",
  "current-auto-initial-hot",
  "current-auto-initial-ordinary",
  "current-auto-resume-tail",
  "version-auto-hot",
  "history-generic-initial-hot",
  "history-generic-resume-tail",
  "current-generic-initial-hot",
  "current-generic-resume-tail",
] as const);

export function makePostgresRelationSnapshotPreflightDatabase(
  queryable: Pick<Pool | PoolClient, "query">,
): RelationSnapshotPreflightDatabase {
  return makeRelationSnapshotPreflightDatabase({
    query: async <Row extends Readonly<Record<string, unknown>>>(
      sql: string,
      parameters: ReadonlyArray<unknown>,
    ) => {
      const result = await queryable.query<Row & QueryResultRow>(
        sql,
        [...parameters],
      );
      return result.rows;
    },
  });
}

function makePostgresRelationSnapshotPreflightTransactionDatabase(
  client: PoolClient,
) {
  return makeRelationSnapshotPreflightTransactionDatabase({
    query: async <Row extends Readonly<Record<string, unknown>>>(
      sql: string,
      parameters: ReadonlyArray<unknown>,
    ) => {
      const result = await client.query<Row & QueryResultRow>(
        sql,
        [...parameters],
      );
      return result.rows;
    },
  });
}

export const collectRelationSnapshotPostgresReceipt = Effect.fn(
  "RelationSnapshotPreflight.collectPostgresReceipt",
)(function* (
  pool: Pool,
  database: RelationSnapshotPreflightDatabase,
) {
  yield* installRelationSnapshotPreflightSchema(database);
  yield* seedRelationSnapshotPreflightProfile(database);
  yield* flushPoolStatistics(pool);
  yield* vacuumSupportRelations(database);
  yield* flushPoolStatistics(pool);

  const postgresVersion = yield* readPostgresVersion(database);
  const plannerSettings = yield* readPlannerSettings(database);
  const counts = yield* readSeedCounts(database);
  const storageBeforeChurn = yield* readStorage(database);
  const semanticParity = yield* proveSemanticParity(pool, database);
  const preparedPlans = yield* measurePreparedPlans(pool);
  yield* validatePreparedPlans(preparedPlans);
  const wal = yield* measureWal(pool);
  const contention = yield* measureContentionMatrix(pool);
  const registrationRace = yield* proveRegistrationRace(pool);
  yield* flushPoolStatistics(pool);
  const activityBeforeVacuum = yield* readActivity(database);
  yield* vacuumSupportRelations(database);
  const storageAfterVacuum = yield* readStorage(database);
  yield* flushPoolStatistics(pool);
  const activityAfterVacuum = yield* readActivity(database);

  const receipt = Object.freeze({
    format: "flarex.r01-p/relation-snapshot-comparison-receipt/v1" as const,
    postgresVersion,
    plannerSettings,
    profile: RELATION_SNAPSHOT_PREFLIGHT_PROFILE,
    seededCurrentEdgeCount: counts.currentEdges,
    seededHistoryRevisionCount: counts.historyRevisions,
    seededAdjacencyVersionCount: counts.adjacencyVersions,
    semanticParity,
    preparedPlans,
    storageBeforeChurn,
    wal,
    contention,
    registrationRace,
    activityBeforeVacuum,
    storageAfterVacuum,
    activityAfterVacuum,
    cleanupOwner: "temporarySchemaFixture" as const,
  }) satisfies RelationSnapshotPostgresReceipt;
  yield* validatePostgresAcceptanceReceipt(receipt);
  return receipt;
});

function readPostgresVersion(
  database: RelationSnapshotPreflightDatabase,
): Effect.Effect<
  string,
  RelationSnapshotPreflightSqlError | RelationSnapshotPreflightEvidenceError
> {
  return database.query<VersionRow>({
    owner: "shared",
    phase: "measure",
    operation: "read PostgreSQL server version",
    sql: "show server_version",
  }).pipe(
    Effect.flatMap(rows => {
      const version = rows[0]?.server_version;
      return typeof version === "string" && /^18\./.test(version)
        ? Effect.succeed(version)
        : Effect.fail(new RelationSnapshotPreflightEvidenceError({
          issue: "invalidPostgresVersion",
          detail: `R01-P requires PostgreSQL 18; observed ${String(version)}.`,
        }));
    }),
  );
}

function readPlannerSettings(
  database: RelationSnapshotPreflightDatabase,
) {
  return database.query<SettingRow>({
    owner: "shared",
    phase: "measure",
    operation: "read planner and WAL settings",
    sql: `select current_setting('plan_cache_mode') as plan_cache_mode,
                 current_setting('random_page_cost') as random_page_cost,
                 current_setting('effective_cache_size') as effective_cache_size,
                 current_setting('full_page_writes') as full_page_writes,
                 current_setting('wal_compression') as wal_compression`,
  }).pipe(
    Effect.flatMap(rows => {
      const row = rows[0];
      return row === undefined
        ? Effect.fail(new RelationSnapshotPreflightEvidenceError({
          issue: "invalidMeasurement",
          detail: "PostgreSQL returned no planner/WAL settings.",
        }))
        : Effect.succeed(Object.freeze({
          planCacheMode: row.plan_cache_mode,
          randomPageCost: row.random_page_cost,
          effectiveCacheSize: row.effective_cache_size,
          fullPageWrites: row.full_page_writes,
          walCompression: row.wal_compression,
        }));
    }),
  );
}

function readSeedCounts(database: RelationSnapshotPreflightDatabase) {
  return database.query<CountRow>({
    owner: "shared",
    phase: "measure",
    operation: "count seeded candidate rows",
    sql: `select
            (select count(*) from r01p_edge_current)::text as current_edges,
            (select count(*) from r01p_edge_history)::text as history_revisions,
            (select count(*) from r01p_adjacency_version)::text as adjacency_versions`,
  }).pipe(
    Effect.flatMap(rows => {
      const row = rows[0];
      if (row === undefined) {
        return Effect.fail(new RelationSnapshotPreflightEvidenceError({
          issue: "invalidMeasurement",
          detail: "PostgreSQL returned no seeded candidate counts.",
        }));
      }
      return Effect.fromResult(Result.gen(function* () {
        const currentEdges = yield* parseNonNegativeInteger(
          row.current_edges,
          "current edge count",
        );
        const historyRevisions = yield* parseNonNegativeInteger(
          row.history_revisions,
          "history revision count",
        );
        const adjacencyVersions = yield* parseNonNegativeInteger(
          row.adjacency_versions,
          "adjacency version count",
        );
        return Object.freeze({
          currentEdges,
          historyRevisions,
          adjacencyVersions,
        });
      }));
    }),
  );
}

const proveSemanticParity = Effect.fn(
  "RelationSnapshotPreflight.provePostgresSemanticParity",
)(function* (
  pool: Pool,
  database: RelationSnapshotPreflightDatabase,
) {
  const highFanoutInput = Object.freeze({
    scopeId: 1,
    edgeDefinitionKey: 1,
    targetDocumentId: 1,
    snapshotCommitSeq: RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth,
    pageSize: RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize,
    consumedFrontier: null,
  } satisfies RelationIncomingPageInput);
  const historyHighFanout = yield* readHistoryIncomingPage(
    database,
    highFanoutInput,
  );
  const adjacencyHighFanout = yield* readAdjacencyVersionIncomingPage(
    database,
    highFanoutInput,
  );
  if (
    adjacencyHighFanout.status !== "success" ||
    JSON.stringify(adjacencyHighFanout.page.occurrences) !==
      JSON.stringify(historyHighFanout.occurrences)
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "snapshotMismatch",
      detail: "Populated PostgreSQL candidates returned different current pages.",
    }));
  }

  const before = Object.freeze({
    scopeId: 70,
    edgeDefinitionKey: 1,
    sourceDocumentId: 7001,
    targetDocumentId: 700,
    duplicateOrdinal: 0,
    position: 0,
  });
  yield* runPostgresTransition(pool, {
    before: null,
    after: before,
  });
  yield* runPostgresTransition(pool, {
    before,
    after: Object.freeze({ ...before, targetDocumentId: 701 }),
  });
  const oldSnapshotInput = Object.freeze({
    scopeId: 70,
    edgeDefinitionKey: 1,
    targetDocumentId: 700,
    snapshotCommitSeq: 1,
    pageSize: 8,
    consumedFrontier: null,
  } satisfies RelationIncomingPageInput);
  const historyOldSnapshot = yield* readHistoryIncomingPage(
    database,
    oldSnapshotInput,
  );
  const adjacencyOldSnapshot = yield* readAdjacencyVersionIncomingPage(
    database,
    oldSnapshotInput,
  );
  if (
    historyOldSnapshot.occurrences.length !== 1 ||
    adjacencyOldSnapshot.status !== "conflict"
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "snapshotMismatch",
      detail: "PostgreSQL old-snapshot candidate dispositions were not exact.",
    }));
  }
  const rolledBackOccurrence = Object.freeze({
    scopeId: 71,
    edgeDefinitionKey: 1,
    sourceDocumentId: 7101,
    targetDocumentId: 710,
    duplicateOrdinal: 0,
    position: 0,
  });
  yield* runPostgresTransition(
    pool,
    {
      before: null,
      after: rolledBackOccurrence,
    },
    "rollback",
  );
  const rolledBackInput = Object.freeze({
    scopeId: 71,
    edgeDefinitionKey: 1,
    targetDocumentId: 710,
    snapshotCommitSeq: 1,
    pageSize: 8,
    consumedFrontier: null,
  } satisfies RelationIncomingPageInput);
  const rolledBackHistory = yield* readHistoryIncomingPage(
    database,
    rolledBackInput,
  );
  const rolledBackAdjacency = yield* readAdjacencyVersionIncomingPage(
    database,
    rolledBackInput,
  );
  const rolledBackClock = yield* database.query<ScopeClockPresenceRow>({
    owner: "shared",
    phase: "read",
    operation: "verify rolled-back scope clock absence",
    sql: `select exists(
            select 1 from r01p_scope_clock where scope_id = $1
          ) as scope_clock_exists`,
    parameters: [rolledBackOccurrence.scopeId],
  });
  if (
    rolledBackHistory.occurrences.length !== 0 ||
    rolledBackAdjacency.status !== "success" ||
    rolledBackAdjacency.expectedAdjacencyVersion !== 0 ||
    rolledBackAdjacency.page.occurrences.length !== 0 ||
    rolledBackClock[0]?.scope_clock_exists !== false
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "snapshotMismatch",
      detail: "PostgreSQL exposed a rolled-back current/history/version transition.",
    }));
  }
  return Object.freeze({
    highFanoutPageCount: historyHighFanout.occurrences.length,
    historyOldSnapshotSourceCount: historyOldSnapshot.occurrences.length,
    adjacencyOldSnapshotDisposition: "conflict" as const,
    rolledBackTransitionInvisible: true as const,
    rolledBackScopeClockAbsent: true as const,
  });
});

function runPostgresTransition(
  pool: Pool,
  transition: RelationEdgeTransition,
  disposition: "commit" | "rollback" = "commit",
) {
  return withClient(
    pool,
    "shared",
    "write",
    "acquire transaction-bound relation transition client",
    Effect.fn("RelationSnapshotPreflight.runPostgresTransition")(
      function* (client) {
        const database =
          makePostgresRelationSnapshotPreflightTransactionDatabase(client);
        yield* database.query({
          owner: "shared",
          phase: "write",
          operation: "begin PostgreSQL relation transition",
          sql: "begin",
        });
        yield* applyRelationEdgeTransitions(database, [transition]);
        yield* database.query({
          owner: "shared",
          phase: "write",
          operation: `${disposition} PostgreSQL relation transition`,
          sql: disposition,
        });
      },
    ),
  );
}

function measurePreparedPlans(pool: Pool) {
  return withClient(
    pool,
    "shared",
    "explain",
    "acquire prepared-plan client",
    Effect.fn("RelationSnapshotPreflight.measurePreparedPlans")(function* (client) {
      const database = makePostgresRelationSnapshotPreflightDatabase(client);
      yield* database.query({
        owner: "edgeHistory",
        phase: "explain",
        operation: "prepare initial history page",
        sql: `prepare r01p_history_initial_page
                (integer, bigint, bigint, bigint, integer)
              as
              select source_document_id, target_document_id,
                     duplicate_ordinal, position, commit_seq, is_present
              from (
                select distinct on (
                         source_document_id, duplicate_ordinal
                       )
                       source_document_id, target_document_id,
                       duplicate_ordinal, position, is_present, commit_seq
                from r01p_edge_history
                where scope_id = $1 and edge_definition_key = $2
                  and target_document_id = $3 and commit_seq <= $4
                order by source_document_id, duplicate_ordinal,
                         commit_seq desc
              ) as latest
              order by source_document_id, duplicate_ordinal
              limit $5`,
      });
      yield* database.query({
        owner: "edgeHistory",
        phase: "explain",
        operation: "prepare resumed history page",
        sql: `prepare r01p_history_after_page
                (integer, bigint, bigint, bigint, bigint, integer, integer)
              as
              select source_document_id, target_document_id,
                     duplicate_ordinal, position, commit_seq, is_present
              from (
                select distinct on (
                         source_document_id, duplicate_ordinal
                       )
                       source_document_id, target_document_id,
                       duplicate_ordinal, position, is_present, commit_seq
                from r01p_edge_history
                where scope_id = $1 and edge_definition_key = $2
                  and target_document_id = $3 and commit_seq <= $4
                  and (source_document_id, duplicate_ordinal) > ($5, $6)
                order by source_document_id, duplicate_ordinal,
                         commit_seq desc
              ) as latest
              order by source_document_id, duplicate_ordinal
              limit $7`,
      });
      yield* database.query({
        owner: "adjacencyVersion",
        phase: "explain",
        operation: "prepare initial current edge page",
        sql: `prepare r01p_current_initial_page
                (integer, bigint, bigint, integer)
              as
              select source_document_id, target_document_id,
                     duplicate_ordinal, position, commit_seq
              from r01p_edge_current
              where scope_id = $1 and edge_definition_key = $2
                and target_document_id = $3
              order by source_document_id, duplicate_ordinal
              limit $4`,
      });
      yield* database.query({
        owner: "adjacencyVersion",
        phase: "explain",
        operation: "prepare resumed current edge page",
        sql: `prepare r01p_current_after_page
                (integer, bigint, bigint, bigint, integer, integer)
              as
              select source_document_id, target_document_id,
                     duplicate_ordinal, position, commit_seq
              from r01p_edge_current
              where scope_id = $1 and edge_definition_key = $2
                and target_document_id = $3
                and (source_document_id, duplicate_ordinal) > ($4, $5)
              order by source_document_id, duplicate_ordinal
              limit $6`,
      });
      yield* database.query({
        owner: "adjacencyVersion",
        phase: "explain",
        operation: "prepare adjacency version read",
        sql: `prepare r01p_version_read (integer, bigint, bigint) as
              select last_changed_commit_seq
              from r01p_adjacency_version
              where scope_id = $1 and edge_definition_key = $2
                and direction = 'incoming' and endpoint_document_id = $3`,
      });

      for (let iteration = 0; iteration < 6; iteration += 1) {
        const target = iteration % 2 === 0 ? 1 : 100001;
        const resumeFrontier = target === 1
          ? HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID
          : 1_000_000;
        yield* database.query({
          owner: "edgeHistory",
          phase: "explain",
          operation: "warm prepared initial history page",
          sql: `execute r01p_history_initial_page(
                  1, 1, ${target},
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
                )`,
        });
        yield* database.query({
          owner: "edgeHistory",
          phase: "explain",
          operation: "warm prepared resumed history page",
          sql: `execute r01p_history_after_page(
                  1, 1, ${target},
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
                  ${resumeFrontier}, 0,
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
                )`,
        });
        yield* database.query({
          owner: "adjacencyVersion",
          phase: "explain",
          operation: "warm prepared initial current page",
          sql: `execute r01p_current_initial_page(
                  1, 1, ${target},
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
                )`,
        });
        yield* database.query({
          owner: "adjacencyVersion",
          phase: "explain",
          operation: "warm prepared resumed current page",
          sql: `execute r01p_current_after_page(
                  1, 1, ${target}, ${resumeFrontier}, 0,
                  ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
                )`,
        });
      }

      const measurements: RelationPlanMeasurement[] = [];
      measurements.push(yield* explainPrepared(
        database,
        "history-auto-initial-hot",
        "edgeHistory",
        `execute r01p_history_initial_page(
           1, 1, 1,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "history-auto-initial-ordinary",
        "edgeHistory",
        `execute r01p_history_initial_page(
           1, 1, 100001,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "history-auto-resume-tail",
        "edgeHistory",
        `execute r01p_history_after_page(
           1, 1, 1,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
           ${HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID}, 0,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "current-auto-initial-hot",
        "adjacencyVersion",
        `execute r01p_current_initial_page(
           1, 1, 1, ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "current-auto-initial-ordinary",
        "adjacencyVersion",
        `execute r01p_current_initial_page(
           1, 1, 100001, ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "current-auto-resume-tail",
        "adjacencyVersion",
        `execute r01p_current_after_page(
           1, 1, 1, ${HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID}, 0,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "version-auto-hot",
        "adjacencyVersion",
        "execute r01p_version_read(1, 1, 1)",
      ));

      yield* database.query({
        owner: "shared",
        phase: "explain",
        operation: "force generic prepared plans",
        sql: "set plan_cache_mode = force_generic_plan",
      });
      measurements.push(yield* explainPrepared(
        database,
        "history-generic-initial-hot",
        "edgeHistory",
        `execute r01p_history_initial_page(
           1, 1, 1,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "history-generic-resume-tail",
        "edgeHistory",
        `execute r01p_history_after_page(
           1, 1, 1,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth},
           ${HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID}, 0,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "current-generic-initial-hot",
        "adjacencyVersion",
        `execute r01p_current_initial_page(
           1, 1, 1, ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
         )`,
      ));
      measurements.push(yield* explainPrepared(
        database,
        "current-generic-resume-tail",
        "adjacencyVersion",
        `execute r01p_current_after_page(
           1, 1, 1, ${HOT_RESUME_FRONTIER_SOURCE_DOCUMENT_ID}, 0,
           ${RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1}
         )`,
      ));
      yield* database.query({
        owner: "shared",
        phase: "explain",
        operation: "restore automatic prepared plans",
        sql: "set plan_cache_mode = auto",
      });
      yield* database.query({
        owner: "shared",
        phase: "explain",
        operation: "release prepared statements",
        sql: "deallocate all",
      });
      return Object.freeze(measurements);
    }),
  );
}

function explainPrepared(
  database: RelationSnapshotPreflightDatabase,
  name: string,
  owner: RelationSnapshotSupportCandidate,
  executeSql: string,
) {
  return database.query<ExplainRow>({
    owner,
    phase: "explain",
    operation: `explain ${name}`,
    sql: `explain (
            analyze, buffers, wal, settings, costs off, timing off, format json
          ) ${executeSql}`,
  }).pipe(
    Effect.flatMap(rows => decodePlanMeasurement(name, rows[0]?.["QUERY PLAN"])),
  );
}

function decodePlanMeasurement(
  name: string,
  raw: unknown,
): Effect.Effect<RelationPlanMeasurement, RelationSnapshotPreflightEvidenceError> {
  const top = Array.isArray(raw) ? asNonArrayRecord(raw[0]) : null;
  const plan = top === null ? null : asNonArrayRecord(top["Plan"]);
  if (top === null || plan === null) {
    return Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidPlan",
      detail: `${name} returned no PostgreSQL JSON plan.`,
    }));
  }
  const nodes = collectPlanNodes(plan);
  if (nodes.length === 0) {
    return Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidPlan",
      detail: `${name} returned a PostgreSQL plan without executable nodes.`,
    }));
  }
  return Effect.fromResult(Result.gen(function* () {
    const planningMilliseconds = yield* decodeFiniteNumber(
      top["Planning Time"],
      `${name} planning time`,
    );
    const executionMilliseconds = yield* decodeFiniteNumber(
      top["Execution Time"],
      `${name} execution time`,
    );
    const actualRows = yield* decodeFiniteNumber(
      plan["Actual Rows"],
      `${name} actual rows`,
    );
    const nodeActualRows = yield* Result.all(nodes.map(node =>
      decodeFiniteNumber(node["Actual Rows"], "plan actual rows")
    ));
    const nodeActualLoops = yield* Result.all(nodes.map(node =>
      decodeFiniteNumber(node["Actual Loops"], "plan actual loops")
    ));
    const nodeRowsRemovedByFilter = yield* Result.all(nodes.map(node =>
      decodeOptionalFiniteNumber(
        node["Rows Removed by Filter"],
        "plan rows removed by filter",
      )
    ));
    const sharedHitBlocks = yield* decodeOptionalFiniteNumber(
      plan["Shared Hit Blocks"],
      "plan shared-hit blocks",
    );
    const sharedReadBlocks = yield* decodeOptionalFiniteNumber(
      plan["Shared Read Blocks"],
      "plan shared-read blocks",
    );
    const sharedDirtiedBlocks = yield* decodeOptionalFiniteNumber(
      plan["Shared Dirtied Blocks"],
      "plan shared-dirtied blocks",
    );
    const sharedWrittenBlocks = yield* decodeOptionalFiniteNumber(
      plan["Shared Written Blocks"],
      "plan shared-written blocks",
    );
    return Object.freeze({
      name,
      planningMilliseconds,
      executionMilliseconds,
      actualRows,
      maximumNodeActualRows: Math.max(...nodeActualRows),
      maximumNodeActualLoops: Math.max(...nodeActualLoops),
      rowsRemovedByFilter: nodeRowsRemovedByFilter.reduce(
        (total, value) => total + value,
        0,
      ),
      sharedHitBlocks,
      sharedReadBlocks,
      sharedDirtiedBlocks,
      sharedWrittenBlocks,
      nodeTypes: Object.freeze(uniqueStrings(nodes.map(node => node["Node Type"]))),
      indexNames: Object.freeze(uniqueStrings(nodes.map(node => node["Index Name"]))),
      sequentialScanRelations: Object.freeze(uniqueStrings(
        nodes
          .filter(node => node["Node Type"] === "Seq Scan")
          .map(node => node["Relation Name"]),
      )),
    });
  }));
}

function validatePreparedPlans(
  plans: ReadonlyArray<RelationPlanMeasurement>,
): Effect.Effect<void, RelationSnapshotPreflightEvidenceError> {
  const pageLookahead = RELATION_SNAPSHOT_PREFLIGHT_PROFILE.pageSize + 1;
  const historyCandidateLookahead =
    RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling + 1;
  const retainedDepthLookahead =
    historyCandidateLookahead *
    RELATION_SNAPSHOT_PREFLIGHT_PROFILE.retainedHistoryDepth;
  const observedNames = new Set(plans.map(plan => plan.name));
  const missingNames = REQUIRED_PREPARED_PLAN_NAMES.filter(name =>
    !observedNames.has(name)
  );
  if (
    plans.length !== REQUIRED_PREPARED_PLAN_NAMES.length ||
    observedNames.size !== plans.length ||
    missingNames.length > 0
  ) {
    return Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidPlan",
      detail: `Prepared-plan receipt names were incomplete or duplicated; missing: ${missingNames.join(", ") || "none"}.`,
    }));
  }
  for (const plan of plans) {
    const isHistory = plan.name.startsWith("history-");
    const isCurrent = plan.name.startsWith("current-");
    const isVersion = plan.name.startsWith("version-");
    const isResume = plan.name.includes("-resume-");
    const isRetainedHistoryInitial =
      isHistory && plan.name.includes("-initial-hot");
    const expectedIndex = isHistory
      ? "r01p_edge_history_snapshot_idx"
      : isCurrent
      ? "r01p_edge_current_incoming_idx"
      : "r01p_adjacency_version_pkey";
    if (
      (isHistory || isCurrent || isVersion) &&
      !plan.indexNames.includes(expectedIndex)
    ) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} did not use ${expectedIndex}.`,
      }));
    }
    if (plan.sequentialScanRelations.some(relation =>
      SUPPORT_RELATIONS.includes(
        relation as typeof SUPPORT_RELATIONS[number],
      )
    )) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} used a candidate-table sequential scan.`,
      }));
    }
    const resultRowCeiling = isHistory && !isResume
      ? historyCandidateLookahead
      : isVersion
      ? 1
      : pageLookahead;
    if (plan.actualRows > resultRowCeiling) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} returned more than its frozen lookahead ceiling.`,
      }));
    }
    if (isResume && plan.actualRows !== pageLookahead) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "invalidPlan",
        detail: `${plan.name} did not return the exact near-tail lookahead.`,
      }));
    }
    const maximumRows = isRetainedHistoryInitial
      ? retainedDepthLookahead
      : isHistory && !isResume
      ? historyCandidateLookahead
      : isVersion
      ? 1
      : pageLookahead;
    if (plan.maximumNodeActualRows > maximumRows || plan.maximumNodeActualLoops > 1) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} exceeded its bounded node work.`,
      }));
    }
    if (plan.rowsRemovedByFilter !== 0) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} removed rows by filter instead of applying index bounds.`,
      }));
    }
    if (plan.nodeTypes.some(nodeType => nodeType.includes("Sort"))) {
      return Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "unboundedPlan",
        detail: `${plan.name} introduced a sort above its frozen access path.`,
      }));
    }
  }
  return Effect.void;
}

const validatePostgresAcceptanceReceipt = Effect.fn(
  "RelationSnapshotPreflight.validatePostgresAcceptanceReceipt",
)(function* (receipt: RelationSnapshotPostgresReceipt) {
  const settings = receipt.plannerSettings;
  const randomPageCost = Number(settings.randomPageCost);
  if (
    settings.planCacheMode !== "auto" ||
    !Number.isFinite(randomPageCost) || randomPageCost !== 4 ||
    settings.fullPageWrites !== "on" ||
    settings.walCompression !== "off"
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidAcceptanceEnvironment",
      detail: "R01-P requires plan_cache_mode=auto, random_page_cost=4, full_page_writes=on, and wal_compression=off.",
    }));
  }

  const retainedHistoryPlans = [
    "history-auto-initial-hot",
    "history-generic-initial-hot",
  ]
    .map(name => receipt.preparedPlans.find(plan => plan.name === name));
  if (
    retainedHistoryPlans.some(plan =>
      plan === undefined ||
      plan.maximumNodeActualRows <=
        RELATION_SNAPSHOT_PREFLIGHT_PROFILE.historyScanCeiling
    )
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "acceptanceThresholdExceeded",
      detail: "The retained-depth history plans did not expose revision scanning beyond the frozen history candidate ceiling.",
    }));
  }

  const scopeSerializedHistory = receipt.contention.filter(measurement =>
    measurement.candidate === "edgeHistory" && measurement.includesScopeClock
  );
  const scopeSerializedAdjacency = receipt.contention.filter(measurement =>
    measurement.candidate === "adjacencyVersion" &&
    measurement.includesScopeClock
  );
  const history = scopeSerializedHistory[0];
  const adjacency = scopeSerializedAdjacency[0];
  if (
    scopeSerializedHistory.length !== 1 ||
    scopeSerializedAdjacency.length !== 1 ||
    history === undefined || adjacency === undefined
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "contentionIncomplete",
      detail: "The receipt did not contain exactly one scope-serialized measurement per candidate.",
    }));
  }
  if (
    history.elapsedMilliseconds <= 0 || history.p95Milliseconds <= 0 ||
    adjacency.elapsedMilliseconds <= 0 || adjacency.p95Milliseconds <= 0
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidMeasurement",
      detail: "Scope-serialized contention timings must be positive before comparison.",
    }));
  }
  if (
    adjacency.elapsedMilliseconds > history.elapsedMilliseconds * 2 ||
    adjacency.p95Milliseconds > history.p95Milliseconds * 2
  ) {
    return yield* Effect.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "acceptanceThresholdExceeded",
      detail: `Scope-serialized adjacency contention exceeded 2x history (elapsed ${adjacency.elapsedMilliseconds}/${history.elapsedMilliseconds} ms, p95 ${adjacency.p95Milliseconds}/${history.p95Milliseconds} ms).`,
    }));
  }
});

function readStorage(database: RelationSnapshotPreflightDatabase) {
  return Effect.forEach(SUPPORT_RELATIONS, relation =>
    database.query<StorageRow>({
      owner: relation === "r01p_edge_history"
        ? "edgeHistory"
        : relation === "r01p_adjacency_version"
        ? "adjacencyVersion"
        : "shared",
      phase: "measure",
      operation: `measure ${relation} storage`,
      sql: `select pg_table_size($1::regclass)::text as table_bytes,
                   pg_indexes_size($1::regclass)::text as index_bytes,
                   pg_total_relation_size($1::regclass)::text as total_bytes`,
      parameters: [relation],
    }).pipe(
      Effect.flatMap(rows => {
        const row = rows[0];
        if (row === undefined) {
          return Effect.fail(new RelationSnapshotPreflightEvidenceError({
            issue: "invalidMeasurement",
            detail: `PostgreSQL returned no storage measurement for ${relation}.`,
          }));
        }
        return Effect.fromResult(Result.gen(function* () {
          const tableBytes = yield* parseNonNegativeInteger(
            row.table_bytes,
            `${relation} table bytes`,
          );
          const indexBytes = yield* parseNonNegativeInteger(
            row.index_bytes,
            `${relation} index bytes`,
          );
          const totalBytes = yield* parseNonNegativeInteger(
            row.total_bytes,
            `${relation} total bytes`,
          );
          return Object.freeze({
            relation,
            tableBytes,
            indexBytes,
            totalBytes,
          });
        }));
      }),
    ), { concurrency: 1 }).pipe(
      Effect.map(rows => Object.freeze(rows)),
    );
}

const measureWal = Effect.fn("RelationSnapshotPreflight.measureWal")(
  function* (pool: Pool) {
    const configurations = [
      ["edgeHistory", 50],
      ["adjacencyVersion", 51],
      ["adjacencyVersion", 52],
      ["edgeHistory", 53],
      ["edgeHistory", 54],
      ["adjacencyVersion", 55],
    ] as const;
    const historyRounds: number[] = [];
    const adjacencyRounds: number[] = [];
    for (const [candidate, scopeId] of configurations) {
      const bytes = yield* measureWalRound(pool, candidate, scopeId);
      if (candidate === "edgeHistory") historyRounds.push(bytes);
      else adjacencyRounds.push(bytes);
    }
    return Object.freeze([
      walMeasurement("edgeHistory", historyRounds),
      walMeasurement("adjacencyVersion", adjacencyRounds),
    ]);
  },
);

function measureWalRound(
  pool: Pool,
  candidate: RelationSnapshotSupportCandidate,
  scopeId: number,
) {
  return withClient(
    pool,
    candidate,
    "measure",
    `acquire ${candidate} WAL client`,
    Effect.fn(`RelationSnapshotPreflight.measureWalRound.${candidate}`)(
      function* (client) {
        const database = makePostgresRelationSnapshotPreflightDatabase(client);
        yield* seedWalCandidateBaseline(database, candidate, scopeId);
        yield* assertNoExternalWalActivity(database, candidate, "before");
        const before = yield* currentWalLsn(database, candidate, "before");
        yield* database.query({
          owner: candidate,
          phase: "measure",
          operation: `begin ${candidate} WAL workload`,
          sql: "begin",
        });
        for (
          let offset = 0;
          offset < RELATION_SNAPSHOT_PREFLIGHT_PROFILE.churnEventCount;
          offset += 1
        ) {
          yield* applyWalCandidateMutation(
            database,
            candidate,
            scopeId,
            offset,
          );
        }
        yield* database.query({
          owner: candidate,
          phase: "measure",
          operation: `commit ${candidate} WAL workload`,
          sql: "commit",
        });
        const after = yield* currentWalLsn(database, candidate, "after");
        yield* assertNoExternalWalActivity(database, candidate, "after");
        const rows = yield* database.query<WalBytesRow>({
          owner: candidate,
          phase: "measure",
          operation: `calculate ${candidate} WAL bytes`,
          sql: `select pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::numeric::text
                   as wal_bytes`,
          parameters: [after, before],
        });
        return yield* Effect.fromResult(parseNonNegativeInteger(
          rows[0]?.wal_bytes,
          `${candidate} WAL bytes`,
        ));
      },
    ),
  );
}

const seedWalCandidateBaseline = Effect.fn(
  "RelationSnapshotPreflight.seedWalCandidateBaseline",
)(function* (
  database: RelationSnapshotPreflightDatabase,
  candidate: RelationSnapshotSupportCandidate,
  scopeId: number,
) {
  if (candidate === "edgeHistory") {
    yield* database.query({
      owner: candidate,
      phase: "measure",
      operation: "seed history WAL workload baseline outside measured LSN",
      sql: `insert into r01p_edge_history
              (scope_id, edge_definition_key, source_document_id,
               target_document_id, duplicate_ordinal, position,
               commit_seq, is_present)
            select $1::integer, 1,
                   $1::bigint * 1000000 + event.ordinal,
                   $1::bigint, 0, 0, 1, true
            from generate_series(0, $2::integer - 1) as event(ordinal)
            where mod(event.ordinal, 4) <> 0`,
      parameters: [
        scopeId,
        RELATION_SNAPSHOT_PREFLIGHT_PROFILE.churnEventCount,
      ],
    });
    return;
  }

  yield* database.query({
    owner: candidate,
    phase: "measure",
    operation: "seed adjacency WAL workload baseline outside measured LSN",
    sql: `insert into r01p_adjacency_version
            (scope_id, edge_definition_key, direction,
             endpoint_document_id, last_changed_commit_seq)
          select $1::integer, 1, 'outgoing',
                 $1::bigint * 1000000 + event.ordinal, 1
          from generate_series(0, $2::integer - 1) as event(ordinal)
          where mod(event.ordinal, 4) <> 0
          union all
          select $1::integer, 1, 'incoming', $1::bigint, 1`,
    parameters: [
      scopeId,
      RELATION_SNAPSHOT_PREFLIGHT_PROFILE.churnEventCount,
    ],
  });
});

const applyWalCandidateMutation = Effect.fn(
  "RelationSnapshotPreflight.applyWalCandidateMutation",
)(function* (
  database: RelationSnapshotPreflightDatabase,
  candidate: RelationSnapshotSupportCandidate,
  scopeId: number,
  offset: number,
) {
  const sourceDocumentId = scopeId * 1_000_000 + offset;
  const oldTargetDocumentId = scopeId;
  const newTargetDocumentId = scopeId + 100_000;
  const commitSeq = offset + 2;
  const mutationKind = walMutationKind(offset);

  if (candidate === "edgeHistory") {
    if (mutationKind === "retarget") {
      yield* database.query({
        owner: candidate,
        phase: "measure",
        operation: "append retarget WAL workload history revisions",
        sql: `insert into r01p_edge_history
                (scope_id, edge_definition_key, source_document_id,
                 target_document_id, duplicate_ordinal, position,
                 commit_seq, is_present)
              values
                ($1::integer, 1, $2, $3, 0, 0, $5, false),
                ($1::integer, 1, $2, $4, 0, 0, $5, true)`,
        parameters: [
          scopeId,
          sourceDocumentId,
          oldTargetDocumentId,
          newTargetDocumentId,
          commitSeq,
        ],
      });
      return;
    }
    yield* database.query({
      owner: candidate,
      phase: "measure",
      operation: "append insert, delete, or reorder WAL history revision",
      sql: `insert into r01p_edge_history
              (scope_id, edge_definition_key, source_document_id,
               target_document_id, duplicate_ordinal, position,
               commit_seq, is_present)
            values ($1::integer, 1, $2, $3, 0, $4, $5, $6)`,
      parameters: [
        scopeId,
        sourceDocumentId,
        oldTargetDocumentId,
        mutationKind === "reorder" ? 1 : 0,
        commitSeq,
        mutationKind !== "delete",
      ],
    });
    return;
  }

  if (mutationKind === "retarget") {
    yield* database.query({
      owner: candidate,
      phase: "measure",
      operation: "advance retarget WAL workload adjacency versions",
      sql: `insert into r01p_adjacency_version
              (scope_id, edge_definition_key, direction,
               endpoint_document_id, last_changed_commit_seq)
            values
              ($1::integer, 1, 'outgoing', $2, $5),
              ($1::integer, 1, 'incoming', $3, $5),
              ($1::integer, 1, 'incoming', $4, $5)
            on conflict (
              scope_id, edge_definition_key, direction,
              endpoint_document_id
            ) do update
            set last_changed_commit_seq = excluded.last_changed_commit_seq`,
      parameters: [
        scopeId,
        sourceDocumentId,
        oldTargetDocumentId,
        newTargetDocumentId,
        commitSeq,
      ],
    });
    return;
  }
  yield* database.query({
    owner: candidate,
    phase: "measure",
    operation: "advance insert, delete, or reorder WAL adjacency versions",
    sql: `insert into r01p_adjacency_version
            (scope_id, edge_definition_key, direction,
             endpoint_document_id, last_changed_commit_seq)
          values
            ($1::integer, 1, 'outgoing', $2, $4),
            ($1::integer, 1, 'incoming', $3, $4)
          on conflict (
            scope_id, edge_definition_key, direction,
            endpoint_document_id
          ) do update
          set last_changed_commit_seq = excluded.last_changed_commit_seq`,
    parameters: [
      scopeId,
      sourceDocumentId,
      oldTargetDocumentId,
      commitSeq,
    ],
  });
});

function walMutationKind(offset: number): RelationWalMutationKind {
  switch (offset % 4) {
    case 0:
      return "insert";
    case 1:
      return "delete";
    case 2:
      return "retarget";
    default:
      return "reorder";
  }
}

const assertNoExternalWalActivity = Effect.fn(
  "RelationSnapshotPreflight.assertNoExternalWalActivity",
)(function (
  database: RelationSnapshotPreflightDatabase,
  owner: RelationSnapshotSupportCandidate,
  position: "before" | "after",
) {
  return database.query<ExternalActivityRow>({
    owner,
    phase: "measure",
    operation: `check ${position}-round exclusive WAL environment`,
    sql: `select count(*)::text as external_activity_count
          from pg_stat_activity
          where pid <> pg_backend_pid()
            and (
              (
                backend_type = 'client backend'
                and state is distinct from 'idle'
              )
              or backend_type in (
                'autovacuum worker',
                'logical replication worker',
                'parallel worker',
                'background worker'
              )
            )`,
  }).pipe(
    Effect.flatMap(rows =>
      Effect.fromResult(parseNonNegativeInteger(
        rows[0]?.external_activity_count,
        `${position}-round external WAL activity count`,
      ))
    ),
    Effect.flatMap(count => count === 0
      ? Effect.void
      : Effect.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "invalidAcceptanceEnvironment",
        detail: `The ${owner} WAL round observed ${count} non-idle external WAL-capable backend(s) ${position} measurement.`,
      }))),
  );
});

function currentWalLsn(
  database: RelationSnapshotPreflightDatabase,
  owner: RelationSnapshotSupportCandidate,
  position: "before" | "after",
) {
  return database.query<WalLsnRow>({
    owner,
    phase: "measure",
    operation: `read ${position} WAL insert LSN`,
    sql: "select pg_current_wal_insert_lsn()::text as lsn",
  }).pipe(
    Effect.flatMap(rows => {
      const lsn = rows[0]?.lsn;
      return typeof lsn === "string"
        ? Effect.succeed(lsn)
        : Effect.fail(new RelationSnapshotPreflightEvidenceError({
          issue: "invalidMeasurement",
          detail: `PostgreSQL returned no ${position} WAL insert LSN.`,
        }));
    }),
  );
}

function walMeasurement(
  candidate: RelationSnapshotSupportCandidate,
  roundBytes: ReadonlyArray<number>,
): RelationWalMeasurement {
  const averageBytes = Math.round(
    roundBytes.reduce((total, value) => total + value, 0) / roundBytes.length,
  );
  return Object.freeze({
    candidate,
    roundBytes: Object.freeze([...roundBytes]),
    averageBytes,
    logicalMutationsPerRound: RELATION_SNAPSHOT_PREFLIGHT_PROFILE.churnEventCount,
    averageBytesPerLogicalMutation: round(
      averageBytes / RELATION_SNAPSHOT_PREFLIGHT_PROFILE.churnEventCount,
    ),
  });
}

const measureContentionMatrix = Effect.fn(
  "RelationSnapshotPreflight.measureContentionMatrix",
)(function* (pool: Pool) {
  const configurations = [
    ["edgeHistory", false, 80],
    ["adjacencyVersion", false, 81],
    ["edgeHistory", true, 82],
    ["adjacencyVersion", true, 83],
  ] as const;
  const measurements: RelationContentionMeasurement[] = [];
  for (const [candidate, includesScopeClock, scopeId] of configurations) {
    measurements.push(yield* measureContention(
      pool,
      candidate,
      includesScopeClock,
      scopeId,
    ));
  }
  return Object.freeze(measurements);
});

function measureContention(
  pool: Pool,
  candidate: RelationSnapshotSupportCandidate,
  includesScopeClock: boolean,
  scopeId: number,
) {
  const writerCount = RELATION_SNAPSHOT_PREFLIGHT_PROFILE.contentionWriters;
  const writesPerWriter =
    RELATION_SNAPSHOT_PREFLIGHT_PROFILE.contentionWritesPerWriter;
  return Effect.tryPromise({
    try: async () => {
      await pool.query(
        `insert into r01p_scope_clock (scope_id, last_commit_seq)
         values ($1, 0)
         on conflict (scope_id) do update set last_commit_seq = 0`,
        [scopeId],
      );
      await prewarmContentionPool(pool, writerCount);
      const durations: number[] = [];
      const started = performance.now();
      await Promise.all(Array.from({ length: writerCount }, async (_, writer) => {
        const client = await pool.connect();
        let destroyClient = false;
        try {
          for (let write = 0; write < writesPerWriter; write += 1) {
            const transactionStarted = performance.now();
            await client.query("begin");
            try {
              const sequence = includesScopeClock
                ? await advanceScopeClock(client, scopeId)
                : writer * writesPerWriter + write + 1;
              const sourceDocumentId =
                scopeId * 1_000_000 + writer * writesPerWriter + write;
              if (candidate === "edgeHistory") {
                await client.query(
                  `insert into r01p_edge_history
                     (scope_id, edge_definition_key, source_document_id,
                      target_document_id, duplicate_ordinal, position,
                      commit_seq, is_present)
                   values ($1::integer, 1, $2, $1::bigint,
                           0, 0, $3, true)`,
                  [scopeId, sourceDocumentId, sequence],
                );
              } else {
                await client.query(
                  `insert into r01p_adjacency_version
                     (scope_id, edge_definition_key, direction,
                      endpoint_document_id, last_changed_commit_seq)
                   values
                     ($1::integer, 1, 'outgoing', $2, $3),
                     ($1::integer, 1, 'incoming', $1::bigint, $3)
                   on conflict (
                     scope_id, edge_definition_key, direction,
                     endpoint_document_id
                   ) do update
                   set last_changed_commit_seq = greatest(
                     r01p_adjacency_version.last_changed_commit_seq,
                     excluded.last_changed_commit_seq
                   )`,
                  [scopeId, sourceDocumentId, sequence],
                );
              }
              await client.query("commit");
              durations.push(performance.now() - transactionStarted);
            } catch (error: unknown) {
              try {
                await client.query("rollback");
              } catch {
                destroyClient = true;
              }
              throw error;
            }
          }
        } finally {
          client.release(destroyClient);
        }
      }));
      const elapsedMilliseconds = performance.now() - started;
      const expected = writerCount * writesPerWriter;
      if (durations.length !== expected) {
        throw new RelationSnapshotPreflightEvidenceError({
          issue: "contentionIncomplete",
          detail: `${candidate} completed ${durations.length}/${expected} writes.`,
        });
      }
      return Object.freeze({
        candidate,
        includesScopeClock,
        writerCount,
        writesPerWriter,
        completedTransactions: durations.length,
        elapsedMilliseconds: round(elapsedMilliseconds),
        p50Milliseconds: percentile(durations, 50),
        p95Milliseconds: percentile(durations, 95),
        p99Milliseconds: percentile(durations, 99),
      });
    },
    catch: cause => cause instanceof RelationSnapshotPreflightEvidenceError
      ? cause
      : new RelationSnapshotPreflightSqlError({
        owner: candidate,
        phase: "contend",
        operation: includesScopeClock
          ? "run scope-serialized contention workload"
          : "run naked endpoint contention workload",
        cause,
      }),
  });
}

async function prewarmContentionPool(
  pool: Pool,
  writerCount: number,
): Promise<void> {
  const acquisitions = await Promise.allSettled(
    Array.from({ length: writerCount }, () => pool.connect()),
  );
  const clients = acquisitions.flatMap(result =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const failedAcquisition = acquisitions.find(result =>
    result.status === "rejected"
  );
  if (failedAcquisition?.status === "rejected") {
    for (const client of clients) client.release();
    throw failedAcquisition.reason;
  }
  for (const client of clients) client.release();
}

async function advanceScopeClock(
  client: PoolClient,
  scopeId: number,
): Promise<number> {
  const result = await client.query<ScopeClockRow>(
    `update r01p_scope_clock
     set last_commit_seq = last_commit_seq + 1
     where scope_id = $1
     returning last_commit_seq::text as last_commit_seq`,
    [scopeId],
  );
  return Result.getOrThrow(parsePositiveInteger(
    result.rows[0]?.last_commit_seq,
    "contention scope commit sequence",
  ));
}

function proveRegistrationRace(pool: Pool) {
  return Effect.tryPromise({
    try: async () => {
      const scopeId = 90;
      const endpoint = 900;
      await pool.query(
        `insert into r01p_scope_clock (scope_id, last_commit_seq)
         values ($1, 1)`,
        [scopeId],
      );
      const expected = await pool.query<ScopeClockRow>(
        `select coalesce((
                  select last_changed_commit_seq
                  from r01p_adjacency_version
                  where scope_id = $1 and edge_definition_key = 1
                    and direction = 'incoming'
                    and endpoint_document_id = $2
                ), 0)::text as last_commit_seq`,
        [scopeId, endpoint],
      );
      const expectedVersion = Result.getOrThrow(parseNonNegativeInteger(
        expected.rows[0]?.last_commit_seq,
        "registration expected version",
      ));

      let validator: PoolClient | null = null;
      let writer: PoolClient | null = null;
      let destroyValidator = false;
      let destroyWriter = false;
      let validatorTransactionOpen = false;
      let writerTransactionOpen = false;
      let validatorLockWork: Promise<unknown> | null = null;
      try {
        validator = await pool.connect();
        writer = await pool.connect();
        const validatorPid = await readBackendPid(validator);
        const writerPid = await readBackendPid(writer);

        await writer.query("begin");
        writerTransactionOpen = true;
        const sequence = await advanceScopeClock(writer, scopeId);
        await writer.query(
          `insert into r01p_adjacency_version
             (scope_id, edge_definition_key, direction,
              endpoint_document_id, last_changed_commit_seq)
           values ($1, 1, 'incoming', $2, $3)`,
          [scopeId, endpoint, sequence],
        );

        await validator.query("begin");
        validatorTransactionOpen = true;
        validatorLockWork = validator.query(
          `select last_commit_seq
           from r01p_scope_clock
           where scope_id = $1
           for update`,
          [scopeId],
        );
        void validatorLockWork.catch(() => undefined);
        const finalValidationBlockedByWriter = await waitForBlockedClient(
          pool,
          validatorPid,
          writerPid,
        );
        await writer.query("commit");
        writerTransactionOpen = false;
        await validatorLockWork;
        validatorLockWork = null;
        const observed = await validator.query<ScopeClockRow>(
          `select last_changed_commit_seq::text as last_commit_seq
           from r01p_adjacency_version
           where scope_id = $1 and edge_definition_key = 1
             and direction = 'incoming' and endpoint_document_id = $2`,
          [scopeId, endpoint],
        );
        const observedVersionAfterLock = Result.getOrThrow(parseNonNegativeInteger(
          observed.rows[0]?.last_commit_seq,
          "registration observed version",
        ));
        const staleDependencyRejected =
          expectedVersion !== observedVersionAfterLock;
        await validator.query("rollback");
        validatorTransactionOpen = false;
        if (!finalValidationBlockedByWriter || !staleDependencyRejected) {
          throw new RelationSnapshotPreflightEvidenceError({
            issue: "registrationRaceNotObserved",
            detail: "Scope-clock serialization did not close the missing-row registration race.",
          });
        }
        return Object.freeze({
          finalValidationBlockedByWriter,
          expectedVersion,
          observedVersionAfterLock,
          staleDependencyRejected,
        });
      } catch (error: unknown) {
        if (writer !== null && writerTransactionOpen) {
          try {
            await writer.query("rollback");
            writerTransactionOpen = false;
          } catch {
            destroyWriter = true;
            writer.release(true);
            writer = null;
          }
        }
        if (validatorLockWork !== null) {
          await Promise.allSettled([validatorLockWork]);
          validatorLockWork = null;
        }
        if (validator !== null && validatorTransactionOpen) {
          try {
            await validator.query("rollback");
            validatorTransactionOpen = false;
          } catch {
            destroyValidator = true;
          }
        }
        throw error;
      } finally {
        if (writer !== null) {
          if (writerTransactionOpen) {
            try {
              await writer.query("rollback");
            } catch {
              destroyWriter = true;
            }
          }
          writer.release(destroyWriter);
        }
        if (validator !== null) {
          if (validatorTransactionOpen) {
            try {
              await validator.query("rollback");
            } catch {
              destroyValidator = true;
            }
          }
          validator.release(destroyValidator);
        }
      }
    },
    catch: cause => cause instanceof RelationSnapshotPreflightEvidenceError
      ? cause
      : new RelationSnapshotPreflightSqlError({
        owner: "adjacencyVersion",
        phase: "contend",
        operation: "prove final-validation registration race closure",
        cause,
      }),
  });
}

async function readBackendPid(client: PoolClient): Promise<number> {
  const result = await client.query<BackendPidRow>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new RelationSnapshotPreflightEvidenceError({
      issue: "invalidMeasurement",
      detail: "PostgreSQL returned an invalid backend PID.",
    });
  }
  return pid;
}

async function waitForBlockedClient(
  pool: Pool,
  blockedPid: number,
  blockerPid: number,
): Promise<boolean> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await pool.query<{ readonly blocked: boolean } & QueryResultRow>(
      `select $2::int = any(pg_blocking_pids($1::int)) as blocked`,
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked === true) return true;
    await delay(10);
  }
  return false;
}

function flushPoolStatistics(pool: Pool) {
  return Effect.tryPromise({
    try: async () => {
      const clients: PoolClient[] = [];
      let destroyClients = false;
      try {
        const existingConnectionCount = Math.max(1, pool.totalCount);
        for (let index = 0; index < existingConnectionCount; index += 1) {
          clients.push(await pool.connect());
        }
        await Promise.all(clients.map(client =>
          client.query("select pg_stat_force_next_flush()")
        ));
      } catch (cause: unknown) {
        destroyClients = true;
        throw cause;
      } finally {
        for (const client of clients) client.release(destroyClients);
      }
    },
    catch: cause => new RelationSnapshotPreflightSqlError({
      owner: "shared",
      phase: "measure",
      operation: "flush every pooled PostgreSQL client's statistics",
      cause,
    }),
  });
}

function readActivity(database: RelationSnapshotPreflightDatabase) {
  return Effect.forEach(SUPPORT_RELATIONS, relation =>
    database.query<ActivityRow>({
      owner: relation === "r01p_edge_history"
        ? "edgeHistory"
        : relation === "r01p_adjacency_version"
        ? "adjacencyVersion"
        : "shared",
      phase: "measure",
      operation: `read ${relation} activity`,
      sql: `select n_tup_ins::text as inserted_tuples,
                   n_tup_upd::text as updated_tuples,
                   n_tup_del::text as deleted_tuples,
                   n_tup_hot_upd::text as hot_updated_tuples,
                   n_live_tup::text as live_tuple_estimate,
                   n_dead_tup::text as dead_tuple_estimate,
                   vacuum_count::text as vacuum_count,
                   autovacuum_count::text as autovacuum_count
            from pg_stat_user_tables
            where schemaname = current_schema() and relname = $1`,
      parameters: [relation],
    }).pipe(
      Effect.flatMap(rows => {
        const row = rows[0];
        if (row === undefined) {
          return Effect.fail(new RelationSnapshotPreflightEvidenceError({
            issue: "invalidMeasurement",
            detail: `PostgreSQL returned no activity row for ${relation}.`,
          }));
        }
        return Effect.fromResult(Result.gen(function* () {
          const insertedTuples = yield* parseNonNegativeInteger(
            row.inserted_tuples,
            `${relation} inserts`,
          );
          const updatedTuples = yield* parseNonNegativeInteger(
            row.updated_tuples,
            `${relation} updates`,
          );
          const deletedTuples = yield* parseNonNegativeInteger(
            row.deleted_tuples,
            `${relation} deletes`,
          );
          const hotUpdatedTuples = yield* parseNonNegativeInteger(
            row.hot_updated_tuples,
            `${relation} HOT updates`,
          );
          const liveTupleEstimate = yield* parseNonNegativeInteger(
            row.live_tuple_estimate,
            `${relation} live estimate`,
          );
          const deadTupleEstimate = yield* parseNonNegativeInteger(
            row.dead_tuple_estimate,
            `${relation} dead estimate`,
          );
          const vacuumCount = yield* parseNonNegativeInteger(
            row.vacuum_count,
            `${relation} vacuum count`,
          );
          const autovacuumCount = yield* parseNonNegativeInteger(
            row.autovacuum_count,
            `${relation} autovacuum count`,
          );
          return Object.freeze({
            relation,
            insertedTuples,
            updatedTuples,
            deletedTuples,
            hotUpdatedTuples,
            liveTupleEstimate,
            deadTupleEstimate,
            vacuumCount,
            autovacuumCount,
          });
        }));
      }),
    ), { concurrency: 1 }).pipe(
      Effect.map(rows => Object.freeze(rows)),
    );
}

function vacuumSupportRelations(database: RelationSnapshotPreflightDatabase) {
  return Effect.forEach(SUPPORT_RELATIONS, relation =>
    database.query({
      owner: relation === "r01p_edge_history"
        ? "edgeHistory"
        : relation === "r01p_adjacency_version"
        ? "adjacencyVersion"
        : "shared",
      phase: "vacuum",
      operation: `vacuum ${relation}`,
      sql: `vacuum (analyze) ${relation}`,
    }), { concurrency: 1, discard: true });
}

function withClient<A, E>(
  pool: Pool,
  owner: RelationSnapshotPreflightOwner,
  phase: RelationSnapshotPreflightPhase,
  operation: string,
  use: (client: PoolClient) => Effect.Effect<A, E>,
): Effect.Effect<A, E | RelationSnapshotPreflightSqlError, never> {
  return Effect.scoped(Effect.acquireRelease(
    Effect.tryPromise({
      try: () => pool.connect(),
      catch: cause => new RelationSnapshotPreflightSqlError({
        owner,
        phase,
        operation,
        cause,
      }),
    }),
    client => Effect.promise(async () => {
      let destroyClient = false;
      try {
        await client.query("rollback");
      } catch {
        destroyClient = true;
      }
      client.release(destroyClient);
    }),
  ).pipe(Effect.flatMap(use)));
}

function collectPlanNodes(
  value: unknown,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const nodes: Readonly<Record<string, unknown>>[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const member of current) visit(member);
      return;
    }
    const record = asNonArrayRecord(current);
    if (record === null) return;
    if (typeof record["Node Type"] === "string") nodes.push(record);
    for (const member of Object.values(record)) visit(member);
  };
  visit(value);
  return Object.freeze(nodes);
}

function uniqueStrings(values: ReadonlyArray<unknown>): ReadonlyArray<string> {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string"
  ))].sort();
}

function decodeFiniteNumber(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightEvidenceError> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return Result.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidMeasurement",
      detail: `PostgreSQL returned an invalid ${name}.`,
    }));
  }
  return Result.succeed(value);
}

function decodeOptionalFiniteNumber(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightEvidenceError> {
  return value === undefined
    ? Result.succeed(0)
    : decodeFiniteNumber(value, name);
}

function parseNonNegativeInteger(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightEvidenceError> {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return Result.fail(new RelationSnapshotPreflightEvidenceError({
      issue: "invalidMeasurement",
      detail: `PostgreSQL returned an invalid ${name}.`,
    }));
  }
  return Result.succeed(parsed);
}

function parsePositiveInteger(
  value: unknown,
  name: string,
): Result.Result<number, RelationSnapshotPreflightEvidenceError> {
  return Result.gen(function* () {
    const parsed = yield* parseNonNegativeInteger(value, name);
    if (parsed < 1) {
      return yield* Result.fail(new RelationSnapshotPreflightEvidenceError({
        issue: "invalidMeasurement",
        detail: `PostgreSQL returned an invalid ${name}.`,
      }));
    }
    return parsed;
  });
}

function percentile(values: ReadonlyArray<number>, percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue / 100) - 1),
  );
  return round(sorted[index] ?? 0);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
