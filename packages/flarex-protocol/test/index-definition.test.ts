import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  type CatalogIndexId,
  type CatalogTableId,
} from "../src/catalog";
import {
  APP_INDEX_PHYSICAL_SPEC_CODEC_VERSION_V1,
  MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
  appPhysicalIndexAccessStorageIdentityV1,
  canonicalizeAppIndexPhysicalSpecV1,
  decodeAppPhysicalIndexAccessIdentityV1,
  type AppCreationTimePhysicalIndexAccessIdentityV1,
  type AppDeveloperPhysicalIndexAccessIdentityV1,
  type AppPhysicalIndexAccessStorageIdentityV1,
} from "../src/index-definition";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
} from "../src/ordered-index";
import {
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  type SchemaManifestAppDeveloperOrderedIndexSpecV1,
} from "../src/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

const tableId = CatalogTableIdSchema.make(7);
const logicalIndexId = CatalogIndexIdSchema.make(11);

describe("physical index definition protocol", () => {
  it("keeps developer and intrinsic access ownership discriminated", () => {
    expectTypeOf<AppDeveloperPhysicalIndexAccessIdentityV1["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
    expectTypeOf<
      AppDeveloperPhysicalIndexAccessIdentityV1["logicalIndexId"]
    >().toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<AppCreationTimePhysicalIndexAccessIdentityV1>()
      .not.toHaveProperty("logicalIndexId");
    expectTypeOf<
      Extract<
        AppPhysicalIndexAccessStorageIdentityV1,
        { readonly kind: "developer" }
      >["accessIdentityId"]
    >().toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<
      Extract<
        AppPhysicalIndexAccessStorageIdentityV1,
        { readonly kind: "by_creation_time" }
      >["accessIdentityId"]
    >().toEqualTypeOf<CatalogTableId>();

    expect(
      appPhysicalIndexAccessStorageIdentityV1({
        kind: "developer",
        tableId,
        logicalIndexId,
      }),
    ).toEqual({
      kind: "developer",
      accessIdentityId: 11,
      tableId: 7,
      logicalIndexId: 11,
    });
    expect(
      appPhysicalIndexAccessStorageIdentityV1({
        kind: "by_creation_time",
        tableId,
      }),
    ).toEqual({
      kind: "by_creation_time",
      accessIdentityId: 7,
      tableId: 7,
      logicalIndexId: null,
    });
  });

  it("excludes direct by_id from buildable physical ownership", () => {
    expect(() =>
      decodeAppPhysicalIndexAccessIdentityV1({
        kind: "by_id",
        tableId,
      })
    ).toThrow();
    expect(() =>
      decodeAppPhysicalIndexAccessIdentityV1({
        kind: "by_creation_time",
        tableId,
        logicalIndexId,
      })
    ).toThrow();
  });

  it("canonicalizes equivalent physical specs to exact bytes and digest", async () => {
    const logicalSpec = developerSpec("profile.email", "name");
    const physicalSpec =
      lowerAppDeveloperOrderedIndexPhysicalSpecV1(logicalSpec);
    const reordered = {
      maxEncodedKeyBytes: physicalSpec.maxEncodedKeyBytes,
      tieBreaker: {
        byteLength: physicalSpec.tieBreaker.byteLength,
        kind: physicalSpec.tieBreaker.kind,
      },
      orderedFields: physicalSpec.orderedFields.map((field) =>
        field.kind === "documentPath"
          ? { path: field.path, kind: field.kind }
          : { kind: field.kind }
      ),
      accessPath: physicalSpec.accessPath,
      keyCodecVersion: physicalSpec.keyCodecVersion,
      kind: physicalSpec.kind,
      collation: physicalSpec.collation,
      specVersion: physicalSpec.specVersion,
    };

    const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
    const replay = await canonicalizeAppIndexPhysicalSpecV1(reordered);

    expect(canonical.codecVersion).toBe(
      APP_INDEX_PHYSICAL_SPEC_CODEC_VERSION_V1,
    );
    expect(canonical.canonicalText).toBe(
      '{"format":"flarexdb-app-index-physical-spec",' +
      '"physicalSpec":{"accessPath":"developer",' +
      '"collation":"binaryUtf8","keyCodecVersion":1,' +
      '"kind":"appOrdered","maxEncodedKeyBytes":2048,' +
      '"orderedFields":[{"kind":"documentPath","path":"profile.email"},' +
      '{"kind":"documentPath","path":"name"},' +
      '{"kind":"systemCreationTime"}],"specVersion":1,' +
      '"tieBreaker":{"byteLength":16,"kind":"separateRowIdentity"}},' +
      '"physicalSpecCodecVersion":1}',
    );
    expect(replay.canonicalBytesHex).toBe(canonical.canonicalBytesHex);
    expect(replay.sha256Hex).toBe(canonical.sha256Hex);
    expectTypeOf(canonical.canonicalBytesHex).toMatchTypeOf<string>();
    expectTypeOf(canonical.sha256Hex).toMatchTypeOf<string>();
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(Object.isFrozen(canonical.physicalSpec)).toBe(true);
  });

  it("changes canonical identity when the physical access path changes", async () => {
    const logicalSpec = developerSpec("name");
    const developer = await canonicalizeAppIndexPhysicalSpecV1(
      lowerAppDeveloperOrderedIndexPhysicalSpecV1(logicalSpec),
    );
    const creationTime = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );

    expect(developer.sha256Hex).not.toBe(creationTime.sha256Hex);
    expect(developer.canonicalText).not.toBe(creationTime.canonicalText);
  });

  it("keeps the largest valid v1 field-path envelope below its storage cap", async () => {
    const sharedSegments = Array.from(
      { length: 127 },
      () => "a".repeat(64),
    );
    const fields = Array.from({ length: 15 }, (_, index) =>
      [
        ...sharedSegments,
        `${"z".repeat(63)}${String.fromCharCode(97 + index)}`,
      ].join(".")
    );
    const canonical = await canonicalizeAppIndexPhysicalSpecV1(
      lowerAppDeveloperOrderedIndexPhysicalSpecV1(
        developerSpec(...fields),
      ),
    );

    expect(canonical.canonicalBytesHex.length / 2).toBeLessThanOrEqual(
      MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
    );
  });
});

function developerSpec(
  ...fields: string[]
): SchemaManifestAppDeveloperOrderedIndexSpecV1 {
  return decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
    kind: "developerOrdered",
    specVersion: 1,
    fields,
  });
}
