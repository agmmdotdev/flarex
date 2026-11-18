import { Result } from "effect";
import { OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import {
  appDocumentPathIsNull,
  appDocumentPathEqualsBoolean,
  lowerAppDocumentOrderedFieldValuesV1,
} from "../indexes/appDocumentOrderedFieldValuesV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "./locatedAppUniqueConstraintDefinition";
import {
  canonicalizeAppUniqueKeyV1Result,
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyClaimV1,
  type OmittedAppUniqueKeyClaimV1,
  type InvalidAppUniqueKeyContractV1Error,
} from "./appUniqueKeyContract";

/** Pure lowering from one authenticated document into the S11 projection. */
function lowerAppUniqueConstraintProjectionV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<AppUniqueKeyProjectionV1 | OmittedAppUniqueKeyClaimV1, OrderedIndexKeyTooLargeError> {
  return Result.try({
    try: () => {
      const spec = definition.physicalSpec;
      const predicate = spec.predicate;
      if (predicate !== undefined && !(predicate.kind === "fieldIsNull"
        ? appDocumentPathIsNull(document, predicate.field)
        : predicate.kind === "fieldsAreNull" ? predicate.fields.every(field => appDocumentPathIsNull(document, field))
        : appDocumentPathIsNull(document, predicate.nullField) &&
          appDocumentPathEqualsBoolean(document, predicate.booleanField, predicate.value))) {
        return Object.freeze({ kind: "omitted" as const, reason: "predicateExcluded" as const, localeKey: "" });
      }
      if (spec.nullsDistinct === true && spec.orderedFields.some(field => appDocumentPathIsNull(document, field))) {
        return Object.freeze({ kind: "omitted" as const, reason: "nullDistinct" as const, localeKey: "" });
      }
      return Object.freeze({ sparse: spec.sparse, localeKey: null,
        values: lowerAppDocumentOrderedFieldValuesV1(document, spec.orderedFields) });
    },
    catch: (cause) => {
      if (cause instanceof OrderedIndexKeyTooLargeError) return cause;
      throw cause;
    },
  });
}

export type LoweredCanonicalAppUniqueConstraintV1 =
  | (CanonicalAppUniqueKeyClaimV1 & { readonly projection: AppUniqueKeyProjectionV1 })
  | OmittedAppUniqueKeyClaimV1;

/** One canonical lowering owner shared by point commit, CMS and backfill. */
export function lowerCanonicalAppUniqueConstraintV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<
  LoweredCanonicalAppUniqueConstraintV1,
  InvalidAppUniqueKeyContractV1Error | OrderedIndexKeyTooLargeError
> {
  return Result.gen(function* () {
    const projection = yield* lowerAppUniqueConstraintProjectionV1Result(definition, document);
    if ("kind" in projection) return projection;
    const canonical = yield* canonicalizeAppUniqueKeyV1Result(projection);
    return canonical.kind === "omitted" ? canonical : Object.freeze({ ...canonical, projection });
  });
}
