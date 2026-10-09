import { Result, Schema } from "effect";
import {
  capturePrivateJsonData,
  cmsError,
  type CmsTransactionError,
} from "@flarex/persistence-postgres/internal/cms-adapter";
import { payloadJoins } from "./contract";

export type PayloadJoinQuery = Readonly<Record<"referencedBy" | "referencedByMany", false | Readonly<{ limit: number }>>>;
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const EmptyJoinWhereSchema = Schema.Record(Schema.String, Schema.Never);
const makeJoinOptionSchemas = (maximumLimit: number) => {
  const caller = Schema.Struct({
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumLimit }))),
    page: Schema.optionalKey(Schema.Literal(1)),
    count: Schema.optionalKey(Schema.Literal(false)),
  }).annotate(strict);
  const sanitized = Schema.Struct({ ...caller.fields, where: Schema.optionalKey(EmptyJoinWhereSchema) }).annotate(strict);
  return { caller, sanitized };
};
const ReferencedByJoinOptions = makeJoinOptionSchemas(payloadJoins[0].maximumLimit);
const ReferencedByManyJoinOptions = makeJoinOptionSchemas(payloadJoins[1].maximumLimit);
/** Caller options accepted by the join owner; sanitized native options remain separate. */
export const PayloadJoinInputSchema = Schema.Union([Schema.Literal(false), Schema.Struct({
  referencedBy: Schema.optionalKey(Schema.Union([Schema.Literal(false), ReferencedByJoinOptions.caller])),
  referencedByMany: Schema.optionalKey(Schema.Union([Schema.Literal(false), ReferencedByManyJoinOptions.caller])),
}).annotate(strict)]);
const SanitizedPayloadJoinInputSchema = Schema.Union([Schema.Literal(false), Schema.Struct({
  referencedBy: Schema.optionalKey(Schema.Union([Schema.Literal(false), ReferencedByJoinOptions.sanitized])),
  referencedByMany: Schema.optionalKey(Schema.Union([Schema.Literal(false), ReferencedByManyJoinOptions.sanitized])),
}).annotate(strict)]);
export type PayloadJoinInput = typeof PayloadJoinInputSchema.Type;
const decodeCallerJoinInput = Schema.decodeUnknownResult(PayloadJoinInputSchema);
const decodeSanitizedJoinInput = Schema.decodeUnknownResult(SanitizedPayloadJoinInputSchema);

type MutablePayloadJoinQuery = { -readonly [Key in keyof PayloadJoinQuery]: PayloadJoinQuery[Key] };

/** The foreign sanitizer may add only an empty where object; caller predicates remain refused. */
export function payloadJoinQuery(input: unknown, sanitized = false): Result.Result<PayloadJoinQuery, CmsTransactionError> {
  return Result.gen(function* () {
    const captured = (yield* capturePrivateJsonData(input === undefined ? {} : input, 4096, cmsError)).value;
    const value = yield* (sanitized ? decodeSanitizedJoinInput(captured) : decodeCallerJoinInput(captured))
      .pipe(Result.mapError(() => cmsError("unsupportedProfile")));
    const query: MutablePayloadJoinQuery = { referencedBy: false, referencedByMany: false };
    for (const join of payloadJoins) {
      const options = value === false ? false : value[join.name];
      if (options === false) continue;
      const limit = options?.limit ?? join.defaultLimit;
      query[join.name] = Object.freeze({ limit });
    }
    return Object.freeze(query);
  });
}
