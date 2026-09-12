import { Result, Schema } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData, cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { UnsupportedPayloadCapability } from "./errors";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";

const Equality = Schema.Struct({ equals: Schema.String });
export type PayloadCollection = PayloadConfiguration["tables"][number];

/** Metadata-derived query policy is compiled once per collection, never per request. */
export function makePayloadQuery(collection: PayloadCollection) {
  const unique = collection.fields.find(field => field.kind !== "relationship" && field.unique === true)?.name;
  const allowed = new Set(["id", ...(unique === undefined ? [] : [unique])]);
  const Where = Schema.Record(Schema.String, Equality).check(Schema.makeFilter(value =>
    Object.keys(value).every(key => allowed.has(key)) ? undefined : "Unsupported equality field"));
  const decode = Schema.decodeUnknownResult(Where, { onExcessProperty: "error" });
  return { decode, adapter: (input: unknown) => Result.gen(function* () {
    let value = (yield* capturePrivateJsonData(input === undefined ? {} : input, 65_536, cmsError)).value;
    // Only Payload's single access-combination wrapper is admitted here.
    if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length <= 1) {
      value = value.and[0] ?? {};
    }
    const where = yield* decode(value).pipe(Result.mapError(() => new UnsupportedPayloadCapability("where operator")));
    return Object.fromEntries(Object.entries(where).map(([name, predicate]) => [name === "id" ? "_id" : name, predicate.equals]));
  }) };
}

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
