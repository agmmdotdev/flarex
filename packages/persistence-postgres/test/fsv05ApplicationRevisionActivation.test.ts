import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationRevisionActivationTargetV1,
} from "../src/applicationRevisionActivationV1";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/pglite";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../src/transactionSessionAttemptKernel";
import {
  FSV05_SUPPORTED_LOCATOR,
  proveFsv05ApplicationRevisionActivationV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("FSV05 application revision activation - PGlite", () => {
  it("atomically activates and coherently reads only ready revisions", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveFsv05ApplicationRevisionActivationV1({
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
        const base = createPGliteLocatedApplicationRevisionActivationTargetV1(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        );
        let transactionCount = 0;
        let injected = false;
        const target = createLocatedApplicationRevisionActivationTargetV1(
          persistence.drizzle,
          FSV05_SUPPORTED_LOCATOR,
          async work => {
            const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
            transactionCount += 1;
            if (transactionCount === 2) {
              injected = true;
              throw new LocatedReadCommittedTransactionFailureV1({
                kind: "decisionUncertain",
                settlementCause: new Error("injected lost activation response"),
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
      unsupportedTargetRejected: true,
      emptyHeadRejected: true,
      rollbackBoundaries: [
        "afterActivationRevisionInsert",
        "afterActivationHeadWrite",
      ],
      firstActivationDisposition: "inserted",
      sameRequestDispositions: ["replayed", "replayed"],
      alreadyActiveRejected: true,
      overflowCasRejected: true,
      invalidatedReadinessRejected: true,
      readerDriftStale: true,
      concurrentReplacement: ["inserted", "stale"],
      uncertaintyDisposition: "replayed",
      uncertaintyObservationFailurePreserved: true,
      decisionUncertaintyInjected: true,
      clonedSelectionRejected: true,
      selectionRevokedAfterScope: true,
      frameCorruptionRejected: true,
      mixedEvidenceRejected: true,
      activationRevisionCount: 5,
      activationHeadCount: 1,
      rollbackActionCount: 0,
      postgresVersion: null,
    });
    expect(proof.coldReloadRevision).toBe(5n);
  }, 480_000);
});
