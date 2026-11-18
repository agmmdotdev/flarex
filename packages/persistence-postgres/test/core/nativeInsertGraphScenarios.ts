import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CoreError, CoreNativeOperations } from "../../src/core/api";
import type { Json, JsonObject } from "flarex-protocol/json";
import { bytesEqual } from "@flarex/utils/bytes";
import { CorePersistenceError, type CoreIndexScan, type CorePersistence } from "../../src/core/contracts";
import type { CoreSqlConnection, CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { CORE_NATIVE_ANNOUNCED_FINDS, CORE_NATIVE_INSERT_GRAPH_SLOTS, CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS, planCoreNativeSlots,
  prefetchCoreNativeFindSlots, type CoreNativeAnnouncedFind, type CoreNativeInsertGroups } from "../../src/core/nativePrefetch";
import * as nativeQuery from "../../src/core/nativeQuery";
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
  let gate: ((statement: string) => Effect.Effect<void> | undefined) | undefined;
  const observe = <Connection extends CoreSqlConnection>(connection: Connection): Connection => ({ ...connection,
    query: (statement, parameters) => Effect.suspend(() => {
      statements.push(statement);
      return fault?.(statement) ?? Effect.andThen(gate?.(statement) ?? Effect.void, connection.query(statement, parameters));
    }) });
  const wrap = (driver: CoreSqlDriver): CoreSqlDriver => ({ ...observe(driver),
    write: (statement, parameters) => { statements.push(statement); return driver.write(statement, parameters); },
    withConnection: run => driver.withConnection(connection => run(observe(connection))),
    transaction: run => driver.transaction(connection => run(observe(connection))) });
  const reads = () => ({ firstPages: statements.filter(isFirstPages).length, pages: statements.filter(isPage).length });
  return { statements, wrap, reads, setFault: (next: typeof fault) => { fault = next; },
    /** Holds a statement before it reaches the driver. */
    setGate: (next: typeof gate) => { gate = next; } };
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
    /** The slot requests of every first-page batch, and slot reads a test refuses with a typed failure. */
    type Slots = { readonly batches: CoreIndexScan[][]; refuse?: ((request: CoreIndexScan) => boolean) | undefined };
    /** As `run`, also observing each batch's slots where the transaction asks persistence for them. */
    const runSlots = <Failure>(body: (graph: Graph, observed: Observed, slots: Slots, states: CoreFinalizedState[]) =>
      Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const observed = observedStatements(), slots: Slots = { batches: [] };
      const fixture = await createFixture({ wrapRuntimeDriver: observed.wrap });
      const refused = (request: CoreIndexScan) => slots.refuse?.(request) === true;
      const persistence: CorePersistence = { ...fixture.persistence,
        readSnapshot: (...input) => Effect.map(fixture.persistence.readSnapshot(...input), snapshot => ({ ...snapshot,
          preload: requests => Effect.suspend(() => {
            const admitted = requests.filter(request => !refused(request));
            slots.batches.push(admitted);
            return admitted.length === 0 ? Effect.void : snapshot.preload(admitted);
          }),
          scan: request => Effect.suspend(() => refused(request) ? Effect.fail(new CorePersistenceError({ reason: "unavailable" })) : snapshot.scan(request)) })) };
      const states: CoreFinalizedState[] = [];
      const originalIssue = CoreFinalizationVault.prototype.issue;
      const issue = vi.spyOn(CoreFinalizationVault.prototype, "issue").mockImplementation(function (this: CoreFinalizationVault, state) {
        states.push(state);
        return originalIssue.call(this, state);
      });
      try {
        await Effect.runPromise(Effect.scoped(Effect.flatMap(setupCompleteProductNative(fixture, persistence), graph => body(graph, observed, slots, states))));
      } finally { issue.mockRestore(); await fixture.close(); }
    };
    const sizes = (slots: Slots) => slots.batches.map(batch => batch.length);
    /** The announcement a framework host forwards: Core table names, insert order. */
    const announce = (graph: Graph, operations: CoreNativeOperations, groups: CoreNativeInsertGroups, finds: readonly CoreNativeAnnouncedFind[] = []) =>
      planCoreNativeSlots(operations, { finds: finds.map(find => ({ tableName: graph.table(find.tableName), where: find.where })),
        inserts: groups.map(group => ({ tableName: graph.table(group.tableName), rows: group.rows })) });
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
      yield* planCoreNativeSlots(writer.operations, { inserts: [{ tableName: "not-a-table", rows: groups[0]?.rows ?? [] },
        { tableName: "_tables", rows: [{ id: "a" }, { id: "b" }] }],
        finds: [{ tableName: "not-a-table", where: { id: "a" } }, { tableName: "not-a-table", where: { id: "b" } },
          { tableName: "_tables", where: { id: "a" } }, { tableName: "_tables", where: { id: "b" } }] });
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

    describe("announced finds", () => {
      const seed = (graph: Graph) => graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("product"), "insert", [product("seed-a"), product("seed-b")]);
        yield* operations.writeRows(graph.table("product_option"), "insert", [option("seed-size", "seed-a"), option("seed-color", "seed-a")]);
      }));
      /** Two tables, present and absent identities and one range. */
      const range: CoreNativeAnnouncedFind = { tableName: "product_option", where: { product_id: "seed-a" } };
      const finds: readonly CoreNativeAnnouncedFind[] = [{ tableName: "product", where: { id: "seed-a" } },
        { tableName: "product", where: { id: "absent" } }, { tableName: "product_option", where: { id: "seed-size" } }, range];
      const found = [1, 0, 1, 2];
      const find = (graph: Graph, operations: CoreNativeOperations, selected: CoreNativeAnnouncedFind) =>
        operations.find(graph.table(selected.tableName), selected.where);
      const findAll = (graph: Graph, operations: CoreNativeOperations, selected: readonly CoreNativeAnnouncedFind[]) =>
        Effect.forEach(selected, one => find(graph, operations, one));

      it("serves announced finds of several tables and a graph insert's slots from one uncharged statement with results, charges and observations unchanged", run((graph, observed, states) => Effect.gen(function* () {
        yield* seed(graph);
        const groups = productGraph("mixed");
        const attempt = Effect.fnUntraced(function* (announced: boolean) {
          const charges: number[] = [], budget = coreNativeTestBudget();
          const operation = yield* graph.begin({ ...budget, chargeRetained: bytes => Effect.andThen(Effect.sync(() => { charges.push(bytes); }), budget.chargeRetained(bytes)) });
          observed.statements.length = 0;
          if (announced) yield* announce(graph, operation.operations, groups, finds);
          const planned = { charges: charges.length, statements: observed.statements.length };
          const documents = yield* findAll(graph, operation.operations, finds);
          const afterFinds = observed.statements.length;
          const written = yield* insertAll(graph, operation.operations, groups);
          const reads = { ...observed.reads(), statements: observed.statements.length };
          states.length = 0;
          yield* operation.finalize();
          const state = comparable(states.at(-1));
          yield* operation.abort();
          return { documents, written: stripped(written), charges, planned, afterFinds, reads, state };
        });
        const control = yield* attempt(false), tested = yield* attempt(true);
        expect(control.documents.map(rows => rows.length)).toEqual(found);
        // Unannounced, every find reads its own slot and every table insert its own batch.
        expect(control.reads).toEqual({ firstPages: groups.length, pages: finds.length, statements: groups.length + finds.length });
        expect(tested.planned).toEqual({ charges: 0, statements: 1 });
        expect(tested.afterFinds).toBe(1);
        expect(tested.reads).toEqual({ firstPages: 1, pages: 0, statements: 1 });
        expect(tested.documents).toEqual(control.documents);
        expect(tested.written).toEqual(control.written);
        expect(tested.charges).toEqual(control.charges);
        expect(tested.state).toEqual(control.state);
      })), 120_000);

      it("records nothing for an announced find that no find consumed", run((graph, observed, states) => Effect.gen(function* () {
        yield* seed(graph);
        const attempt = Effect.fnUntraced(function* (announced: boolean) {
          const charges: number[] = [], budget = coreNativeTestBudget();
          const operation = yield* graph.begin({ ...budget, chargeRetained: bytes => Effect.andThen(Effect.sync(() => { charges.push(bytes); }), budget.chargeRetained(bytes)) });
          observed.statements.length = 0;
          if (announced) yield* announce(graph, operation.operations, [], finds);
          const planned = observed.statements.length;
          // Only the first announced find follows.
          const documents = yield* findAll(graph, operation.operations, finds.slice(0, 1));
          states.length = 0;
          yield* operation.finalize();
          const state = comparable(states.at(-1));
          yield* operation.abort();
          return { planned, documents, charges, state };
        });
        const control = yield* attempt(false), tested = yield* attempt(true);
        expect(tested.planned).toBe(1);
        expect(tested.documents).toEqual(control.documents);
        expect(tested.charges).toEqual(control.charges);
        expect(tested.state).toEqual(control.state);
      })), 120_000);

      it.each([
        ["no write", { range: 0, other: 0 }],
        // A covered table's insert keeps the announcement but ends the finds of its own table.
        ["a covered insert into the find's table", { range: 1, other: 0 }],
        // Any other write batch ends the whole announcement.
        ["an update of the find's table", { range: 1, other: 1 }],
      ] as const)("after %s reads a dropped announced find again with the write visible", (kind, expected) => run((graph, observed) => Effect.gen(function* () {
        yield* seed(graph);
        const other: CoreNativeAnnouncedFind = { tableName: "product", where: { id: "seed-b" } };
        const added = [{ tableName: "product_option", rows: [option("added-large", "seed-a"), option("added-small", "seed-a")] }];
        const attempt = Effect.fnUntraced(function* (announced: boolean) {
          const operation = yield* graph.begin();
          if (announced) yield* announce(graph, operation.operations, added, [range, other]);
          if (kind === "a covered insert into the find's table") yield* insertAll(graph, operation.operations, added);
          if (kind === "an update of the find's table")
            yield* operation.operations.writeRows(graph.table("product_option"), "update", [{ id: "seed-size", title: "renamed" }]);
          observed.statements.length = 0;
          const ranged = yield* find(graph, operation.operations, range);
          const afterRange = observed.statements.length;
          const point = yield* find(graph, operation.operations, other);
          const reads = { range: afterRange, other: observed.statements.length - afterRange };
          yield* operation.abort();
          // Generated document identities order the result and differ per attempt.
          return { ranged: ranged.map(({ _id, _creationTime, ...row }) => row).toSorted((left, right) => String(left.id) < String(right.id) ? -1 : 1), point, reads };
        });
        const control = yield* attempt(false), tested = yield* attempt(true);
        expect(control.reads).toEqual({ range: 1, other: 1 });
        expect(tested.reads).toEqual(expected);
        expect(tested.ranged).toEqual(control.ranged);
        expect(tested.point).toEqual(control.point);
        expect(tested.ranged.map(row => row.title).toSorted()).toEqual(kind === "no write" ? ["seed-color", "seed-size"]
          : kind === "an update of the find's table" ? ["renamed", "seed-color"] : ["added-large", "added-small", "seed-color", "seed-size"]);
      }))(), 120_000);

      it.each(["a write batch", "a staged write to one find's table"] as const)("stores no page that %s passed while the announcement's statement was in flight", kind => run((graph, observed) => Effect.gen(function* () {
        yield* seed(graph);
        const groups = productGraph("flight"), other: CoreNativeAnnouncedFind = { tableName: "product", where: { id: "seed-b" } };
        const operation = yield* graph.begin();
        // The row the staged write changes is observed first, so that write reads nothing.
        const [observedRow] = yield* find(graph, operation.operations, { tableName: "product_option", where: { id: "seed-color" } });
        const patched = observedRow?._id;
        if (typeof patched !== "string") throw new Error("Missing seeded option");
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        observed.setGate(statement => isFirstPages(statement) ? Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)) : undefined);
        const fiber = yield* Effect.forkChild(announce(graph, operation.operations, kind === "a write batch" ? groups : [], [range, other]));
        yield* Deferred.await(entered);
        observed.setGate(undefined);
        // A reconstitution of no rows is a write batch that reads nothing: it only drops.
        if (kind === "a write batch") yield* Effect.exit(operation.operations.reconstituteRows(graph.table("product"), [], "preserveTimestamps"));
        else yield* operation.operations.patch(patched, { title: "patched" });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
        observed.statements.length = 0;
        const ranged = yield* find(graph, operation.operations, range);
        const afterRange = observed.statements.length;
        yield* find(graph, operation.operations, other);
        const reads = { range: afterRange, other: observed.statements.length - afterRange };
        expect(ranged.map(row => row.title).toSorted()).toEqual([kind === "a write batch" ? "seed-color" : "patched", "seed-size"]);
        if (kind === "a write batch") {
          expect(reads).toEqual({ range: 1, other: 1 });
          // Nothing covers the announced tables either: each insert overlaps its own slots.
          observed.statements.length = 0;
          yield* insertAll(graph, operation.operations, groups);
          expect(observed.reads()).toEqual({ firstPages: groups.length, pages: 0 });
        // Only the written table's find was ended; the other table's page was stored.
        } else expect(reads).toEqual({ range: 1, other: 0 });
        yield* operation.abort();
      }))(), 120_000);

      it("keeps announced pages across a read batch and other finds, and reads a find of another range in place", run((graph, observed) => Effect.gen(function* () {
        yield* seed(graph);
        const operation = yield* graph.begin();
        yield* announce(graph, operation.operations, [], finds);
        observed.statements.length = 0;
        // Another identity of an announced table is another slot.
        expect(yield* operation.operations.find(graph.table("product"), { id: "seed-b" })).toHaveLength(1);
        expect(observed.reads()).toEqual({ firstPages: 0, pages: 1 });
        // A relational read's own selections are one read batch.
        yield* prefetchCoreNativeFindSlots(operation.operations, graph.table("product"), [{ id: "batch-a" }, { id: "batch-b" }]);
        expect(observed.reads()).toEqual({ firstPages: 1, pages: 1 });
        expect((yield* findAll(graph, operation.operations, finds)).map(rows => rows.length)).toEqual(found);
        expect(observed.reads()).toEqual({ firstPages: 1, pages: 1 });
        yield* operation.abort();
      })), 120_000);

      describe("an announced condition's derivation", () => {
        /** Conditions nothing can change: the forms a trusted owner announces and then finds. */
        const fixed = (tableName: string, where: JsonObject): CoreNativeAnnouncedFind => ({ tableName, where: Object.freeze(where) });
        /** How often the ordered find's two derivation owners ran. */
        const derivations = () => {
          const captured = vi.spyOn(nativeQuery, "captureCoreNativeWhere"), planned = vi.spyOn(nativeQuery, "planCoreNativeQuery");
          return { counted: <A, E>(work: Effect.Effect<A, E>) => Effect.gen(function* () {
            captured.mockClear(); planned.mockClear();
            const result = yield* work;
            return { result, captured: captured.mock.calls.length, planned: planned.mock.calls.length };
          }), restore: () => { captured.mockRestore(); planned.mockRestore(); } };
        };

        it("is taken by the find and the read batch handed that same fixed object, with results, charges and observations unchanged", run((graph, observed, states) => Effect.gen(function* () {
          yield* seed(graph);
          const spied = derivations();
          const attempt = Effect.fnUntraced(function* (kept: boolean) {
            const announced = finds.map(one => kept ? fixed(one.tableName, { ...one.where }) : { tableName: one.tableName, where: { ...one.where } });
            const charges: number[] = [], budget = coreNativeTestBudget();
            const operation = yield* graph.begin({ ...budget, chargeRetained: bytes => Effect.andThen(Effect.sync(() => { charges.push(bytes); }), budget.chargeRetained(bytes)) });
            observed.statements.length = 0;
            const plan = yield* spied.counted(announce(graph, operation.operations, [], announced));
            // The seam derives a read batch's slots as it is called.
            const batch = yield* spied.counted(Effect.suspend(() =>
              prefetchCoreNativeFindSlots(operation.operations, graph.table("product"), announced.slice(0, 2).map(one => one.where))));
            const found = yield* spied.counted(findAll(graph, operation.operations, announced));
            // An equal condition in another object, and the same object for another table, derive in full.
            const equal = yield* spied.counted(find(graph, operation.operations, { tableName: "product", where: { id: "seed-a" } }));
            const elsewhere = yield* spied.counted(find(graph, operation.operations, { tableName: "product", where: announced[2]?.where ?? {} }));
            const statements = observed.statements.length;
            states.length = 0;
            yield* operation.finalize();
            const state = comparable(states.at(-1));
            yield* operation.abort();
            return { plan, batch, found, equal, elsewhere, statements, charges, state };
          });
          const control = yield* attempt(false), tested = yield* attempt(true);
          spied.restore();
          const count = ({ captured, planned }: { captured: number; planned: number }) => ({ captured, planned });
          expect(count(control.plan)).toEqual({ captured: finds.length, planned: finds.length });
          expect(count(control.batch)).toEqual({ captured: 2, planned: 2 });
          expect(count(control.found)).toEqual({ captured: finds.length, planned: finds.length });
          expect(count(tested.plan)).toEqual({ captured: finds.length, planned: finds.length });
          expect(count(tested.batch)).toEqual({ captured: 0, planned: 0 });
          expect(count(tested.found)).toEqual({ captured: 0, planned: 0 });
          for (const attempted of [control, tested]) {
            expect(count(attempted.equal)).toEqual({ captured: 1, planned: 1 });
            expect(count(attempted.elsewhere)).toEqual({ captured: 1, planned: 1 });
            expect(attempted.found.result.map(rows => rows.length)).toEqual(found);
            // The other table's condition names a product that does not exist.
            expect(attempted.elsewhere.result).toEqual([]);
          }
          expect(tested.found.result).toEqual(control.found.result);
          expect(tested.equal.result).toEqual(control.equal.result);
          expect(tested.statements).toBe(control.statements);
          expect(tested.charges).toEqual(control.charges);
          expect(tested.state).toEqual(control.state);
        })), 120_000);

        it("is not kept for a condition object that can still change", run((graph, observed) => Effect.gen(function* () {
          yield* seed(graph);
          const spied = derivations(), operation = yield* graph.begin();
          const open = { id: "seed-a" }, bounds = { gte: "seed-a" }, ranged = Object.freeze({ id: bounds });
          yield* announce(graph, operation.operations, [], [{ tableName: "product", where: open }, { tableName: "product_option", where: ranged }]);
          // Each object now says something else: its find derives what it says.
          Object.assign(open, { id: "seed-b" });
          Object.assign(bounds, { gte: "seed-size" });
          const point = yield* spied.counted(operation.operations.find(graph.table("product"), open));
          const range = yield* spied.counted(operation.operations.find(graph.table("product_option"), ranged));
          spied.restore();
          expect({ captured: point.captured, planned: point.planned }).toEqual({ captured: 1, planned: 1 });
          expect({ captured: range.captured, planned: range.planned }).toEqual({ captured: 1, planned: 1 });
          expect(point.result.map(row => row.id)).toEqual(["seed-b"]);
          expect(range.result.map(row => row.id)).toEqual(["seed-size"]);
          yield* operation.abort();
        })), 120_000);

        it.each([
          ["no write", { range: 0, other: 0 }],
          ["a covered insert into the find's table", { range: 1, other: 0 }],
          ["an update of the find's table", { range: 1, other: 1 }],
          ["the next announcement", { range: 1, other: 1 }],
        ] as const)("after %s is derived again exactly where the announcement ended", (kind, expected) => run(graph => Effect.gen(function* () {
          yield* seed(graph);
          const spied = derivations(), operation = yield* graph.begin();
          const ranged = fixed(range.tableName, { ...range.where }), other = fixed("product", { id: "seed-b" });
          const added = [{ tableName: "product_option", rows: [option("again-large", "seed-a"), option("again-small", "seed-a")] }];
          yield* announce(graph, operation.operations, added, [ranged, other]);
          if (kind === "a covered insert into the find's table") yield* insertAll(graph, operation.operations, added);
          if (kind === "an update of the find's table")
            yield* operation.operations.writeRows(graph.table("product_option"), "update", [{ id: "seed-size", title: "renamed" }]);
          if (kind === "the next announcement") yield* announce(graph, operation.operations, [], [fixed("product", { id: "seed-a" }), fixed("product", { id: "absent" })]);
          const first = yield* spied.counted(find(graph, operation.operations, ranged));
          const second = yield* spied.counted(find(graph, operation.operations, other));
          spied.restore();
          expect({ range: first.planned, other: second.planned }).toEqual(expected);
          expect({ range: first.captured, other: second.captured }).toEqual(expected);
          expect(first.result).toHaveLength(kind === "a covered insert into the find's table" ? 4 : 2);
          expect(second.result).toHaveLength(1);
          yield* operation.abort();
          // A closed transaction answers no find, whatever it derived.
          expect(refusal(yield* Effect.exit(find(graph, operation.operations, other)))).toContain("closed");
        }))(), 120_000);
      });

      it("plans the finds within the announcement bound and leaves the rest to read in place", run((graph, observed) => Effect.gen(function* () {
        const extra = 12, operation = yield* graph.begin();
        const many = Array.from({ length: CORE_NATIVE_ANNOUNCED_FINDS + extra }, (_, position) => ({ tableName: "product", where: { id: `bound-${position}` } }));
        observed.statements.length = 0;
        yield* announce(graph, operation.operations, [], many);
        expect(observed.statements).toHaveLength(1);
        observed.statements.length = 0;
        yield* findAll(graph, operation.operations, many.slice(0, CORE_NATIVE_ANNOUNCED_FINDS));
        expect(observed.statements).toEqual([]);
        yield* findAll(graph, operation.operations, many.slice(CORE_NATIVE_ANNOUNCED_FINDS));
        expect(observed.reads()).toEqual({ firstPages: 0, pages: extra });
        yield* operation.abort();
      })), 120_000);

      it("counts finds into the transaction's slot bound and truncates the announcement that crosses it", run((graph, observed) => Effect.gen(function* () {
        const each = 250, whole = Math.floor(CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS / each), fitting = CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS - whole * each;
        const operation = yield* graph.begin();
        const issued: number[] = [];
        for (let call = 0; call < whole + 3; call += 1) {
          const many = Array.from({ length: each }, (_, position) => ({ tableName: "product", where: { id: `budget-${call}-${position}` } }));
          observed.statements.length = 0;
          yield* announce(graph, operation.operations, [], many);
          issued.push(observed.statements.length);
          if (call !== whole) continue;
          // The crossing announcement planned exactly the finds that still fit.
          observed.statements.length = 0;
          yield* findAll(graph, operation.operations, many.slice(0, fitting));
          expect(observed.statements).toEqual([]);
          yield* findAll(graph, operation.operations, many.slice(fitting, fitting + 2));
          expect(observed.reads()).toEqual({ firstPages: 0, pages: 2 });
        }
        expect(fitting).toBeGreaterThan(1);
        expect(issued).toEqual([...Array.from({ length: whole + 1 }, () => 1), 0, 0]);
        // Spent finds leave nothing for a graph insert either.
        observed.statements.length = 0;
        yield* announce(graph, operation.operations, productGraph("spent"));
        expect(observed.statements).toEqual([]);
        yield* operation.abort();
      })), 120_000);

      it("plans a reader's finds and none of its announced inserts", run((graph, observed) => Effect.gen(function* () {
        yield* seed(graph);
        const groups = productGraph("reader"), reader = yield* graph.beginRead();
        observed.statements.length = 0;
        yield* announce(graph, reader.operations, groups, finds);
        expect(observed.reads()).toEqual({ firstPages: 1, pages: 0 });
        expect((yield* findAll(graph, reader.operations, finds)).map(rows => rows.length)).toEqual(found);
        // The announced insert identities were not read: their finds read in place.
        yield* findAll(graph, reader.operations, [{ tableName: "product", where: { id: "reader-a" } }, { tableName: "image", where: { id: "reader-front" } }]);
        expect(observed.reads()).toEqual({ firstPages: 1, pages: 2 });
        yield* reader.abort();
      })), 120_000);
    });

    describe("per-table coverage and carried pages", () => {
      const seed = (graph: Graph) => graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("product"), "insert", [product("seed-a"), product("seed-b")]);
        yield* operations.writeRows(graph.table("product_option"), "insert", [option("seed-size", "seed-a"), option("seed-color", "seed-a")]);
      }));
      const find = (graph: Graph, operations: CoreNativeOperations, selected: CoreNativeAnnouncedFind) =>
        operations.find(graph.table(selected.tableName), selected.where);
      const findAll = (graph: Graph, operations: CoreNativeOperations, selected: readonly CoreNativeAnnouncedFind[]) =>
        Effect.forEach(selected, one => find(graph, operations, one));
      const range: CoreNativeAnnouncedFind = { tableName: "product_option", where: { product_id: "seed-a" } };
      /** Announced first; the first is found, the others are still to come at the next announcement. */
      const pending: readonly CoreNativeAnnouncedFind[] = [{ tableName: "product", where: { id: "seed-a" } }, range, { tableName: "product", where: { id: "absent" } }];
      const fresh: readonly CoreNativeAnnouncedFind[] = [{ tableName: "product", where: { id: "seed-b" } }, { tableName: "product", where: { id: "absent-too" } }];

      it.each([
        // The first table's own batch ends the announcement, so every later table overlaps its own slots too.
        ["first", "product", 4],
        // Every earlier table took its planned pages; only this one overlaps its own.
        ["last", "image", 1],
      ] as const)("leaves the %s insert table of a mixed announcement to its own batch when none of its own slots stored a page", (_name, refusedTable, batches) => runSlots((graph, observed, slots) => Effect.gen(function* () {
        yield* seed(graph);
        // The tablet of the refused table, as a batch of its slots names it.
        const probe = yield* graph.begin();
        yield* prefetchCoreNativeFindSlots(probe.operations, graph.table(refusedTable), [{ id: "probe-a" }, { id: "probe-b" }]);
        const tablet = slots.batches.at(-1)?.[0]?.tableId;
        yield* probe.abort();
        if (tablet === undefined) throw new Error("Missing probed tablet");
        const finds = [range, { tableName: "product_option", where: { id: "seed-size" } }];
        const attempt = Effect.fnUntraced(function* (prefix: string, refused: boolean) {
          const groups = productGraph(prefix), operation = yield* graph.begin();
          slots.batches.length = 0;
          if (refused) slots.refuse = request => bytesEqual(request.tableId, tablet);
          yield* announce(graph, operation.operations, groups, finds);
          slots.refuse = undefined;
          const planned = sizes(slots);
          const documents = yield* findAll(graph, operation.operations, finds);
          observed.statements.length = 0;
          const written = yield* insertAll(graph, operation.operations, groups);
          const reads = observed.reads();
          yield* operation.abort();
          return { planned, documents, reads, written: stripped(written).map(rows => rows.map(row => JSON.stringify(row).replaceAll(prefix, "graph"))) };
        });
        const control = yield* attempt("whole", false), tested = yield* attempt("partial", true);
        expect(control.planned).toHaveLength(1);
        expect(control.reads).toEqual({ firstPages: 0, pages: 0 });
        // The find pages and the other tables' pages were stored: the mixed batch did store pages.
        expect(tested.planned).toHaveLength(1);
        expect(tested.planned[0]).toBeGreaterThan(finds.length);
        expect(tested.planned[0]).toBeLessThan(control.planned[0] ?? 0);
        expect(tested.documents).toEqual(control.documents);
        // The refused table reads its slots in one batch of its own, never one by one.
        expect(tested.reads).toEqual({ firstPages: batches, pages: 0 });
        expect(tested.written).toEqual(control.written);
      }))(), 120_000);

      it("keeps a still-held page of a find announced again instead of reading it a second time, with results, charges and observations unchanged", runSlots((graph, observed, slots, states) => Effect.gen(function* () {
        yield* seed(graph);
        const later = [...fresh, ...pending.slice(1)];
        const attempt = Effect.fnUntraced(function* (announced: boolean) {
          const charges: number[] = [], budget = coreNativeTestBudget();
          const operation = yield* graph.begin({ ...budget, chargeRetained: bytes => Effect.andThen(Effect.sync(() => { charges.push(bytes); }), budget.chargeRetained(bytes)) });
          slots.batches.length = 0;
          observed.statements.length = 0;
          if (announced) yield* announce(graph, operation.operations, [], pending);
          const first = yield* findAll(graph, operation.operations, pending.slice(0, 1));
          // The nested announcement repeats the finds that are still to come.
          if (announced) yield* announce(graph, operation.operations, [], later);
          const planned = { batches: sizes(slots), statements: observed.statements.length };
          const documents = yield* findAll(graph, operation.operations, later);
          const statements = observed.statements.length;
          states.length = 0;
          yield* operation.finalize();
          const state = comparable(states.at(-1));
          yield* operation.abort();
          return { first, documents, planned, statements, charges, state };
        });
        const control = yield* attempt(false), tested = yield* attempt(true);
        expect(control.statements).toBe(pending.length + fresh.length);
        // The second batch reads only the finds announced for the first time.
        expect(tested.planned).toEqual({ batches: [pending.length, fresh.length], statements: 2 });
        expect(tested.statements).toBe(2);
        expect(tested.documents.map(rows => rows.length)).toEqual([1, 0, 2, 0]);
        expect(tested.first).toEqual(control.first);
        expect(tested.documents).toEqual(control.documents);
        expect(tested.charges).toEqual(control.charges);
        expect(tested.state).toEqual(control.state);
      })), 120_000);

      it.each([
        // The written table's page is gone when the find is announced again: it is read again, the other table's page kept.
        ["before", [pending.length, fresh.length + 1], 0],
        // The kept page is held under the new announcement's find set, which the write ends as well.
        ["after", [pending.length, fresh.length], 1],
      ] as const)("drops a find's page at a write to its table %s the announcement that repeats it", (when, batches, inPlace) => runSlots((graph, observed, slots) => Effect.gen(function* () {
        yield* seed(graph);
        const operation = yield* graph.begin(), later = [...fresh, ...pending.slice(1)];
        // The row the staged write changes is observed first, so that write reads nothing.
        const [observedRow] = yield* find(graph, operation.operations, { tableName: "product_option", where: { id: "seed-color" } });
        const patched = observedRow?._id;
        if (typeof patched !== "string") throw new Error("Missing seeded option");
        slots.batches.length = 0;
        yield* announce(graph, operation.operations, [], pending);
        if (when === "before") yield* operation.operations.patch(patched, { title: "patched" });
        yield* announce(graph, operation.operations, [], later);
        if (when === "after") yield* operation.operations.patch(patched, { title: "patched" });
        expect(sizes(slots)).toEqual(batches);
        observed.statements.length = 0;
        const ranged = yield* find(graph, operation.operations, range);
        expect(observed.reads()).toEqual({ firstPages: 0, pages: inPlace });
        expect(ranged.map(row => row.title).toSorted()).toEqual(["patched", "seed-size"]);
        // The other table's find kept its page through both.
        expect(yield* find(graph, operation.operations, { tableName: "product", where: { id: "absent" } })).toEqual([]);
        expect(observed.reads()).toEqual({ firstPages: 0, pages: inPlace });
        yield* operation.abort();
      }))(), 120_000);

      it("reads a carried page in place when another transaction committed into its interval after the page was read", runSlots((graph, observed, slots) => Effect.gen(function* () {
        yield* seed(graph);
        const later = [...fresh, ...pending.slice(1)], untouched = [...fresh, ...pending.slice(2)];
        const attempt = Effect.fnUntraced(function* (prefix: string, announced: boolean) {
          const operation = yield* graph.begin();
          slots.batches.length = 0;
          if (announced) yield* announce(graph, operation.operations, [], pending);
          // Committed after the range's page was read and before the announcement that carries it.
          const first = sizes(slots);
          yield* graph.write(operations => operations.writeRows(graph.table("product_option"), "insert", [option(`${prefix}-late`, "seed-a")]));
          // The competing insert's own batches are not this transaction's.
          slots.batches.length = 0;
          if (announced) yield* announce(graph, operation.operations, [], later);
          const planned = [...first, ...sizes(slots)];
          observed.statements.length = 0;
          const ranged = yield* find(graph, operation.operations, range);
          const reads = observed.reads();
          const others = yield* findAll(graph, operation.operations, untouched);
          const after = observed.reads();
          yield* operation.abort();
          return { planned, ranged: ranged.map(row => String(row.id).replace(prefix, "competing")).toSorted(), reads, others, after };
        });
        const tested = yield* attempt("tested", true);
        // The competing row leaves with its attempt, so the control starts from the same rows.
        yield* graph.write(operations => operations.deleteRows(graph.table("product_option"), [{ id: "tested-late" }]));
        const control = yield* attempt("control", false);
        // The second batch read only the new finds: the range's page was carried, not read again.
        expect(tested.planned).toEqual([pending.length, fresh.length]);
        // The carried page is as old as its own read, so the commit after it refuses it.
        expect(tested.reads).toEqual({ firstPages: 0, pages: 1 });
        expect(tested.reads).toEqual(control.reads);
        expect(tested.ranged).toEqual(["competing-late", "seed-color", "seed-size"]);
        expect(tested.ranged).toEqual(control.ranged);
        // The other carried page and the new pages, which no commit touched, are still served.
        expect(tested.after).toEqual(tested.reads);
        expect(tested.others).toEqual(control.others);
        expect(control.after).toEqual({ firstPages: 0, pages: 1 + untouched.length });
      })), 120_000);

      it("does not count a kept page again against the transaction's slot bound", runSlots((graph, observed, slots) => Effect.gen(function* () {
        const each = 250, repeats = Math.ceil(CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS / each) + 2, operation = yield* graph.begin();
        const many = (prefix: string) => Array.from({ length: each }, (_, position) => ({ tableName: "product", where: { id: `${prefix}-${position}` } }));
        const held = many("held");
        for (let call = 0; call < repeats; call += 1) yield* announce(graph, operation.operations, [], held);
        // Only the first announcement read; every repetition kept its pages.
        expect(sizes(slots)).toEqual([each]);
        // The bound still has room for exactly the slots not yet planned.
        const added = many("added");
        yield* announce(graph, operation.operations, [], [...held, ...added.slice(0, 6)]);
        expect(sizes(slots)).toEqual([each, 6]);
        observed.statements.length = 0;
        yield* findAll(graph, operation.operations, [...held, ...added.slice(0, 6)]);
        expect(observed.statements).toEqual([]);
        const spent = Math.floor((CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS - each - 6) / each);
        for (let call = 0; call < spent + 2; call += 1) yield* announce(graph, operation.operations, [], many(`spent-${call}`));
        // Each of those was read once until the bound was reached, the crossing one in part.
        expect(sizes(slots).slice(2).length).toBe(spent + 1);
        expect(sizes(slots).reduce((sum, size) => sum + size, 0)).toBe(CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS);
        yield* operation.abort();
      })), 120_000);
    });

    describe("normalized insert rows and the captures of one transaction", () => {
      /** Every snapshot the database opens and the first pages each is asked for. */
      const runObserved = <Failure>(body: (graph: Graph, observed: Readonly<{ opened: bigint[]; firstPages: number[] }>) =>
        Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
        const fixture = await createFixture({});
        const opened: bigint[] = [], firstPages: number[] = [];
        const persistence: CorePersistence = { ...fixture.persistence,
          readSnapshot: (...input) => Effect.map(fixture.persistence.readSnapshot(...input), snapshot => {
            opened.push(snapshot.timestamp);
            return { ...snapshot, preload: requests => Effect.andThen(Effect.sync(() => { firstPages.push(requests.length); }), snapshot.preload(requests)) };
          }) };
        try {
          await Effect.runPromise(Effect.scoped(Effect.flatMap(setupCompleteProductNative(fixture, persistence), graph => body(graph, { opened, firstPages }))));
        } finally { await fixture.close(); }
      };
      const nested = (depth: number): Json => depth === 0 ? "leaf" : { nested: nested(depth - 1) };

      it("reads a normalized row's unique slots without a document capture and still refuses the row the document codec refuses", runObserved((graph, observed) => Effect.gen(function* () {
        const table = graph.table("product");
        // Row normalization accepts this nesting; the document codec refuses it at the insert.
        const refused = { ...product("codec-refused"), metadata: nested(20) };
        const attempt = Effect.fnUntraced(function* (rows: readonly JsonObject[]) {
          const operation = yield* graph.begin();
          observed.firstPages.length = 0;
          const exit = yield* Effect.exit(operation.operations.writeRows(table, "insert", rows));
          const firstPages = [...observed.firstPages];
          const pending = (yield* operation.operations.find(table, {})).map(row => String(row.id)).toSorted();
          yield* operation.abort();
          return { refusal: refusal(exit), firstPages, pending };
        });
        // The identity slot and the handle slot of each row, the refused row's included.
        expect(yield* attempt([product("codec-a"), product("codec-b")])).toEqual({ refusal: "accepted", firstPages: [4], pending: ["codec-a", "codec-b"] });
        const alone = yield* attempt([refused]), second = yield* attempt([product("codec-a"), refused]);
        expect(alone).toEqual({ refusal: JSON.stringify([{ tag: "CoreTransactionError", reason: "invalidValue" }]), firstPages: [2], pending: [] });
        // The refused batch stages none of its rows.
        expect(second).toEqual({ refusal: alone.refusal, firstPages: [4], pending: [] });
        expect(yield* graph.read("product")).toEqual([]);
      })), 60_000);

      it("opens one persistence snapshot for one transaction's captures at one published timestamp and another once it advances", runObserved((graph, observed) => Effect.gen(function* () {
        const table = graph.table("product");
        yield* graph.write(operations => operations.writeRows(table, "insert", [product("held-a"), product("held-b")]));
        const operation = yield* graph.begin(), other = yield* graph.begin();
        observed.opened.length = 0;
        expect(yield* operation.operations.find(table, { id: "held-a" })).toHaveLength(1);
        expect(yield* operation.operations.find(table, { id: "held-b" })).toHaveLength(1);
        expect(yield* operation.operations.find(table, { id: "held-absent" })).toEqual([]);
        expect(observed.opened).toHaveLength(1);
        // Another transaction never takes it.
        expect(yield* other.operations.find(table, { id: "held-a" })).toHaveLength(1);
        expect(observed.opened).toEqual([observed.opened[0], observed.opened[0]]);
        const first = observed.opened[0] ?? 0n;
        // An untouched row committed later is still observed, on a snapshot of its own.
        yield* graph.write(operations => operations.writeRows(table, "insert", [product("held-c")]));
        observed.opened.length = 0;
        expect(yield* operation.operations.find(table, { id: "held-c" })).toHaveLength(1);
        expect(yield* operation.operations.find(table, { id: "held-other" })).toEqual([]);
        expect(observed.opened).toHaveLength(1);
        expect(observed.opened[0]).toBeGreaterThan(first);
        // A closed transaction is refused before any snapshot, held or new.
        yield* operation.abort();
        observed.opened.length = 0;
        expect(refusal(yield* Effect.exit(operation.operations.find(table, { id: "held-a" }))))
          .toBe(JSON.stringify([{ tag: "CoreTransactionError", reason: "closed" }]));
        expect(observed.opened).toEqual([]);
        yield* other.abort();
      })), 60_000);
    });
  });
}
