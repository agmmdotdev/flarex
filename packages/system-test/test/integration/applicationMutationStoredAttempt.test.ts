import { describe, expect, it } from "vitest";

import {
  proveApplicationMutationStoredAttemptPGlite,
  proveStandardApplicationMutationPGlite,
} from "../../support/applicationMutationStoredAttemptHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("Application mutation stored-attempt kernel - PGlite", () => {
  it("seals, replaces an OCC conflict, reloads runtime authority, and commits once", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveApplicationMutationStoredAttemptPGlite(
      persistence,
    );

    expect(proof).toMatchObject({
      firstResultKind: "published",
      competingResultKind: "published",
      runtimeExecutions: 2,
      competingRuntimeExecutions: 1,
      sourceLoads: 3,
      distinctWorkerDefinitions: true,
      primaryOutcomeCount: 1,
      competingOutcomeCount: 1,
      durableCommitCount: 2,
      primaryAttemptFence: "2",
      primaryCommitSeq: "3",
      competingCommitSeq: "2",
      finalName: "primary-2",
      sessionGenerations: ["application_v1", "application_v1"],
    });
  }, 480_000);

  it("composes the Application Standard mutation and replays its durable outcome", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveStandardApplicationMutationPGlite(persistence);

    expect(proof).toEqual({
      firstDisposition: "published",
      replayDisposition: "replayed",
      runtimeExecutions: 1,
      sourceLoads: 1,
      grantIssuances: 1,
      exactCompositionGuards: true,
      conflictingRequestRejected: true,
      admittedSessionSurvivedHeadRemoval: true,
      staleHeadBeforeAdmissionRejected: true,
      sessionCount: 1,
      outcomeCount: 1,
      commitCount: 1,
      generation: "application_v1",
      finalName: "standard-application",
    });
  }, 480_000);
});
