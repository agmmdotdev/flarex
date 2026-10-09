import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { createPointCommitPublisherPortV1, PointCommitConflictV1Error, PointCommitCorruptionV1Error,
  PointFiniteAttemptRetryBudgetExhaustedError } from
  "../../persistence-postgres/src/commit/pointCommitTransaction";
import { fxSystemTransactionSessions } from "../../persistence-postgres/src/database/schema";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function execute(fixture: Fixture) {
  const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(await fixture.runExecution());
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
}

async function currentAttempt(fixture: Fixture) {
  const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
  if (session === undefined) throw new Error("Missing finite attempt");
  return session;
}

function selector(fixture: Fixture, attemptFence: bigint) {
  return { deploymentId: fixture.activation.anchor.deploymentId, scopeId: fixture.activation.anchor.scopeId,
    sessionId: fixture.activation.anchor.sessionId, attemptFence: attemptFence.toString() };
}

describe.each(drivers)("finite retry eligibility on %s", driver => {
  it("authenticates cold redispatch before one recovered replacement and replays its commit", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-cold-original-entry-${driver}` });
    try {
      const value = await execute(fixture);
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`, handle: `${fixture.seed.newHandle}-concurrent` });
      const failure = await Effect.runPromise(await fixture.prepareOccPublication(value))
        .then(() => undefined, (cause: unknown) => cause);
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      const fenced = await currentAttempt(fixture);
      expect(fenced.lifecycle).toBe("retrying");
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      const dispatcher = fixture.makeFiniteDispatcher();
      const published = await Effect.runPromise(dispatcher.redispatchExactPointMutationAttempt(selector(fixture, fenced.attemptFence)));
      expect(published).toMatchObject({ kind: "published" });
      const committed = await currentAttempt(fixture);
      expect(committed).toMatchObject({ lifecycle: "committed", attemptFence: fenced.attemptFence + 1n });
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(fixture.retryContexts).toHaveLength(1);
      expect(await Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt(selector(fixture, committed.attemptFence))))
        .toMatchObject({ kind: "replayed", token: published.kind === "busy" ? undefined : published.token });
      expect(await currentAttempt(fixture)).toEqual(committed);
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(fixture.retryContexts).toHaveLength(1);
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
    } finally { await fixture.close(); }
  }, 240_000);

  it("durably closes a permanent publication refusal before a cold dispatcher can rerun callbacks", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-permanent-${driver}` });
    try {
      const value = await execute(fixture);
      // The real publisher refuses the missing participant composition. This
      // is its actual typed failure, not an injected or reconstructed ticket.
      const publisher = createPointCommitPublisherPortV1(fixture.pointCommitPorts, {
        ...fixture.publisherOptions, logicalOperationProfiles: [],
      });
      const failure = await Effect.runPromise(await fixture.prepareOccPublication(value, publisher)).then(() => undefined, (cause: unknown) => cause);
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      const closed = await currentAttempt(fixture);
      expect(closed.lifecycle).toBe("aborted");
      expect(closed.validatedArgsJson).toBeNull();
      const before = Object.fromEntries(fixture.nativeInvokeCount);
      await expect(fixture.retryWholeAttempt(failure)).rejects.toMatchObject({ reason: "unprovenRetry" });
      await expect(Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt(
        selector(fixture, closed.attemptFence)))).rejects.toBeDefined();
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(before);
      expect(fixture.retryContexts).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 240_000);

  for (const recovery of ["warm", "cold"] as const) {
    it(`enforces the same persisted four-rerun budget through ${recovery} recovery`, async () => {
      let fixture: Fixture;
      let conflicts = 0;
      fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-budget-${recovery}-${driver}`, hooks: {
        afterNativeBeforeAck: method => method !== "update" ? Effect.void : Effect.tryPromise({
          try: async () => {
            const ordinal = ++conflicts;
            await fixture.runStandaloneProductUpdate({ title: `concurrent title ${ordinal}`, handle: `concurrent-handle-${ordinal}` });
          }, catch: cause => commerceError("resourceFailure", cause),
        }),
      } });
      try {
        let failure = await Effect.runPromise(await fixture.prepareOccPublication(await execute(fixture))).then(() => undefined, (cause: unknown) => cause);
        expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
        for (let attempt = 2; attempt <= 5; attempt++) {
          failure = await (recovery === "warm" ? fixture.retryWholeAttempt(failure) :
            Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt(
              selector(fixture, (await currentAttempt(fixture)).attemptFence)))).then(() => undefined, (cause: unknown) => cause);
          if (attempt < 5) expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
        }
        expect(failure).toBeInstanceOf(PointFiniteAttemptRetryBudgetExhaustedError);
        expect(failure).toMatchObject({ attemptFence: 5n, maximumAttempts: 5n });
        const closed = await currentAttempt(fixture);
        expect(closed.attemptFence).toBe(5n);
        expect(closed.lifecycle).toBe("aborted");
        expect(fixture.nativeInvokeCount.get("update")).toBe(5);
        expect(fixture.retryContexts).toHaveLength(4);
        await expect(Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt(
          selector(fixture, 5n)))).rejects.toBeDefined();
        expect(fixture.nativeInvokeCount.get("update")).toBe(5);
      } finally { await fixture.close(); }
    }, 240_000);
  }

  it("replays a successful fifth attempt before applying the exhausted budget", async () => {
    let fixture: Fixture;
    let conflicts = 0;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-budget-success-${driver}`, hooks: {
      afterNativeBeforeAck: method => method !== "update" || conflicts >= 4 ? Effect.void : Effect.tryPromise({
        try: async () => {
          const ordinal = ++conflicts;
          await fixture.runStandaloneProductUpdate({ title: `concurrent successful title ${ordinal}`, handle: `concurrent-success-handle-${ordinal}` });
        }, catch: cause => commerceError("resourceFailure", cause),
      }),
    } });
    try {
      let failure = await Effect.runPromise(await fixture.prepareOccPublication(await execute(fixture))).then(() => undefined, (cause: unknown) => cause);
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      for (let attempt = 2; attempt <= 4; attempt++) {
        failure = await fixture.retryWholeAttempt(failure).then(() => undefined, (cause: unknown) => cause);
        expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      }
      expect(await fixture.retryWholeAttempt(failure)).toMatchObject({ kind: "published" });
      expect((await currentAttempt(fixture)).attemptFence).toBe(5n);
      expect(await Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt(
        selector(fixture, 5n)))).toMatchObject({ kind: "replayed" });
      expect(fixture.nativeInvokeCount.get("update")).toBe(5);
      expect(fixture.retryContexts).toHaveLength(4);
    } finally { await fixture.close(); }
  }, 240_000);
});
