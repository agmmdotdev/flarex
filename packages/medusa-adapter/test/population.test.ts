import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceRelation } from "../src/commerce-relations";
import { populateCommerceRelations } from "../src/commerce-relations";
import { commerceDecoder } from "../src/commerce-decoder";
import { makeReadCatalog } from "../src/query/catalog";
import { compilePopulationWhere } from "../src/query/population";
import type { WherePolicy } from "../src/query/predicate";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";

const toOne = (name: string): CommerceRelation => ({ name, sourcePrimaryKeys: ["id"], targetTable: "people", targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: ["person_id"] } });
const catalog = Result.getOrThrow(makeReadCatalog([
  { name: "roots", columns: ["id", "person_id"], primaryKeys: ["id"], foreignKeys: ["person_id"], companions: {} },
  { name: "people", columns: ["id", "state", "deleted_at", "person_id"], primaryKeys: ["id"], foreignKeys: ["person_id"], companions: {} },
], new Map([
  ["roots", new Map([toOne("visible"), toOne("hidden"), toOne("unfiltered")].map(relation => [relation.name, relation]))],
  ["people", new Map([["nested", toOne("nested")]])],
])));
const policy: WherePolicy = {
  decode: commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile"),
  fields: new Map([["state", { column: "state", decode: commerceDecoder(Schema.Union([Schema.String, Schema.Null]), "invalidInput") }]]),
};
const policies = new Map(["visible", "hidden", "visible.nested"].map(path => [path, policy]));

describe("per-path population predicates", () => {
  it("compiles the native populateWhere shape with checked path and field ownership", () => {
    const filters = Result.getOrThrow(compilePopulationWhere(catalog, "roots", ["visible.nested"], { visible: { state: null } }, policies));
    expect(filters).toEqual([{ path: "visible", predicate: { kind: "and", children: [{ kind: "isNull", column: "state" }] } }]);
    expect(Object.isFrozen(filters)).toBe(true);
    expect(Object.isFrozen(filters[0]?.predicate)).toBe(true);
    for (const input of [null, [], { missing: {} }, { visible: { missing: null } }, { visible: { state: 1 } }]) {
      expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], input, policies))).toBe(true);
    }
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", [], { visible: {} }, policies))).toBe(true);
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["missing"], { missing: {} }, new Map([["missing", policy]])))).toBe(true);
    const invalid = { ...policy, fields: new Map([["state", { column: "missing", decode: commerceDecoder(Schema.String, "invalidInput") }]]) };
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], { visible: { state: "open" } }, new Map([["visible", invalid]])))).toBe(true);
    for (const mode of ["membership", "tuples"] as const) {
      const selectors = { mode, key: "missing", decode: commerceDecoder(Schema.Array(Schema.Struct({ missing: Schema.String })), "unsupportedProfile") };
      expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], { visible: { $or: [{ missing: "open" }] } }, new Map([["visible", { ...policy, selectors }]])))).toBe(true);
    }
  });

  it("does not reuse differently filtered primary-key rows and resolves nested filters at their full path", async () => {
    const paths = ["visible.nested", "hidden", "unfiltered"];
    const filters = Result.getOrThrow(compilePopulationWhere(catalog, "roots", paths,
      { visible: { state: "open" }, "visible.nested": { state: "nested" }, hidden: { state: "closed" } }, policies));
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason), { ...defaultCommerceResources, commandMs: 30000 }, {}, {}, "population", "read"));
    const queries: unknown[] = [];
    const returned: JsonObject[][] = [
      [{ id: "p", person_id: "n", state: "open" }], [{ id: "n", person_id: null, state: "nested" }], [], [{ id: "p", person_id: "n", state: "open" }],
    ];
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const ctx = { manager: lifetime.context, resources: defaultCommerceResources,
      table: () => Effect.succeed({ find: (manager: unknown, query: unknown) => Effect.sync(() => {
        expect(manager).toBe(lifetime.context); queries.push(query);
        const rows = returned.shift(); if (!rows) throw new Error("Unexpected population read"); return rows;
      }), count: unused, write: unused, delete: unused, lifecycle: unused }),
    };
    try {
      expect(await Effect.runPromise(populateCommerceRelations(ctx, "roots", [{ id: "r", person_id: "p" }], paths, catalog.relations, new Map(), false, filters)))
        .toEqual([{ id: "r", person_id: "p", visible: { id: "p", person_id: "n", state: "open", nested: { id: "n", person_id: null, state: "nested" } }, hidden: null, unfiltered: { id: "p", person_id: "n", state: "open" } }]);
      expect(queries).toHaveLength(4);
      for (const [index, value] of ["open", "nested", "closed"].entries()) expect(queries[index]).toMatchObject({ predicate: { children: [
        { kind: "in" }, { kind: "isNull", column: "deleted_at" }, { kind: "and", children: [{ kind: "in", column: "state", values: [value] }] },
      ] } });
      expect(queries[3]).toMatchObject({ predicate: { children: [{ kind: "in" }, { kind: "isNull", column: "deleted_at" }] } });
      expect(returned).toHaveLength(0);
    } finally { await Effect.runPromise(lifetime.close); }
  });
});
