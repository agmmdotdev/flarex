import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import type { Fsv06StandardPointMutationLaneV1 } from
  "./fsv06StandardPointMutationHarness";
import { runPrivateStandardCookingApplicationV1 } from
  "./privateStandardApplicationTestApiV1";
import { runPrivateStandardEnglishLearningApplicationV1 } from
  "./privateStandardEnglishLearningApplicationV1";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("private Standard Application Test API PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting SAC01-F1/F2a/F2b.",
    ).not.toBeNull();
  });
});

describePostgres("private Standard Application Test API - PostgreSQL", () => {
  it("creates and reads one cooking-app recipe through genuine PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(
        runPrivateStandardCookingApplicationV1(makePostgresLane(persistence)),
      );
      expect(proof).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        controlledSetup: true,
        mutationReplay: true,
        queryReplay: true,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        commitSeqs: ["1"],
        commitFeedCommitSeqs: ["1"],
        outboxCommitSeqs: ["1"],
      });
      expect(proof.finalInspection).toMatchObject({
        currentRowCount: 1,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);

  it("runs the English-learning consumer through genuine PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(
        runPrivateStandardEnglishLearningApplicationV1(
          makePostgresLane(persistence),
        ),
      );
      expect(proof).toMatchObject({
        lane: "postgres",
        scenario: "english-learning-lesson-create-and-read-v1",
        definitionAnalyzedRegisteredReadyActivated: true,
        controlledSetup: true,
        mutationReplay: true,
        queryReplay: true,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        commitSeqs: ["1"],
        commitFeedCommitSeqs: ["1"],
        outboxCommitSeqs: ["1"],
      });
      expect(proof.finalInspection).toMatchObject({
        currentRowCount: 1,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});

function makePostgresLane(
  persistence: PostgresFlarexPersistence,
): Fsv06StandardPointMutationLaneV1 {
  return {
    name: "postgres",
    persistence,
    registrationTarget:
      createPostgresLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeActivationTarget: () =>
      createPostgresLocatedApplicationRevisionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeDecisionUncertainTarget: () => {
      throw new Error(
        "The Standard Test API does not inject activation uncertainty.",
      );
    },
    makeSessionTarget: () =>
      createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeEpochTarget: () =>
      createPostgresLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
  };
}
