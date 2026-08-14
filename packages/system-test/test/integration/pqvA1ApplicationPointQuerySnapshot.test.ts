import { describe, expect, expectTypeOf, it } from "vitest";

import * as persistenceRoot from "@flarex/persistence-postgres";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import {
  FSV05_SUPPORTED_LOCATOR,
} from "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  provePqvA1ApplicationPointQuerySnapshotV1,
} from "../../support/pqvA1ApplicationPointQuerySnapshotHarness";
import { createHistoricalApplicationAnalysisPGlitePersistence as createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("PQV-A1 target-native query snapshot - PGlite", () => {
  it("pins one active snapshot and exposes only bounded point reads", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "openApplicationPointQuerySnapshotV1" |
        "readApplicationPointQueryDocumentV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("openApplicationPointQuerySnapshotV1" in persistenceRoot).toBe(false);
    const persistence = await createMigratedPGlitePersistence();
    const proof = await provePqvA1ApplicationPointQuerySnapshotV1({
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
      firstStatus: "pending",
      repeatedStatus: "pending",
      concurrentWriterPinnedStatus: "pending",
      coldStatus: "complete",
      missing: true,
      unknownFunctionRejected: true,
      invalidDeploymentRejected: true,
      wrongTableRejected: true,
      wrongDocumentTableRejected: true,
      unsupportedTargetRejected: true,
      cloneRejected: true,
      closedRejected: true,
      generationRejected: true,
      fenceRejected: true,
      epochRejected: true,
      floorRejected: true,
      supersededRejected: true,
      countBudgetRejected: true,
      byteBudgetRejected: true,
      interruptionPreserved: true,
      cleanupCausePreserved: true,
      noMutationPublication: true,
      postgresVersion: null,
    });
  }, 480_000);
});
