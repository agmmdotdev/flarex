import { Data, Result } from "effect";
import {
  CatalogUniqueConstraintDefinitionIdSchema,
  MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID,
  type CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import {
  encodeOrderedIndexComponentsV1,
  orderedIndexKeyBytesHexV1ToBytes,
  type OrderedIndexComponentV1,
  type OrderedIndexKeyCodecVersion,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  MAX_APP_UNIQUE_KEY_COMPONENTS_V1,
} from "flarex-protocol/app-unique-constraint-definition";

export {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  MAX_APP_UNIQUE_KEY_COMPONENTS_V1,
};
export const MAX_APP_UNIQUE_CONSTRAINT_ID_V1 =
  MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID;
export const MAX_APP_UNIQUE_LOCALE_KEY_BYTES_V1 = 63;

/** S11 claims are owned by the exact immutable physical definition. */
export type AppUniqueConstraintIdV1 = CatalogUniqueConstraintDefinitionId;

export interface AppUniqueKeyProjectionV1 {
  readonly sparse: boolean;
  readonly localeKey: string | null;
  readonly values: ReadonlyArray<OrderedIndexComponentV1>;
}

export interface CanonicalAppUniqueKeyClaimV1 {
  readonly kind: "claim";
  readonly localeKey: string;
  readonly keyCodecVersion: OrderedIndexKeyCodecVersion;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly canonicalKeyBytes: Uint8Array;
}

export interface OmittedAppUniqueKeyClaimV1 {
  readonly kind: "omitted";
  readonly reason: "sparseMissing";
  readonly localeKey: string;
}

export type CanonicalAppUniqueKeyV1 =
  | CanonicalAppUniqueKeyClaimV1
  | OmittedAppUniqueKeyClaimV1;

export class InvalidAppUniqueKeyContractV1Error extends Data.TaggedError(
  "InvalidAppUniqueKeyContractV1Error",
)<{
  readonly field: "constraintId" | "sparse" | "localeKey" | "values";
  readonly detail: string;
}> {}

const UTF8 = new TextEncoder();
const CANONICAL_LOCALE = /^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8})*$/;

export function decodeAppUniqueConstraintIdV1Result(
  value: unknown,
): Result.Result<
  AppUniqueConstraintIdV1,
  InvalidAppUniqueKeyContractV1Error
> {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= 1 && value <= MAX_APP_UNIQUE_CONSTRAINT_ID_V1
    ? Result.succeed(CatalogUniqueConstraintDefinitionIdSchema.make(value))
    : Result.fail(new InvalidAppUniqueKeyContractV1Error({
      field: "constraintId",
      detail: "expected a positive signed-32-bit integer",
    }));
}

/**
 * Unique keys reuse Ordered Index V1 component bytes. A leading component
 * binds locale: missing means non-localized and a canonical string means one
 * localized claim. Sparse omission applies only to top-level missing values;
 * explicit null remains a claim and is distinct from missing.
 */
export function canonicalizeAppUniqueKeyV1Result(
  input: AppUniqueKeyProjectionV1,
): Result.Result<CanonicalAppUniqueKeyV1, InvalidAppUniqueKeyContractV1Error> {
  return Result.try({
    try: () => {
      const sparse = input.sparse;
      const rawLocaleKey = input.localeKey;
      const rawValues = input.values;
      if (typeof sparse !== "boolean") {
        throw invalid("sparse", "expected a boolean");
      }
      const localeKey = canonicalLocaleKey(rawLocaleKey);
      if (
        !Array.isArray(rawValues) ||
        rawValues.length > MAX_APP_UNIQUE_KEY_COMPONENTS_V1
      ) {
        throw invalid(
          "values",
          `expected at most ${MAX_APP_UNIQUE_KEY_COMPONENTS_V1} components`,
        );
      }
      const values = Array.from(rawValues);
      const encodedKey = encodeOrderedIndexComponentsV1([
        localeKey === ""
          ? Object.freeze({ kind: "missing" as const })
          : Object.freeze({ kind: "string" as const, value: localeKey }),
        ...values,
      ]);
      const sparseMissing = values.some((value) => value.kind === "missing");
      if (sparse && sparseMissing) {
        return Object.freeze({
          kind: "omitted" as const,
          reason: "sparseMissing" as const,
          localeKey,
        });
      }
      return Object.freeze({
        kind: "claim" as const,
        localeKey,
        keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        encodedKey,
        canonicalKeyBytes: new Uint8Array(
          orderedIndexKeyBytesHexV1ToBytes(encodedKey),
        ),
      });
    },
    catch: (cause) => cause instanceof InvalidAppUniqueKeyContractV1Error
      ? cause
      : new InvalidAppUniqueKeyContractV1Error({
        field: "values",
        detail: "components are not canonical Ordered Index V1 values",
      }),
  });
}

function canonicalLocaleKey(value: unknown): string {
  if (value === null) return "";
  if (
    typeof value !== "string" ||
    !CANONICAL_LOCALE.test(value) ||
    UTF8.encode(value).byteLength > MAX_APP_UNIQUE_LOCALE_KEY_BYTES_V1
  ) {
    throw invalid(
      "localeKey",
      "expected null or a lowercase canonical locale of at most 63 bytes",
    );
  }
  return value;
}

function invalid(
  field: InvalidAppUniqueKeyContractV1Error["field"],
  detail: string,
): InvalidAppUniqueKeyContractV1Error {
  return new InvalidAppUniqueKeyContractV1Error({ field, detail });
}
