import { Result, Schema } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import { capturePrivateJsonData, cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { UnsupportedPayloadCapability } from "./errors";
import { canonicalPayloadNumber } from "./contract";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";

const Predicate = Schema.Struct({ equals: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null])),
  greater_than: Schema.optionalKey(Schema.Finite), greater_than_equal: Schema.optionalKey(Schema.Finite),
  less_than: Schema.optionalKey(Schema.Finite), less_than_equal: Schema.optionalKey(Schema.Finite),
}).annotate({ parseOptions: { onExcessProperty: "error" } }).check(Schema.makeFilter(value =>
  Object.keys(value).length > 0 && (value.equals === undefined || Object.keys(value).length === 1) &&
    !(value.greater_than !== undefined && value.greater_than_equal !== undefined) &&
    !(value.less_than !== undefined && value.less_than_equal !== undefined) ? undefined : "Expected equality or a numeric range"));
export type PayloadCollection = PayloadConfiguration["tables"][number];

/** Metadata-derived query policy is compiled once per collection, never per request. */
export function makePayloadQuery(collection: PayloadCollection) {
  const unique = collection.fields.filter(field => field.kind !== "relationship" && field.unique === true).map(field => field.name);
  const allowed = new Set(["id", ...unique, ...(collection.indexes?.flatMap(index => index.fields) ?? [])]);
  const Where = Schema.Record(Schema.String, Predicate).check(Schema.makeFilter(value => {
    for (const [name, predicate] of Object.entries(value)) {
      if (!allowed.has(name)) return "Unsupported query field";
      const field = collection.fields.find(candidate => candidate.name === name);
      const kind = name === "id" ? "text" : field?.kind;
      if (predicate.equals === null) {
        if (field === undefined || field.kind === "relationship" || !field.nullable) return "Only nullable scalar fields accept null equality";
      } else if (predicate.equals === undefined) {
        if (kind !== "number") return "Only numeric range predicates are admitted";
      } else if (typeof predicate.equals !== (kind === "number" ? "number" : kind === "boolean" ? "boolean" : "string") ||
        (kind === "date" && (typeof predicate.equals !== "string" || !isCanonicalIsoTimestamp(predicate.equals)))) return "Query value does not match the field";
    }
    return Object.keys(value).length === 0 || value.id !== undefined || unique.some(field => value[field]?.equals !== undefined) ||
      collection.indexes?.some(index => index.fields[0] !== undefined && value[index.fields[0]] !== undefined)
      ? undefined : "Query requires a declared index prefix";
  }));
  const decode = Schema.decodeUnknownResult(Where, { onExcessProperty: "error" });
  return { decode, adapter: (input: unknown) => Result.gen(function* () {
    let value = (yield* capturePrivateJsonData(input === undefined ? {} : input, 65_536, cmsError)).value;
    // Only Payload's single access-combination wrapper is admitted here.
    if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length <= 1) {
      value = value.and[0] ?? {};
    }
    const where = yield* decode(value).pipe(Result.mapError(() => new UnsupportedPayloadCapability("where operator")));
    const translated: Record<string, Json> = {};
    for (const [name, predicate] of Object.entries(where)) {
      const field = name === "id" ? "_id" : name;
      translated[field] = predicate.equals !== undefined ? typeof predicate.equals === "number" ? canonicalPayloadNumber(predicate.equals) : predicate.equals : {
        // Payload comparisons select finite numbers. The shared ordered domain
        // also contains null/missing below numbers, so upper-only ranges need
        // the domain's lower bound in both indexed and residual evaluation.
        ...(predicate.greater_than === undefined && predicate.greater_than_equal === undefined ? { gte: -Number.MAX_VALUE } : {}),
        ...(predicate.greater_than === undefined ? {} : { gt: canonicalPayloadNumber(predicate.greater_than) }),
        ...(predicate.greater_than_equal === undefined ? {} : { gte: canonicalPayloadNumber(predicate.greater_than_equal) }),
        ...(predicate.less_than === undefined ? {} : { lt: canonicalPayloadNumber(predicate.less_than) }),
        ...(predicate.less_than_equal === undefined ? {} : { lte: canonicalPayloadNumber(predicate.less_than_equal) }),
      };
    }
    return translated;
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
