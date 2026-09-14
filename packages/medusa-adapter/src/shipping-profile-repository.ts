import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { prepareScalarRepository } from "./scalar-repository";
import type { ScalarFilter, WherePolicy } from "./query/predicate";
import type { captureShippingProfileMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const strings = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]), "unsupportedProfile");
const where: WherePolicy = {
  decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"),
  fields: new Map<string, ScalarFilter>([
    ["id", { column: "id", decode: strings, decodeNotEqual: commerceDecoder(Id, "unsupportedProfile") }],
    ["name", { column: "name", decode: strings }], ["type", { column: "type", decode: strings }],
  ]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(256)), "unsupportedProfile") },
};
export function prepareShippingProfileRepository(metadata: Effect.Success<ReturnType<typeof captureShippingProfileMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables[0];
    if (metadata.tables.length !== 1 || table?.name !== "shipping_profile") return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* prepareScalarRepository(table, "ShippingProfile", where);
  });
}
