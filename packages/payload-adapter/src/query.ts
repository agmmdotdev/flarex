import { Result, Schema } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData, cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { UnsupportedPayloadCapability } from "./errors";

const Equality = Schema.Struct({ equals: Schema.String });
export const PayloadWhere = Schema.Struct({
  id: Schema.optionalKey(Equality),
  title: Schema.optionalKey(Equality),
});
export type PayloadWhere = typeof PayloadWhere.Type;
export const decodePayloadWhere = Schema.decodeUnknownResult(PayloadWhere, { onExcessProperty: "error" });

export const PayloadLimit = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 32 }));
export const PayloadPage = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 257 }));
export const PayloadPaging = Schema.Struct({
  page: Schema.optional(PayloadPage),
  limit: Schema.optional(PayloadLimit),
  pagination: Schema.optional(Schema.Boolean),
  sort: Schema.optional(Schema.Literal("id")),
});
export const decodePayloadPaging = Schema.decodeUnknownResult(PayloadPaging, { onExcessProperty: "error" });
export const isPayloadLimit = Schema.is(PayloadLimit);
export const isPayloadPage = Schema.is(PayloadPage);

/** Only Payload's single access-combination wrapper is admitted here. */
export function payloadAdapterWhere(input: unknown) {
  return Result.gen(function* () {
    let value = (yield* capturePrivateJsonData(input === undefined ? {} : input, 65_536, cmsError)).value;
    if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length <= 1) {
      value = value.and[0] ?? {};
    }
    const where = yield* decodePayloadWhere(value).pipe(Result.mapError(() => new UnsupportedPayloadCapability("where operator")));
    return {
      ...(where.id === undefined ? {} : { _id: where.id.equals }),
      ...(where.title === undefined ? {} : { title: where.title.equals }),
    };
  });
}
