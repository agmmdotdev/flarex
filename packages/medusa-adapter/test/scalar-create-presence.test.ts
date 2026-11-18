import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import type { ModulePersistenceMutationEventArgs } from "@medusajs/types";
import { commerceError, commerceLimits, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { prepareScalarRepository } from "../src/repository/scalar";
import { scalarIdWhere } from "../src/repository/scalar-id-read";
import { decodeCompiledDml } from "../src/schema/compiled";
import { compileCompleteRow } from "../src/value/complete-row";
import { mockRelationalRead } from "./mock-relational-read";

const timestamp = "2026-10-23T00:00:00.000Z";
const metadata = () => decodeCompiledDml({ tables: [{ name: "neutral_owner", columns: [
  { name: "id", type: "id", nullable: false, primaryKey: true },
  ...["first_id", "second_id", "created_by"].map(name => ({ name, type: "text", nullable: true, primaryKey: false })),
  { name: "metadata", type: "json", nullable: true, primaryKey: false },
  { name: "score", type: "float", nullable: true, primaryKey: false },
  ...["created_at", "updated_at", "deleted_at"].map(name => ({ name, type: "dateTime", nullable: name === "deleted_at", primaryKey: false })),
], indexes: [], checks: [], foreignKeys: ["first", "second"].map(name => ({ name: `${name}_fk`, columns: [`${name}_id`],
  referencedTable: "neutral_target", referencedColumns: ["id"] })),
relationships: ["first", "second"].map(name => ({ name, type: "belongsTo", targetModel: "NeutralTarget", targetTable: "neutral_target",
  nullable: true, cascadeDelete: false, cascadeDetach: false, foreignKeyNames: [`${name}_id`] })),
cascades: { delete: [], detach: [] } }] });

const complete = (id: string, values: JsonObject = {}): JsonObject => ({ id, first_id: null, second_id: null,
  created_by: null, metadata: null, score: null, created_at: timestamp, updated_at: timestamp, deleted_at: null, ...values });

/** The write capability supplies scripted complete storage results. It does
 * not implement defaults, constraints or transactions; this unit witness owns
 * only immediate native presentation and mutation-subscriber translation. */
const create = Effect.fn("ScalarCreatePresence.create")((input: unknown, stored: readonly JsonObject[], nativePresence = true, nativeReal = false) =>
  Effect.scoped(Effect.gen(function* () {
    const table = (yield* metadata()).tables[0];
    if (table === undefined) throw new Error("Missing neutral creation metadata");
    const prepared = yield* Effect.fromResult(prepareScalarRepository(table, "NeutralOwner", scalarIdWhere, undefined,
      { ...(nativePresence ? { nativeToOneCreationPresence: table.relationships } : {}),
        ...(nativeReal ? { nativeRealPresentation: true } : {}) }));
    const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), current => current.close);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits,
      {}, {}, "scalar-create-presence", "write"), current => current.close);
    const writes: unknown[] = [], eventRows: ModulePersistenceMutationEventArgs["entity"][] = [];
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store = { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, find: unused, findPage: unused,
      count: unused, aggregate: unused, delete: unused, lifecycle: unused,
      write: (_context: unknown, mode: unknown, rows: unknown) => Effect.sync(() => {
        expect(mode).toBe("insert"); writes.push(structuredClone(rows)); return structuredClone(stored);
      }) };
    const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources, store,
      table: () => Effect.succeed(store) }, "scalar-create-presence", lifetime.context, unused, unused);
    const bound = prepared.bind(root, owner), shared = { manager: root.manager };
    bound.events.registerSubscriber(shared, bound.events.createSubscriber(["NeutralOwner"], {
      interceptEntityMutationEvents: (_event, args) => { eventRows.push(structuredClone(args.entity)); },
    }));
    const rows = yield* bound.createRows(root, input, shared);
    return { rows, writes, eventRows, decode: yield* Effect.fromResult(compileCompleteRow(table)) };
  })));

describe("opt-in native nullable belongsTo creation presence", () => {
  it("distinguishes omitted and own undefined FKs from explicit NULL and supplied IDs", async () => {
    const inputs = [{ id: "omitted" }, { id: "undefined", first_id: undefined, second_id: undefined },
      { id: "null", first_id: null }, { id: "supplied", first_id: "target-a", second_id: "target-b" }];
    const before = structuredClone(inputs), stored = inputs.map(row => complete(row.id,
      row.id === "supplied" ? { first_id: "target-a", second_id: "target-b" } : {}));
    const result = await Effect.runPromise(create(inputs, stored));
    expect(result.rows).toEqual([
      { ...complete("omitted"), first_id: undefined, second_id: undefined },
      { ...complete("undefined"), first_id: undefined, second_id: undefined },
      { ...complete("null"), first_id: null, second_id: undefined },
      complete("supplied", { first_id: "target-a", second_id: "target-b" }),
    ].map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))));
    for (const row of result.rows.slice(0, 2)) {
      expect(Object.hasOwn(row, "first_id")).toBe(false);
      expect(Object.hasOwn(row, "second_id")).toBe(false);
      expect(row).toMatchObject({ metadata: null, created_by: null });
      expect(Object.hasOwn(row, "first")).toBe(false);
      expect(Object.hasOwn(row, "second")).toBe(false);
    }
    expect(Object.hasOwn(result.rows[2] ?? {}, "first_id")).toBe(true);
    expect(result.eventRows).toEqual(stored);
    for (const row of result.eventRows) expect(Result.isSuccess(result.decode(row))).toBe(true);
    expect(Result.isFailure(result.decode(result.rows[0]))).toBe(true);
    expect(inputs).toEqual(before);
    expect(stored).toEqual(inputs.map(row => complete(row.id,
      row.id === "supplied" ? { first_id: "target-a", second_id: "target-b" } : {})));
  });

  it("uses final canonical identities after nullish hydration and preserves every response alias", async () => {
    const shared = { id: "a", first_id: null, metadata: null };
    const inputs = [shared, { id: "b", second_id: null },
      { id: "a", first_id: "target-a", second_id: "target-b", metadata: { filled: true } }, shared,
      { id: "a", first_id: "ignored", second_id: "ignored", metadata: { ignored: true } }];
    const before = structuredClone(inputs), a = complete("a", { first_id: "target-a", second_id: "target-b", metadata: { filled: true } }),
      b = complete("b");
    const result = await Effect.runPromise(create(inputs, [a, b]));
    expect(result.writes).toEqual([[{ id: "a", first_id: "target-a", second_id: "target-b", metadata: { filled: true } },
      { id: "b", second_id: null }]]);
    const presentedB = { ...b }; delete presentedB.first_id;
    expect(result.rows).toEqual([a, presentedB, a, a, a]);
    expect(result.eventRows).toEqual([a, b]);
    expect(inputs).toEqual(before);
    expect(inputs[0]).toBe(inputs[3]);
    expect(result.rows[0]).not.toBe(result.rows[2]);
    const first = result.rows[0];
    if (first === undefined) throw new Error("Missing created alias");
    if (first.metadata === undefined || !isJsonObject(first.metadata)) throw new Error("Missing created metadata object");
    Object.assign(first.metadata, { filled: false, changed: true });
    expect(first.metadata).toEqual({ filled: false, changed: true });
    expect(result.rows[2]?.metadata).toEqual({ filled: true });
    expect(result.eventRows).toEqual([a, b]);
    expect(inputs).toEqual(before);
  });

  it("binds presence and response positions to identity when the complete write cohort has another order", async () => {
    const a = complete("a", { score: 0.10000000149011612 }), b = complete("b", { first_id: "target-b", score: 0.20000000298023224 });
    const result = await Effect.runPromise(create([{ id: "a", second_id: null, score: 0.1 }, { id: "b", first_id: "target-b", score: 0.2 },
      { id: "a" }], [b, a], true, true));
    const presentedA: Record<string, Json> = { ...a, score: 0.1 }, presentedB: Record<string, Json> = { ...b, score: 0.2 };
    delete presentedA.first_id; delete presentedB.second_id;
    expect(result.rows).toEqual([presentedA, presentedB, presentedA]);
    expect(result.eventRows).toEqual([{ ...b, score: 0.2 }, { ...a, score: 0.1 }]);
  });

  it.each(["unknown", "duplicate", "missing", "missingId"] as const)("refuses a %s returned identity cohort", async recipe => {
    const a = complete("a"), b = complete("b");
    let stored: JsonObject[];
    if (recipe === "unknown") stored = [a, complete("foreign")];
    else if (recipe === "duplicate") stored = [a, a];
    else if (recipe === "missing") stored = [a];
    else {
      const withoutId: Record<string, Json> = { ...b };
      delete withoutId.id;
      stored = [a, withoutId];
    }
    const result = await Effect.runPromiseExit(create([{ id: "a" }, { id: "b" }], stored));
    if (Exit.isSuccess(result)) throw new Error("Malformed returned cohort was accepted");
    expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error._tag === "CommerceTransactionError" && reason.error.reason === "storedCorruption")).toBe(true);
  });

  it("leaves default-mode complete rows and existing native REAL event presentation unchanged", async () => {
    const stored = [complete("default", { score: 0.10000000149011612 })];
    const defaultResult = await Effect.runPromise(create([{ id: "default", score: 0.1 }], stored, false));
    expect(defaultResult.rows).toEqual(stored);
    expect(defaultResult.eventRows).toEqual(stored);
    const realResult = await Effect.runPromise(create([{ id: "default", score: 0.1 }], stored, true, true));
    expect(realResult.rows[0]?.score).toBe(0.1);
    expect(realResult.eventRows).toEqual([complete("default", { score: 0.1 })]);
    expect(stored[0]?.score).toBe(0.10000000149011612);
  });

  it.each(["unknownColumn", "redirectedTarget", "composite", "notNullable", "missingForeignKeyNames"] as const)("refuses an unproved %s presentation option", async recipe => {
    const table = (await Effect.runPromise(metadata())).tables[0];
    if (table === undefined || table.relationships[0] === undefined) throw new Error("Missing neutral creation relationship");
    const relation = { ...table.relationships[0],
      ...(recipe === "unknownColumn" ? { foreignKeyNames: ["created_by"] } : {}),
      ...(recipe === "redirectedTarget" ? { targetTable: "foreign_target" } : {}),
      ...(recipe === "composite" ? { foreignKeyNames: ["first_id", "second_id"] } : {}) };
    if (recipe === "missingForeignKeyNames") delete relation.foreignKeyNames;
    const columns = recipe === "notNullable" ? table.columns.map(column => column.name === "first_id" ? { ...column, nullable: false } : column) : table.columns;
    expect(prepareScalarRepository({ ...table, columns }, "NeutralOwner", scalarIdWhere, undefined,
      { nativeToOneCreationPresence: [relation] })).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
