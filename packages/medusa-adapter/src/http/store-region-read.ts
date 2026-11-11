import { Cause, Effect, Schema } from "effect";
import { MedusaError } from "@medusajs/utils/common/errors";
import { commerceError, commerceLimits, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { StoreRegionOrder, type makeStoreRegionReadCommands } from "../modules/region/store-read";

const Field = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^(\*|[a-zA-Z_][a-zA-Z0-9_]*)$/));
const Fields = Schema.Array(Field).check(Schema.isMaxLength(64), Schema.isUnique());
const decodeRemote = commerceDecoder(Schema.Struct({ __value: Schema.Struct({ region: Schema.Struct({ fields: Fields,
  isServiceAccess: Schema.Literal(false), __args: Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit), order: Schema.optionalKey(StoreRegionOrder) }),
  countries: Schema.optionalKey(Schema.Struct({ fields: Fields })),
}) }) }), "unsupportedProfile");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)), "storedCorruption");
const decodeCount = commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))]), "storedCorruption");
type Commands = Effect.Success<ReturnType<typeof makeStoreRegionReadCommands>>;

/** The callable native Remote Query distinguishes listAndCount (take supplied)
 * from detail (plain rows). Both execute on the existing Region host. */
export function makeStoreRegionRemoteQuery(input: Readonly<{
  commands: Pick<Commands, "list" | "count">;
  read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, ReturnType<typeof commerceError>>;
}>) {
  return Effect.fn("StoreRegion.remoteQuery")(function* (value: unknown) {
    const query = yield* Effect.fromResult(decodeRemote(yield* Effect.fromResult(captureCommerceInput(value))));
    const { fields: requested, countries, __args: args } = query.__value.region;
    // RemoteJoiner hydrates the native primary key; Country's implicit HTTP id
    // is absent from DML and must not replace its actual identity, iso_2.
    const fields = [...new Set(["id", ...requested, ...(countries === undefined ? [] :
      (countries.fields.length === 0 ? ["*"] : countries.fields).map(field => `countries.${field === "id" ? "iso_2" : field}`))])];
    const config: JsonObject = { select: fields, ...(countries === undefined ? {} : { relations: ["countries"] }),
      ...(args.take === undefined ? {} : { take: args.take }), ...(args.skip === undefined ? {} : { skip: args.skip }),
      ...(args.order === undefined ? {} : { order: args.order }) };
    const counted = args.take !== undefined;
    const result = yield* input.read(counted ? input.commands.count : input.commands.list, { filters: args.filters ?? {}, config });
    if (!counted) return yield* Effect.fromResult(decodeRows(result));
    const [rows, count] = yield* Effect.fromResult(decodeCount(result));
    return { rows, metadata: { count, skip: args.skip ?? 0, take: args.take ?? commerceLimits.catalogRows } };
  }, work => work.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unsupportedProfile" || error.reason === "invalidInput" || error.reason === "limitExceeded"
      ? commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
        "Region query is outside the private supported profile", undefined, undefined, { cause: error }))
      : error)))));
}
