import { describe, expect, it } from "vitest";

import {
  proveApplicationMutationStoredAttemptPGlite,
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
});
