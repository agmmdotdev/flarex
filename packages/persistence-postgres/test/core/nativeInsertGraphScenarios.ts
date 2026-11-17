import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CoreError, CoreNativeOperations } from "../../src/core/api";
import { CorePersistenceError } from "../../src/core/contracts";
import type { CoreSqlConnection, CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { CORE_NATIVE_INSERT_GRAPH_SLOTS, CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS, prefetchCoreNativeGraphInsertSlots,
  type CoreNativeInsertGroups } from "../../src/core/nativePrefetch";
import { CoreFinalizationVault, type CoreFinalizedState } from "../../src/core/transaction";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { setupCompleteProductNative } from "./nativeRelationalIntegrityScenarios";
import { coreNativeTestBudget } from "./nativeTestBudget";

const product = (id: string) => ({ id, title: id, handle: id });
const option = (id: string, productId: string) => ({ id, product_id: productId, title: id });
const value = (id: string, optionId: string) => ({ id, option_id: optionId, value: id });
const image = (id: string, productId: string) => ({ id, product_id: productId, url: `https://example.test/${id}.png` });
/** One Product graph in its insertion order, by the genuine Product table names. */
const productGraph = (prefix: string): CoreNativeInsertGroups => [
  { tableName: "product", rows: [product(`${prefix}-a`), product(`${prefix}-b`)] },
  { tableName: "product_option", rows: [option(`${prefix}-size`, `${prefix}-a`), option(`${prefix}-color`, `${prefix}-b`)] },
  { tableName: "product_option_value", rows: [value(`${prefix}-s`, `${prefix}-size`), value(`${prefix}-m`, `${prefix}-size`), value(`${prefix}-red`, `${prefix}-color`)] },
  { tableName: "image", rows: [image(`${prefix}-front`, `${prefix}-a`), image(`${prefix}-back`, `${prefix}-a`)] },
];
const isFirstPages = (statement: string) => statement.includes("jsonb_to_recordset($3::jsonb)");
const isPage = (statement: string) => statement.includes("DISTINCT ON") && !statement.includes("jsonb_to_recordset");
/** Every statement the serving role sends, whichever connection carries it, with an optional injected outcome. */
function observedStatements() {
  const statements: string[] = [];
  let fault: ((statement: string) => Effect.Effect<never, CorePersistenceError> | undefined) | undefined;
  const observe = <Connection extends CoreSqlConnection>(connection: Connection): Connection => ({ ...connection,
    query: (statement, parameters) => Effect.suspend(() => {
      statements.push(statement);
      return fault?.(statement) ?? connection.query(statement, parameters);
    }) });
  const wrap = (driver: CoreSqlDriver): CoreSqlDriver => ({ ...observe(driver),
    write: (statement, parameters) => { statements.push(statement); return driver.write(statement, parameters); },
    withConnection: run => driver.withConnection(connection => run(observe(connection))),
    transaction: run => driver.transaction(connection => run(observe(connection))) });
  const reads = () => ({ firstPages: statements.filter(isFirstPages).length, pages: statements.filter(isPage).length });
  return { statements, wrap, reads, setFault: (next: typeof fault) => { fault = next; } };
}
/** Generated document identities differ per transaction; everything else must not. */
function comparable(state: CoreFinalizedState | undefined) {
  if (state === undefined) throw new Error("Missing finalized state");
  const generated = state.changes.flatMap(change => typeof change.finalDocument?._id === "string" ? [change.finalDocument._id] : []);
  let observations = JSON.stringify(state.nativeObservations, (_, member: unknown) => typeof member === "bigint" ? `${member}n`
    : member instanceof Uint8Array ? encodeBytesToLowercaseHex(member) : member);
  for (const [position, id] of generated.entries()) observations = observations.replaceAll(id, `generated-${position}`);
  return { usage: state.usage, observations, written: generated.length };
}
const stripped = (written: readonly (readonly Readonly<Record<string, unknown>>[])[]) =>
  written.map(rows => rows.map(({ _id, ...row }) => row));
const refusal = <A>(exit: Exit.Exit<A, unknown>) => Exit.isSuccess(exit) ? "accepted" : JSON.stringify(exit.cause.reasons.map(reason =>
  reason._tag === "Fail" ? { tag: (reason.error as { _tag?: string })._tag, reason: (reason.error as { reason?: string }).reason } : reason._tag));

export function registerNativeInsertGraphScenarios(label: string,
  createFixture: (options: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    type Observed = ReturnType<typeof observedStatements>;
    type Graph = Effect.Success<ReturnType<typeof setupCompleteProductNative>>;
    const run = <Failure>(body: (graph: Graph, observed: Observed, states: CoreFinalizedState[]) =>
      Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const observed = observedStatements();
      const fixture = await createFixture({ wrapRuntimeDriver: observed.wrap });
      const states: CoreFinalizedState[] = [];
      const originalIssue = CoreFinalizationVault.prototype.issue;
      const issue = vi.spyOn(CoreFinalizationVault.prototype, "issue").mockImplementation(function (this: CoreFinalizationVault, state) {
        states.push(state);
        return originalIssue.call(this, state);
      });
      try {
        await Effect.runPromise(Effect.scoped(Effect.flatMap(setupCompleteProductNative(fixture), graph => body(graph, observed, states))));
      } finally { issue.mockRestore(); await fixture.close(); }
    };
    /** The announcement a framework host forwards: Core table names, insert order. */
    const announce = (graph: Graph, operations: CoreNativeOperations, groups: CoreNativeInsertGroups) =>
      prefetchCoreNativeGraphInsertSlots(operations, groups.map(group => ({ tableName: graph.table(group.tableName), rows: group.rows })));
    /** The ordered table inserts an adapter performs for these groups. */
    const insertAll = (graph: Graph, operations: CoreNativeOperations, groups: CoreNativeInsertGroups,
      before: (tableName: string) => Effect.Effect<unknown, CoreError> = () => Effect.void,
      invocation?: Parameters<CoreNativeOperations["writeRows"]>[3]) => Effect.gen(function* () {
      const written = [];
      for (const group of groups) {
        yield* before(group.tableName);
        written.push(yield* operations.writeRows(graph.table(group.tableName), "insert", group.rows, invocation));
      }
      return written;
    });

    it("reads an announced graph insert's slots of every table in one uncharged statement with results and observations unchanged", run((graph, observed, states) => Effect.gen(function* () {
      const groups = productGraph("parity");
      const attempt = Effect.fnUntraced(function* (announced: boolean) {
        const charges: number[] = [], budget = coreNativeTestBudget();
        const operation = yield* graph.begin({ ...budget, chargeRetained: bytes => Effect.andThen(Effect.sync(() => { charges.push(bytes); }), budget.chargeRetained(bytes)) });
        observed.statements.length = 0;
        if (announced) yield* announce(graph, operation.operations, groups);
        const planned = { charges: charges.length, statements: observed.statements.length };
        const written = yield* insertAll(graph, operation.operations, groups);
        const reads = { ...observed.reads(), statements: observed.statements.length };
        states.length = 0;
        yield* operation.finalize();
        const state = comparable(states.at(-1));
        // Neither attempt commits, so both observe the same published snapshot.
        yield* operation.abort();
        return { written: stripped(written), charges, planned, reads, state };
      });
      const control = yield* attempt(false), tested = yield* attempt(true);
      // Without an announcement each table call overlaps only its own slots.
      expect(control.reads).toEqual({ firstPages: groups.length, pages: 0, statements: groups.length });
      expect(tested.planned).toEqual({ charges: 0, statements: 1 });
      expect(tested.reads).toEqual({ firstPages: 1, pages: 0, statements: 1 });
      expect(tested.written).toEqual(control.written);
      expect(tested.charges).toEqual(control.charges);
      expect(tested.state.written).toBe(groups.reduce((sum, group) => sum + group.rows.length, 0));
      expect(tested.state).toEqual(control.state);
    })), 60_000);

    it("rejects a planned page that a competing commit touched before its table insert and reads it again", run((graph, observed) => Effect.gen(function* () {
      const attempt = Effect.fnUntraced(function* (prefix: string, announced: boolean) {
        const groups = productGraph(prefix);
        const operation = yield* graph.begin();
        if (announced) yield* announce(graph, operation.operations, groups);
        observed.statements.length = 0;
        const exit = yield* Effect.exit(insertAll(graph, operation.operations, groups, tableName => tableName !== "product" ? Effect.void
          : Effect.andThen(graph.write(operations => operations.writeRows(graph.table("product"), "insert", [product(`${prefix}-b`)])),
            Effect.sync(() => { observed.statements.length = 0; }))));
        const after = { firstPages: observed.statements.filter(isFirstPages).length, pages: observed.statements.filter(isPage).length };
        yield* operation.abort();
        return { refusal: refusal(exit), after };
      });
      const control = yield* attempt("control", false), tested = yield* attempt("tested", true);
      expect(control.refusal).not.toBe("accepted");
      expect(tested.refusal).toBe(control.refusal);
      // The control's product call overlaps its own slots after the commit. The
      // stale planned pages fail their write-log proof instead, so the touched
      // slot is read in place at the newer snapshot before the refusal.
      expect(control.after).toEqual({ firstPages: 1, pages: 0 });
      expect(tested.after.firstPages).toBe(0);
      expect(tested.after.pages).toBeGreaterThan(0);
    })), 60_000);

    it.each([
      ["more rows than the graph bound", CORE_NATIVE_INSERT_GRAPH_SLOTS + 1],
      ["rows within the bound whose slots exceed it", CORE_NATIVE_INSERT_GRAPH_SLOTS - 4],
    ])("stops the plan at a table with %s and leaves it and every later table to its own batch", (_, rows) => run((graph, observed) => Effect.gen(function* () {
      const groups = productGraph("bound");
      const [products, options, values, images] = groups;
      if (products === undefined || options === undefined || values === undefined || images === undefined) throw new Error("Missing graph table");
      const wide = { tableName: "image", rows: Array.from({ length: rows }, (_, position) => image(`bound-wide-${position}`, "bound-a")) };
      const operation = yield* graph.begin();
      observed.statements.length = 0;
      yield* announce(graph, operation.operations, [products, wide, options, values]);
      expect(observed.reads()).toEqual({ firstPages: 1, pages: 0 });
      // Only the product table was planned: its insert takes its pages, the wide
      // table and the tables announced after it each overlap their own slots.
      yield* insertAll(graph, operation.operations, [products]);
      expect(observed.reads()).toEqual({ firstPages: 1, pages: 0 });
      yield* insertAll(graph, operation.operations, [options, values, images]);
      expect(observed.reads()).toEqual({ firstPages: 4, pages: 0 });
      yield* operation.abort();
    }))(), 60_000);

    it("stops planning once the transaction's graph inserts reached their slot bound", run((graph, observed) => Effect.gen(function* () {
      const operation = yield* graph.begin();
      const issued: number[] = [];
      for (let call = 0; call < 24; call += 1) {
        observed.statements.length = 0;
        yield* announce(graph, operation.operations, [{ tableName: "product", rows: Array.from({ length: 300 }, (_, position) => product(`budget-${call}-${position}`)) }]);
        issued.push(observed.statements.length);
      }
      const planned = issued.filter(statements => statements === 1).length;
      expect(planned).toBeGreaterThan(0);
      expect(planned * 300).toBeLessThanOrEqual(CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS);
      expect(issued).toEqual([...Array.from({ length: planned }, () => 1), ...Array.from({ length: 24 - planned }, () => 0)]);
      yield* operation.abort();
    })), 120_000);

    it("reads nothing for announced tables that are unknown, private or not writable by the writer", run((graph, observed) => Effect.gen(function* () {
      const groups = productGraph("refused");
      const writer = yield* graph.begin();
      observed.statements.length = 0;
      yield* prefetchCoreNativeGraphInsertSlots(writer.operations, [{ tableName: "not-a-table", rows: groups[0]?.rows ?? [] },
        { tableName: "_tables", rows: [{ id: "a" }, { id: "b" }] }]);
      expect(observed.statements).toEqual([]);
      yield* writer.abort();
      // A closed transaction reads nothing either.
      observed.statements.length = 0;
      yield* announce(graph, writer.operations, groups);
      expect(observed.statements).toEqual([]);
      const reader = yield* graph.beginRead();
      observed.statements.length = 0;
      yield* announce(graph, reader.operations, groups);
      expect(observed.statements).toEqual([]);
      yield* reader.abort();
    })), 60_000);

    it("covers no table when the planned batch stored no page", run((graph, observed) => Effect.gen(function* () {
      const groups = productGraph("unstored");
      const operation = yield* graph.begin();
      observed.setFault(statement => isFirstPages(statement) || isPage(statement) ? Effect.fail(new CorePersistenceError({ reason: "unavailable" })) : undefined);
      yield* announce(graph, operation.operations, groups);
      observed.setFault(undefined);
      observed.statements.length = 0;
      // Nothing was stored, so every table still overlaps its own slots.
      yield* insertAll(graph, operation.operations, groups);
      expect(observed.reads()).toEqual({ firstPages: groups.length, pages: 0 });
      yield* operation.abort();
    })), 60_000);

    it("propagates a defect of the planned batch and keeps none of its earlier pages", run((graph, observed) => Effect.gen(function* () {
      const groups = productGraph("defect"), defect = new Error("planned read defect");
      const operation = yield* graph.begin();
      // The shared first pages fail typed, so each slot reads for itself; a later one dies.
      let pages = 0;
      observed.setFault(statement => isFirstPages(statement) ? Effect.fail(new CorePersistenceError({ reason: "unavailable" }))
        : isPage(statement) && (pages += 1) > 3 ? Effect.die(defect) : undefined);
      const exit = yield* Effect.exit(announce(graph, operation.operations, groups));
      observed.setFault(undefined);
      expect(Exit.isFailure(exit) && exit.cause.reasons.every(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      expect(pages).toBeGreaterThan(3);
      observed.statements.length = 0;
      // The slots that had settled first left no page: an ordered find of the first planned identity reads in place.
      expect(yield* operation.operations.find(graph.table("product"), { id: "defect-a" })).toEqual([]);
      expect(observed.reads()).toEqual({ firstPages: 0, pages: 1 });
      yield* operation.abort();
    })), 60_000);

    it("propagates an interruption of the planned batch and leaves the following inserts unchanged", run((graph, observed) => Effect.gen(function* () {
      const groups = productGraph("interrupted");
      const control = yield* graph.begin();
      const expected = stripped(yield* insertAll(graph, control.operations, groups));
      yield* control.abort();
      const operation = yield* graph.begin();
      const entered = yield* Deferred.make<void>();
      observed.setFault(statement => isFirstPages(statement) ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never) : undefined);
      const fiber = yield* Effect.forkChild(announce(graph, operation.operations, groups));
      yield* Deferred.await(entered);
      const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
      observed.setFault(undefined);
      expect(Exit.isFailure(exit) && exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
      observed.statements.length = 0;
      expect(stripped(yield* insertAll(graph, operation.operations, groups))).toEqual(expected);
      expect(observed.reads()).toEqual({ firstPages: groups.length, pages: 0 });
      yield* operation.abort();
    })), 60_000);

    it.each(["update", "reconstitution"] as const)("drops the planned pages at a %s between the graph's table inserts with results unchanged", kind => run((graph, observed) => Effect.gen(function* () {
      const attempt = Effect.fnUntraced(function* (prefix: string, announced: boolean) {
        const groups = productGraph(prefix);
        const operation = yield* graph.begin();
        if (announced) yield* announce(graph, operation.operations, groups);
        const first = yield* insertAll(graph, operation.operations, groups.slice(0, 1));
        const between = yield* Effect.exit(kind === "update"
          ? operation.operations.writeRows(graph.table("product"), "update", [{ id: `${prefix}-a`, title: "renamed" }])
          : operation.operations.reconstituteRows(graph.table("product"), [], "preserveTimestamps"));
        observed.statements.length = 0;
        const rest = yield* insertAll(graph, operation.operations, groups.slice(1));
        const reads = observed.reads();
        yield* operation.abort();
        return { written: JSON.stringify(stripped([...first, ...rest])).replaceAll(prefix, "graph"), between: refusal(between), reads };
      });
      const control = yield* attempt("control", false), tested = yield* attempt("tested", true);
      expect(tested.written).toBe(control.written);
      expect(tested.between).toBe(control.between);
      // The remaining tables no longer hold planned pages and overlap their own slots.
      expect(tested.reads).toEqual(control.reads);
      expect(tested.reads).toEqual({ firstPages: 3, pages: 0 });
    }))(), 60_000);

    it("lets a statement reference check take its parent's planned page only while no commit touched it", run((graph, observed) => Effect.gen(function* () {
      const attempt = Effect.fnUntraced(function* (prefix: string, announced: boolean, competing: boolean) {
        const [products, options] = productGraph(prefix);
        if (products === undefined || options === undefined) throw new Error("Missing graph table");
        const operation = yield* graph.begin();
        if (announced) yield* announce(graph, operation.operations, [products, options]);
        if (competing) yield* graph.write(operations => operations.writeRows(graph.table("product"), "insert", products.rows));
        observed.statements.length = 0;
        // The child table is inserted first: its reference check finds the parent identity the plan read.
        const exit = yield* Effect.exit(insertAll(graph, operation.operations, [options], undefined, { statementReferenceChecks: true }));
        const reads = observed.reads();
        yield* operation.abort();
        return { refusal: refusal(exit), reads };
      });
      const absentControl = yield* attempt("absent-control", false, false), absent = yield* attempt("absent", true, false);
      expect(absentControl.refusal).not.toBe("accepted");
      expect(absent.refusal).toBe(absentControl.refusal);
      expect(absentControl.reads.pages).toBeGreaterThan(0);
      // The planned absence page answered the check without another read.
      expect(absent.reads).toEqual({ firstPages: 0, pages: 0 });
      const presentControl = yield* attempt("present-control", false, true), present = yield* attempt("present", true, true);
      expect(presentControl.refusal).toBe("accepted");
      // The competing parent made the planned absence stale: it is read again and found.
      expect(present.refusal).toBe("accepted");
      expect(present.reads.pages).toBeGreaterThan(0);
    })), 60_000);
  });
}
