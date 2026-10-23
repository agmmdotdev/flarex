import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { projectRows } from "../src/query/projection";
import { assembleCommerceRelations, populateCommerceRelations, type CommerceRelationReadContext } from "../src/query/relations";
import { relationPaths } from "../src/local-graph/module";
import { resolveCommerceRelationFilter } from "../src/query/relation-filter";
import { mockRelationalRead } from "./mock-relational-read";

import { inverseRelations, inversePaths, inverseCatalog, inverseProjection } from "./support/inverse-one-query";

const roots = [{ id: "p1", deleted_at: null }, { id: "p2", deleted_at: null }];
const rows = new Map<string, readonly JsonObject[]>([
  ["neutral_parent", roots], ["neutral_child", [{ id: "c1", parent_id: "p1", deleted_at: null }]],
  ["neutral_note", [{ id: "n1", child_id: "c1", deleted_at: null }]],
]);

describe("shared inverse singleton query owner", () => {
  it.each([
    ["neutral_parent", "child", "neutral_child", "parent_id", null],
    ["neutral_parent", "child", "neutral_child", "parent_id", 17],
    ["neutral_parent", "child", "neutral_child", "parent_id", undefined],
    ["neutral_child", "notes", "neutral_note", "child_id", null],
    ["neutral_child", "notes", "neutral_note", "child_id", 17],
    ["neutral_child", "notes", "neutral_note", "child_id", undefined],
  ] as const)("treats only null inverse references as unrelated (%s.%s, %s.%s=%s)", async (source, path, target, key, parent) => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "inverse-one-filter", "read");
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const context: CommerceRelationReadContext = { manager: lifetime.context, resources: defaultCommerceResources,
        table: table => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); },
          findPage: unused, aggregate: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
          find: (manager) => Effect.sync(() => {
            expect(manager).toBe(lifetime.context); expect(table).toBe(target);
            return [{ id: "orphan", deleted_at: null, ...(parent === undefined ? {} : { [key]: parent }) }];
          }),
        }) };
      const result = yield* Effect.result(resolveCommerceRelationFilter(context, source, path,
        { kind: "in", column: "id", values: ["orphan"] }, inverseRelations).pipe(Effect.ensuring(lifetime.close)));
      if (parent === null) expect(Result.getOrThrow(result)).toEqual({ kind: "in", column: "id", values: [] });
      else expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    }));
  });

  it("assembles and masks nested singleton objects and absence without changing stored rows", () => {
    const before = structuredClone(rows);
    const assembled = Result.getOrThrow(assembleCommerceRelations("neutral_parent", rows, inversePaths, inverseRelations));
    expect(Result.getOrThrow(projectRows(assembled, Result.getOrThrow(inverseProjection()).node)))
      .toEqual([{ id: "p1", child: { id: "c1", notes: [{ id: "n1" }] } }, { id: "p2", child: null }]);
    expect(rows).toEqual(before);
    expect(Result.getOrThrow(relationPaths(Result.getOrThrow(inverseCatalog()), "neutral_parent", inversePaths, { nativeFields: true })))
      .toMatchObject([{ path: "child", many: false, sourceFields: ["id"] }, { path: "child.notes", many: true }]);
  });

  it("refuses duplicate singleton matches during receipt assembly", () => {
    const duplicate = new Map(rows);
    duplicate.set("neutral_child", [...rows.get("neutral_child") ?? [], { id: "c2", parent_id: "p1", deleted_at: null }]);
    expect(assembleCommerceRelations("neutral_parent", duplicate, inversePaths, inverseRelations))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it.each([false, true])("uses complete bounded selections and the borrowed manager (duplicate=%s)", async duplicate => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "inverse-one", "read");
      const queries: unknown[] = [];
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const context: CommerceRelationReadContext = { manager: lifetime.context, resources: defaultCommerceResources,
        table: table => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); },
          findPage: unused, aggregate: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
          find: (manager, query) => Effect.sync(() => {
            expect(manager).toBe(lifetime.context); queries.push(query);
            const selected = rows.get(table) ?? [];
            return duplicate && table === "neutral_child" ? [...selected, { id: "c2", parent_id: "p1", deleted_at: null }] : selected;
          }),
        }) };
      const result = yield* Effect.result(populateCommerceRelations(context, "neutral_parent", roots, inversePaths, inverseRelations, new Map())
        .pipe(Effect.ensuring(lifetime.close)));
      expect(queries[0]).toEqual({ take: 256, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "in", column: "parent_id", values: ["p1", "p2"] }, { kind: "isNull", column: "deleted_at" },
      ] } });
      if (duplicate) expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      else expect(Result.getOrThrow(result)).toEqual(Result.getOrThrow(assembleCommerceRelations("neutral_parent", rows, inversePaths, inverseRelations)));
    }));
  });
});
