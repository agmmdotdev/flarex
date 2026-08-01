import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationRevisionReadinessTargetV1,
} from "../src/applicationRevisionReadinessV1";
import {
  createPGliteLocatedApplicationRevisionReadinessTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/pglite";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../src/transactionSessionAttemptKernel";
import {
  proveFsv04ApplicationRevisionReadinessV1,
} from "./fsv04ApplicationRevisionReadinessHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "fsv03-private",
  schemaName: "public",
} as const);

describe("FSV04 application revision readiness - PGlite", () => {
  it("settles only complete target-native evidence and remains non-activating", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveFsv04ApplicationRevisionReadinessV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        ),
      makeReadinessTarget: () =>
        createPGliteLocatedApplicationRevisionReadinessTargetV1(
          persistence,
          LOCATOR,
        ),
      makeDecisionUncertainTarget: () => {
        const base = createPGliteLocatedApplicationRevisionReadinessTargetV1(
          persistence,
          LOCATOR,
        );
        let transactionCount = 0;
        let injected = false;
        const target = createLocatedApplicationRevisionReadinessTargetV1(
          persistence.drizzle,
          LOCATOR,
          async work => {
            const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
            transactionCount += 1;
            if (transactionCount === 2) {
              injected = true;
              throw new LocatedReadCommittedTransactionFailureV1({
                kind: "decisionUncertain",
                settlementCause: new Error("injected lost commit response"),
              });
            }
            return result;
          },
        );
        return Object.freeze({ target, wasInjected: () => injected });
      },
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      notReadyReasons: [
        "physicalBuildMissing",
        "physicalBuildNotEnabled",
      ],
      rollbackBoundaries: ["afterVerdictInsert", "afterAttemptReady"],
      concurrentDispositions: ["inserted", "replayed"],
      coldReplayDisposition: "replayed",
      decisionUncertainDisposition: "replayed",
      decisionUncertaintyInjected: true,
      coldAuthorityFailures: ["missingGroup", "projectionMismatch"],
      buildStateInvalidation: true,
      receiptCorruptionRejected: true,
      staleInvalidation: true,
      verdictCount: 1,
      activeRevisionCount: 0,
      activeHeadCount: 0,
      attemptLifecycle: "ready",
      postgresVersion: null,
    });
    expect(proof.buildLifecycles.at(-1)).toBe("enabled");
  }, 240_000);
});
