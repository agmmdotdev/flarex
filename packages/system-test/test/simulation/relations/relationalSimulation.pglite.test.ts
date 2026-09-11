import { Effect } from "effect";
import { expect, it } from "vitest";

import { runSimulation } from "@flarex/system-test/environment";
import { makePGliteDatabaseLane } from "@flarex/system-test/lanes";
import { createMigratedSplitPGlitePersistence } from
  "../../support/databaseFixturesV1";
import { relationalSimulation } from "./relationalSimulation";

const USER_CODE_FAILURE =
  "PointMutationOccUserCodeV1Error>ApplicationWorkerUserCodeV1Error";
const RELATION_READ_BOUNDARY_FAILURE =
  "QueryInvocationError:unavailable>ApplicationExecutionHostError:readBoundaryFailed>ApplicationWorkerReadBoundaryV1Error";

it("runs the admitted relational profile through the Standard simulation", async () => {
  const persistence = await createMigratedSplitPGlitePersistence();
  const receipt = await Effect.runPromise(runSimulation({
    lane: makePGliteDatabaseLane(persistence),
    simulation: relationalSimulation,
  }));

  expect(receipt).toMatchObject({
    applicationId: "relational-system-test",
    simulationId: "relational-admitted-profile-matrix",
    lane: "pglite",
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
    postgresVersion: null,
  });
  expect(Object.values(receipt.workloadProof.failureClassifications))
    .not.toContain("unclassified-object");
  expect(receipt.workloadProof.failureClassifications).toEqual({
    duplicate: "ApplicationRelationConstraintError:duplicateTarget",
    unorderedDuplicate: "ApplicationRelationConstraintError:duplicateTarget",
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
}, 480_000);
