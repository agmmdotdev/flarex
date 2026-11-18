import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { prepareScalarRepository } from "../../repository/scalar";
import type { ScalarFilter, WherePolicy } from "../../query/predicate";
import type { captureShippingProfileMetadata } from "./shipping-profile-schema";
import { compileShippingProfileCreationOutput } from "./shipping-profile-create-output";

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
    const scalar = yield* prepareScalarRepository(table, "ShippingProfile", where);
    const output = yield* compileShippingProfileCreationOutput(table, 256);
    const bind: typeof scalar.bind = (...args) => {
      const bound = scalar.bind(...args), { bridge } = bound;
      return { ...bound, repository: { ...bound.repository,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          return yield* Effect.fromResult(output.initializeRows(yield* bound.createRows(ctx, captured, shared)));
        }))),
      } };
    };
    return { ...scalar, bind, creation: output };
  });
}
