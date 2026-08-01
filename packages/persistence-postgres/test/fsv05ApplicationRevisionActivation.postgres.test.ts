import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationRevisionActivationTargetV1,
} from "../src/applicationRevisionActivationV1";
import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  FSV05_SUPPORTED_LOCATOR,
  proveFsv05ApplicationRevisionActivationV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("FSV05 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting FSV05.",
    ).not.toBeNull();
  });
});

describePostgres("FSV05 application revision activation - PostgreSQL", () => {
  it("proves multi-connection activation, CAS, uncertainty, and coherent reload", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveFsv05ApplicationRevisionActivationV1({
        name: "postgres",
        persistence,
        registrationTarget:
          createPostgresLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeActivationTarget: () =>
          createPostgresLocatedApplicationRevisionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeDecisionUncertainTarget: () => {
          const run = createPostgresLocatedReadCommittedTransactionRunnerV1(
            persistence.pool,
          );
          let transactionCount = 0;
          let injected = false;
          const target = createLocatedApplicationRevisionActivationTargetV1(
            persistence.drizzle,
            FSV05_SUPPORTED_LOCATOR,
            async work => {
              const result = await run(work);
              transactionCount += 1;
              if (transactionCount === 2) {
                injected = true;
                throw new LocatedReadCommittedTransactionFailureV1({
                  kind: "decisionUncertain",
                  settlementCause: new Error(
                    "injected lost PostgreSQL activation response",
                  ),
                });
              }
              return result;
            },
          );
          return Object.freeze({ target, wasInjected: () => injected });
        },
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        concurrentReplacement: ["inserted", "stale"],
        uncertaintyDisposition: "replayed",
        decisionUncertaintyInjected: true,
        selectionRevokedAfterScope: true,
        syscallValidatorAcceptedValidDocument: true,
        syscallValidatorRejectedInvalidDocument: true,
        syscallValidatorRejectedClone: true,
        syscallValidatorRejectedForgery: true,
        syscallValidatorRejectedMixedContext: true,
        syscallValidatorRejectedSupersededSelection: true,
        syscallValidatorRevokedAfterScope: true,
        activationRevisionCount: 6,
        activationHeadCount: 1,
        rollbackActionCount: 0,
      });
      expect(proof.coldReloadRevision).toBe(5n);
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    });
  }, 480_000);
});
