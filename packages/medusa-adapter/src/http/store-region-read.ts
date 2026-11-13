import { Cause, Effect, Schema } from "effect";
import { executeCountedRemoteFetchRequest, hasRemoteFetchPagination } from "@medusajs/modules-sdk/remote-query";
import { MedusaError } from "@medusajs/utils/common/errors";
import { commerceError, commerceLimits, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { StoreRegionOrder, type makeStoreRegionReadCommands } from "../modules/region/store-read";
import { makeNativeQueryBridge, type NativeQueryMetadata } from "../local-graph/native-bridge";

const Field = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^(\*|[a-zA-Z_][a-zA-Z0-9_]*)$/));
const Fields = Schema.Array(Field).check(Schema.isMaxLength(64), Schema.isUnique());
const decodeRemote = commerceDecoder(Schema.Struct({ __value: Schema.Struct({ region: Schema.Struct({ fields: Fields,
  isServiceAccess: Schema.Literal(false), __args: Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit), order: Schema.optionalKey(StoreRegionOrder) }),
  countries: Schema.optionalKey(Schema.Struct({ fields: Fields })),
}) }) }), "unsupportedProfile");
const decodeCount = commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))]), "storedCorruption");
type Commands = Effect.Success<ReturnType<typeof makeStoreRegionReadCommands>>;

/** Native Query owns Country expansion and presentation. The admitted callback
 * retains its actual counted command and the existing protected Region host. */
export function makeStoreRegionRemoteQuery(input: Readonly<{
  commands: Pick<Commands, "count">;
  read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, ReturnType<typeof commerceError>>;
  native: NativeQueryMetadata;
}>) {
  const native = makeNativeQueryBridge({ ...input.native, read: (request, owner) =>
    owner.invoke(() => executeCountedRemoteFetchRequest(request, (filters, options) => owner.run(Effect.gen(function* () {
      // Native ID-array detail queries mean an unpaged complete cohort. Charge
      // the original finite Store bound and refuse an incomplete result.
      const complete = !hasRemoteFetchPagination(options);
      const config = { ...options, ...(options.take === null || options.take === undefined ? { take: commerceLimits.catalogRows } : {}) };
      const args = yield* Effect.fromResult(captureCommerceInput({ filters, config }));
      const result = yield* Effect.fromResult(decodeCount(yield* input.read(input.commands.count, args)));
      if (complete && result[0].length !== result[1]) return yield* commerceError("limitExceeded");
      return structuredClone(result);
    })))) });
  return Effect.fn("StoreRegion.remoteQuery")(function* (value: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(value));
    yield* Effect.fromResult(decodeRemote(captured));
    return yield* native.query(captured);
  }, work => work.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unsupportedProfile" || error.reason === "invalidInput" || error.reason === "limitExceeded"
      ? commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
        "Region query is outside the private supported profile", undefined, undefined, { cause: error }))
      : error)))));
}
