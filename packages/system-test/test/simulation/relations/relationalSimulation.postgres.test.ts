import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { runSimulation } from "@flarex/system-test/environment";
import { makePostgresDatabaseLane } from "@flarex/system-test/lanes";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../../support/databaseFixturesV1";
import { relationalSimulation } from "./relationalSimulation";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const USER_CODE_FAILURE =
  "PointMutationOccUserCodeV1Error>ApplicationWorkerUserCodeV1Error";
const RELATION_READ_BOUNDARY_FAILURE =
  "QueryInvocationError:unavailable>ApplicationExecutionHostError:readBoundaryFailed>ApplicationWorkerReadBoundaryV1Error";

describe("relational simulation genuine PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting relational PostgreSQL evidence.",
    ).not.toBeNull();
  });
});

describePostgres("relational simulation - PostgreSQL", () => {
  it("preserves the admitted profile and budget boundaries", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      const receipt = await Effect.runPromise(runSimulation({
        lane: makePostgresDatabaseLane(persistence),
        simulation: relationalSimulation,
      }));
      expect(receipt).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        workloadProof: {
          sameCommitGraph: true,
          requiredOne: true,
          optionalOne: true,
          orderedMany: true,
          unorderedMany: true,
          associationTable: true,
          duplicateRejected: true,
          unorderedDuplicateRejected: true,
          danglingRejected: true,
          wrongTableRejected: true,
          maximumRejected: true,
          minimumRejected: true,
          minimumAccepted: true,
          requiredMissingRejected: true,
          nullOptionalRejected: true,
          maximumAccepted: true,
          targetDeleteRestricted: true,
          manyTargetDeleteRestricted: true,
          detachedTargetDeleted: true,
          sourceDeleteCleaned: true,
          noOpRelationUpdate: true,
          optionalCleared: true,
          overLimitExhausted: true,
          exactLimitExhausted: true,
          syscallBudgetExact: true,
          syscallBudgetExceeded: true,
          occurrenceBudgetExact: true,
          occurrenceBudgetExceeded: true,
          invalidLimitsRejected: true,
          invalidRelationRejected: true,
          wrongQueryTargetRejected: true,
        },
      });
      expect(Object.values(receipt.workloadProof.failureClassifications))
        .not.toContain("unclassified-object");
      expect(receipt.workloadProof.failureClassifications).toEqual({
        duplicate: "ApplicationRelationConstraintError:duplicateTarget",
        unorderedDuplicate:
          "ApplicationRelationConstraintError:duplicateTarget",
        dangling: "ApplicationRelationTargetNotLiveError",
        wrongTable: USER_CODE_FAILURE,
        maximum:
          "ApplicationRelationConstraintError:relationCardinalityViolation",
        minimum:
          "ApplicationRelationConstraintError:relationCardinalityViolation",
        requiredMissing: USER_CODE_FAILURE,
        nullOptional: USER_CODE_FAILURE,
        restrictedDelete: "ApplicationRelationTargetDeleteRestrictedError",
        restrictedManyTargetDelete:
          "ApplicationRelationTargetDeleteRestrictedError",
        syscallBudget: RELATION_READ_BOUNDARY_FAILURE,
        occurrenceBudget: RELATION_READ_BOUNDARY_FAILURE,
        invalidLimit: RELATION_READ_BOUNDARY_FAILURE,
        invalidRelation: RELATION_READ_BOUNDARY_FAILURE,
        wrongQueryTarget: RELATION_READ_BOUNDARY_FAILURE,
      });

      const relationState = await persistence.target.query<{
        current_edges: string;
        adjacency_versions: string;
        relation_change_commits: string;
      }>(`select
        (select count(*)::text from fx_app_edge_current) as current_edges,
        (select count(*)::text from fx_app_edge_adjacency_version)
          as adjacency_versions,
        (select count(distinct commit_seq)::text
           from fx_system_commit_relation_adjacency_change)
          as relation_change_commits`);
      expect(relationState.rows).toEqual([{
        current_edges: "128",
        adjacency_versions: "155",
        relation_change_commits: "13",
      }]);

      const noOpFacts = await persistence.target.query<{ fact_count: string }>(
        `select count(*)::text as fact_count
           from fx_system_commit_relation_adjacency_change
          where commit_seq = $1`,
        [receipt.workloadProof.noOpCommitSeq],
      );
      expect(noOpFacts.rows).toEqual([{ fact_count: "0" }]);
      expect(receipt.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
