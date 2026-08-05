import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import { proveSap05StandardPointQueryV1 } from
  "../../support/sap05StandardPointQueryHarness";

describe("SAP05 Standard point query - PGlite", () => {
  it("reads through the private System query and real Workerd runtime", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveSap05StandardPointQueryV1({
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
      coldRuntimeReconstructed: true,
      invalidArgumentsRejected: true,
      invalidResultRejected: true,
      readDefectPreserved: true,
      unknownWorkerDefectPreserved: true,
      interruptionPreserved: true,
      cleanupUncertaintyTyped: true,
      unknownFunctionRejected: true,
      closedSelectionRejected: true,
      corruptArtifactRejected: true,
      noMutationPublication: true,
      postgresVersion: null,
    });
    expect(proof.realWorkerdExecutions).toBeGreaterThanOrEqual(3);
  }, 480_000);
});
