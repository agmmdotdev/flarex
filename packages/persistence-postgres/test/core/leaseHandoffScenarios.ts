import { Clock, Deferred, Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";

/** Replace only the host's proposal clock; persistence and SQL remain genuine. */
const acquireAt = Effect.fn("CoreLeaseHandoff.acquireAt")(
  function* (persistence: CorePersistence, proposal: bigint) {
    const clock = yield* Clock.Clock;
    return yield* persistence.acquireLease().pipe(Effect.provideService(Clock.Clock, {
      ...clock, currentTimeNanos: Effect.succeed(proposal), currentTimeNanosUnsafe: () => proposal,
    }));
  },
);

export function registerCoreLeaseHandoffScenarios(
  lane: string,
  create: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>,
) {
  describe(`serialized Core lease handoff (${lane})`, () => {
    it.each([100n, 99n])("admits a fresh successor with host-clock proposal %s", async proposal => {
      const fixture = await create();
      try {
        await fixture.query(`INSERT INTO "${fixture.namespace}".leases VALUES ($1,99)`, [fixture.instanceName]);
        const first = fixture.persistence;
        const lease = await Effect.runPromise(acquireAt(first, 100n));
        await Effect.runPromise(first.putGlobal(lease, "handoff-witness", new TextEncoder().encode("before")));
        const successor = await fixture.reopen();
        const result = await Effect.runPromise(Effect.result(acquireAt(successor, proposal)));
        expect(lease.token).toBe(100n);
        expect(result).toMatchObject({ _tag: "Success", success: { token: 101n } });
        expect(await Effect.runPromise(Effect.result(first.putGlobal(lease, "handoff-witness", Uint8Array.of(2)))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
        if (Result.isFailure(result)) throw new Error("Fresh successor was refused");
        await Effect.runPromise(successor.putGlobal(result.success, "handoff-witness", Uint8Array.of(3)));
      } finally { await fixture.close(); }
    });

    it("grants one capability to contenders that observed the same predecessor", async () => {
      const bothObserved = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      let observations = 0;
      let armed = false;
      const fixture = await create({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (statement, parameters) => driver.query(statement, parameters).pipe(Effect.tap(() => {
          if (!armed || !statement.startsWith("SELECT ts::text AS ts FROM ")) return Effect.void;
          return Effect.gen(function* () {
            observations += 1;
            if (observations === 2) yield* Deferred.succeed(bothObserved, undefined);
            yield* Deferred.await(release);
          });
        })),
      }) });
      const pending: Array<Promise<Result.Result<unknown, CorePersistenceError>>> = [];
      try {
        const first = fixture.persistence;
        const second = await fixture.reopen();
        armed = true;
        pending.push(Effect.runPromise(Effect.result(first.acquireLease())), Effect.runPromise(Effect.result(second.acquireLease())));
        await Effect.runPromise(Deferred.await(bothObserved));
        armed = false;
        await Effect.runPromise(Deferred.succeed(release, undefined));
        const outcomes = await Promise.all(pending);
        expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
        expect(outcomes.filter(Result.isFailure)).toMatchObject([{ failure: { reason: "leaseLost" } }]);
        expect(observations).toBe(2);
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        try { await Promise.all(pending); } finally { await fixture.close(); }
      }
    });

    it("refuses a paused stale observation without retrying or revoking the successor", async () => {
      const observed = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      let armed = false;
      let observations = 0;
      const fixture = await create({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (statement, parameters) => driver.query(statement, parameters).pipe(Effect.tap(() => {
          if (!statement.startsWith("SELECT ts::text AS ts FROM ")) return Effect.void;
          observations += 1;
          if (!armed) return Effect.void;
          armed = false;
          return Effect.gen(function* () { yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release); });
        })),
      }) });
      let pending: Promise<Result.Result<unknown, CorePersistenceError>> | undefined;
      try {
        const first = fixture.persistence;
        const successor = await fixture.reopen();
        armed = true;
        pending = Effect.runPromise(Effect.result(first.acquireLease()));
        await Effect.runPromise(Deferred.await(observed));
        const lease = await Effect.runPromise(successor.acquireLease());
        await Effect.runPromise(successor.putGlobal(lease, "winner", Uint8Array.of(1)));
        await Effect.runPromise(Deferred.succeed(release, undefined));
        expect(await pending).toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
        await Effect.runPromise(successor.putGlobal(lease, "winner", Uint8Array.of(2)));
        expect(observations).toBe(2);
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        try { await pending; } finally { await fixture.close(); }
      }
    });

    it("never issues a capability when the acquisition acknowledgement is lost", async () => {
      let discard = true;
      const fixture = await create({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (statement, parameters) => driver.query(statement, parameters).pipe(Effect.flatMap(rows => {
          if (!discard || !statement.startsWith("UPDATE ") || !statement.includes("RETURNING ts")) return Effect.succeed(rows);
          discard = false;
          return Effect.fail(new CorePersistenceError({ reason: "unavailable", cause: "Injected acquisition acknowledgement loss" }));
        })),
      }) });
      try {
        expect(await Effect.runPromise(Effect.result(fixture.persistence.acquireLease())))
          .toMatchObject({ _tag: "Failure", failure: { reason: "unavailable" } });
        const stored = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ ts: Schema.String })))(await fixture.query(
          `SELECT ts::text AS ts FROM "${fixture.namespace}".leases WHERE instance_name = $1`, [fixture.instanceName]));
        const token = stored[0]?.ts;
        if (token === undefined) throw new Error("Lost acknowledgement did not persist its generation");
        expect(await Effect.runPromise(Effect.result(fixture.persistence.putGlobal({ token: BigInt(token) }, "forged", Uint8Array.of(1)))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
        const reopened = await fixture.reopen();
        const replacement = await Effect.runPromise(reopened.acquireLease());
        expect(replacement.token).toBe(BigInt(token) + 1n);
        expect(await Effect.runPromise(reopened.isFresh(replacement))).toBe(true);
      } finally { await fixture.close(); }
    });

    it("keeps read-only admission separate from issued writers and resumes after removal", async () => {
      const fixture = await create();
      try {
        const first = fixture.persistence;
        const lease = await Effect.runPromise(first.acquireLease());
        await fixture.query(`INSERT INTO "${fixture.namespace}".read_only VALUES ($1)`, [fixture.instanceName]);
        const next = await fixture.reopen();
        expect(await Effect.runPromise(Effect.result(next.acquireLease())))
          .toMatchObject({ _tag: "Failure", failure: { reason: "readOnly" } });
        await Effect.runPromise(first.putGlobal(lease, "admitted-before-marker", Uint8Array.of(1)));
        await fixture.query(`DELETE FROM "${fixture.namespace}".read_only WHERE instance_name=$1`, [fixture.instanceName]);
        const replacement = await Effect.runPromise(next.acquireLease());
        expect(replacement.token).toBe(lease.token + 1n);
      } finally { await fixture.close(); }
    });

    it("advances timestamp-shaped predecessors exactly once and refuses signed-int64 saturation", async () => {
      const fixture = await create();
      try {
        const maximum = 0x7fff_ffff_ffff_ffffn;
        await fixture.query(`INSERT INTO "${fixture.namespace}".leases VALUES ($1,$2)`, [fixture.instanceName, maximum - 1n]);
        const lease = await Effect.runPromise(fixture.persistence.acquireLease());
        expect(lease.token).toBe(maximum);
        const reopened = await fixture.reopen();
        expect(await Effect.runPromise(Effect.result(reopened.acquireLease())))
          .toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
        await Effect.runPromise(fixture.persistence.putGlobal(lease, "last-generation", Uint8Array.of(1)));
        expect(await fixture.query(`SELECT ts::text AS ts FROM "${fixture.namespace}".leases WHERE instance_name=$1`, [fixture.instanceName]))
          .toEqual([{ ts: maximum.toString() }]);
      } finally { await fixture.close(); }
    });

    it("classifies malformed stored generations as corruption without replacing them", async () => {
      const fixture = await create();
      try {
        await fixture.query(`INSERT INTO "${fixture.namespace}".leases VALUES ($1,-1)`, [fixture.instanceName]);
        expect(await Effect.runPromise(Effect.result(fixture.persistence.acquireLease())))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
        expect(await fixture.query(`SELECT ts::text AS ts FROM "${fixture.namespace}".leases WHERE instance_name=$1`, [fixture.instanceName]))
          .toEqual([{ ts: "-1" }]);
      } finally { await fixture.close(); }
    });

    it.each(["missing observation", "mismatched acknowledgement"] as const)("issues no capability after %s", async kind => {
      const fixture = await create({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (statement, parameters) => driver.query(statement, parameters).pipe(Effect.map(rows => {
          if (kind === "missing observation" && statement.startsWith("SELECT ts::text AS ts FROM ")) return [];
          if (kind === "mismatched acknowledgement" && statement.startsWith("UPDATE ") && statement.includes("RETURNING ts"))
            return [{ ts: "999" }];
          return rows;
        })),
      }) });
      try {
        expect(await Effect.runPromise(Effect.result(fixture.persistence.acquireLease())))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
        const token = kind === "missing observation" ? 0n : 1n;
        expect(await fixture.query(`SELECT ts::text AS ts FROM "${fixture.namespace}".leases WHERE instance_name=$1`, [fixture.instanceName]))
          .toEqual([{ ts: token.toString() }]);
        expect(await Effect.runPromise(Effect.result(fixture.persistence.putGlobal({ token }, "inferred", Uint8Array.of(1)))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
      } finally { await fixture.close(); }
    });

    it("confines every fenced family to issued capabilities and keeps lost capabilities terminal", async () => {
      let transactions = 0;
      const fixture = await create({ wrapRuntimeDriver: driver => ({ ...driver,
        transaction: run => { transactions += 1; return driver.transaction(run); },
      }) });
      try {
        const first = fixture.persistence;
        const old = await Effect.runPromise(first.acquireLease());
        const second = await fixture.reopen();
        const lease = await Effect.runPromise(second.acquireLease());
        const operations = (persistence: CorePersistence, capability: { readonly token: bigint }):
          Array<Effect.Effect<unknown, CorePersistenceError>> => [
          persistence.write(capability, { documents: [], indexes: [] }),
          persistence.writeIndexBackfill(capability, []),
          persistence.reconcileIndexBackfill(capability, { id: new Uint8Array(16) }),
          persistence.putGlobal(capability, "forbidden", Uint8Array.of(1)),
          persistence.isFresh(capability), persistence.latestTimestamp(capability), persistence.readRetentionBounds(capability),
        ];
        for (const operation of operations(second, { token: lease.token })) {
          expect(await Effect.runPromise(Effect.result(operation)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
        }
        // First equality check latches loss; every later operation refuses before SQL.
        expect(await Effect.runPromise(Effect.result(first.isFresh(old))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
        const afterLoss = transactions;
        for (const operation of operations(first, old)) {
          expect(await Effect.runPromise(Effect.result(operation)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
        }
        expect(transactions).toBe(afterLoss);
        await Effect.runPromise(second.putGlobal(lease, "current", Uint8Array.of(1)));
      } finally { await fixture.close(); }
    });
  });
}
