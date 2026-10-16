import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { WherePolicy } from "../../query/predicate";
import { StoreGuardFilters, decodeStoreGuardQuery } from "./input";
import type { captureStoreMetadata } from "./schema";

const where: WherePolicy = {
  decode: commerceDecoder(StoreGuardFilters, "unsupportedProfile"),
  fields: new Map([["default_sales_channel_id", { column: "default_sales_channel_id",
    decode: commerceDecoder(StoreGuardFilters.fields.default_sales_channel_id, "unsupportedProfile") }]]),
};

export function prepareStoreGuardRepository(metadata: Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "store");
    if (metadata.tables.length !== 3 || table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareScalarRepository(table, "Store", where);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      // Only native list reaches data. Inherited retrieve/count and every CRUD
      // method remain refused, including accesses to child-model repositories.
      const repository: DAL.RepositoryService = { ...denied,
        serialize: bound.repository.serialize,
        find: (input: Parameters<typeof bound.repository.find>[0], shared: Parameters<typeof bound.repository.find>[1]) =>
          bound.bridge.execute(shared, current => bound.bridge.checked(current, Effect.gen(function* () {
            const captured = yield* Effect.fromResult(captureCommerceInput(input, current.resources));
            yield* Effect.fromResult(decodeStoreGuardQuery(captured));
            return structuredClone((yield* bound.find(current, captured, false)).rows);
          }))),
      };
      return { ...bound, repository, denied };
    };
    return { table: prepared.table, bind };
  });
}
