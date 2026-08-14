import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  proveFsv06A1CandidateBoundRuntimeDispatchV1,
} from "../../support/fsv06A1CandidateBoundRuntimeDispatchHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("FSV06-A1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting FSV06-A1.",
    ).not.toBeNull();
  });
});

describePostgres("FSV06-A1 candidate-bound runtime dispatch - PostgreSQL", () => {
  it("reconstructs the same authenticated runtime target after reload", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveFsv06A1CandidateBoundRuntimeDispatchV1({
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
          throw new Error("FSV06-A1 does not mint activation uncertainty.");
        },
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        deterministicReplay: true,
        workerGraphChangeRekeysTarget: true,
        coldRestartReplay: true,
        exactWorkerDefinition: true,
        cloneRejected: true,
        closedSelectionRejected: true,
        closedTargetRejected: true,
        missingObjectRejected: true,
        corruptObjectRejected: true,
        objectBudgetRejected: true,
        accessorBudgetRejected: true,
        interruptionPreserved: true,
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    }, { historicalApplicationAnalysis: true });
  }, 480_000);
});
