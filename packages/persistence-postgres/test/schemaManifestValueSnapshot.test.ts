import { describe, expect, expectTypeOf, it } from "vitest";
import {
  decodeSchemaManifestAppTableDeclarationsV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";

import { snapshotSchemaManifestValue } from "../src/schemaManifestValueSnapshot";

describe("snapshotSchemaManifestValue", () => {
  it("detaches and recursively freezes decoded schema-manifest values", () => {
    const tables = decodeSchemaManifestAppTableDeclarationsV1([
      {
        logicalName: "users",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              name: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
        },
      },
    ]);

    const snapshot = snapshotSchemaManifestValue(tables);
    const snapshotFromMutableArray = snapshotSchemaManifestValue([...tables]);

    expectTypeOf(snapshotFromMutableArray).toEqualTypeOf<
      ReadonlyArray<SchemaManifestAppTableDeclarationV1>
    >();

    expect(snapshot).toEqual(tables);
    expect(snapshot).not.toBe(tables);
    expect(snapshot[0]).not.toBe(tables[0]);
    expect(snapshot[0]?.definition).not.toBe(tables[0]?.definition);
    expectDeeplyFrozen(snapshot);

    const table = tables[0];
    if (table === undefined) throw new Error("Expected one decoded table.");
    Object.defineProperty(table, "logicalName", { value: "changed" });

    expect(snapshot[0]?.logicalName).toBe("users");
    expect(Object.isFrozen(tables)).toBe(false);
    expect(Object.isFrozen(table)).toBe(false);
  });
});

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    expectDeeplyFrozen(child);
  }
}
