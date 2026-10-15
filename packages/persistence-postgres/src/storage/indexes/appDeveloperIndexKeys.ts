import { Result } from "effect";
import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  encodeAppOrderedIndexKeyV1,
  OrderedIndexKeyTooLargeError,
  orderedIndexCreationTimeV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexComponentV1,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { LocatedAppIndexDefinitionV1 } from "./locatedAppIndexDefinition";
import {
  appDocumentPathEqualsText,
  appDocumentPathIsNull,
  lowerAppDocumentOrderedFieldValuesV1,
} from "./appDocumentOrderedFieldValuesV1";

/**
 * Pure C08-A lowering from an authenticated final or prior document into the
 * physical ordered-key contract already committed by the located definition.
 */
export function lowerAppDeveloperIndexKeyV1(
  definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): Result.Result<OrderedIndexKeyHexV1 | null, OrderedIndexKeyTooLargeError | ExactDecimalError> {
  if (definition.access.kind !== "developer") throw new TypeError("Expected a located developer index definition.");
  return lowerAppOrderedIndexPhysicalKeyV1(definition.physicalSpec, document, creationTime);
}

/** Same canonical key lowering for an authenticated target-side activation
 * projection. The trusted publisher owns the definition and its digest. */
export function lowerAppOrderedIndexPhysicalKeyV1(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): Result.Result<OrderedIndexKeyHexV1 | null, OrderedIndexKeyTooLargeError | ExactDecimalError> {
  try {
    const predicate = physicalSpec.predicate;
    if (predicate !== undefined && !(predicate.kind === "fieldIsNull"
      ? appDocumentPathIsNull(document, predicate.field)
      : appDocumentPathIsNull(document, predicate.nullField) &&
        appDocumentPathEqualsText(document, predicate.textField, predicate.value))) return Result.succeed(null);
    const values: OrderedIndexComponentV1[] = [];
    const documentFields = physicalSpec.orderedFields.filter(
      (field): field is Extract<typeof field, { readonly kind: "documentPath" }> =>
        field.kind === "documentPath",
    );
    const loweredDocumentValues = lowerAppDocumentOrderedFieldValuesV1(
      document,
      documentFields,
    );
    let documentFieldIndex = 0;
    for (const field of physicalSpec.orderedFields) {
      switch (field.kind) {
        case "documentPath":
          values.push(loweredDocumentValues[documentFieldIndex]!);
          documentFieldIndex += 1;
          break;
        case "systemCreationTime":
          values.push(orderedIndexCreationTimeV1(creationTime));
          break;
      }
    }
    return Result.succeed(encodeAppOrderedIndexKeyV1({
      spec: physicalSpec,
      values: Object.freeze(values),
    }));
  } catch (cause) {
    if (cause instanceof OrderedIndexKeyTooLargeError || cause instanceof ExactDecimalError) {
      return Result.fail(cause);
    }
    throw cause;
  }
}
