import { Effect, Result, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreError, CoreRequestAbsence, CoreRequestIdentity } from "../../src/core/api";
import type { CoreSqlConnection, CoreSqlDriver } from "../../src/database/corePersistence/driver";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { readCoreNativeFixtureInventory } from "./nativeFixtureInventory";
import { openCoreDatabase, openCoreDatabaseGeneration } from "../../src/core/database";
import { rebindNativeRootFixture, setupNativeRootFixture, type NativeRootFixture } from "./nativeRootScenarios";
import { coreNativeTestBudget } from "./nativeTestBudget";

/** Every statement the serving role sends, whichever connection carries it. */
function observedStatements() {
  const statements: string[] = [];
  const observe = <Connection extends CoreSqlConnection>(connection: Connection): Connection => ({ ...connection,
    query: (statement, parameters) => Effect.suspend(() => { statements.push(statement); return connection.query(statement, parameters); }) });
  const wrap = (driver: CoreSqlDriver): CoreSqlDriver => ({ ...observe(driver),
    write: (statement, parameters) => { statements.push(statement); return driver.write(statement, parameters); },
    withConnection: run => driver.withConnection(connection => run(observe(connection))),
    transaction: run => driver.transaction(connection => run(observe(connection))) });
  return { statements, wrap };
}
const post = (title: string) => ({ title, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

export function registerNativeRequestAbsenceScenarios(label: string,
  createFixture: (options: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    type Observed = ReturnType<typeof observedStatements>;
    const run = <Failure>(body: (tested: NativeRootFixture, observed: Observed, fixture: CorePersistenceFixture) =>
      Effect.Effect<void, Failure, Scope.Scope>) => async () => {
      const observed = observedStatements();
      const fixture = await createFixture({ wrapRuntimeDriver: observed.wrap });
      try {
        await Effect.runPromise(Effect.scoped(Effect.flatMap(setupNativeRootFixture(fixture), tested => body(tested, observed, fixture))));
      } finally { await fixture.close(); }
    };
    const request = (tested: NativeRootFixture, key: string): CoreRequestIdentity =>
      ({ kind: "nativeRoot", root: tested.metadata.identity, key, requestHash: `arguments of ${key}` });
    /** The absence a fresh resolution of this request issues. */
    const absent = Effect.fnUntraced(function* (tested: NativeRootFixture, identity: CoreRequestIdentity) {
      const resolved = yield* tested.database.resolveRequest(identity);
      if (resolved.kind !== "missing" || resolved.absence === undefined) return yield* Effect.die(new Error("Fresh request had no absence"));
      expect(Object.keys(resolved.absence)).toEqual([]);
      return resolved.absence;
    });
    /** One claim and the statements it sent. */
    const claim = Effect.fnUntraced(function* (tested: NativeRootFixture, observed: Observed, identity: CoreRequestIdentity,
      absence?: CoreRequestAbsence) {
      observed.statements.length = 0;
      const acquired = yield* tested.database.claimRequest(identity, tested.root, absence);
      return { acquired, statements: observed.statements.length };
    });
    /** The statement count of today's complete claim of a fresh request. */
    const control = Effect.fnUntraced(function* (tested: NativeRootFixture, observed: Observed, key: string) {
      const identity = request(tested, key);
      yield* tested.database.resolveRequest(identity);
      const claimed = yield* claim(tested, observed, identity);
      if (claimed.acquired.kind !== "claimed") return yield* Effect.die(new Error("Control request was not claimed"));
      yield* tested.database.abortRequest(claimed.acquired.claim);
      return claimed.statements;
    });

    it("claims a resolved-absent request with one statement fewer and replays its committed outcome through the complete path", run((tested, observed) => Effect.gen(function* () {
      const complete = yield* control(tested, observed, "control");
      const identity = request(tested, "fresh"), absence = yield* absent(tested, identity);
      const claimed = yield* claim(tested, observed, identity, absence);
      expect(claimed.statements).toBe(complete - 1);
      if (claimed.acquired.kind !== "claimed") return yield* Effect.die(new Error("Absent request was not claimed"));
      expect(yield* tested.database.resolveRequest(identity)).toEqual({ kind: "busy" });
      const operation = yield* tested.database.beginNativeRoot(tested.root, { claim: claimed.acquired.claim, ...coreNativeTestBudget() });
      yield* (yield* operation.native(tested.payloadBinding)).insert("posts", post("committed"));
      const timestamp = yield* tested.database.commit(yield* operation.finalize(), { claim: claimed.acquired.claim, result: { done: true } });
      // A committed request resolves to its outcome and carries no absence.
      const committed = { kind: "committed", timestamp, result: { done: true } };
      const replayed = yield* tested.database.resolveRequest(identity);
      expect(replayed).toEqual(committed);
      expect("absence" in replayed).toBe(false);
      // The spent absence predates the claim's own write, so the claim reads again.
      expect(yield* claim(tested, observed, identity, absence)).toEqual({ acquired: committed, statements: 1 });
      expect(yield* claim(tested, observed, identity)).toEqual({ acquired: committed, statements: 1 });
    })), 120_000);

    it("gives a claimant that lost the key after its resolution exactly the complete path's outcome", run((tested, observed) => Effect.gen(function* () {
      const identity = request(tested, "contended");
      const [first, second] = [yield* absent(tested, identity), yield* absent(tested, identity)];
      // Both hold a valid absence of the same key and claim at once: the read
      // witness each registers lets exactly one commit.
      const contenders = yield* Effect.all([tested.database.claimRequest(identity, tested.root, first),
        tested.database.claimRequest(identity, tested.root, second)], { concurrency: 2 });
      expect(contenders.map(result => result.kind).toSorted()).toEqual(["busy", "claimed"]);
      const winner = contenders.find(result => result.kind === "claimed");
      if (winner?.kind !== "claimed") return yield* Effect.die(new Error("Missing winning claim"));
      // A later claimant whose absence predates the winner's claim reads the key.
      const complete = yield* claim(tested, observed, identity);
      expect(complete.acquired).toEqual({ kind: "busy" });
      expect(yield* claim(tested, observed, identity, first)).toEqual(complete);
      expect(yield* claim(tested, observed, identity, second)).toEqual(complete);
      yield* tested.database.abortRequest(winner.claim);
      const failed = yield* claim(tested, observed, identity);
      expect(failed.acquired).toEqual({ kind: "failed" });
      expect(yield* claim(tested, observed, identity, first)).toEqual(failed);
      // A changed correlation under a held absence of the original is refused as before.
      const changed = { ...identity, requestHash: "changed correlation" };
      expect(failure(yield* Effect.result(tested.database.claimRequest(changed, tested.root, first)))).toMatchObject({ reason: "requestMismatch" });
    })), 120_000);

    it("reads the key for another request's, another database's and a forged absence", run((tested, observed, fixture) => Effect.gen(function* () {
      const complete = yield* control(tested, observed, "control");
      const other = yield* absent(tested, request(tested, "other"));
      const expectComplete = Effect.fnUntraced(function* (key: string, absence: unknown) {
        const identity = request(tested, key);
        yield* tested.database.resolveRequest(identity);
        const claimed = yield* claim(tested, observed, identity, absence as CoreRequestAbsence);
        expect(claimed.statements).toBe(complete);
        if (claimed.acquired.kind !== "claimed") return yield* Effect.die(new Error(`Request ${key} was not claimed`));
        return claimed.acquired.claim;
      });
      const held = yield* expectComplete("wrong-request", other);
      // The other request's absence never hides this request's existing record.
      expect((yield* claim(tested, observed, request(tested, "wrong-request"), other)).acquired).toEqual({ kind: "busy" });
      yield* tested.database.abortRequest(held);
      yield* expectComplete("wrong-hash", yield* absent(tested, { ...request(tested, "wrong-hash"), requestHash: "another correlation" }));
      yield* expectComplete("copied", { ...(yield* absent(tested, request(tested, "copied"))) });
      yield* expectComplete("plain", {});
      yield* expectComplete("primitive", "absence");
      yield* expectComplete("null", null);
      // The same request resolved absent by a different database instance.
      const foreign = yield* Effect.acquireRelease(Effect.promise(() => createFixture({})), owned => Effect.promise(() => owned.close()));
      const elsewhere = yield* setupNativeRootFixture(foreign);
      expect(elsewhere.metadata.identity).toEqual(tested.metadata.identity);
      yield* expectComplete("foreign", yield* absent(elsewhere, request(elsewhere, "foreign")));
      expect(fixture.namespace).not.toBe(foreign.namespace);
    })), 180_000);

    it("leaves no live claim or row when a claim made with an absence is rolled back", run((tested, observed, fixture) => Effect.gen(function* () {
      const identity = request(tested, "rolled-back"), absence = yield* absent(tested, identity);
      const claimed = yield* claim(tested, observed, identity, absence);
      if (claimed.acquired.kind !== "claimed") return yield* Effect.die(new Error("Absent request was not claimed"));
      const operation = yield* tested.database.beginNativeRoot(tested.root, { claim: claimed.acquired.claim, ...coreNativeTestBudget() });
      yield* (yield* operation.native(tested.payloadBinding)).insert("posts", post("rolled back"));
      yield* operation.abort();
      yield* tested.database.abortRequest(claimed.acquired.claim);
      expect(yield* tested.database.resolveRequest(identity)).toEqual({ kind: "failed" });
      expect(failure(yield* Effect.result(tested.database.abortRequest(claimed.acquired.claim)))).toMatchObject({ reason: "foreignClaim" });
      expect((yield* claim(tested, observed, identity, absence)).acquired).toEqual({ kind: "failed" });
      const inventory = yield* readCoreNativeFixtureInventory(tested.database, fixture.persistence);
      expect(inventory.rows.filter(row => row.table === "posts")).toEqual([]);
    })), 120_000);

    it.each([
      // The successor only took the lease: neither path can see anything under the key.
      ["took the lease only", false],
      // The successor's claim is not in the stale owner's write log, so its held absence still stands.
      ["claimed the same request", true],
    ] as const)("stores nothing and issues no claim for a stale owner holding an absence after a successor %s", (_name, successorClaims) => run((tested, observed, fixture) => Effect.gen(function* () {
      /** One owner generation with its request census, resolved absent, then succeeded. */
      const superseded = Effect.fnUntraced(function* (key: string, hold: boolean) {
        const persistence = yield* Effect.promise(() => fixture.reopen());
        const stale = yield* Effect.acquireRelease(openCoreDatabaseGeneration(persistence, tested.options, 8), owned => owned.database.close());
        const staleRoot = yield* rebindNativeRootFixture(stale.database, tested);
        const identity = request(tested, key);
        const absence = yield* absent({ ...tested, database: stale.database }, identity);
        const successorPersistence = yield* Effect.promise(() => fixture.reopen());
        const successor = yield* Effect.acquireRelease(openCoreDatabase(successorPersistence, tested.options), owned => owned.close());
        const successorRoot = yield* rebindNativeRootFixture(successor, tested);
        const held = successorClaims ? yield* successor.claimRequest(identity, successorRoot) : undefined;
        if (successorClaims && held?.kind !== "claimed") return yield* Effect.die(new Error("Successor did not claim"));
        observed.statements.length = 0;
        const refused = yield* Effect.result(stale.database.claimRequest(identity, staleRoot, hold ? absence : undefined));
        const statements = observed.statements.length;
        const stored = (yield* readCoreNativeFixtureInventory(successor, successorPersistence)).outcomes.filter(outcome => outcome.value.key === key)
          .map(outcome => ({ state: outcome.value.state, timestamp: outcome.timestamp }));
        return { refused, statements, stored, resolved: yield* successor.resolveRequest(identity),
          heldAt: held?.kind === "claimed" ? yield* successor.publishedTimestamp : undefined,
          // What this generation hands its successor to recover.
          unresolved: stale.sealRequests().map(unresolved => unresolved.key) };
      });
      const complete = yield* superseded("complete", false), held = yield* superseded("held", true);
      // No claim is issued on either path: the fenced commit refuses the stale owner.
      for (const attempt of [complete, held]) {
        expect(Result.isFailure(attempt.refused)).toBe(true);
        expect(failure(attempt.refused)).toMatchObject({ _tag: "CorePersistenceError", reason: "leaseLost" });
        // Nothing of the stale claim is stored: only the successor's own record, unchanged.
        expect(attempt.stored).toEqual(successorClaims ? [{ state: "claimed", timestamp: attempt.heldAt }] : []);
        expect(attempt.resolved.kind).toBe(successorClaims ? "busy" : "missing");
      }
      // The held absence only saves the stale owner its scan.
      expect(held.statements).toBe(complete.statements - 1);
      // A lost lease is not a proven noncommit, so on either path the request stays in
      // the stale generation's census for its successor to recover.
      expect(complete.unresolved).toEqual(["complete"]);
      expect(held.unresolved).toEqual(["held"]);
    }))(), 180_000);
  });
}
