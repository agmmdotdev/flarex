import {
  ORDERED_INDEX_MISSING_V1,
  orderedIndexValueFromFlarexValueV1,
  type OrderedIndexComponentV1,
} from "flarex-protocol/ordered-index";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

/** Package-local lowering shared by ordered developer and unique definitions. */
export function lowerAppDocumentOrderedFieldValuesV1(
  document: CanonicalFlarexValueV1,
  orderedFields: ReadonlyArray<string>,
): ReadonlyArray<OrderedIndexComponentV1> {
  const root = document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(root)) {
    throw new TypeError("Expected a canonical application document object.");
  }
  return Object.freeze(orderedFields.map((path) => {
    const value = readCanonicalDocumentPath(root, path);
    return value === MISSING_DOCUMENT_PATH
      ? ORDERED_INDEX_MISSING_V1
      : orderedIndexValueFromFlarexValueV1(value);
  }));
}

const MISSING_DOCUMENT_PATH: unique symbol = Symbol(
  "FlarexDB/MissingOrderedDocumentPath",
);

function readCanonicalDocumentPath(
  root: Readonly<Record<string, CanonicalFlarexRuntimeValueV1>>,
  path: string,
): CanonicalFlarexRuntimeValueV1 | typeof MISSING_DOCUMENT_PATH {
  let current: CanonicalFlarexRuntimeValueV1 = root;
  for (const segment of path.split(".")) {
    if (
      !isCanonicalFlarexRuntimeObjectV1(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return MISSING_DOCUMENT_PATH;
    }
    current = current[segment]!;
  }
  return current;
}
