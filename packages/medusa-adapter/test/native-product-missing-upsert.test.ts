import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { compileProductCoreDefinition } from "../src/modules/product/schema";
import { coreNativeRelationalFailure, coreNativeRelationalRows } from "../../persistence-postgres/src/core/nativePolicy";

let definition: Effect.Success<ReturnType<typeof compileProductCoreDefinition>>;
beforeAll(async () => {
  definition = await Effect.runPromise(compileProductCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID() }));
});
const stamp = "2026-11-10T00:00:00.000Z";

describe("native Product missing-ID upsert contract", () => {
  it.each([undefined, "explicit-native-handle", ""])("passes missing ID and handle=%s through genuine upsert without create normalization", async handle => {
    const writes: unknown[] = [], reads: unknown[] = [];
    const update: unknown = Reflect.get(ProductModuleService.prototype, "updateProducts_");
    if (typeof update !== "function") throw new Error("Missing native Product update owner");
    const receiver: object = Object.create(ProductModuleService.prototype);
    Object.defineProperties(receiver, {
      productRepository_: { value: {} },
      productService_: { value: {
        async list(...args: unknown[]) { reads.push(args); return []; },
        async upsertWithReplace(...args: unknown[]) { writes.push(args); return { entities: [], performedActions: { created: {}, updated: {}, deleted: {} } }; },
      } },
    });
    const transactionManager = {};
    const input = { id: "product_missing_batch", title: "Missing", ...(handle === undefined ? {} : { handle }) };
    await Reflect.apply(update, receiver, [[input], { transactionManager }]);
    expect(reads).toHaveLength(1);
    expect(writes).toEqual([[[input], {
      relations: ["options", "variants", "images", "tags", "categories"],
    }, { transactionManager }]]);
  });

  it("identifies missing handle through the actual issued Core row normalizer", () => {
    const table = definition.tables.find(table => table.localName === "product");
    if (table === undefined) throw new Error("Missing Product declaration");
    const policy = coreNativeRelationalRows(definition, table.name);
    if (policy === undefined) throw new Error("Missing issued Product row policy");
    const result = policy.rows.normalize({ id: "product_missing_batch", title: "Missing" }, null, stamp);
    if (Result.isSuccess(result)) throw new Error("Product without required handle normalized successfully");
    expect(coreNativeRelationalFailure(result.failure)?.diagnostic).toMatchObject({ kind: "missing", column: "handle" });
    expect(policy.table.columns.find(column => column.identity.columnId === "handle"))
      .toMatchObject({ nullable: false, default: { kind: "none" } });
  });

  it.each(["missing-complete", ""])("admits the same missing-ID insert with provided handle=%s", handle => {
    const table = definition.tables.find(table => table.localName === "product");
    if (table === undefined) throw new Error("Missing Product declaration");
    const policy = coreNativeRelationalRows(definition, table.name);
    if (policy === undefined) throw new Error("Missing issued Product row policy");
    expect(Result.getOrThrow(policy.rows.normalize({ id: "product_missing_batch", title: "Missing", handle }, null, stamp)))
      .toMatchObject({ id: "product_missing_batch", title: "Missing", handle,
        is_giftcard: false, discountable: true, status: "draft", deleted_at: null, created_at: stamp, updated_at: stamp });
  });
});
