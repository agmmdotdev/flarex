import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { proveFsv06StandardPointMutationV1 } from
  "../../support/fsv06StandardPointMutationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("FSV06 Standard point mutation - PGlite", () => {
  it("invokes real Standard source through active runtime and C07", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveFsv06StandardPointMutationV1({
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
        throw new Error("FSV06 does not alter activation uncertainty.");
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
      insertCommitted: true,
      updateCommitted: true,
      exactReplay: true,
      conflictingReuseRejected: true,
      validationCaught: true,
      invalidWriteNotAccepted: true,
      coldSelectionReplay: true,
      closedSelectionRejected: true,
      clonedSelectionRejected: true,
      deploymentMismatchRejected: true,
      confirmedRollbackPreserved: true,
      occConflictReran: true,
      interruptionRecovered: true,
      decisionUncertaintyRecovered: true,
      currentRowCount: 1,
      commitCount: 7,
      outcomeCount: 7,
      feedCount: 6,
      outboxCount: 7,
      postgresVersion: null,
    });
  }, 480_000);
});
