import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { currencyAnnouncementWrite, currencyCommands } from "../src/modules/currency/service";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./support/logical-currency-fixture";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { requireAtomicCommerceScopeExclusion } from "../../persistence-postgres/src/frameworks/atomicCommerce/execution";

// Real independent transactions are required; PGlite's single connection cannot
// establish callback exclusion. Currency supplies a neutral existing row owner.
const native = process.env.FLAREX_TEST_DRIVER === "postgres" ? describe : describe.skip;
const cleanup: Array<() => Promise<void>> = [];
let fixture: LogicalCurrencyFixture;
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (!(value instanceof Error)) return [];
  const reason = "reason" in value && typeof value.reason === "string" ? value.reason : value.name;
  return [reason, ...failurePath(value.cause)];
}

native("logical atomic workflow locking prerequisite", () => {
  beforeAll(async () => { fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close)); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  for (const isolation of [undefined, "scopeExclusive"] as const) it(isolation === undefined
    ? "retains default overlapping callbacks and stale-write rejection"
    : "excludes a competing callback before its availability read", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const firstRead = yield* Deferred.make<void>();
      const secondRead = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const participant = defineAtomicCommerceParticipant("currency");
      const observed: number[] = [];
      const change = defineAtomicCommerceCommand("lockingPrerequisite", Effect.fn("LockingProof.change")(function* (ctx, input) {
        if (isolation !== undefined) yield* requireAtomicCommerceScopeExclusion(ctx);
        const current = yield* ctx.call(participant, currencyCommands.retrieve, { code: "usd" });
        if (!isJsonObject(current) || typeof current.decimal_digits !== "number") return yield* ctx.refuse(commerceError("storedCorruption"));
        observed.push(current.decimal_digits);
        yield* Deferred.succeed(input === "first" ? firstRead : secondRead, undefined);
        yield* Deferred.await(release);
        return yield* ctx.call(participant, currencyAnnouncementWrite, {
          code: "usd", name: "Locking proof", symbol: "$", symbol_native: "$",
          decimal_digits: current.decimal_digits + 1, rounding: 0,
        });
      }));
      const host = yield* makeAtomicCommerceHost({ ...fixture.hostInput, ...(isolation === undefined ? {} : { executionIsolation: isolation }), commands: [change], participants: [{
        participant, logicalStorage: fixture.hostInput.logicalStorage, commands: [currencyCommands.retrieve, currencyAnnouncementWrite],
      }] });
      yield* Effect.addFinalizer(() => host.close);
      const first = yield* Effect.forkChild(host.run(host.newRequestKey(), change, "first"));
      yield* Deferred.await(firstRead);
      const second = yield* Effect.forkChild(host.run(host.newRequestKey(), change, "second"));
      // The first callback remains live. A second readiness signal is direct
      // evidence of overlap, rather than a SQL count or an inferred lock wait.
      const overlap = yield* Deferred.await(secondRead).pipe(Effect.as(true),
        Effect.timeoutOrElse({ duration: isolation === undefined ? "1 second" : "100 millis", orElse: () => Effect.succeed(false) }));
      yield* Deferred.succeed(release, undefined);
      const outcomes = [yield* Fiber.await(first), yield* Fiber.await(second)];
      const failures = outcomes.filter(Exit.isFailure).map(exit => failurePath(exit.cause));
      const stored = yield* fixture.host.read(currencyCommands.retrieve, { code: "usd" });
      process.stdout.write(JSON.stringify({ callbackOverlap: overlap, observed, successes: outcomes.filter(Exit.isSuccess).length,
        failures, stored }) + "\n");
      if (isolation === undefined) {
        expect(overlap).toBe(true);
        expect(observed).toHaveLength(2);
        expect(observed[1]).toBe(observed[0]);
        expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
        expect(failures.flat()).toContain("writeConflict");
        expect(stored).toMatchObject({ decimal_digits: observed[0]! + 1 });
      } else {
        expect(overlap).toBe(false);
        expect(outcomes.every(Exit.isSuccess)).toBe(true);
        expect(stored).toMatchObject({ decimal_digits: observed[0]! + 2 });
      }
    })));
  });

  it("binds exclusion to replay identity, rejects caught default-profile checks and closes escaped evidence", async () => {
    let escaped: AtomicCommerceContext | undefined;
    const participant = defineAtomicCommerceParticipant("currency");
    const check = defineAtomicCommerceCommand("exclusionIdentity", Effect.fn("LockingProof.identity")(function* (ctx) {
      escaped = ctx;
      yield* requireAtomicCommerceScopeExclusion(ctx).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
      return yield* ctx.call(participant, currencyCommands.retrieve, { code: "usd" });
    }));
    const options = { ...fixture.hostInput, commands: [check], participants: [{ participant,
      logicalStorage: fixture.hostInput.logicalStorage, commands: [currencyCommands.retrieve] }] };
    const exclusive = await Effect.runPromise(makeAtomicCommerceHost({ ...options, executionIsolation: "scopeExclusive" }));
    const ordinary = await Effect.runPromise(makeAtomicCommerceHost(options));
    try {
      const key = exclusive.newRequestKey();
      const result = await Effect.runPromise(exclusive.run(key, check, null));
      expect(await Effect.runPromise(exclusive.run(key, check, null))).toEqual(result);
      const foreign = await Effect.runPromise(Effect.exit(ordinary.run(key, check, null)));
      expect(Exit.isFailure(foreign) ? failurePath(foreign.cause) : []).toContain("requestConflict");
      const caught = await Effect.runPromise(Effect.exit(ordinary.run(ordinary.newRequestKey(), check, null)));
      expect(Exit.isFailure(caught) ? failurePath(caught.cause) : []).toContain("unsupportedProfile");
      if (escaped === undefined) throw new Error("Missing escaped exclusion context");
      const closed = await Effect.runPromise(Effect.exit(requireAtomicCommerceScopeExclusion(escaped)));
      expect(Exit.isFailure(closed) ? failurePath(closed.cause) : []).toContain("invalidAuthority");
    } finally { await Effect.runPromise(exclusive.close); await Effect.runPromise(ordinary.close); }
  });
});
