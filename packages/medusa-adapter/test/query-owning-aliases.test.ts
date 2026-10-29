import { Effect } from "effect";
import { expect, it } from "vitest";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { bindCommerceRelationRows, populateCommerceRelations, type CommerceRelationReadContext, type CommerceRelations } from "../src/query/relations";
import { mockRelationalRead } from "./mock-relational-read";

const relations: CommerceRelations = new Map([["parent", new Map(["left", "right"].map(name => [name, {
  name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: "child",
  join: { type: "belongsTo" as const, foreignKeys: [name + "_id"] },
}]))]]);
const child = (id: string) => ({ id, deleted_at: null });
const cases = [
  { name: "shared aliases", roots: [{ id: "p", left_id: "a", right_id: "a" }], batches: [[child("a")]], pairs: [["a", "a"]] },
  { name: "distinct aliases", roots: [{ id: "p", left_id: "a", right_id: "b" }], batches: [[child("a")], [child("b")]], pairs: [["a", "b"]] },
  { name: "absent targets", roots: [{ id: "p", left_id: "a", right_id: "a" }], batches: [[], []], pairs: [[null, null]] },
  { name: "complete subset", roots: [{ id: "p1", left_id: "a", right_id: "a" }, { id: "p2", left_id: "b", right_id: "a" }],
    batches: [[child("a"), child("b")]], pairs: [["a", "a"], ["b", "a"]] },
  { name: "partial overlap", roots: [{ id: "p1", left_id: "a", right_id: "b" }, { id: "p2", left_id: "b", right_id: "c" }],
    batches: [[child("a"), child("b")], [child("b"), child("c")]], pairs: [["a", "b"], ["b", "c"]] },
];

it.each(cases)("retains real owning-relation cache reads and one borrowed manager for $name", async ({ roots, batches, pairs }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
      { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "owning-aliases", "read");
    const reads: unknown[] = [];
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const context: CommerceRelationReadContext = { manager: lifetime.context, resources: defaultCommerceResources,
      table: table => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); },
        findPage: unused, aggregate: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
        find: (manager, query) => Effect.sync(() => {
          expect(manager).toBe(lifetime.context); expect(table).toBe("child");
          const batch = batches[reads.length]; reads.push(query);
          if (batch === undefined) throw new Error("Unexpected extra relation read");
          return batch;
        }),
      }) };
    const result = yield* populateCommerceRelations(bindCommerceRelationRows(context), "parent", roots, ["left", "right"], relations, new Map())
      .pipe(Effect.ensuring(lifetime.close));
    expect(reads).toHaveLength(batches.length);
    expect(result.map(row => [row.left, row.right])).toEqual(pairs.map(pair => pair.map(id => id === null ? null : child(id))));
    expect(roots.every(row => !Object.hasOwn(row, "left") && !Object.hasOwn(row, "right"))).toBe(true);
  }));
});
