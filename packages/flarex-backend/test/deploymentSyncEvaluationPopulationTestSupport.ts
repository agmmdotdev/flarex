import type { DatabaseSync } from "node:sqlite";

import {
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  buildQuerySyncState,
  captureQueryAuthorityWitness,
  captureQueryDescriptor,
  captureQueryGeneration,
  captureQueryPublicationArtifact,
  captureQueryResultDigest,
  captureQuerySnapshot,
  createEmptyQuerySyncState,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  type CanonicalPublicationContent,
  type NamespaceCursor,
  type PendingQueryPublication,
  type QueryState,
  type QuerySyncState,
  type QuerySyncWorkRevision,
} from "@flarex/query-sync/internal/kernel";
import { Encoding, Result } from "effect";

import type {
  DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import type {
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  encodeDeploymentQuerySyncDependencyRow,
  type EncodedDeploymentQuerySyncDependencyRow,
} from "../src/deploymentSync/DependencyRowCodec";
import {
  encodeDeploymentQuerySyncCompleteQueryRow,
  type EncodedDeploymentQuerySyncCompleteQueryRow,
} from "../src/deploymentSync/EvaluationRowCodec";
import {
  encodeDeploymentQuerySyncPendingPublicationRow,
  type EncodedDeploymentQuerySyncPendingPublicationRow,
} from "../src/deploymentSync/PublicationRowCodec";
import {
  encodeDeploymentQuerySyncScopeRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";

const MAXIMUM_PENDING_CONTENT_ROWS = 32;
const MAXIMUM_TARGET_INDEX = MAXIMUM_PENDING_CONTENT_ROWS;
const MAXIMUM_POPULATION_IDENTITY_BYTES =
  MAX_RETAINED_QUERY_IDENTITY_BYTES / MAX_REFERENCE_QUERIES;

export interface CountedCanonicalMaximumEvaluationPopulation {
  readonly state: QuerySyncState;
  readonly target: QueryState;
}

export function buildCountedCanonicalMaximumEvaluationPopulation(input: {
  readonly cursor: NamespaceCursor;
  readonly evaluationWorkRevision: QuerySyncWorkRevision;
}): CountedCanonicalMaximumEvaluationPopulation {
  const maximumIdentity = canonicalData(
    MAXIMUM_POPULATION_IDENTITY_BYTES,
    0x69,
  );
  if (
    !Number.isInteger(MAXIMUM_POPULATION_IDENTITY_BYTES)
    || MAXIMUM_POPULATION_IDENTITY_BYTES
      > MAX_CANONICAL_QUERY_IDENTITY_BYTES
  ) {
    throw new Error("Maximum retained identity bytes cannot be distributed.");
  }
  const emptyContents = Array.from(
    { length: MAXIMUM_PENDING_CONTENT_ROWS },
    () => canonicalContent(0, 0),
  );
  const emptyPopulation = buildMaximumIdentityPopulation(
    input,
    maximumIdentity,
    emptyContents,
  );
  const contentDeficit = MAX_COUNTED_CANONICAL_BYTES
    - emptyPopulation.state.metrics.countedCanonicalBytes;
  if (
    contentDeficit < 0
    || contentDeficit
      > MAXIMUM_PENDING_CONTENT_ROWS * MAX_INLINE_PUBLICATION_CONTENT_BYTES
  ) {
    throw new Error(
      "The exact counted-canonical maximum cannot be represented by pending content.",
    );
  }

  let remainingContentBytes = contentDeficit;
  const contents = Array.from(
    { length: MAXIMUM_PENDING_CONTENT_ROWS },
    (_value, index) => {
      const byteLength = Math.min(
        remainingContentBytes,
        MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      );
      remainingContentBytes -= byteLength;
      return canonicalContent(byteLength, 0x70 + (index % 16));
    },
  );
  if (remainingContentBytes !== 0) {
    throw new Error("Maximum pending content did not consume every byte.");
  }

  const population = buildMaximumIdentityPopulation(
    input,
    maximumIdentity,
    contents,
  );
  if (
    population.state.metrics.queryCount !== MAX_REFERENCE_QUERIES
    || population.state.metrics.retainedIdentityBytes
      !== MAX_RETAINED_QUERY_IDENTITY_BYTES
    || population.state.metrics.pendingPublicationCount
      !== MAXIMUM_PENDING_CONTENT_ROWS
    || population.state.metrics.retainedPublicationContentBytes
      !== contentDeficit
    || population.state.metrics.countedCanonicalBytes
      !== MAX_COUNTED_CANONICAL_BYTES
  ) {
    throw new Error("Maximum evaluation population metrics are not exact.");
  }
  return population;
}

function buildMaximumIdentityPopulation(
  input: {
    readonly cursor: NamespaceCursor;
    readonly evaluationWorkRevision: QuerySyncWorkRevision;
  },
  queryIdentity: string,
  contents: readonly CanonicalPublicationContent[],
): CountedCanonicalMaximumEvaluationPopulation {
  const completed = contents.map((content, index) => completedPendingQuery(
    input.cursor,
    index,
    queryIdentity,
    content,
  ));
  const provisional = Array.from(
    { length: MAX_REFERENCE_QUERIES - completed.length },
    (_value, offset) => provisionalQuery(
      input.cursor,
      completed.length + offset,
      queryIdentity,
    ),
  );
  const queries = [
    ...completed.map(entry => entry.query),
    ...provisional,
  ];
  const state = buildEvaluationPopulation({
    cursor: input.cursor,
    evaluationWorkRevision: input.evaluationWorkRevision,
    queries,
    pending: completed.map(entry => entry.pending),
  });
  const target = state.queries.find(query =>
    query.descriptor.queryKey
      === indexedCanonicalData(32, MAXIMUM_TARGET_INDEX, 0x4b)
  );
  if (target === undefined) {
    throw new Error("Maximum evaluation population is missing its target.");
  }
  return Object.freeze({ state, target });
}

function buildEvaluationPopulation(input: {
  readonly cursor: NamespaceCursor;
  readonly evaluationWorkRevision: QuerySyncWorkRevision;
  readonly queries: readonly QueryState[];
  readonly pending: readonly PendingQueryPublication[];
}): QuerySyncState {
  const empty = resultSuccess(createEmptyQuerySyncState(input.cursor));
  return resultSuccess(buildQuerySyncState({
    cursor: input.cursor,
    queries: input.queries,
    evaluationWork: Object.freeze({
      revision: input.evaluationWorkRevision,
      fairnessAnchor: null,
    }),
    publicationWork: Object.freeze({
      pending: input.pending,
      inFlight: empty.publicationWork.inFlight,
      latestDelivered: empty.publicationWork.latestDelivered,
      precedingAttemptOutcome: empty.publicationWork.precedingAttemptOutcome,
    }),
  }));
}

function completedPendingQuery(
  cursor: NamespaceCursor,
  index: number,
  queryIdentity: string,
  content: CanonicalPublicationContent,
): Readonly<{
  readonly query: QueryState;
  readonly pending: PendingQueryPublication;
}> {
  const descriptor = resultSuccess(captureQueryDescriptor({
    queryKey: indexedCanonicalData(32, index, 0x4b),
    queryIdentity,
  }));
  const generation = resultSuccess(captureQueryGeneration(1n));
  const evaluationSnapshotSequence = resultSuccess(captureQuerySnapshot(
    cursor.appliedThroughSequence,
  ));
  const resultDigest = resultSuccess(captureQueryResultDigest(
    indexedCanonicalData(32, index, 0x5d),
  ));
  const authorityWitness = resultSuccess(captureQueryAuthorityWitness(
    indexedCanonicalData(32, index, 0x7d),
  ));
  const identity = makeQueryPublicationIdentity({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    queryKey: descriptor.queryKey,
    generation,
  });
  const pending = makePendingQueryPublication({
    identity,
    queryIdentity: descriptor.queryIdentity,
    completedThroughSequence: cursor.appliedThroughSequence,
    resultDigest,
    content,
  });
  const query = Object.freeze({
    descriptor,
    active: Object.freeze({
      generation,
      evaluationSnapshotSequence,
      freshThroughSequence: cursor.appliedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest,
      authorityWitness,
      dependencyKeys: Object.freeze([]),
    }),
    provisional: null,
    currentCompletion: Object.freeze({
      identity,
      queryIdentity: descriptor.queryIdentity,
      expectedActiveGeneration: null,
      registrationCursor: cursor,
      requestedDirtyThroughSequence: null,
      evaluationSnapshotSequence,
      evaluationDependencyKeys: Object.freeze([]),
      evaluationAuthorityWitness: authorityWitness,
      refreshedThroughSequence: cursor.appliedThroughSequence,
      relevantThroughSequence: null,
      refreshAuthorityWitness: authorityWitness,
      resultDigest,
      publicationDisposition: pendingPublicationDisposition(identity),
    }),
    precedingCompletionIdentity: null,
  } satisfies QueryState);
  return Object.freeze({ query, pending });
}

function provisionalQuery(
  cursor: NamespaceCursor,
  index: number,
  queryIdentity: string,
): QueryState {
  return Object.freeze({
    descriptor: resultSuccess(captureQueryDescriptor({
      queryKey: indexedCanonicalData(32, index, 0x4b),
      queryIdentity,
    })),
    active: null,
    provisional: Object.freeze({
      generation: resultSuccess(captureQueryGeneration(1n)),
      expectedActiveGeneration: null,
      registrationCursor: cursor,
      requestedDirtyThroughSequence: null,
      evaluationDisposition: Object.freeze({ _tag: "ready" as const }),
    }),
    currentCompletion: null,
    precedingCompletionIdentity: null,
  });
}

function canonicalContent(
  byteLength: number,
  fill: number,
): CanonicalPublicationContent {
  return resultSuccess(captureQueryPublicationArtifact({
    content: canonicalData(byteLength, fill),
  })).content;
}

function canonicalData(byteLength: number, fill: number): string {
  return Encoding.encodeBase64Url(new Uint8Array(byteLength).fill(fill));
}

function indexedCanonicalData(
  byteLength: number,
  index: number,
  fill: number,
): string {
  const bytes = new Uint8Array(byteLength).fill(fill);
  new DataView(bytes.buffer).setUint32(0, index, false);
  return Encoding.encodeBase64Url(bytes);
}

function resultSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

export function seedEvaluationPopulation(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const insertScope = database.prepare(INSERT_SCOPE_SQL);
    const insertQuery = database.prepare(INSERT_QUERY_SQL);
    const insertDependency = database.prepare(INSERT_DEPENDENCY_SQL);
    const insertPending = database.prepare(INSERT_PENDING_SQL);
    writeEvaluationPopulation({
      clear: () => {
        database.exec("DELETE FROM deployment_sync_pending_publications");
        database.exec("DELETE FROM deployment_sync_query_dependencies");
        database.exec("DELETE FROM deployment_sync_queries");
        database.exec("DELETE FROM deployment_sync_scope_state");
      },
      insertScope: row => {
        insertScope.run(...scopeRowValues(row));
      },
      insertQuery: row => {
        insertQuery.run(...queryRowValues(row));
      },
      insertDependency: row => {
        insertDependency.run(...dependencyRowValues(row));
      },
      insertPending: row => {
        insertPending.run(...pendingPublicationRowValues(row));
      },
    }, binding, state);
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

export function seedEvaluationPopulationInStorage(
  storage: DeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
): void {
  storage.transactionSync(() => writeEvaluationPopulation({
    clear: () => {
      storage.sql.exec("DELETE FROM deployment_sync_pending_publications");
      storage.sql.exec("DELETE FROM deployment_sync_query_dependencies");
      storage.sql.exec("DELETE FROM deployment_sync_queries");
      storage.sql.exec("DELETE FROM deployment_sync_scope_state");
    },
    insertScope: row => {
      storage.sql.exec(INSERT_SCOPE_SQL, ...scopeRowValues(row));
    },
    insertQuery: row => {
      storage.sql.exec(INSERT_QUERY_SQL, ...queryRowValues(row));
    },
    insertDependency: row => {
      storage.sql.exec(INSERT_DEPENDENCY_SQL, ...dependencyRowValues(row));
    },
    insertPending: row => {
      storage.sql.exec(INSERT_PENDING_SQL, ...pendingPublicationRowValues(row));
    },
  }, binding, state));
}

const INSERT_SCOPE_SQL = `INSERT INTO deployment_sync_scope_state (
      singleton,
      scope_uuid,
      epoch_uuid,
      storage_generation,
      storage_generation_fence,
      sync_model_id,
      applied_through_sequence,
      evaluation_work_revision,
      fairness_anchor,
      query_count,
      retained_identity_bytes,
      dependency_memberships,
      pending_publication_count,
      in_flight_publication_count,
      retained_publication_content_bytes,
      settlement_envelope_bytes,
      counted_canonical_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_QUERY_SQL = `INSERT INTO deployment_sync_queries (
      query_key,
      query_identity,
      active_generation,
      active_evaluation_snapshot_sequence,
      active_fresh_through_sequence,
      active_dirty_through_sequence,
      active_result_digest,
      active_authority_witness,
      provisional_generation,
      provisional_expected_active_generation,
      provisional_registration_sequence,
      provisional_requested_dirty_through_sequence,
      provisional_disposition,
      completion_generation,
      completion_expected_active_generation,
      completion_registration_sequence,
      completion_requested_dirty_through_sequence,
      completion_evaluation_snapshot_sequence,
      completion_evaluation_authority_witness,
      completion_refreshed_through_sequence,
      completion_relevant_through_sequence,
      completion_refresh_authority_witness,
      completion_result_digest,
      completion_publication_disposition,
      preceding_completion_generation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_DEPENDENCY_SQL = `INSERT INTO deployment_sync_query_dependencies (
        role,
        query_key,
        generation,
        dependency_key
      ) VALUES (?, ?, ?, ?)`;

const INSERT_PENDING_SQL = `INSERT INTO deployment_sync_pending_publications (
        query_key,
        generation,
        query_identity,
        completed_through_sequence,
        result_digest,
        content
      ) VALUES (?, ?, ?, ?, ?, ?)`;

interface EvaluationPopulationWriter {
  readonly clear: () => void;
  readonly insertScope: (row: EncodedDeploymentQuerySyncScopeRow) => void;
  readonly insertQuery: (
    row: EncodedDeploymentQuerySyncCompleteQueryRow,
  ) => void;
  readonly insertDependency: (
    row: EncodedDeploymentQuerySyncDependencyRow,
  ) => void;
  readonly insertPending: (
    row: EncodedDeploymentQuerySyncPendingPublicationRow,
  ) => void;
}

type EvaluationPopulationSqlValue = null | number | string;

function writeEvaluationPopulation(
  writer: EvaluationPopulationWriter,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
): void {
  assertEmptyPublicationLifecycle(state);
  const scopeRow = encodeDeploymentQuerySyncScopeRow({
    scopeUuid: binding.scopeUuid,
    epochUuid: binding.epochUuid,
    storageGeneration: binding.storageGeneration,
    storageGenerationFence: binding.storageGenerationFence,
    syncModelId: binding.syncModelId,
    facts: Object.freeze({
      cursor: state.cursor,
      evaluationWork: state.evaluationWork,
      metrics: state.metrics,
    }),
  });
  writer.clear();
  writer.insertScope(scopeRow);
  for (const query of state.queries.toReversed()) {
    writer.insertQuery(encodeDeploymentQuerySyncCompleteQueryRow(query));
    const active = query.active;
    if (active !== null) {
      for (const dependencyKey of active.dependencyKeys) {
        writer.insertDependency(encodeDeploymentQuerySyncDependencyRow({
          role: "active",
          queryKey: query.descriptor.queryKey,
          generation: active.generation,
          dependencyKey,
        }));
      }
    }
    const completion = query.currentCompletion;
    if (completion !== null) {
      for (const dependencyKey of completion.evaluationDependencyKeys) {
        writer.insertDependency(encodeDeploymentQuerySyncDependencyRow({
          role: "completion",
          queryKey: query.descriptor.queryKey,
          generation: completion.identity.generation,
          dependencyKey,
        }));
      }
    }
  }
  for (const publication of state.publicationWork.pending) {
    writer.insertPending(
      encodeDeploymentQuerySyncPendingPublicationRow(publication),
    );
  }
}

function assertEmptyPublicationLifecycle(state: QuerySyncState): void {
  if (
    state.publicationWork.inFlight !== null
    || state.publicationWork.latestDelivered !== null
    || state.publicationWork.precedingAttemptOutcome !== null
    || state.metrics.inFlightPublicationCount !== 0
    || state.metrics.settlementEnvelopeBytes !== 0
  ) {
    throw new Error(
      "Population seeding requires an empty publication lifecycle.",
    );
  }
}

function scopeRowValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): EvaluationPopulationSqlValue[] {
  return [
    row.singleton,
    row.scope_uuid,
    row.epoch_uuid,
    row.storage_generation,
    row.storage_generation_fence,
    row.sync_model_id,
    row.applied_through_sequence,
    row.evaluation_work_revision,
    row.fairness_anchor,
    row.query_count,
    row.retained_identity_bytes,
    row.dependency_memberships,
    row.pending_publication_count,
    row.in_flight_publication_count,
    row.retained_publication_content_bytes,
    row.settlement_envelope_bytes,
    row.counted_canonical_bytes,
  ];
}

function queryRowValues(
  row: EncodedDeploymentQuerySyncCompleteQueryRow,
): EvaluationPopulationSqlValue[] {
  return [
    row.query_key,
    row.query_identity,
    row.active_generation,
    row.active_evaluation_snapshot_sequence,
    row.active_fresh_through_sequence,
    row.active_dirty_through_sequence,
    row.active_result_digest,
    row.active_authority_witness,
    row.provisional_generation,
    row.provisional_expected_active_generation,
    row.provisional_registration_sequence,
    row.provisional_requested_dirty_through_sequence,
    row.provisional_disposition,
    row.completion_generation,
    row.completion_expected_active_generation,
    row.completion_registration_sequence,
    row.completion_requested_dirty_through_sequence,
    row.completion_evaluation_snapshot_sequence,
    row.completion_evaluation_authority_witness,
    row.completion_refreshed_through_sequence,
    row.completion_relevant_through_sequence,
    row.completion_refresh_authority_witness,
    row.completion_result_digest,
    row.completion_publication_disposition,
    row.preceding_completion_generation,
  ];
}

function dependencyRowValues(
  row: EncodedDeploymentQuerySyncDependencyRow,
): EvaluationPopulationSqlValue[] {
  return [row.role, row.query_key, row.generation, row.dependency_key];
}

function pendingPublicationRowValues(
  row: EncodedDeploymentQuerySyncPendingPublicationRow,
): EvaluationPopulationSqlValue[] {
  return [
    row.query_key,
    row.generation,
    row.query_identity,
    row.completed_through_sequence,
    row.result_digest,
    row.content,
  ];
}
