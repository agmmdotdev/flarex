import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { prepareScalarRepository } from "../src/repository/scalar";
import { scalarIdWhere } from "../src/repository/scalar-id-read";
import { decodeCompiledDml } from "../src/schema/compiled";
import { mockRelationalRead } from "./mock-relational-read";

/** This witness has no database semantics: every persistence operation fails.
 * It exercises the real scalar serializer and its request lifetime only. */
function serialize(input: unknown, options: unknown, relation: "none" | "foreignKey" | "relationship" | "both" = "none", admitPopulate = true) {
  return Effect.scoped(Effect.gen(function* () {
    const metadata = yield* decodeCompiledDml({ tables: [{ name: "neutral_scalar", columns: [
      { name: "id", type: "id", nullable: false, primaryKey: true },
      { name: "title", type: "text", nullable: false, primaryKey: false },
      { name: "target_id", type: "text", nullable: true, primaryKey: false },
    ], indexes: [], checks: [], foreignKeys: relation === "foreignKey" || relation === "both" ? [{ name: "target_fk", columns: ["target_id"],
      referencedTable: "neutral_target", referencedColumns: ["id"] }] : [],
    relationships: relation === "relationship" || relation === "both" ? [{ name: "target", type: "belongsTo", targetModel: "NeutralTarget", targetTable: "neutral_target",
      nullable: true, cascadeDelete: false, cascadeDetach: false, foreignKeyNames: ["target_id"] }] : [],
    cascades: { delete: [], detach: [] } }] });
    const table = metadata.tables[0];
    if (table === undefined) throw new Error("Missing neutral scalar");
    const prepared = yield* Effect.fromResult(prepareScalarRepository(table, "NeutralScalar", scalarIdWhere,
      undefined, undefined, admitPopulate ? { relationships: table.relationships } : undefined));
    const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), current => current.close);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits,
      {}, {}, "scalar-serialization", "read"), current => current.close);
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store = { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, find: unused, findPage: unused,
      count: unused, aggregate: unused, delete: unused, lifecycle: unused, write: unused };
    const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources, store,
      table: () => unused() }, "scalar-serialization", lifetime.context, unused, unused);
    return yield* owner.invoke(() => prepared.bind(root, owner).repository.serialize(input, options));
  }));
}

describe("scalar native populate serialization", () => {
  it("accepts the native populate marker for relation-free scalar projections without I/O", async () => {
    const input = [{ id: "one", title: "key", target_id: null }];
    const output = await Effect.runPromise(serialize(input, { populate: true }));
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output)).toBe(false);
    if (Array.isArray(output)) {
      expect(output[0]).not.toBe(input[0]);
      expect(Object.isFrozen(output[0])).toBe(false);
      Object.assign(output[0], { title: "formatter-owned" });
    }
    expect(input[0]?.title).toBe("key");
    expect(await Effect.runPromise(serialize({ id: "one" }, { populate: true }))).toEqual({ id: "one" });
    expect(await Effect.runPromise(serialize([], { populate: true }))).toEqual([]);
  });

  it("preserves ordinary scalar serialization", async () => {
    expect(await Effect.runPromise(serialize({ id: "one", title: "key", target_id: null }, undefined)))
      .toEqual({ id: "one", title: "key", target_id: null });
  });

  it("requires an explicit checked relationship profile for the populate marker", async () => {
    expect(Exit.isFailure(await Effect.runPromiseExit(serialize({ id: "one" }, { populate: true }, "none", false)))).toBe(true);
    expect(await Effect.runPromise(serialize({ id: "one" }, undefined, "none", false))).toEqual({ id: "one" });
  });

  it("refuses relation-bearing models, extra options and invalid scalar projections", async () => {
    for (const [input, options, relation] of [
      [{ id: "one" }, { populate: true }, "both"],
      [{ id: "one" }, { populate: true }, "foreignKey"],
      [{ id: "one" }, { populate: true }, "relationship"],
      [{ id: "one" }, { populate: false }, "none"],
      [{ id: "one" }, { populate: true, exclude: ["title"] }, "none"],
      [{ id: "one" }, { populate: true, extra: undefined }, "none"],
      [{ id: "one" }, {}, "none"],
      [{ id: "one", title: 1 }, { populate: true }, "none"],
      [{ id: "one", target: { id: "two" } }, { populate: true }, "none"],
    ] as const) expect(Exit.isFailure(await Effect.runPromiseExit(serialize(input, options, relation)))).toBe(true);
  });

  it("rejects accessor options without evaluating them", async () => {
    let evaluated = false;
    const options = Object.defineProperty({}, "populate", { enumerable: true, get() { evaluated = true; return true; } });
    expect(Exit.isFailure(await Effect.runPromiseExit(serialize({ id: "one" }, options)))).toBe(true);
    expect(evaluated).toBe(false);
  });
});
