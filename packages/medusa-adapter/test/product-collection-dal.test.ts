import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { findCollectionMembershipProducts, updateCollectionMembershipProducts } from "../src/modules/product/collection-membership";
import { mockRelationalRead } from "./mock-relational-read";

let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("collection-dal")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

/** Records the DAL/core boundary only. Real logical tests own pending-state,
 * constraints, publication and rollback claims. */
describe("named Collection membership DAL translation", () => {
  it("passes repeated native Product pairs to ordered singleton writes", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 64, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "collection-dal", "write");
      const writes: Array<readonly JsonObject[]> = [];
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const ctx = { manager: lifetime.context, table: () => Effect.succeed({
        prepareRead(query: unknown) { return mockRelationalRead(this, query); },
        find: unused, findPage: unused, aggregate: unused, count: unused, delete: unused, lifecycle: unused,
        write: (_manager: unknown, _operation: unknown, input: unknown) => Effect.sync(() => {
          const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(input);
          writes.push(rows); return [...rows];
        }),
      }) };
      const pairs = ["collection-b", "collection-a"].map(collection_id => ({
        entity: { id: "shared-product", collection_id: "before" }, update: { collection_id },
      }));
      yield* Effect.gen(function* () {
        expect(yield* updateCollectionMembershipProducts(ctx, catalog, pairs, true)).toEqual([
          { id: "shared-product", collection_id: "collection-b" }, { id: "shared-product", collection_id: "collection-a" },
        ]);
        expect(writes).toEqual([[{ id: "shared-product", collection_id: "collection-b" }],
          [{ id: "shared-product", collection_id: "collection-a" }]]);
        expect(yield* Effect.result(updateCollectionMembershipProducts(ctx, catalog, pairs)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      }).pipe(Effect.ensuring(lifetime.close));
    }));
  });

  it("bounds the complete active prior cohort before excluding desired members", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 64, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "collection-read-dal", "read");
      const rows = Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, collection_id: "collection" }));
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const ctx = { manager: lifetime.context, resources: defaultCommerceResources, table: () => Effect.succeed({
        prepareRead(query: unknown) { return mockRelationalRead(this, query); }, find: () => Effect.succeed(rows),
        findPage: unused, aggregate: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
      }) };
      yield* Effect.gen(function* () {
        const input = { where: { collection_id: "collection", id: { $nin: ["p0", "p1", "p2", "p3"] } }, options: { populate: [] } };
        expect(yield* Effect.result(findCollectionMembershipProducts(ctx, catalog, input, true)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
        expect(yield* findCollectionMembershipProducts(ctx, catalog, input)).toEqual([rows[4]]);
      }).pipe(Effect.ensuring(lifetime.close));
    }));
  });
});
