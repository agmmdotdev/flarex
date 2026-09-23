import { Result, Schema } from "effect";
import { commerceLimits } from "./model";

/** One trusted initialization descriptor for physical and logical Commerce. */
const CommerceInitialization = Schema.Struct({
  stepId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.-]{0,127}(?![\s\S])/)),
  datasetSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}(?![\s\S])/)),
  expectedRowCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
});

export type CommerceInitialization = typeof CommerceInitialization.Type;
const decode = Schema.decodeUnknownResult(CommerceInitialization);
export const decodeCommerceInitialization = (input: unknown) =>
  decode(input).pipe(Result.map(value => Object.freeze(value)));
