import { Schema } from "effect";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";

export const QueryEnvelope = Schema.Struct({
  where: Schema.optionalKey(Schema.Unknown),
  options: Schema.optionalKey(Schema.Unknown),
});

export const QueryOffset = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows - 1 }));
export const QueryLimit = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows }));
