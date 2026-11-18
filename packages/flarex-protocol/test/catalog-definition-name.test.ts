import { Result, Schema } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { CatalogDefinitionNameSchema, type CatalogDefinitionName } from "../src/catalog";
import { SchemaManifestAppIndexDescriptorSchema, type SchemaManifestAppIndexDescriptor } from "../src/schema-manifest";

it("preserves native catalog names while retaining Application identifier rules", () => {
  const decode = Schema.decodeUnknownResult(CatalogDefinitionNameSchema);
  for (const name of ["key/currency.primary", "index/currency.active", "key/a.b", "key/a_b", "key/ငွေ", "key/💰", "key/" + "x".repeat(512)]) {
    expect(Result.getOrThrow(decode(name))).toBe(name);
  }
  for (const name of ["", " ", "key/\0bad", "key/\ud800", "key/" + "💰".repeat(256)]) {
    expect(Result.isFailure(decode(name))).toBe(true);
  }
  const application = Schema.decodeUnknownResult(SchemaManifestAppIndexDescriptorSchema);
  expect(Result.isFailure(application("key/currency.primary"))).toBe(true);
  expect(Result.isFailure(application("by_id"))).toBe(true);
  expect(Result.getOrThrow(application("by_code"))).toBe("by_code");
  expectTypeOf<SchemaManifestAppIndexDescriptor>().toExtend<CatalogDefinitionName>();
});
