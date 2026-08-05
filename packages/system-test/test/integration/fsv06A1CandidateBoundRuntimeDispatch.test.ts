import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  proveFsv06A1CandidateBoundRuntimeDispatchV1,
} from "../../support/fsv06A1CandidateBoundRuntimeDispatchHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("FSV06-A1 candidate-bound runtime dispatch - PGlite", () => {
  it("derives a scoped exact runtime solely from active evidence and R2", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveFsv06A1CandidateBoundRuntimeDispatchV1({
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
      makeDecisionUncertainTarget: () => {
        throw new Error("FSV06-A1 does not mint activation uncertainty.");
      },
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      deterministicReplay: true,
      workerGraphChangeRekeysTarget: true,
      coldRestartReplay: true,
      exactWorkerDefinition: true,
      cloneRejected: true,
      closedSelectionRejected: true,
      closedTargetRejected: true,
      unknownFunctionRejected: true,
      mixedAuthorityRejected: true,
      substitutedFunctionRejected: true,
      missingObjectRejected: true,
      corruptObjectRejected: true,
      objectBudgetRejected: true,
      accessorBudgetRejected: true,
      interruptionPreserved: true,
      postgresVersion: null,
    });
    expect(proof.runtimeTargetSha256Hex).toMatch(/^[0-9a-f]{64}$/);
  }, 480_000);
});
