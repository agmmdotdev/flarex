import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationActionAuthorityTargetV1,
} from "../src/applicationActionAuthorityV1";
import {
  createPostgresLocatedApplicationActionAuthorityTargetV1,
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/postgres";
import { RUN_LOCATED_READ_COMMITTED_V1 } from
  "../src/transactionSessionAttemptKernel";
import {
  AAV_A1_LOCATOR,
  proveApplicationActionAuthorityV1,
} from "./applicationActionAuthorityV1Harness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("AAV-A1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AAV-A1.",
    ).not.toBeNull();
  });
});

describePostgres("AAV-A1 application action authority - PostgreSQL", () => {
  it("proves multi-connection convergence and conservative dispatch recovery", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const base = createPostgresLocatedApplicationActionAuthorityTargetV1(
        persistence,
        AAV_A1_LOCATOR,
      );
      const proof = await proveApplicationActionAuthorityV1({
        name: "postgres",
        persistence,
        registrationTarget:
          createPostgresLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            AAV_A1_LOCATOR,
          ),
        actionTarget: base,
        activationTarget:
          createPostgresLocatedApplicationRevisionActivationTargetV1(
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
                throw new Error("injected PostgreSQL AAV-A1 lost response");
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
        lane: "postgres",
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
      });
      expect(proof.postgresVersion).toContain("PostgreSQL");
    });
  }, 480_000);
});
