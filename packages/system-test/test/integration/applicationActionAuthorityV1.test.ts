import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationActionAuthorityTargetV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  createPGliteLocatedApplicationActionAuthorityTargetV1,
} from "@flarex/persistence-postgres/pglite";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { RUN_LOCATED_READ_COMMITTED_V1 } from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  AAV_A1_LOCATOR,
  proveApplicationActionAuthorityV1,
} from "../../support/applicationActionAuthorityV1Harness";
import { createHistoricalApplicationAnalysisPGlitePersistence as createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("AAV-A1 application action authority - PGlite", () => {
  it("proves fenced admission, effects, replay, recovery, and R2-only bodies", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const base = createPGliteLocatedApplicationActionAuthorityTargetV1(
      persistence,
      AAV_A1_LOCATOR,
    );
    const proof = await proveApplicationActionAuthorityV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          AAV_A1_LOCATOR,
        ),
      actionTarget: base,
      activationTarget:
        createPGliteLocatedApplicationRevisionActivationTargetV1(
          persistence,
          AAV_A1_LOCATOR,
        ),
      makeLostResponseTarget: () => {
        let injected = false;
        return createLocatedApplicationActionAuthorityTargetV1(
          persistence.drizzle,
          AAV_A1_LOCATOR,
          async work => {
            const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
            if (!injected) {
              injected = true;
              throw new Error("injected AAV-A1 lost response");
            }
            return result;
          },
        );
      },
      makeBlockedTransactionTarget: (onBlocked, onFinished, release) =>
        createLocatedApplicationActionAuthorityTargetV1(
          persistence.drizzle,
          AAV_A1_LOCATOR,
          async work => {
            try {
              return await base[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
                onBlocked();
                await release;
                return work(tx);
              });
            } finally {
              onFinished();
            }
          },
        ),
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      concurrentAdmission: ["inserted", "replayed"],
      contradictoryReuseRejected: true,
      singularClaim: true,
      effectOrdinals: [1n, 2n],
      completedReplay: true,
      cancellationBeforeExecution: true,
      cancellationRecoveryTerminal: true,
      safeRecoveryGeneration: 2n,
      dispatchRecoveryUncertain: true,
      terminalEffectEvidence: true,
      malformedReferenceRejected: true,
      staleAuthorityRejected: true,
      lostResponseReplayed: true,
      rollbackProof: true,
      interruptionWaitsForTransaction: true,
      mutableDigestCaptured: true,
      storedBodyColumnCount: 0,
      postgresVersion: null,
    });
    expect(proof.invocationCount).toBeGreaterThanOrEqual(9);
    expect(proof.effectCount).toBeGreaterThanOrEqual(8);
  }, 480_000);
});
