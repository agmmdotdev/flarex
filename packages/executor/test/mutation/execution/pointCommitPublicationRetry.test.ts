import { Effect, Random } from "effect";
import { describe, expect, it } from "vitest";
import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitCorruptionV1Error,
} from "@flarex/persistence-postgres/point-commit-transaction";
import { publishPointCommitWithKnownSettledSqlRetry, PointCommitKnownSettledSqlRetryExhaustedV1Error,
  readPointCommitSqlRetryTerminalRefusal } from "../../../src/mutation/authentication/stored/finishingOperations";

const noDelay = Object.freeze({ nextDoubleUnsafe: () => 0, nextIntUnsafe: () => 0 });

describe("publication rollback retry policy", () => {
  it("stops at a permanent refusal after a confirmed transient rollback", async () => {
    const transient = new PointCommitConfirmedPreDecisionRollbackV1Error({ operation: "writeCommitHeader", sqlState: "40001", cause: "rollback" });
    const permanent = new PointCommitCorruptionV1Error({ reason: "commandInvalid" });
    let calls = 0;
    const publication = Effect.suspend(() => Effect.fail(++calls === 1 ? transient : permanent));
    await expect(Effect.runPromise(publishPointCommitWithKnownSettledSqlRetry(publication).pipe(
      Effect.provideService(Random.Random, noDelay)))).rejects.toBe(permanent);
    expect(calls).toBe(2);
  });

  it("retains the actual final rollback for durable terminalization after three attempts", async () => {
    const refusals = [1, 2, 3].map(ordinal => new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeCommitHeader", sqlState: "40P01", cause: ordinal,
    }));
    let calls = 0;
    const publication = Effect.suspend(() => {
      const refusal = refusals[calls++];
      return refusal === undefined ? Effect.die("Unexpected fourth SQL retry") : Effect.fail(refusal);
    });
    const failure = await Effect.runPromise(publishPointCommitWithKnownSettledSqlRetry(publication).pipe(
      Effect.provideService(Random.Random, noDelay))).then(() => undefined, (cause: unknown) => cause);
    expect(failure).toBeInstanceOf(PointCommitKnownSettledSqlRetryExhaustedV1Error);
    if (!(failure instanceof PointCommitKnownSettledSqlRetryExhaustedV1Error)) throw new Error("Expected SQL retry exhaustion");
    expect(readPointCommitSqlRetryTerminalRefusal(failure)).toBe(refusals[2]);
    expect(calls).toBe(3);
  });
});
