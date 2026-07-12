import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
  decodeCatalogTableId,
  decodeCatalogTableNamespace,
  MAX_CATALOG_INDEX_DEFINITION_ID,
  MAX_CATALOG_INDEX_ID,
  MAX_CATALOG_TABLE_ID,
  type CatalogIndexDefinitionId,
  type CatalogIndexId,
  type CatalogTableId,
  type CatalogTableNamespace,
} from "../src/catalog";

describe("FlarexDB catalog contracts", () => {
  it("keeps compact table identities nominal", () => {
    expectTypeOf<CatalogTableId>().toMatchTypeOf<number>();
    expectTypeOf<number>().not.toMatchTypeOf<CatalogTableId>();
  });

  it("accepts only positive PostgreSQL integer table identities", () => {
    expect(decodeCatalogTableId(1)).toBe(1);
    expect(decodeCatalogTableId(MAX_CATALOG_TABLE_ID)).toBe(
      MAX_CATALOG_TABLE_ID,
    );

    for (const value of [
      0,
      -1,
      1.5,
      MAX_CATALOG_TABLE_ID + 1,
      "1",
      null,
    ]) {
      expect(() => decodeCatalogTableId(value)).toThrow();
    }
  });

  it("keeps logical and physical index identities nominally distinct", () => {
    expectTypeOf<CatalogIndexId>().toMatchTypeOf<number>();
    expectTypeOf<CatalogIndexDefinitionId>().toMatchTypeOf<number>();
    expectTypeOf<CatalogIndexId>()
      .not.toEqualTypeOf<CatalogIndexDefinitionId>();
    expectTypeOf<CatalogTableId>()
      .not.toEqualTypeOf<CatalogIndexDefinitionId>();

    expect(decodeCatalogIndexId(1)).toBe(1);
    expect(decodeCatalogIndexId(MAX_CATALOG_INDEX_ID)).toBe(
      MAX_CATALOG_INDEX_ID,
    );
    expect(decodeCatalogIndexDefinitionId(1)).toBe(1);
    expect(
      decodeCatalogIndexDefinitionId(MAX_CATALOG_INDEX_DEFINITION_ID),
    ).toBe(MAX_CATALOG_INDEX_DEFINITION_ID);

    for (const value of [
      0,
      -1,
      1.5,
      MAX_CATALOG_INDEX_DEFINITION_ID + 1,
      "1",
      null,
    ]) {
      expect(() => decodeCatalogIndexDefinitionId(value)).toThrow();
    }
  });

  it("keeps namespace ownership explicit and closed", () => {
    expectTypeOf<CatalogTableNamespace>().toEqualTypeOf<
      "app" | "payload" | "medusa" | "system"
    >();

    for (const namespace of ["app", "payload", "medusa", "system"] as const) {
      expect(decodeCatalogTableNamespace(namespace)).toBe(namespace);
    }
    for (const value of ["commerce", "", 1, null]) {
      expect(() => decodeCatalogTableNamespace(value)).toThrow();
    }
  });
});
