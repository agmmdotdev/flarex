import {
  createApplicationRelationalCorePostgresSystemTestFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-relation-query-fixture";
import { describe, expect, it } from "vitest";

import {
  expectedApplicationRelationalCoreCommits,
  proveApplicationRelationalCore,
} from
  "../../support/applicationRelationalCoreHarness";
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("SV-R Core PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting SV-R Core.",
    ).not.toBeNull();
  });
});

describePostgres("SV-R Core relational Application - PostgreSQL", () => {
  it("crosses the real relational runtime and commit path", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      const proof = await proveApplicationRelationalCore(analysis =>
        createApplicationRelationalCorePostgresSystemTestFixture(
          persistence,
          analysis,
        )
      );

      expect(proof.analysisWorkerLoads).toBe(2);
      expect(proof.missingRelationPortWorkerLoads).toBe(1);
      expect(proof.missingRelationPortFailedClosed).toBe(true);
      expect(proof.mutationWorkerLoads).toBe(10);
      expect(proof.targetDeleteWasRestricted).toBe(true);
      expect(proof.commits).toEqual(
        expectedApplicationRelationalCoreCommits(proof),
      );
      expect(proof.incomingSourceDocumentIds).toEqual([proof.postDocumentId]);
      expect(proof.finalIncomingSourceDocumentIds).toEqual([]);
      expect(proof.edgePositions).toEqual([]);
      expect(proof.sourceRelationHistory.map(row => row.authors)).toEqual([
        [proof.targetDocumentIds[0], proof.targetDocumentIds[1]],
        [proof.targetDocumentIds[1], proof.targetDocumentIds[0]],
        [proof.targetDocumentIds[1]],
        [proof.targetDocumentIds[2]],
        [],
      ]);
      expect(proof.adjacencyVersions.map(version => [
        version.direction,
        version.lastChangedCommitSeq,
      ])).toEqual([
        ["incoming", 6n],
        ["incoming", 7n],
        ["incoming", 8n],
        ["outgoing", 8n],
      ]);
    });
  }, 480_000);
});
