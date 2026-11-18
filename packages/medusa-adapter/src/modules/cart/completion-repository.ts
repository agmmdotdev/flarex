import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";
import { commerceDecoder } from "../../value/decoder";
import { CartCompletionPatch } from "./completion-input";
import type { prepareCartPaymentRead } from "./payment-read";

type PreparedRead = Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
const decodePairs = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown).check(Schema.isLengthBetween(1, 1)));
const decodePatch = commerceDecoder(CartCompletionPatch, "unsupportedProfile");
const emptyAddressEnvelope = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: Schema.Array(Schema.Never) }),
  options: Schema.JsonObject }), "unsupportedProfile");

/** Extend the existing Cart read owner. Native methods retain their real empty
 * Address branches; the only admitted Cart mutation is completion/restoration. */
export function prepareCartCompletionRepository(read: PreparedRead) {
  return Result.gen(function* () {
    const address = read.byName.get("cart_address");
    if (address === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const addressScalar = yield* prepareScalarRepository(address.table, "Address", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = read.bind(root, owner), { bridge, events } = bound;
      const addresses = addressScalar.bind(root, owner, events, bridge);
      const update: DAL.RepositoryService["update"] = (input, shared, options) => bridge.execute(shared,
        ctx => bridge.checked(ctx, Effect.gen(function* () {
          if (options !== undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const patches = [];
          for (const value of yield* decodePairs(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const pair = yield* captureNativeRecord(value), before = yield* Effect.fromResult(
              captureCommerceInput(pair.entity, ctx.resources).pipe(Result.flatMap(read.cart.complete)));
            const observed = typeof before.id === "string" ? bound.originals.get(before.id) : undefined;
            if (observed === undefined || !jsonEqual(observed, before))
              return yield* ctx.refuse(commerceError("storedCorruption"));
            const patch = yield* Effect.fromResult(decodePatch(yield* captureNativeDateRecord(pair.update, ["completed_at"])));
            if (patch.id !== before.id) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            for (const [name, retained] of Object.entries(patch)) if (name !== "completed_at") {
              const original = before[name];
              if (original === undefined || !jsonEqual(retained, original)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            }
            patches.push(patch);
          }
          const rows = yield* (yield* ctx.table(read.cart.table.name)).write(ctx.manager, "update", patches);
          const checked = [];
          for (const row of rows) checked.push(yield* Effect.fromResult(read.cart.complete(projectNativeRow(row))));
          if (checked.length !== patches.length || shared === undefined || !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "Cart", checked, shared);
          return bound.remember(checked);
        })));
      const addressRepository: DAL.RepositoryService = { ...bound.denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          yield* Effect.fromResult(emptyAddressEnvelope(value));
          const result = yield* addresses.find(ctx, value, false);
          if (result.rows.length) return yield* ctx.refuse(commerceError("storedCorruption"));
          return bound.remember(structuredClone(result.rows), address.table.name);
        }))) };
      const repository: DAL.RepositoryService = { ...bound.repository, update };
      return { ...bound, repository, addressRepository };
    };
    return { ...read, address, addressQuery: addressScalar.query, bind };
  });
}
