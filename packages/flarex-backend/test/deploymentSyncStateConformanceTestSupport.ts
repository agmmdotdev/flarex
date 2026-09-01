import {
  buildQuerySyncState,
  type QueryState,
  type QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  CompleteQueryScalarFacts,
} from "@flarex/query-sync/internal/transition-plan";

import {
  decodeDeploymentQuerySyncDependencyRowsResult,
  type DeploymentQuerySyncDependencyRole,
} from "../src/deploymentSync/DependencyRowCodec";
import {
  decodeDeploymentQuerySyncCompleteQueryRowResult,
} from "../src/deploymentSync/EvaluationRowCodec";
import {
  decodeDeploymentQuerySyncPendingPublicationRowResult,
} from "../src/deploymentSync/PublicationRowCodec";
import {
  readDeploymentQuerySyncPublicationLifecycle,
} from "../src/deploymentSync/PublicationStorage";
import {
  decodeDeploymentQuerySyncScopeRowResult,
} from "../src/deploymentSync/RowCodec";
import {
  type PreparedEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

interface DependencyRowCatalog {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly consumedIndexes: Set<number>;
}

function dependencyKeys(
  catalog: DependencyRowCatalog,
  queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"],
  generation: NonNullable<CompleteQueryScalarFacts["active"]>["generation"],
  role: DeploymentQuerySyncDependencyRole,
) {
  const generationText = generation.toString();
  const rows: Readonly<Record<string, unknown>>[] = [];
  for (const [index, row] of catalog.rows.entries()) {
    if (
      row.role !== role
      || row.query_key !== queryKey
      || row.generation !== generationText
    ) {
      continue;
    }
    if (catalog.consumedIndexes.has(index)) {
      throw new Error("Conformance dependency row was consumed twice.");
    }
    catalog.consumedIndexes.add(index);
    rows.push(row);
  }
  return success(decodeDeploymentQuerySyncDependencyRowsResult(rows, {
    role,
    queryKey,
    generation,
  })).dependencyKeys;
}

function queryState(
  dependencyCatalog: DependencyRowCatalog,
  query: CompleteQueryScalarFacts,
): QueryState {
  const active = query.active === null
    ? null
    : Object.freeze({
      ...query.active,
      dependencyKeys: dependencyKeys(
        dependencyCatalog,
        query.descriptor.queryKey,
        query.active.generation,
        "active",
      ),
    });
  const currentCompletion = query.currentCompletion === null
    ? null
    : Object.freeze({
      ...query.currentCompletion,
      evaluationDependencyKeys: dependencyKeys(
        dependencyCatalog,
        query.descriptor.queryKey,
        query.currentCompletion.identity.generation,
        "completion",
      ),
    });
  return Object.freeze({
    descriptor: query.descriptor,
    active,
    provisional: query.provisional,
    currentCompletion,
    precedingCompletionIdentity: query.precedingCompletionIdentity,
  });
}

function metricsEqual(
  left: QuerySyncState["metrics"],
  right: QuerySyncState["metrics"],
): boolean {
  return left.queryCount === right.queryCount
    && left.retainedIdentityBytes === right.retainedIdentityBytes
    && left.dependencyMemberships === right.dependencyMemberships
    && left.pendingPublicationCount === right.pendingPublicationCount
    && left.inFlightPublicationCount === right.inFlightPublicationCount
    && left.retainedPublicationContentBytes
      === right.retainedPublicationContentBytes
    && left.settlementEnvelopeBytes === right.settlementEnvelopeBytes
    && left.countedCanonicalBytes === right.countedCanonicalBytes;
}

export function normalizedDeploymentQuerySyncState(
  prepared: PreparedEvaluationState,
): QuerySyncState | null {
  const scopeRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_scope_state
    ORDER BY singleton`).all();
  if (scopeRows.length === 0) return null;
  if (scopeRows.length !== 1 || scopeRows[0] === undefined) {
    throw new Error("Expected one conformance scope row.");
  }
  const scope = success(decodeDeploymentQuerySyncScopeRowResult(scopeRows[0]));
  const queryRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_queries
    ORDER BY query_key COLLATE BINARY`).all();
  const scalarQueries = queryRows.map(row => success(
    decodeDeploymentQuerySyncCompleteQueryRowResult(row, scope.facts),
  ));
  const dependencyRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_query_dependencies
    ORDER BY role COLLATE BINARY,
      query_key COLLATE BINARY,
      generation COLLATE BINARY,
      dependency_key COLLATE BINARY`).all();
  const dependencyCatalog: DependencyRowCatalog = {
    rows: dependencyRows,
    consumedIndexes: new Set<number>(),
  };
  const queries = scalarQueries.map(query => queryState(
    dependencyCatalog,
    query,
  ));
  if (dependencyCatalog.consumedIndexes.size !== dependencyRows.length) {
    throw new Error(
      "Expected every conformance dependency row to have one live owner.",
    );
  }
  const pendingRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_pending_publications
    ORDER BY query_key COLLATE BINARY`).all();
  const pending = pendingRows.map(row => {
    const rawQueryKey = row.query_key;
    const owner = scalarQueries.find(
      query => query.descriptor.queryKey === rawQueryKey,
    );
    if (owner === undefined) {
      throw new Error("Expected a conformance pending-publication owner.");
    }
    return success(decodeDeploymentQuerySyncPendingPublicationRowResult(
      row,
      scope.facts,
      owner,
    ));
  });
  const lifecycle = success(readDeploymentQuerySyncPublicationLifecycle(
    prepared.storage.sql,
    scope,
    "claimPublication",
  ));
  const state = success(buildQuerySyncState({
    cursor: scope.facts.cursor,
    queries,
    evaluationWork: scope.facts.evaluationWork,
    publicationWork: Object.freeze({
      pending: Object.freeze(pending),
      ...lifecycle,
    }),
  }));
  if (!metricsEqual(state.metrics, scope.facts.metrics)) {
    throw new Error("Stored and normalized conformance metrics differ.");
  }
  return state;
}
