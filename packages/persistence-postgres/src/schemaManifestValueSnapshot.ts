import type {
  SchemaManifestAppIndexDeclarationV1,
  SchemaManifestAppSchemaV1,
  SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";

type SchemaManifestSnapshotValue =
  | SchemaManifestAppSchemaV1
  | ReadonlyArray<SchemaManifestAppIndexDeclarationV1>
  | ReadonlyArray<SchemaManifestAppTableDeclarationV1>;

/**
 * Detaches and recursively freezes an already-decoded schema-manifest value.
 *
 * This intentionally accepts only the plain-data manifest shapes retained by
 * persistence preparation. It is not a general deep-freeze utility.
 */
export function snapshotSchemaManifestValue(
  value: SchemaManifestAppSchemaV1,
): SchemaManifestAppSchemaV1;
export function snapshotSchemaManifestValue(
  value: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
export function snapshotSchemaManifestValue(
  value: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
): ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
export function snapshotSchemaManifestValue(
  value: SchemaManifestSnapshotValue,
): SchemaManifestSnapshotValue {
  const snapshot = structuredClone(value);
  freezeSchemaManifestValue(snapshot);
  return snapshot;
}

function freezeSchemaManifestValue(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) freezeSchemaManifestValue(child);
  Object.freeze(value);
}
