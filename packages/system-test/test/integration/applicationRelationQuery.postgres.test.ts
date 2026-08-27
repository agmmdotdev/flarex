import {
  createApplicationRelationQueryPostgresSystemTestFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-relation-query-fixture";
import { describe, expect, it } from "vitest";

import { proveApplicationRelationQuery } from
  "../support/applicationRelationQueryTestFixture";
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("RQ01 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting RQ01.",
    ).not.toBeNull();
  });
});

describePostgres("RQ01 private Standard relation query - PostgreSQL", () => {
  it("reads the exact logical relation without Worker or mutation authority", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      const proof = await proveApplicationRelationQuery(() =>
        createApplicationRelationQueryPostgresSystemTestFixture(persistence)
      );

      expectRelationQueryProof(proof);
    });
  }, 120_000);
});

function expectRelationQueryProof(
  proof: Awaited<ReturnType<typeof proveApplicationRelationQuery>>,
): void {
  expect(proof.invalidInput).toEqual({
    activeReadCount: 0,
    failures: [
      { tag: "ApplicationRelationQueryInputError", path: "input" },
      { tag: "ApplicationRelationQueryInputError", path: "input.relation" },
      {
        tag: "ApplicationRelationQueryInputError",
        path: "input.relation.source.path",
      },
      { tag: "ApplicationRelationQueryInputError", path: "input.target" },
      { tag: "ApplicationRelationQueryInputError", path: "input.limit" },
    ],
    accessorReadCount: 0,
  });
  expect(proof.fullPage.sourceDocumentIds).toEqual(
    proof.expectedFullPageSourceDocumentIds,
  );
  expect(proof.fullPage.duplicateOrdinals).toEqual(
    Array.from({ length: 128 }, () => 0),
  );
  expect(proof.fullPage.positions).toEqual(
    Array.from({ length: 128 }, () => null),
  );
  expect(proof.fullPage.exhausted).toBe(false);
  expect(proof.exactLimitPage.sourceDocumentIds).toEqual(
    proof.expectedExactLimitSourceDocumentIds,
  );
  expect(proof.exactLimitPage.exhausted).toBe(true);
  expect(proof.emptyPage).toEqual({ sourceCount: 0, exhausted: true });
  expect(proof.activeReadCountAfterSuccess).toBe(4);
  expect(proof.readOnlyStateStable).toBe(true);
  expect(proof.syncReceipt).toEqual({
    dependencyKind: "appRelationIncoming",
    pageMatchesLogicalResult: true,
    snapshotScopeMatchesSelection: true,
    snapshotEpochMatchesSelection: true,
    storageGenerationMatchesSelection: true,
    storageGenerationFenceMatchesSelection: true,
    observationAtOrBeforeSnapshot: true,
    edgeDefinitionMatches: true,
    targetRowMatches: true,
    activationSequenceMatches: true,
    activeHeadDigestMatches: true,
    runtimeSurfaceFrozen: true,
  });
  expect(proof.activeHeadObservation).toEqual({
    scopeMatches: true,
    epochMatches: true,
    storageGenerationMatches: true,
    storageGenerationFenceMatches: true,
    activationSequenceMatches: true,
    activeHeadDigestMatches: true,
    observedAtCurrentCommit: true,
    runtimeSurfaceFrozen: true,
  });
  expect(proof.activeHeadMissing).toEqual({
    tag: "ScopeSyncActiveHeadObservationError",
    operation: null,
    reason: "activeHeadMissing",
    retryable: null,
  });
  expect(proof.legacyActive).toEqual({
    tag: "ApplicationActivationError",
    operation: "validateSelection",
    reason: "invalidComposition",
    retryable: false,
    edgeStorageGuarded: true,
  });
  expect(proof.staleSelection).toEqual({
    tag: "ApplicationActivationError",
    operation: "validateSelection",
    reason: "concurrentHead",
    retryable: false,
    edgeStorageGuarded: true,
  });
  expect(proof.foreignTableTarget).toEqual({
    tag: "AppDocumentIdV1Error",
    operation: null,
    reason: "tableMismatch",
    retryable: null,
    edgeStorageGuarded: true,
  });
  expect(proof.snapshotChanged).toEqual({
    tag: "ApplicationRelationQuerySnapshotError",
    operation: "read",
    reason: "snapshotChanged",
    retryable: true,
    observedPageQueries: 1,
    pageQuery: {
      name: "readIncomingPage",
      normalizedSql:
        "select source_row_id, duplicate_ordinal, position, commit_seq from fx_app_edge_current where (fx_app_edge_current.scope_uuid = $1 and fx_app_edge_current.edge_definition_id = $2 and fx_app_edge_current.target_row_id = $3) order by fx_app_edge_current.source_row_id asc, fx_app_edge_current.duplicate_ordinal asc limit $4",
      placeholders: ["$1", "$2", "$3", "$4"],
      parameterCount: 4,
      parametersMatch: true,
      limitParameter: 129,
    },
  });
}
