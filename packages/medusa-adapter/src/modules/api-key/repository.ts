import { Effect, Result, Schema } from "effect";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { orderNativeIdRows } from "../../repository/result";
import { QueryEnvelope } from "../../query/decoder";
import { ApiKeyId, compileApiKeyContracts, decodeApiKeyIds } from "./contracts";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { compileKeyedUpdates } from "../../write/keyed";
import { apiKeyWhere } from "./query";
import { captureCommerceInput } from "../../value/input";
import { captureApiKeyNativeQuery, captureApiKeyNativeUpdates } from "./native-input";
import type { captureApiKeyMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof captureApiKeyMetadata>>["frame"];
const decodeRowsWithIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: ApiKeyId }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeId = commerceDecoder(ApiKeyId, "invalidInput");

/** Selected creation and lifecycle profiles reuse scalar reads and writes.
 * Native methods own generation, title filtering, revocation and deletion
 * restrictions; neither profile grants authentication or general upserts. */
export function prepareApiKeyRepository(metadata: Metadata, profile: "creation" | "lifecycle" = "creation") {
  return Result.gen(function* () {
    const table = metadata.tables[0];
    if (metadata.tables.length !== 1 || table?.name !== "api_key") return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileApiKeyContracts(table);
    const scalar = yield* prepareScalarRepository(table, "ApiKey", profile === "creation" ? scalarIdWhere : apiKeyWhere,
      undefined, undefined, { relationships: table.relationships });
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))),
      validateData: commerceRowDecoder(["title", "revoked_at", "revoked_by"], "unsupportedProfile") });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound;
      // Native Date translation precedes the same normal JSON queue boundary.
      // The shared bridge selects authority and owns the only Promise runner.
      const nativeInput = <Value>(input: unknown, shared: unknown,
        normalize: (value: unknown) => Effect.Effect<unknown, CommerceTransactionError>,
        work: (ctx: CommerceCommandContext, captured: unknown) => Effect.Effect<Value, CommerceTransactionError>) =>
        bridge.executeInput(shared, input, work, (ctx, value) => Effect.gen(function* () {
          const normalized = yield* normalize(value);
          return yield* Effect.fromResult(captureCommerceInput(normalized, ctx.resources));
        }));
      const repository: DAL.RepositoryService = { ...bound.repository,
        create: profile === "creation" ? bound.repository.create : bound.refuse,
        find: (input, shared) => nativeInput(input, shared, captureApiKeyNativeQuery, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
          const result = yield* bound.find(ctx, captured, false);
          if (result.rows.length > 4) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          return structuredClone(orderNativeIdRows(yield* Effect.fromResult(decodeRowsWithIds(result.rows)), envelope.where ?? {}));
        }))),
        update: profile === "creation" ? bound.refuse : (input, shared) => nativeInput(input, shared, captureApiKeyNativeUpdates, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(updates)));
          const store = yield* ctx.table(table.name);
          // Native API Key methods remove unchanged titles before reaching DAL.
          // Every remaining keyed update is a genuine native mutation attempt.
          const updated = yield* store.write(ctx.manager, "update", rows);
          for (const row of updated) {
            yield* Effect.fromResult(contracts.complete(row));
            if (row.type !== "publishable") return yield* ctx.refuse(commerceError("unsupportedProfile"));
          }
          if (shared === undefined || !bound.events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* bound.events.rows("afterUpdate", "ApiKey", updated.map(row => ({ ...row })), shared);
          return structuredClone([...updated]);
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* bound.find(ctx, { where: captured, options: { filters: { softDeletable: { withDeleted: true } } } }, false);
          const ids = yield* Effect.fromResult(decodeApiKeyIds(selected.rows.map(row => row.id)));
          for (const row of selected.rows) {
            yield* Effect.fromResult(contracts.complete(row));
            if (row.type !== "publishable") return yield* ctx.refuse(commerceError("unsupportedProfile"));
          }
          const store = yield* ctx.table(table.name);
          const removed = yield* store.delete(ctx.manager, ids.map(id => ({ id })));
          return (yield* Effect.fromResult(decodeRowsWithIds(removed))).map(row => row.id);
        }))),
      };
      return { ...bound, repository, captureOutput: (input: unknown) => owner.run(contracts.captureOutput(input, root.resources)) };
    };
    return { table, readTable: scalar.table, query: scalar.query, contracts, bind };
  });
}
