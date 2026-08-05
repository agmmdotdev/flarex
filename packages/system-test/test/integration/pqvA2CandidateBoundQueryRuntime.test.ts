import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import { provePqvA2CandidateBoundQueryRuntimeV1 } from
  "../../support/pqvA2CandidateBoundQueryRuntimeHarness";

describe("PQV-A2 candidate-bound exact point-query runtime - PGlite", () => {
  it("executes an authenticated query handler through the scoped snapshot", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await provePqvA2CandidateBoundQueryRuntimeV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeActivationTarget: () =>
        createPGliteLocatedApplicationRevisionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeDecisionUncertainTarget: () => Object.freeze({
        target: createPGliteLocatedApplicationRevisionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
        wasInjected: () => false,
      }),
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      presentStatus: "pending",
      missing: true,
      deterministicReplay: true,
      coldReplay: true,
      cloneRejected: true,
      closedSelectionRejected: true,
      closedSnapshotRejected: true,
      closedTargetRejected: true,
      mixedSnapshotRejected: true,
      supersededZeroReadRejected: true,
      functionEvidenceRejected: true,
      unknownFunctionRejected: true,
      missingObjectRejected: true,
      corruptObjectRejected: true,
      budgetRejected: true,
      interruptionPreserved: true,
      noMutationPublication: true,
      postgresVersion: null,
    });
  }, 480_000);
});
