import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { proveSap06A3MutationInternalCallV1 } from
  "../../support/fsv06StandardPointMutationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("SAP06-A3 mutation internal calls - PGlite", () => {
  it("preserves caught child writes and publishes only the parent outcome", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveSap06A3MutationInternalCallV1({
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
        throw new Error("SAP06-A3 does not alter activation uncertainty.");
      },
      makeSessionTarget: () =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      makeEpochTarget: () => createPGliteLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      inlineInternalMutation: true,
      nestedInternalQuery: true,
        caughtFailurePreservedWrite: true,
        oneParentPublication: true,
        exactReplay: true,
        confirmedRollbackPreserved: true,
        occConflictReran: true,
        interruptionRecovered: true,
        decisionUncertaintyRecovered: true,
        coldSelectionReplay: true,
        currentRowPointerCount: 6,
        liveRowCount: 0,
        commitCount: 12,
        outcomeCount: 12,
        feedCount: 12,
        outboxCount: 12,
      postgresVersion: null,
    });
  }, 480_000);
});
