import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import { proveSap06A1InternalPointQueryV1 } from
  "../../support/sap05StandardPointQueryHarness";

describe("SAP06-A1 inline internal point query - PGlite", () => {
  it("runs a public query into one authenticated internal query", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveSap06A1InternalPointQueryV1({
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
      inlineInternalQuery: true,
      deterministicReplay: true,
      noMutationPublication: true,
      postgresVersion: null,
    });
  }, 480_000);
});
