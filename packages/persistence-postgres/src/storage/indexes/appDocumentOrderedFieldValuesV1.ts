import {
  ORDERED_INDEX_MISSING_V1,
  orderedIndexValueForAppFieldV1,
  orderedIndexValueFromFlarexValueV1,
  type AppOrderedIndexDocumentPathV1,
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
  orderedFields: ReadonlyArray<string | AppOrderedIndexDocumentPathV1>,
): ReadonlyArray<OrderedIndexComponentV1> {
  const root = document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(root)) {
    throw new TypeError("Expected a canonical application document object.");
  }
  return Object.freeze(orderedFields.map((field) => {
    const path = typeof field === "string" ? field : field.path;
    const value = readCanonicalDocumentPath(root, path);
    return value === MISSING_DOCUMENT_PATH
      ? ORDERED_INDEX_MISSING_V1
      : typeof field === "string" ? orderedIndexValueFromFlarexValueV1(value)
        : orderedIndexValueForAppFieldV1(field, value);
  }));
}

const MISSING_DOCUMENT_PATH: unique symbol = Symbol(
  "FlarexDB/MissingOrderedDocumentPath",
);

/** Predicate evaluation must not encode a value that does not participate in a key. */
export function appDocumentPathIsNull(document: CanonicalFlarexValueV1, path: string): boolean {
  if (!isCanonicalFlarexRuntimeObjectV1(document.value)) {
    throw new TypeError("Expected a canonical application document object.");
  }
  return readCanonicalDocumentPath(document.value, path) === null;
}

export function appDocumentPathEqualsText(document: CanonicalFlarexValueV1, path: string, value: string): boolean {
  if (!isCanonicalFlarexRuntimeObjectV1(document.value)) {
    throw new TypeError("Expected a canonical application document object.");
  }
  return readCanonicalDocumentPath(document.value, path) === value;
}

export function appDocumentPathEqualsBoolean(document: CanonicalFlarexValueV1, path: string, value: boolean): boolean {
  if (!isCanonicalFlarexRuntimeObjectV1(document.value)) {
    throw new TypeError("Expected a canonical application document object.");
  }
  return readCanonicalDocumentPath(document.value, path) === value;
}

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
