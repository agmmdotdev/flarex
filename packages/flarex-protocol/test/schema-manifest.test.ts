import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeCatalogSchemaVersionId,
  decodeCatalogSchemaVersion,
  decodeSchemaManifestCodecVersion,
  decodeSchemaManifestSha256,
  MAX_CATALOG_SCHEMA_VERSION,
  MAX_SCHEMA_MANIFEST_NESTING_DEPTH,
  SchemaManifestCodecVersionSchema,
  type CanonicalSchemaManifestBytes,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestCodecVersion,
  type SchemaManifestJson,
  type SchemaManifestSha256,
} from "../src/schema-manifest";

describe("FlarexDB schema manifest contracts", () => {
  it("keeps schema-version and artifact values nominal", () => {
    expectTypeOf<CatalogSchemaVersionId>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<CatalogSchemaVersionId>();
    expectTypeOf<CatalogSchemaVersion>().toMatchTypeOf<number>();
    expectTypeOf<number>().not.toMatchTypeOf<CatalogSchemaVersion>();
    expectTypeOf<SchemaManifestCodecVersion>().toMatchTypeOf<1>();
    expectTypeOf<1>().not.toMatchTypeOf<SchemaManifestCodecVersion>();
    expectTypeOf<CanonicalSchemaManifestBytes>()
      .toMatchTypeOf<Uint8Array>();
    expectTypeOf<Uint8Array>()
      .not.toMatchTypeOf<CanonicalSchemaManifestBytes>();
    expectTypeOf<SchemaManifestSha256>().toMatchTypeOf<Uint8Array>();
    expectTypeOf<Uint8Array>().not.toMatchTypeOf<SchemaManifestSha256>();
  });

  it("validates opaque IDs, positive int32 versions, codec v1, and digests", () => {
    expect(CatalogSchemaVersionIdSchema.make("schema_v1")).toBe("schema_v1");
    expect(CatalogSchemaVersionSchema.make(1)).toBe(1);
    expect(CatalogSchemaVersionSchema.make(MAX_CATALOG_SCHEMA_VERSION)).toBe(
      MAX_CATALOG_SCHEMA_VERSION,
    );
    expect(SchemaManifestCodecVersionSchema.make(1)).toBe(1);
    expect(decodeSchemaManifestSha256(new Uint8Array(32))).toHaveLength(32);

    for (const value of [
      "",
      " \t\n",
      "schema\u0000id",
      "schema\ud800id",
      1,
      null,
    ]) {
      expect(() => decodeCatalogSchemaVersionId(value)).toThrow();
    }
    for (const value of [0, -1, 1.5, MAX_CATALOG_SCHEMA_VERSION + 1]) {
      expect(() => decodeCatalogSchemaVersion(value)).toThrow();
    }
    expect(() => decodeSchemaManifestCodecVersion(2)).toThrow();
    for (const length of [0, 31, 33]) {
      expect(() => decodeSchemaManifestSha256(new Uint8Array(length))).toThrow();
    }
  });

  it("emits the domain-separated codec-v1 golden artifact", async () => {
    const artifact = await canonicalizeSchemaManifestV1({});

    expect(artifact.canonicalText).toBe(
      '{"format":"flarexdb-schema-manifest","manifest":{},"manifestCodecVersion":1}',
    );
    expect(artifact.canonicalBytes).toHaveLength(76);
    expect(encodeBytesToLowercaseHex(artifact.sha256)).toBe(
      "ddd4820699614ff561924bbfca12688a0eb8e42a848f481dfee413518c23e02b",
    );
  });

  it("sorts object keys by UTF-16 while preserving array order", async () => {
    const first = await canonicalizeSchemaManifestV1({
      "10": "ten",
      z: { b: 2, a: 1 },
      "2": "two",
      ä: true,
      list: ["second", "first"],
    });
    const reordered = await canonicalizeSchemaManifestV1({
      list: ["second", "first"],
      ä: true,
      "2": "two",
      z: { a: 1, b: 2 },
      "10": "ten",
    });
    const arrayChanged = await canonicalizeSchemaManifestV1({
      "10": "ten",
      z: { b: 2, a: 1 },
      "2": "two",
      ä: true,
      list: ["first", "second"],
    });

    expect(first.canonicalText).toContain(
      '"manifest":{"10":"ten","2":"two","list":["second","first"],"z":{"a":1,"b":2},"ä":true}',
    );
    expect(reordered.canonicalBytes).toEqual(first.canonicalBytes);
    expect(reordered.sha256).toEqual(first.sha256);
    expect(arrayChanged.sha256).not.toEqual(first.sha256);
  });

  it("normalizes negative zero and returns a detached frozen manifest", async () => {
    const input = { nested: { value: -0 } };
    const artifact = await canonicalizeSchemaManifestV1(input);
    input.nested.value = 9;

    expect(artifact.canonicalText).toContain('"value":0');
    expect(artifact.manifestJson).toEqual({ nested: { value: 0 } });
    expect(Object.isFrozen(artifact.manifestJson)).toBe(true);
    expect(Object.isFrozen(artifact.manifestJson.nested)).toBe(true);
  });

  it("preserves __proto__ as data without changing the cloned prototype", async () => {
    const input: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"data"}',
    );
    const artifact = await canonicalizeSchemaManifestV1(input);

    expect(Object.hasOwn(artifact.manifestJson, "__proto__")).toBe(true);
    expect(artifact.manifestJson.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(artifact.manifestJson)).toBe(Object.prototype);
    expect(artifact.manifestJson.constructor).toBe("data");
  });

  it("rejects values that cannot round-trip through PostgreSQL jsonb", async () => {
    class ManifestArray extends Array<unknown> {}

    const sparse = new Array<unknown>(2);
    sparse[1] = "value";
    const subclassedArray = new ManifestArray("value");
    const replacedPrototypeArray = ["value"];
    Object.setPrototypeOf(replacedPrototypeArray, {
      map: () => ["rewritten"],
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const withSymbol = { ok: true };
    Object.defineProperty(withSymbol, Symbol("hidden"), {
      enumerable: true,
      value: 1,
    });
    const withAccessor = {};
    Object.defineProperty(withAccessor, "value", {
      enumerable: true,
      get: () => 1,
    });
    const invalidValues: ReadonlyArray<unknown> = [
      [],
      null,
      undefined,
      { value: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: 1n },
      { value: new Date() },
      { value: "nul\u0000value" },
      { value: "\ud800" },
      { sparse },
      { subclassedArray },
      { replacedPrototypeArray },
      cyclic,
      withSymbol,
      withAccessor,
    ];

    for (const value of invalidValues) {
      await expect(canonicalizeSchemaManifestV1(value)).rejects.toThrow();
    }
  });

  it("rejects manifests deeper than the codec-v1 nesting ceiling", async () => {
    let value: SchemaManifestJson = {};
    for (
      let depth = 0;
      depth <= MAX_SCHEMA_MANIFEST_NESTING_DEPTH;
      depth += 1
    ) {
      value = { nested: value };
    }

    await expect(canonicalizeSchemaManifestV1(value)).rejects.toThrow();
  });
});
