import { describe, expect, it } from "vitest";

import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { scopePhysicalLocatorsEqual } from "../src/scopePhysicalLocator";

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "flarex_shared",
} satisfies ScopePhysicalLocator;

describe("scope physical locator equality", () => {
  it("compares locator values rather than object identity", () => {
    expect(
      scopePhysicalLocatorsEqual(sharedLocator, { ...sharedLocator }),
    ).toBe(true);
  });

  it("compares every persisted locator identity field", () => {
    const differentLocators = [
      { ...sharedLocator, kind: "schema_per_scope" },
      { ...sharedLocator, databaseKey: "secondary" },
      { ...sharedLocator, schemaName: "flarex_other" },
    ] satisfies ReadonlyArray<ScopePhysicalLocator>;

    for (const locator of differentLocators) {
      expect(scopePhysicalLocatorsEqual(sharedLocator, locator)).toBe(false);
    }
  });
});
