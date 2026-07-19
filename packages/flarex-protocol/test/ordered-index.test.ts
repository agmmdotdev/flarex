import { Result, Schema } from "effect";
import {
  SchemaManifestAppDeveloperOrderedIndexSpecV1Schema,
  decodeSchemaManifestAppIndexFieldPath,
  type SchemaManifestAppDeveloperOrderedIndexSpecV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  APP_BY_ID_PHYSICAL_SPEC_V1,
  APP_ORDERED_INDEX_SYSTEM_CREATION_TIME_V1,
  InvalidEncodedOrderedIndexKeyV1Error,
  InvalidOrderedIndexRangeV1Error,
  MAX_ORDERED_INDEX_BOUND_BYTES_V1,
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  ORDERED_INDEX_MISSING_V1,
  ORDERED_INDEX_NULL_V1,
  OrderedIndexCodecV1InputError,
  OrderedIndexKeyTooLargeError,
  appOrderedIndexDocumentPathV1,
  compareOrderedIndexKeysV1,
  compareOrderedIndexPositionsV1,
  compileAppOrderedIndexBoundsV1,
  decodeAppOrderedIndexKeyV1,
  decodeAppOrderedIndexPhysicalSpecV1,
  decodeOrderedIndexComponentsV1,
  decodeOrderedIndexKeyBytesHexV1,
  encodeAppOrderedIndexKeyV1,
  encodeOrderedIndexComponentsV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  orderedIndexBytesV1FromBytes,
  orderedIndexBytesV1ToBytes,
  orderedIndexCreationTimeV1,
  orderedIndexBoundHexV1FromBytes,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexFloat64FromBitsV1,
  orderedIndexFloat64FromNumberV1,
  orderedIndexFloat64ToNumberV1,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexPositionInBoundsV1,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  type AppOrderedIndexPhysicalFieldV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexArrayV1,
  type OrderedIndexComponentV1,
  type OrderedIndexFloat64V1,
  type OrderedIndexBoundHexV1,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexKeyHexV1,
  type OrderedIndexObjectV1,
  type OrderedIndexObjectEntryV1,
  type OrderedIndexPositionV1,
  type OrderedIndexRowIdHexV1,
  type OrderedIndexValueV1,
} from "../src/ordered-index";

describe("ordered index physical contract v1", () => {
  it("lowers developer and intrinsic access paths without changing the logical spec", () => {
    const logical = logicalSpec("status", "createdBy");
    const physical = lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical);

    expect(physical).toEqual({
      kind: "appOrdered",
      specVersion: 1,
      accessPath: "developer",
      orderedFields: [
        { kind: "documentPath", path: "status" },
        { kind: "documentPath", path: "createdBy" },
        { kind: "systemCreationTime" },
      ],
      tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
      keyCodecVersion: 1,
      collation: "binaryUtf8",
      maxEncodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
    });
    expect(logical.fields).toEqual(["status", "createdBy"]);
    expect(APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1.orderedFields).toEqual([
      { kind: "systemCreationTime" },
    ]);
    expect(APP_BY_ID_PHYSICAL_SPEC_V1.orderedFields).toEqual([]);
    expect(Object.isFrozen(physical)).toBe(true);
    expect(Object.isFrozen(physical.orderedFields)).toBe(true);
    expect(Object.isFrozen(physical.tieBreaker)).toBe(true);
  });

  it("rejects malformed or widened physical specifications", () => {
    const base = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("status"),
    );
    for (const invalid of [
      { ...base, keyCodecVersion: 2 },
      { ...base, collation: "locale" },
      { ...base, maxEncodedKeyBytes: 2_500 },
      { ...base, orderedFields: [{ kind: "documentPath", path: "status" }] },
      {
        ...base,
        orderedFields: [
          { kind: "documentPath", path: "status" },
          { kind: "documentPath", path: "status" },
          { kind: "systemCreationTime" },
        ],
      },
      { ...base, callerPhysicalName: "unsafe" },
    ]) {
      expect(() => decodeAppOrderedIndexPhysicalSpecV1(invalid)).toThrow();
    }
  });

  it("detaches and deeply freezes decoded physical specifications", () => {
    const input = {
      kind: "appOrdered",
      specVersion: 1,
      accessPath: "developer",
      orderedFields: [
        { kind: "documentPath", path: "status" },
        { kind: "systemCreationTime" },
      ],
      tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
      keyCodecVersion: 1,
      collation: "binaryUtf8",
      maxEncodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
    };

    const decoded = decodeAppOrderedIndexPhysicalSpecV1(input);
    input.orderedFields[0]!.path = "changedAfterDecode";
    input.tieBreaker.byteLength = 1;

    expect(decoded.orderedFields[0]).toEqual({
      kind: "documentPath",
      path: "status",
    });
    expect(decoded.tieBreaker.byteLength).toBe(16);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.orderedFields)).toBe(true);
    expect(Object.isFrozen(decoded.orderedFields[0])).toBe(true);
    expect(Object.isFrozen(decoded.tieBreaker)).toBe(true);
  });

  it("keeps encoded-key and row-identity types nominally distinct", () => {
    expectTypeOf<OrderedIndexKeyHexV1>()
      .not.toEqualTypeOf<OrderedIndexRowIdHexV1>();
    expectTypeOf<OrderedIndexKeyBytesHexV1>()
      .not.toEqualTypeOf<OrderedIndexBoundHexV1>();
    expectTypeOf<OrderedIndexKeyHexV1>()
      .not.toEqualTypeOf<OrderedIndexKeyBytesHexV1>();
    expectTypeOf<AppOrderedIndexPhysicalSpecV1["accessPath"]>()
      .toEqualTypeOf<"developer" | "by_creation_time" | "by_id">();
  });
});

describe("ordered value codec v1", () => {
  it("pins exact portable value bytes", () => {
    const fixtures: ReadonlyArray<
      readonly [string, OrderedIndexComponentV1]
    > = [
      ["01", ORDERED_INDEX_MISSING_V1],
      ["03", ORDERED_INDEX_NULL_V1],
      ["04" + "80" + "00".repeat(7), int64(-(1n << 63n))],
      ["05ffff7fff", int64(-32_769n)],
      ["068000", int64(-32_768n)],
      ["06ff7f", int64(-129n)],
      ["0780", int64(-128n)],
      ["07ff", int64(-1n)],
      ["08", int64(0n)],
      ["0901", int64(1n)],
      ["097f", int64(127n)],
      ["0a0080", int64(128n)],
      ["0a7fff", int64(32_767n)],
      ["0b00008000", int64(32_768n)],
      ["0c7fffffffffffffff", int64((1n << 63n) - 1n)],
      ["0d0007ffffffffffff", floatBits(0xfff8_0000_0000_0000n)],
      ["0d000fffffffffffff", floatBits(0xfff0_0000_0000_0000n)],
      ["0d7fffffffffffffff", floatBits(0x8000_0000_0000_0000n)],
      ["0d8000000000000000", floatBits(0x0000_0000_0000_0000n)],
      ["0dbff0000000000000", floatBits(0x3ff0_0000_0000_0000n)],
      ["0dfff0000000000000", floatBits(0x7ff0_0000_0000_0000n)],
      ["0dfff8000000000000", floatBits(0x7ff8_0000_0000_0000n)],
      ["0e", bool(false)],
      ["0f", bool(true)],
      ["1000", stringValue("")],
      ["106100", stringValue("a")],
      ["106100ff6200", stringValue("a\u0000b")],
      ["10c3a900", stringValue("é")],
      ["1100", bytesValue()],
      ["1100ffff00", bytesValue(0x00, 0xff)],
      ["1200", arrayValue()],
      ["120300", arrayValue(ORDERED_INDEX_NULL_V1)],
      ["1500", objectValue()],
      ["1500ff0300", objectValue(["", ORDERED_INDEX_NULL_V1])],
      ["1561000300", objectValue(["a", ORDERED_INDEX_NULL_V1])],
    ];

    for (const [expected, value] of fixtures) {
      expect(encodeOrderedIndexComponentsV1([value])).toBe(expected);
    }
    expect(
      encodeOrderedIndexComponentsV1([
        ORDERED_INDEX_MISSING_V1,
        ORDERED_INDEX_NULL_V1,
        bool(false),
        stringValue("a"),
      ]),
    ).toBe("01030e106100");
  });

  it("round-trips canonical tuples without losing special float bits", () => {
    const values: ReadonlyArray<OrderedIndexComponentV1> = [
      ORDERED_INDEX_MISSING_V1,
      int64(-9_223_372_036_854_775_808n),
      floatBits(0xfff8_0000_0000_0001n),
      stringValue("မင်္ဂလာပါ"),
      bytesValue(0x00, 0x7f, 0xff),
      arrayValue(ORDERED_INDEX_NULL_V1, bool(true), int64(4n)),
      objectValue(
        ["b", stringValue("second")],
        ["", ORDERED_INDEX_NULL_V1],
        ["a", bytesValue(1, 2)],
      ),
    ];
    const encoded = encodeOrderedIndexComponentsV1(values);
    const decoded = decodeOrderedIndexComponentsV1(encoded, values.length);

    expect(decoded).toEqual([
      ORDERED_INDEX_MISSING_V1,
      int64(-9_223_372_036_854_775_808n),
      floatBits(0xfff8_0000_0000_0001n),
      stringValue("မင်္ဂလာပါ"),
      bytesValue(0x00, 0x7f, 0xff),
      arrayValue(ORDERED_INDEX_NULL_V1, bool(true), int64(4n)),
      objectValue(
        ["", ORDERED_INDEX_NULL_V1],
        ["a", bytesValue(1, 2)],
        ["b", stringValue("second")],
      ),
    ]);
    expect(encodeOrderedIndexComponentsV1(decoded)).toBe(encoded);
  });

  it("preserves the total type and recursive value order", () => {
    const ordered: ReadonlyArray<OrderedIndexComponentV1> = [
      ORDERED_INDEX_MISSING_V1,
      ORDERED_INDEX_NULL_V1,
      int64(10n),
      floatBits(0xfff8_0000_0000_0000n),
      floatBits(0xfff0_0000_0000_0000n),
      orderedIndexFloat64FromNumberV1(-0),
      orderedIndexFloat64FromNumberV1(0),
      orderedIndexFloat64FromNumberV1(Number.POSITIVE_INFINITY),
      floatBits(0x7ff8_0000_0000_0000n),
      bool(false),
      bool(true),
      stringValue("a"),
      bytesValue(),
      arrayValue(),
      objectValue(),
    ];
    const encoded = ordered.map((value) =>
      encodeOrderedIndexComponentsV1([value])
    );

    for (let index = 1; index < encoded.length; index += 1) {
      const previous = encoded[index - 1];
      const current = encoded[index];
      if (previous === undefined || current === undefined) {
        throw new Error("Expected adjacent ordered-key fixtures.");
      }
      expect(previous < current).toBe(true);
    }
    expect(
      encodeOrderedIndexComponentsV1([int64(-10n)]) <
        encodeOrderedIndexComponentsV1([int64(-2n)]),
    ).toBe(true);
    expect(
      encodeOrderedIndexComponentsV1([stringValue("a")]) <
        encodeOrderedIndexComponentsV1([stringValue("aa")]),
    ).toBe(true);
    expect(
      encodeOrderedIndexComponentsV1([
        stringValue("user"),
        int64(2n),
      ]) <
        encodeOrderedIndexComponentsV1([
          stringValue("user"),
          int64(10n),
        ]),
    ).toBe(true);
  });

  it("rejects non-canonical values before encoding", () => {
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([int64(1n << 63n)]));
    expectTerminalCodecError(() =>
      orderedIndexFloat64FromBitsV1(1n << 64n));
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([stringValue("\ud800")])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([stringValue("a".repeat(2_047))])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([
        objectValue(["$reserved", ORDERED_INDEX_NULL_V1]),
      ])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([
        objectValue(["bad\nfield", ORDERED_INDEX_NULL_V1]),
      ])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([
        objectValue(
          ["same", ORDERED_INDEX_NULL_V1],
          ["same", bool(true)],
        ),
      ])
    );
    expectTerminalCodecError(() =>
      Reflect.apply(encodeOrderedIndexComponentsV1, undefined, [[{
        kind: "array",
        value: [ORDERED_INDEX_MISSING_V1],
      }]])
    );

    const sparse: OrderedIndexValueV1[] = new Array(1);
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{ kind: "array", value: sparse }])
    );

    const extraProperty: OrderedIndexValueV1[] = [ORDERED_INDEX_NULL_V1];
    Object.defineProperty(extraProperty, "metadata", {
      enumerable: true,
      value: "not part of the ordered value",
    });
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "array",
        value: extraProperty,
      }])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "array",
        value: Array.from(
          { length: 2_047 },
          () => ORDERED_INDEX_NULL_V1,
        ),
      }])
    );

    const sparseEntries: OrderedIndexObjectEntryV1[] = new Array(1);
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "object",
        entries: sparseEntries,
      }])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([objectValue([
        "a".repeat(1_025),
        ORDERED_INDEX_NULL_V1,
      ])])
    );
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "object",
        entries: Array.from(
          { length: 2_049 },
          (_, index) => ({
            field: `f${index}`,
            value: ORDERED_INDEX_NULL_V1,
          }),
        ),
      }])
    );
    expectTerminalCodecError(() =>
      orderedIndexBytesV1FromBytes(new Uint8Array(2_047))
    );

    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1(
        Array.from({ length: 17 }, () => ORDERED_INDEX_NULL_V1),
      )
    );

    const members: OrderedIndexValueV1[] = [];
    const cycle = { kind: "array", value: members } satisfies OrderedIndexArrayV1;
    members.push(cycle);
    expectTerminalCodecError(() => encodeOrderedIndexComponentsV1([cycle]));

    expect(() =>
      encodeOrderedIndexComponentsV1([
        wrapInArrays(arrayValue(), 63),
      ])
    ).not.toThrow();
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([
        wrapInArrays(arrayValue(), 64),
      ])
    );
    expect(() =>
      encodeOrderedIndexComponentsV1([
        wrapInArrays(objectValue(), 63),
      ])
    ).not.toThrow();
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([
        wrapInArrays(objectValue(), 64),
      ])
    );

    let getterRead = false;
    const accessor = {};
    Object.defineProperty(accessor, "kind", {
      enumerable: true,
      get() {
        getterRead = true;
        return "null";
      },
    });
    expectTerminalCodecError(() =>
      Reflect.apply(encodeOrderedIndexComponentsV1, undefined, [[accessor]])
    );
    expect(getterRead).toBe(false);

    let arrayGetterRead = false;
    const accessorComponents: OrderedIndexComponentV1[] = [
      ORDERED_INDEX_NULL_V1,
    ];
    Object.defineProperty(accessorComponents, 0, {
      enumerable: true,
      get() {
        arrayGetterRead = true;
        return ORDERED_INDEX_NULL_V1;
      },
    });
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1(accessorComponents)
    );

    const accessorMembers: OrderedIndexValueV1[] = [ORDERED_INDEX_NULL_V1];
    Object.defineProperty(accessorMembers, 0, {
      enumerable: true,
      get() {
        arrayGetterRead = true;
        return ORDERED_INDEX_NULL_V1;
      },
    });
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "array",
        value: accessorMembers,
      }])
    );

    const accessorEntries: OrderedIndexObjectEntryV1[] = [{
      field: "a",
      value: ORDERED_INDEX_NULL_V1,
    }];
    Object.defineProperty(accessorEntries, 0, {
      enumerable: true,
      get() {
        arrayGetterRead = true;
        return { field: "a", value: ORDERED_INDEX_NULL_V1 };
      },
    });
    expectTerminalCodecError(() =>
      encodeOrderedIndexComponentsV1([{
        kind: "object",
        entries: accessorEntries,
      }])
    );
    expect(arrayGetterRead).toBe(false);
  });

  it("strictly rejects malformed and non-canonical stored bytes", () => {
    for (const [hex, count] of [
      ["02", 1],
      ["0a0001", 1],
      ["1061", 1],
      ["10c0af00", 1],
      ["120100", 1],
      ["1562000361000300", 1],
      ["1561000361000f00", 1],
      ["03ff", 1],
    ] as const) {
      expect(() =>
        decodeOrderedIndexComponentsV1(
          decodeOrderedIndexKeyBytesHexV1(hex),
          count,
        )
      ).toThrow(InvalidEncodedOrderedIndexKeyV1Error);
    }
    expect(() =>
      Reflect.apply(decodeOrderedIndexComponentsV1, undefined, ["0D", 1])
    ).toThrow(InvalidEncodedOrderedIndexKeyV1Error);

    const allowedArrayDepth = encodeOrderedIndexComponentsV1([
      wrapInArrays(arrayValue(), 63),
    ]);
    expect(() => decodeOrderedIndexComponentsV1(allowedArrayDepth, 1))
      .not.toThrow();
    const tooDeepArray = decodeOrderedIndexKeyBytesHexV1(
      "12".repeat(65) + "00".repeat(65),
    );
    expect(() => decodeOrderedIndexComponentsV1(tooDeepArray, 1))
      .toThrow(InvalidEncodedOrderedIndexKeyV1Error);
    const allowedObjectDepth = encodeOrderedIndexComponentsV1([
      wrapInArrays(objectValue(), 63),
    ]);
    expect(() => decodeOrderedIndexComponentsV1(allowedObjectDepth, 1))
      .not.toThrow();
    const tooDeepObject = decodeOrderedIndexKeyBytesHexV1(
      "12".repeat(64) + "1500" + "00".repeat(64),
    );
    expect(() => decodeOrderedIndexComponentsV1(tooDeepObject, 1))
      .toThrow(InvalidEncodedOrderedIndexKeyV1Error);
  });

  it("enforces the exact 2048-byte encoded-key ceiling", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("value"),
    );
    const exact = encodeAppOrderedIndexKeyV1({
      spec,
      values: [
        stringValue("a".repeat(2_037)),
        orderedIndexCreationTimeV1(1),
      ],
    });
    expect(exact.length / 2).toBe(MAX_ORDERED_INDEX_KEY_BYTES_V1);

    const exactWithEscapedNuls = encodeAppOrderedIndexKeyV1({
      spec,
      values: [
        stringValue("a" + "\u0000".repeat(1_018)),
        orderedIndexCreationTimeV1(1),
      ],
    });
    expect(exactWithEscapedNuls.length / 2).toBe(
      MAX_ORDERED_INDEX_KEY_BYTES_V1,
    );

    expect(() =>
      encodeAppOrderedIndexKeyV1({
        spec,
        values: [
          stringValue("a".repeat(2_038)),
          orderedIndexCreationTimeV1(1),
        ],
      })
    ).toThrow(OrderedIndexKeyTooLargeError);

    const valueField = requiredField(spec, 0);
    const creationField = requiredField(spec, 1);
    const fullEquality = compileAppOrderedIndexBoundsV1({
      spec,
      expressions: [
        { op: "eq", field: valueField, value: stringValue("a".repeat(2_037)) },
        { op: "eq", field: creationField, value: orderedIndexCreationTimeV1(1) },
      ],
    });
    expect(fullEquality.endExclusive?.length).toBe(
      MAX_ORDERED_INDEX_BOUND_BYTES_V1 * 2,
    );
    const endExclusive = fullEquality.endExclusive;
    if (endExclusive === undefined) {
      throw new Error("Expected a complete-key exclusive endpoint.");
    }
    expect(orderedIndexBoundHexV1ToBytes(endExclusive))
      .toHaveLength(MAX_ORDERED_INDEX_BOUND_BYTES_V1);
    expect(() =>
      encodeAppOrderedIndexKeyV1({
        spec,
        values: [
          stringValue("aa" + "\u0000".repeat(1_018)),
          orderedIndexCreationTimeV1(1),
        ],
      })
    ).toThrow(OrderedIndexKeyTooLargeError);
  });

  it("converts defensive byte and float representations", () => {
    const source = new Uint8Array([0x01, 0x00, 0xff]);
    const encoded = orderedIndexKeyBytesHexV1FromBytes(source);
    source[0] = 0xee;
    expect(encoded).toBe("0100ff");
    const decoded = orderedIndexKeyBytesHexV1ToBytes(encoded);
    decoded[0] = 0xaa;
    expect(orderedIndexKeyBytesHexV1ToBytes(encoded)).toEqual(
      new Uint8Array([0x01, 0x00, 0xff]),
    );

    const negativeZero = orderedIndexFloat64FromNumberV1(-0);
    expect(Object.is(orderedIndexFloat64ToNumberV1(negativeZero), -0)).toBe(true);

    const byteSource = new Uint8Array([0x00, 0x7f, 0xff]);
    const byteValue = orderedIndexBytesV1FromBytes(byteSource);
    byteSource[0] = 0xaa;
    expect(byteValue.hex).toBe("007fff");
    const byteCopy = orderedIndexBytesV1ToBytes(byteValue);
    byteCopy[0] = 0xbb;
    expect(orderedIndexBytesV1ToBytes(byteValue)).toEqual(
      new Uint8Array([0x00, 0x7f, 0xff]),
    );
  });

  it("rejects detached byte views instead of encoding them as empty", () => {
    const converters: ReadonlyArray<(value: Uint8Array) => unknown> = [
      orderedIndexBytesV1FromBytes,
      orderedIndexKeyBytesHexV1FromBytes,
      orderedIndexBoundHexV1FromBytes,
    ];

    for (const convert of converters) {
      const buffer = new ArrayBuffer(1);
      const bytes = new Uint8Array(buffer);
      structuredClone(buffer, { transfer: [buffer] });

      expect(() => convert(bytes)).toThrow(TypeError);
    }
  });

  it("encodes backing bytes instead of a caller-controlled iterator", () => {
    const bytes = new Uint8Array([0]);
    Object.defineProperty(bytes, Symbol.iterator, {
      value: () => [255][Symbol.iterator](),
    });

    expect([...bytes]).toEqual([255]);
    expect(orderedIndexKeyBytesHexV1FromBytes(bytes)).toBe("00");
  });
});

describe("app ordered keys, positions, and bounds v1", () => {
  it("encodes trusted creation time separately from the row identity", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("status"),
    );
    const encodedKey = encodeAppOrderedIndexKeyV1({
      spec,
      values: [stringValue("open"), orderedIndexCreationTimeV1(1)],
    });
    const rowId = orderedIndexRowIdFromBytesFixture(
      Uint8Array.from({ length: 16 }, (_, index) => index),
    );
    const decoded = decodeAppOrderedIndexKeyV1({ spec, encodedKey });

    expect(encodedKey).toBe("106f70656e000dbff0000000000000");
    expect(rowId).toBe("000102030405060708090a0b0c0d0e0f");
    expect(decoded).toEqual([
      stringValue("open"),
      orderedIndexCreationTimeV1(1),
    ]);
    expect(orderedIndexRowIdHexV1ToBytes(rowId)).toEqual(
      Uint8Array.from({ length: 16 }, (_, index) => index),
    );
  });

  it("decodes row identity bytes through one Result-first protocol owner", () => {
    const source = Uint8Array.from({ length: 16 }, (_, index) => index);
    const decoded = orderedIndexRowIdHexV1FromBytesResult(source);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toBe("000102030405060708090a0b0c0d0e0f");
    }

    const invalid = orderedIndexRowIdHexV1FromBytesResult(
      new Uint8Array(15),
    );
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toBeInstanceOf(OrderedIndexCodecV1InputError);
      expect(invalid.failure.issue).toEqual({
        reason: "invalidValue",
        path: "$rowId",
        detail: "row identity must contain exactly 16 bytes",
      });
    }
  });

  it("orders duplicate keys by the separate fixed row identity", () => {
    const key = encodeOrderedIndexComponentsV1([stringValue("same")]);
    const first = position(key, 0x01);
    const second = position(key, 0x02);
    const laterKey = position(
      encodeOrderedIndexComponentsV1([stringValue("z")]),
      0x00,
    );

    expect(compareOrderedIndexPositionsV1(first, second)).toBeLessThan(0);
    expect(compareOrderedIndexPositionsV1(second, first)).toBeGreaterThan(0);
    expect(compareOrderedIndexPositionsV1(second, laterKey)).toBeLessThan(0);
    expect(compareOrderedIndexKeysV1(first.encodedKey, first.encodedKey)).toBe(0);
  });

  it("supports intrinsic by_creation_time and direct by_id order", () => {
    const creationKey = encodeAppOrderedIndexKeyV1({
      spec: APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      values: [orderedIndexCreationTimeV1(123.5)],
    });
    const byIdKey = encodeAppOrderedIndexKeyV1({
      spec: APP_BY_ID_PHYSICAL_SPEC_V1,
      values: [],
    });

    expect(creationKey.length).toBe(18);
    expect(byIdKey).toBe("");
    expect(compareOrderedIndexPositionsV1(
      { encodedKey: byIdKey, rowId: position(byIdKey, 1).rowId },
      { encodedKey: byIdKey, rowId: position(byIdKey, 2).rowId },
    )).toBeLessThan(0);
  });

  it("builds equality and half-open inequality bounds in physical field order", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("userId", "score"),
    );
    const userField = requiredField(spec, 0);
    const scoreField = requiredField(spec, 1);
    const creationField = requiredField(spec, 2);
    const userPrefix = encodeOrderedIndexComponentsV1([stringValue("u1")]);

    expect(
      compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          { op: "eq", field: userField, value: stringValue("u1") },
        ],
      }),
    ).toEqual({
      startInclusive: userPrefix,
      endExclusive: `${userPrefix}16`,
    });

    const bounds = compileAppOrderedIndexBoundsV1({
      spec,
      expressions: [
        { op: "eq", field: userField, value: stringValue("u1") },
        { op: "gte", field: scoreField, value: int64(2n) },
        { op: "lt", field: scoreField, value: int64(10n) },
      ],
    });
    const inside = position(
      encodeAppOrderedIndexKeyV1({
        spec,
        values: [
          stringValue("u1"),
          int64(9n),
          orderedIndexCreationTimeV1(100),
        ],
      }),
      1,
    );
    const outside = position(
      encodeAppOrderedIndexKeyV1({
        spec,
        values: [
          stringValue("u1"),
          int64(10n),
          orderedIndexCreationTimeV1(100),
        ],
      }),
      1,
    );
    expect(orderedIndexPositionInBoundsV1(inside, bounds)).toBe(true);
    expect(orderedIndexPositionInBoundsV1(outside, bounds)).toBe(false);

    const creationBounds = compileAppOrderedIndexBoundsV1({
      spec,
      expressions: [
        { op: "eq", field: userField, value: stringValue("u1") },
        { op: "eq", field: scoreField, value: int64(9n) },
        {
          op: "lte",
          field: creationField,
          value: orderedIndexCreationTimeV1(100),
        },
      ],
    });
    expect(creationBounds.endExclusive).toBe(
      `${encodeOrderedIndexComponentsV1([
        stringValue("u1"),
        int64(9n),
        orderedIndexCreationTimeV1(100),
      ])}00`,
    );
  });

  it("keeps escaped value extensions outside exact equality intervals", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("value"),
    );
    const field = requiredField(spec, 0);
    const creationTime = orderedIndexCreationTimeV1(100);
    const cases: ReadonlyArray<readonly [
      OrderedIndexValueV1,
      OrderedIndexValueV1,
    ]> = [
      [stringValue("a"), stringValue("a\u0000")],
      [bytesValue(0x61), bytesValue(0x61, 0x00)],
      [objectValue(), objectValue(["", ORDERED_INDEX_NULL_V1])],
    ];

    for (const [exact, extension] of cases) {
      const exactPosition = position(encodeAppOrderedIndexKeyV1({
        spec,
        values: [exact, creationTime],
      }), 1);
      const extensionPosition = position(encodeAppOrderedIndexKeyV1({
        spec,
        values: [extension, creationTime],
      }), 2);
      const equality = compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [{ op: "eq", field, value: exact }],
      });
      const greaterThan = compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [{ op: "gt", field, value: exact }],
      });
      const lessThanOrEqual = compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [{ op: "lte", field, value: exact }],
      });

      expect(orderedIndexPositionInBoundsV1(exactPosition, equality)).toBe(true);
      expect(orderedIndexPositionInBoundsV1(extensionPosition, equality)).toBe(false);
      expect(orderedIndexPositionInBoundsV1(exactPosition, greaterThan)).toBe(false);
      expect(orderedIndexPositionInBoundsV1(extensionPosition, greaterThan)).toBe(true);
      expect(orderedIndexPositionInBoundsV1(exactPosition, lessThanOrEqual)).toBe(true);
      expect(orderedIndexPositionInBoundsV1(extensionPosition, lessThanOrEqual)).toBe(false);
    }
  });

  it("rejects invalid field/range ordering and creation-time values", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      logicalSpec("userId", "score"),
    );
    const userField = requiredField(spec, 0);
    const scoreField = requiredField(spec, 1);

    expect(() =>
      compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          { op: "eq", field: scoreField, value: int64(1n) },
        ],
      })
    ).toThrow(InvalidOrderedIndexRangeV1Error);

    expect(() =>
      Reflect.apply(compileAppOrderedIndexBoundsV1, undefined, [{
        spec,
        expressions: [{ op: "eq", field: null, value: stringValue("a") }],
      }])
    ).toThrow(InvalidOrderedIndexRangeV1Error);
    let rangeFieldGetterRead = false;
    const accessorField = {};
    Object.defineProperty(accessorField, "kind", {
      enumerable: true,
      get() {
        rangeFieldGetterRead = true;
        return "documentPath";
      },
    });
    expect(() =>
      Reflect.apply(compileAppOrderedIndexBoundsV1, undefined, [{
        spec,
        expressions: [{
          op: "eq",
          field: accessorField,
          value: stringValue("a"),
        }],
      }])
    ).toThrow(InvalidOrderedIndexRangeV1Error);
    expect(rangeFieldGetterRead).toBe(false);
    expect(() =>
      compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          { op: "gte", field: userField, value: stringValue("a") },
          { op: "eq", field: userField, value: stringValue("b") },
        ],
      })
    ).toThrow(InvalidOrderedIndexRangeV1Error);
    expect(() =>
      compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          { op: "gt", field: userField, value: stringValue("a") },
          { op: "gte", field: userField, value: stringValue("b") },
        ],
      })
    ).toThrow(InvalidOrderedIndexRangeV1Error);
    expect(() =>
      compileAppOrderedIndexBoundsV1({
        spec: APP_BY_ID_PHYSICAL_SPEC_V1,
        expressions: [
          { op: "eq", field: userField, value: stringValue("a") },
        ],
      })
    ).toThrow(InvalidOrderedIndexRangeV1Error);

    expect(() => orderedIndexCreationTimeV1(-1))
      .toThrow(OrderedIndexCodecV1InputError);
    expect(() => orderedIndexCreationTimeV1(0))
      .toThrow(OrderedIndexCodecV1InputError);
    expect(() => orderedIndexCreationTimeV1(-0))
      .toThrow(OrderedIndexCodecV1InputError);
    expect(() => orderedIndexCreationTimeV1(Number.NaN))
      .toThrow(OrderedIndexCodecV1InputError);
    expect(() => orderedIndexCreationTimeV1(2 ** 53))
      .toThrow(OrderedIndexCodecV1InputError);
    expect(orderedIndexCreationTimeV1((2 ** 53) - 1).kind).toBe("float64");
    expect(() =>
      encodeAppOrderedIndexKeyV1({
        spec,
        values: [stringValue("u1"), int64(1n), ORDERED_INDEX_MISSING_V1],
      })
    ).toThrow(OrderedIndexCodecV1InputError);
  });

});

function logicalSpec(
  ...fields: string[]
): SchemaManifestAppDeveloperOrderedIndexSpecV1 {
  return Schema.decodeUnknownSync(
    SchemaManifestAppDeveloperOrderedIndexSpecV1Schema,
    { onExcessProperty: "error" },
  )({
    kind: "developerOrdered",
    specVersion: 1,
    fields,
  });
}

function int64(value: bigint): OrderedIndexValueV1 {
  return { kind: "int64", value };
}

function floatBits(bits: bigint): OrderedIndexFloat64V1 {
  return orderedIndexFloat64FromBitsV1(bits);
}

function bool(value: boolean): OrderedIndexValueV1 {
  return { kind: "boolean", value };
}

function stringValue(value: string): OrderedIndexValueV1 {
  return { kind: "string", value };
}

function bytesValue(...values: number[]): OrderedIndexValueV1 {
  return orderedIndexBytesV1FromBytes(new Uint8Array(values));
}

function arrayValue(
  ...values: ReadonlyArray<OrderedIndexValueV1>
): OrderedIndexArrayV1 {
  return { kind: "array", value: values };
}

function objectValue(
  ...entries: ReadonlyArray<readonly [string, OrderedIndexValueV1]>
): OrderedIndexObjectV1 {
  return {
    kind: "object",
    entries: entries.map(([field, value]) => ({ field, value })),
  };
}

function wrapInArrays(
  value: OrderedIndexValueV1,
  levels: number,
): OrderedIndexValueV1 {
  let wrapped = value;
  for (let index = 0; index < levels; index += 1) {
    wrapped = { kind: "array", value: [wrapped] };
  }
  return wrapped;
}

function position(
  encodedKey: OrderedIndexKeyHexV1,
  finalByte: number,
): OrderedIndexPositionV1 {
  const rowId = new Uint8Array(16);
  rowId[15] = finalByte;
  return {
    encodedKey,
    rowId: orderedIndexRowIdFromBytesFixture(rowId),
  };
}

function orderedIndexRowIdFromBytesFixture(
  value: Uint8Array,
): OrderedIndexRowIdHexV1 {
  return Result.getOrThrow(orderedIndexRowIdHexV1FromBytesResult(value));
}

function requiredField(
  spec: AppOrderedIndexPhysicalSpecV1,
  index: number,
): AppOrderedIndexPhysicalFieldV1 {
  const field = spec.orderedFields[index];
  if (field === undefined) throw new Error(`Missing physical field ${index}.`);
  return field;
}

function expectTerminalCodecError(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(
      error instanceof OrderedIndexCodecV1InputError ||
        error instanceof OrderedIndexKeyTooLargeError,
    ).toBe(true);
    return;
  }
  throw new Error("Expected a terminal ordered-index codec error.");
}
