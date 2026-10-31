import { Cause, Deferred, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { copyBytes } from "@flarex/utils/bytes";
import { CorePersistenceError, type CoreDocumentLogCursor, type CoreDocumentLogEntry, type CorePreviousRevisionSearch } from "../../src/core/contracts";
import type { CoreSqlDriver, CoreSqlParameter } from "../../src/database/corePersistence/driver";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";

const id = (value: number) => { const bytes = new Uint8Array(16); new DataView(bytes.buffer).setUint32(12, value); return bytes; };
const row = (ts: bigint, table: number, key: number, deleted = false, prevTs: bigint | null = null): CoreDocumentLogEntry => ({
  ts, tableId: id(table), id: id(key), deleted, prevTs,
  jsonValue: deleted ? new Uint8Array() : new TextEncoder().encode("{}"),
});
const search = (table: number, key: number, ts: bigint): CorePreviousRevisionSearch => ({ tableId: id(table), id: id(key), ts });
const noFloor = { validateIndex: () => Effect.void, validateDocument: () => Effect.void };
const key = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12);
type QueryEffect = Effect.Effect<readonly unknown[], CorePersistenceError>;
type HistoryHook = (execute: QueryEffect) => QueryEffect;

function tracker(hook?: HistoryHook) {
  const state = { checkouts: 0, releases: 0, transactions: 0,
    history: [] as Array<Readonly<{ statement: string; parameters: readonly CoreSqlParameter[] }>> };
  let runtime: CoreSqlDriver | undefined;
  const wrap = (driver: CoreSqlDriver): CoreSqlDriver => {
    runtime = driver;
    return { ...driver,
      transaction: run => { state.transactions += 1; return driver.transaction(run); },
      withConnection: run => driver.withConnection(connection => Effect.acquireUseRelease(
        Effect.sync(() => { state.checkouts += 1; }),
        () => run({ query: (statement, parameters = []) => {
          if (!statement.includes("AS query_ts")) return connection.query(statement, parameters);
          return Effect.suspend(() => {
            state.history.push({ statement, parameters: parameters.map(value => value instanceof Uint8Array ? copyBytes(value) : value) });
            const execute = connection.query(statement, parameters);
            return hook === undefined ? execute : hook(execute);
          });
        } }),
        () => Effect.sync(() => { state.releases += 1; }),
      )),
    };
  };
  return { state, wrap, runtime: () => {
    if (runtime === undefined) throw new Error("History fixture did not retain its runtime driver");
    return runtime;
  } };
}

export function registerPreviousRevisionSearchScenarios(lane: string,
  create: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>): void {
  const withFixture = async (run: (fixture: CorePersistenceFixture) => Promise<void>, options?: CorePersistenceFixtureOptions) => {
    const fixture = await create(options);
    try { await run(fixture); } finally { await fixture.close(); }
  };
  describe(`Source batched previous-revision search (${lane})`, () => {
    it("preserves numeric timestamp order for history, point reads and log pages", () => withFixture(async fixture => {
      const lease = await Effect.runPromise(fixture.persistence.acquireLease());
      await Effect.runPromise(fixture.persistence.write(lease, { documents: [
        row(2n, 2, 4), row(10n, 2, 4, true, 2n), row(100n, 2, 4, false, 10n),
      ], indexes: [] }));
      const history = await Effect.runPromise(fixture.persistence.previousRevisions([search(2, 4, 11n)]));
      const snapshot = await Effect.runPromise(fixture.persistence.readSnapshot(11n));
      const point = await Effect.runPromise(snapshot.get(id(2), id(4)));
      const collect = async (order: "asc" | "desc") => {
        const timestamps: bigint[] = [];
        let after: CoreDocumentLogCursor | undefined;
        for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
          const page = await Effect.runPromise(fixture.persistence.loadDocuments({
            start: 2n, end: 100n, order, maxResults: 1, tableId: id(2), ...(after === undefined ? {} : { after }),
          }));
          timestamps.push(...page.documents.map(document => document.ts));
          if (page.done) return timestamps;
          if (page.cursor === null) throw new Error("Numeric log page omitted its continuation tuple");
          after = page.cursor;
        }
        throw new Error("Three source revisions did not finish in four log pages");
      };
      const ascending = await collect("asc");
      const descending = await collect("desc");
      // Capture every read before the assertion so a wrong history result cannot hide point/log failures.
      expect({ history: history.map(value => ({ ts: value.document.ts, deleted: value.document.deleted })),
        point: Option.match(point, { onNone: () => null, onSome: value => ({ ts: value.ts, deleted: value.deleted }) }),
        ascending, descending }).toEqual({ history: [{ ts: 10n, deleted: true }], point: { ts: 10n, deleted: true },
        ascending: [2n, 10n, 100n], descending: [100n, 10n, 2n] });
    }));

    it("keeps strict bounds, tombstones, table/instance identity and distinct query times", () => withFixture(async fixture => {
      const lease = await Effect.runPromise(fixture.persistence.acquireLease());
      await Effect.runPromise(fixture.persistence.write(lease, { documents: [row(1n, 2, 4), row(3n, 2, 4, false, 1n),
        row(7n, 2, 4, true, 3n), row(2n, 2, 5), row(4n, 3, 4)], indexes: [] }));
      const other = await fixture.reopen("other");
      const otherLease = await Effect.runPromise(other.acquireLease());
      await Effect.runPromise(other.write(otherLease, { documents: [row(9n, 2, 4)], indexes: [] }));
      const queries = [search(3, 4, 5n), search(2, 4, 8n), search(2, 4, 1n), search(2, 4, 4n),
        search(2, 4, 3n), search(2, 4, 2n), search(2, 5, 2n), search(2, 5, 3n), search(2, 99, 20n), search(2, 4, 4n)];
      const result = await Effect.runPromise(fixture.persistence.previousRevisions(queries));
      expect(result.map(value => [key(value.query.tableId), key(value.query.id), value.query.ts, value.document.ts,
        value.document.deleted, value.document.prevTs])).toEqual([
        [2, 4, 2n, 1n, false, null], [2, 4, 3n, 1n, false, null], [2, 4, 4n, 3n, false, 1n],
        [2, 4, 8n, 7n, true, 3n], [2, 5, 3n, 2n, false, null], [3, 4, 5n, 4n, false, null],
      ]);
      expect(result.find(value => value.document.deleted)?.document.jsonValue).toEqual(new Uint8Array());
      expect((await Effect.runPromise(fixture.persistence.previousRevisions([search(2, 4, 10n)])))[0]?.document.deleted).toBe(true);
      expect((await Effect.runPromise(other.previousRevisions([search(2, 4, 10n)])))[0]?.document.ts).toBe(9n);
      const first = result[0];
      if (first === undefined) throw new Error("Missing owned search result");
      first.query.id.fill(0);
      first.document.id.fill(0);
      expect(key(queries[5]?.id ?? new Uint8Array(16))).toBe(4);
      expect((await Effect.runPromise(fixture.persistence.previousRevisions([search(2, 4, 2n)])))[0]?.document.id).toEqual(id(4));
      // The older exact-predecessor port keeps its different meaning.
      expect(await Effect.runPromise(fixture.persistence.previousRevisionsOfDocuments([
        { ...search(2, 4, 8n), prevTs: 2n },
      ]))).toEqual([]);
    }));

    it("uses eight-way groups and singleton remainders with sixteen owned query futures", async () => {
      const entered = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      let active = 0, peak = 0, settled = 0;
      const observed = tracker(execute => Effect.uninterruptible(Effect.acquireUseRelease(
        Effect.sync(() => { active += 1; peak = Math.max(peak, active); if (active === 16) Deferred.doneUnsafe(entered, Effect.void); }),
        () => execute.pipe(Effect.andThen(rows => Deferred.await(release).pipe(Effect.as(rows)))),
        () => Effect.sync(() => { active -= 1; settled += 1; }),
      )));
      await withFixture(async fixture => {
        const lease = await Effect.runPromise(fixture.persistence.acquireLease());
        await Effect.runPromise(fixture.persistence.write(lease, { documents: [row(1n, 2, 136)], indexes: [] }));
        observed.state.transactions = 0;
        const input = Array.from({ length: 136 }, (_, index) => ({ ...search(2, index + 1, index === 0 ? 11n : 20n) }));
        const pending = Effect.runPromiseExit(fixture.persistence.previousRevisions(input, {
          validateIndex: () => Effect.void,
          validateDocument: at => Effect.sync(() => { expect(at).toBe(11n); expect(settled).toBe(17); }),
        }));
        let exit: Exit.Exit<readonly unknown[], CorePersistenceError>;
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(5_000)));
          expect(observed.state.history).toHaveLength(16);
          expect(observed.state.checkouts).toBe(1);
          expect(observed.state.releases).toBe(0);
          // This last request has not entered its query yet. It must already be owned.
          const last = input.at(-1);
          if (last === undefined) throw new Error("Missing last request");
          last.tableId.fill(255); last.id.fill(255); last.ts = 0n; input.length = 0;
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          exit = await pending;
        }
        expect(Exit.isSuccess(exit)).toBe(true);
        if (Exit.isSuccess(exit)) expect(exit.value).toMatchObject([{ query: { tableId: id(2), id: id(136), ts: 20n }, document: { ts: 1n } }]);
        expect(peak).toBe(16);
        expect(observed.state.history).toHaveLength(17);
        expect(observed.state.transactions).toBe(0);
        expect(observed.state.releases).toBe(1);
        // Source uses single requests for the incomplete final group.
        observed.state.history.length = 0;
        await Effect.runPromise(fixture.persistence.previousRevisions(Array.from({ length: 19 }, (_, index) => search(2, index + 1, 20n)), noFloor));
        expect(observed.state.history).toHaveLength(5);
        expect(observed.state.history.filter(value => value.statement.startsWith("WITH "))).toHaveLength(2);
        expect(observed.state.history.filter(value => value.statement.startsWith("SELECT "))).toHaveLength(3);
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("rechecks the document floor after returned rows and empty results have settled", async () => {
      const entered = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      const observed = tracker(execute => execute.pipe(Effect.andThen(rows => Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return rows;
      }))));
      await withFixture(async fixture => {
        const lease = await Effect.runPromise(fixture.persistence.acquireLease());
        const pending = Effect.runPromiseExit(fixture.persistence.previousRevisions([search(2, 4, 49n)]));
        let result: Exit.Exit<readonly unknown[], CorePersistenceError>;
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(5_000)));
          await Effect.runPromise(fixture.persistence.putGlobal(lease, "document_min_snapshot_ts", new TextEncoder().encode("50")));
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          result = await pending;
        }
        expect(Exit.isFailure(result) && result.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error.reason === "outOfRetention")).toBe(true);
        expect(observed.state.releases).toBe(1);
        expect(await Effect.runPromise(fixture.persistence.previousRevisions([search(2, 4, 50n)]))).toEqual([]);
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("fails closed on wrong query correlation, nonprevious rows and duplicate results", async () => {
      let mode: "valid" | "wrongQuery" | "wrongId" | "boundary" | "duplicate" = "valid";
      const observed = tracker(execute => execute.pipe(Effect.map(rows => {
        if (mode === "valid") return [...rows].reverse();
        if (mode === "duplicate") return [...rows, ...rows];
        return [{ ts: mode === "boundary" ? "4" : "1", table_id: id(2), id: id(mode === "wrongId" ? 99 : 4),
          json_value: new TextEncoder().encode("{}"), deleted: false, prev_ts: null,
          query_ts: mode === "wrongQuery" ? "999" : "4" }];
      })));
      await withFixture(async fixture => {
        const lease = await Effect.runPromise(fixture.persistence.acquireLease());
        await Effect.runPromise(fixture.persistence.write(lease, { documents: [row(1n, 2, 4)], indexes: [] }));
        for (const fault of ["wrongQuery", "wrongId", "boundary", "duplicate"] as const) {
          mode = fault;
          const result = await Effect.runPromise(Effect.result(fixture.persistence.previousRevisions([search(2, 4, 4n)])));
          expect(Result.isFailure(result) && result.failure.reason).toBe("corruptData");
        }
        mode = "valid";
        expect(await Effect.runPromise(fixture.persistence.previousRevisions([search(2, 4, 4n), search(2, 4, 2n)])))
          .toMatchObject([{ query: { ts: 2n }, document: { ts: 1n } }, { query: { ts: 4n }, document: { ts: 1n } }]);
        expect(observed.state.releases).toBe(5);
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("drains issued queries before releasing a cancelled read checkout", async () => {
      const entered = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      const cancellation = new AbortController();
      let started = 0, settled = 0;
      const observed = tracker(execute => Effect.uninterruptible(Effect.gen(function* () {
        started += 1;
        if (started === 16) yield* Deferred.succeed(entered, undefined);
        const rows = yield* execute;
        yield* Deferred.await(release);
        settled += 1;
        return rows;
      })));
      await withFixture(async fixture => {
        const pending = Effect.runPromiseExit(fixture.persistence.previousRevisions(
          Array.from({ length: 136 }, (_, index) => search(2, index + 1, 20n)), noFloor), { signal: cancellation.signal });
        let result: Exit.Exit<readonly unknown[], CorePersistenceError>;
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(5_000)));
          cancellation.abort();
          await Effect.runPromise(Effect.yieldNow);
          expect(observed.state.releases).toBe(0);
        } finally {
          cancellation.abort();
          await Effect.runPromise(Deferred.succeed(release, undefined));
          result = await pending;
        }
        expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
        expect(started).toBe(16);
        expect(settled).toBe(started);
        expect(observed.state.releases).toBe(1);
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("preserves a complete transport Cause without retrying the query", async () => {
      const unavailable = new CorePersistenceError({ reason: "unavailable" });
      const defect = new Error("History query defect");
      const cause = Cause.fromReasons([Cause.makeFailReason(unavailable), Cause.makeDieReason(defect), Cause.makeInterruptReason(42)]);
      const observed = tracker(() => Effect.failCause(cause));
      await withFixture(async fixture => {
        const result = await Effect.runPromiseExit(fixture.persistence.previousRevisions([search(2, 4, 4n)], noFloor));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          expect(result.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
          const [failed, died, interrupted] = result.cause.reasons;
          expect(failed !== undefined && Cause.isFailReason(failed) && failed.error).toBe(unavailable);
          expect(died !== undefined && Cause.isDieReason(died) && died.defect).toBe(defect);
          expect(interrupted !== undefined && Cause.isInterruptReason(interrupted) && interrupted.fiberId).toBe(42);
        }
        expect(observed.state.history).toHaveLength(1);
        expect(observed.state.releases).toBe(1);
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("selects bounded revisions through the ordinary document key index", () => {
      const observed = tracker();
      return withFixture(async fixture => {
        const lease = await Effect.runPromise(fixture.persistence.acquireLease());
        await Effect.runPromise(fixture.persistence.write(lease, { documents: Array.from({ length: 1024 }, (_, index) => row(BigInt(index + 1), 2, index + 1)), indexes: [] }));
        await fixture.query(`ANALYZE "${fixture.namespace}".documents`);
        await Effect.runPromise(fixture.persistence.previousRevisions([1, 17, 99, 233, 511, 777, 999, 1024].map(value => search(2, value, 1025n))));
        const query = observed.state.history[0];
        if (query === undefined) throw new Error("Missing history query plan witness");
        const plan = JSON.stringify(await Effect.runPromise(observed.runtime().query(`EXPLAIN (FORMAT JSON) ${query.statement}`, query.parameters)));
        expect(plan).toContain('"Index Name":"documents_by_table_and_id"');
        expect(plan).not.toContain('"Node Type":"Seq Scan"');
        expect(plan).not.toContain('"Node Type":"Sort"');
      }, { wrapRuntimeDriver: observed.wrap });
    });

    it("does not acquire a checkout for empty or malformed requests", () => {
      const observed = tracker();
      return withFixture(async fixture => {
        expect(await Effect.runPromise(fixture.persistence.previousRevisions([]))).toEqual([]);
        const invalid = await Effect.runPromise(Effect.result(fixture.persistence.previousRevisions([{ tableId: new Uint8Array(15), id: id(4), ts: 4n }])));
        expect(Result.isFailure(invalid) && invalid.failure.reason).toBe("invalidTarget");
        expect(observed.state.checkouts).toBe(0);
      }, { wrapRuntimeDriver: observed.wrap });
    });
  });
}
