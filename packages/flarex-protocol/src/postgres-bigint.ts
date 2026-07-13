import { Schema, SchemaTransformation } from "effect";

export const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

const CanonicalUnsignedDecimalString = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]*)$/),
);

const NonNegativePostgresBigInt = Schema.BigInt.check(
  Schema.makeFilter((value) =>
    value >= 0n && value <= POSTGRES_SIGNED_BIGINT_MAX
      ? undefined
      : `Expected a nonnegative PostgreSQL signed-bigint value no greater than ${POSTGRES_SIGNED_BIGINT_MAX}`,
  ),
);

const PositivePostgresBigInt = Schema.BigInt.check(
  Schema.makeFilter((value) =>
    value >= 1n && value <= POSTGRES_SIGNED_BIGINT_MAX
      ? undefined
      : `Expected a positive PostgreSQL signed-bigint value no greater than ${POSTGRES_SIGNED_BIGINT_MAX}`,
  ),
);

export const CanonicalNonNegativePostgresBigIntFromString =
  CanonicalUnsignedDecimalString.pipe(
    Schema.decodeTo(
      NonNegativePostgresBigInt,
      SchemaTransformation.bigintFromString,
    ),
  );

export const CanonicalPositivePostgresBigIntFromString =
  CanonicalUnsignedDecimalString.pipe(
    Schema.decodeTo(
      PositivePostgresBigInt,
      SchemaTransformation.bigintFromString,
    ),
  );
