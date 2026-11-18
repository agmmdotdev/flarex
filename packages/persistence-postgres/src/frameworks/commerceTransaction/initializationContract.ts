import { Result, Schema } from "effect";
import { commerceLimits } from "./model";

/** One trusted initialization descriptor for physical and logical Commerce. */
const initializationDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}(?![\s\S])/));
const CommerceInitialization = Schema.Struct({
  stepId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.-]{0,127}(?![\s\S])/)),
  datasetSha256: initializationDigest,
  expectedRowCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
});

export type CommerceInitialization = typeof CommerceInitialization.Type;
const decode = Schema.decodeUnknownResult(CommerceInitialization);
export const decodeCommerceInitialization = (input: unknown) =>
  decode(input).pipe(Result.map(value => Object.freeze(value)));

/** Read construction receives the installed contract digest from its trusted caller. */
const CommerceReadInitialization = Schema.Struct({
  ...CommerceInitialization.fields, contractSha256: initializationDigest,
});
export type CommerceReadInitialization = typeof CommerceReadInitialization.Type;
// Keep digest capture separate so malformed digests retain their existing
// invalid-input priority over resource and initialization-profile failures.
export const decodeCommerceReadInitializationDigest = Schema.decodeUnknownResult(
  CommerceReadInitialization.fields.contractSha256,
);
