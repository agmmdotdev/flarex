import { Result } from "effect";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

// @ts-expect-error Relational schema values must remain absent from the root.
import type { RelationalSchema as RootRelationalSchema } from "../src";
import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import { RelationalSchemaError } from
  "../src/relationalSchema/errors";
import type {
  RelationalColumnId,
  RelationalPersistenceCapabilityId,
  RelationalSchema,
  RelationalTableId,
} from "../src/relationalSchema/model";
import {
  MAX_RELATIONAL_SCHEMA_DECODE_UNITS,
  normalizeRelationalSchema,
} from
  "../src/relationalSchema/policy";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type PublicRelationalSchemaExport = Extract<
  keyof typeof import("../src"),
  | `${string}RelationalSchema${string}`
  | `${string}relationalSchema${string}`
  | `${string}RELATIONAL_SCHEMA${string}`
>;

type PlainStringIsRelationalIdentity = string extends
  RelationalTableId | RelationalColumnId | RelationalPersistenceCapabilityId
  ? true
  : false;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private relational schema values", () => {
  it("remains private, nominally typed, and Result-based", () => {
    expectTypeOf<PublicRelationalSchemaExport>().toEqualTypeOf<never>();
    expectTypeOf<PlainStringIsRelationalIdentity>().toEqualTypeOf<false>();
    expectTypeOf<RelationalTableId>().not.toMatchTypeOf<RelationalColumnId>();
    expectTypeOf<RelationalColumnId>()
      .not.toMatchTypeOf<RelationalPersistenceCapabilityId>();
    expectTypeOf<ReturnType<typeof normalizeRelationalSchema>>()
      .toEqualTypeOf<Result.Result<RelationalSchema, RelationalSchemaError>>();
    const unsupported = RelationalSchemaError.unsupportedCapability(
      "$.owner",
      "payload",
    );
    if (unsupported.reason === "unsupportedCapability") {
      expectTypeOf(unsupported.capability).toEqualTypeOf<string>();
    }
    const invalid = RelationalSchemaError.invalidInput("$.owner");
    if (invalid.reason === "invalidInput") {
      expectTypeOf(invalid.capability).toEqualTypeOf<undefined>();
    }
  });

  it("normalizes the exact Currency storage facts without treating search as an index", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];

    expect(schema.coordinate).toEqual({
      owner: "medusa",
      lineageId: "commerce",
    });
    expect(table?.identity.tableId).toBe("currency");
    expect(table?.columns.map(column => [
      column.identity.columnId,
      column.type,
      column.nullable,
      column.default.kind,
      column.origin.kind,
    ])).toEqual([
      ["code", "text", false, "none", "authored"],
      ["created_at", "timestamptz", false, "currentTimestamp", "implicit"],
      ["decimal_digits", "integer", false, "integerLiteral", "authored"],
      ["deleted_at", "timestamptz", true, "none", "implicit"],
      ["name", "text", false, "none", "authored"],
      ["raw_rounding", "jsonb", false, "exactNumericRawLiteral", "derived"],
      ["rounding", "numeric", false, "exactNumericLiteral", "authored"],
      ["symbol", "text", false, "none", "authored"],
      ["symbol_native", "text", false, "none", "authored"],
      ["updated_at", "timestamptz", false, "currentTimestamp", "implicit"],
    ]);
    expect(table?.keys).toHaveLength(1);
    expect(table?.keys[0]).toMatchObject({
      kind: "primary",
      columns: [{ columnId: "code" }],
    });
    expect(table?.keys[0]?.columns.some(column => column.columnId === "id"))
      .toBe(false);
    expect(table?.indexes).toMatchObject([{
      kind: "btree",
      columns: [{ columnId: "deleted_at" }],
      predicate: { kind: "isNull", column: { columnId: "deleted_at" } },
    }]);
    expect(table?.indexes.some(index =>
      index.columns.some(column =>
        column.columnId === "code" || column.columnId === "name"
      )
    )).toBe(false);
    const column = (columnId: string) => table?.columns.find(
      candidate => candidate.identity.columnId === columnId,
    );
    expect(column("decimal_digits")?.default).toEqual({
      kind: "integerLiteral",
      value: 0,
    });
    expect(column("rounding")?.default).toEqual({
      kind: "exactNumericLiteral",
      value: "0",
    });
    expect(column("raw_rounding")).toMatchObject({
      nullable: false,
      default: {
        kind: "exactNumericRawLiteral",
        value: "0",
        precision: 20,
      },
      origin: {
        kind: "derived",
        sourceId: "dml.big-number.raw_rounding",
      },
    });
    expect(schema.capabilities.map(capability => capability.kind)).toEqual([
      "exactNumericCompanion",
      "searchableText",
      "softDelete",
      "managedTimestamps",
    ]);
    expect(schema.capabilities).toMatchObject([
      {
        kind: "exactNumericCompanion",
        numericColumn: { tableId: "currency", columnId: "rounding" },
        rawColumn: { tableId: "currency", columnId: "raw_rounding" },
      },
      {
        kind: "searchableText",
        columns: [
          { tableId: "currency", columnId: "code" },
          { tableId: "currency", columnId: "name" },
        ],
      },
      {
        kind: "softDelete",
        deletedAtColumn: { tableId: "currency", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "currency", indexId: "currency.active" },
      },
      {
        kind: "managedTimestamps",
        createdAtColumn: { tableId: "currency", columnId: "created_at" },
        updatedAtColumn: { tableId: "currency", columnId: "updated_at" },
        updateBehavior: "currentTimestampOnUpdate",
      },
    ]);
  });

  it("admits the synthetic key, index, check, foreign-key, and relationship vocabulary", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(syntheticInput()));
    const child = schema.tables.find(table => table.identity.tableId === "child");
    const parent = schema.tables.find(table => table.identity.tableId === "parent");

    expect(parent?.keys.map(key => key.kind)).toEqual(["primary", "unique"]);
    expect(child?.indexes).toMatchObject([
      {
        kind: "btree",
        columns: [{ columnId: "alternate_parent_id" }],
        predicate: null,
      },
      {
        kind: "btree",
        columns: [{ columnId: "parent_id" }],
        predicate: null,
      },
    ]);
    expect(child?.constraints.map(constraint => constraint.kind)).toEqual([
      "foreignKey",
      "integerRange",
      "foreignKey",
    ]);
    expect(child?.relationships).toMatchObject([
      {
        kind: "manyToOne",
        foreignKey: { constraintId: "child.alternate-parent" },
      },
      {
        kind: "manyToOne",
        foreignKey: { constraintId: "child.parent" },
      },
    ]);
  });

  it("classifies composite relationship cardinality by unique column set", () => {
    const schema = Result.getOrThrow(
      normalizeRelationalSchema(compositeRelationshipInput()),
    );
    const child = schema.tables.find(table => table.identity.tableId === "child");
    expect(child?.relationships).toMatchObject([{
      kind: "oneToOne",
      foreignKey: { constraintId: "child.parent" },
    }]);

    const wrongCardinality = compositeRelationshipInput();
    Reflect.set(
      wrongCardinality.tables[0]?.relationships[0] ?? {},
      "kind",
      "manyToOne",
    );
    expectInvalid(
      wrongCardinality,
      "$.tables[child].relationships[child.parent]",
    );
  });

  it("couples exact numeric companion nullability", () => {
    const nullable = currencyInput();
    const nullableColumns = nullable.tables[0]?.columns ?? [];
    Reflect.set(
      nullableColumns.find(column => column.columnId === "rounding") ?? {},
      "nullable",
      true,
    );
    Reflect.set(
      nullableColumns.find(column => column.columnId === "raw_rounding") ?? {},
      "nullable",
      true,
    );
    expect(Result.isSuccess(normalizeRelationalSchema(nullable))).toBe(true);

    const mismatched = currencyInput();
    Reflect.set(
      mismatched.tables[0]?.columns.find(
        column => column.columnId === "rounding",
      ) ?? {},
      "nullable",
      true,
    );
    expectInvalid(mismatched, "$.capabilities[currency.exact-number]");
  });

  it("admits only PostgreSQL text and integer literal values", () => {
    for (const value of [-2_147_483_648, 2_147_483_647]) {
      expect(Result.isSuccess(
        normalizeRelationalSchema(minimalIntegerInput(value)),
      )).toBe(true);
    }
    const negativeZero = Result.getOrThrow(
      normalizeRelationalSchema(minimalIntegerInput(-0)),
    );
    const normalizedNegativeZero = negativeZero.tables[0]?.columns[0]?.default;
    expect(normalizedNegativeZero).toEqual({
      kind: "integerLiteral",
      value: 0,
    });
    if (normalizedNegativeZero?.kind === "integerLiteral") {
      expect(Object.is(normalizedNegativeZero.value, -0)).toBe(false);
    }

    expectInvalid(
      minimalIntegerInput(-2_147_483_649),
      "$.tables[0].columns[0].default.value",
    );
    expectInvalid(
      minimalIntegerInput(2_147_483_648),
      "$.tables[0].columns[0].default.value",
    );

    const nulText = minimalInput();
    Reflect.set(nulText.tables[0]?.columns[0] ?? {}, "default", {
      kind: "textLiteral",
      value: "not\0postgres",
    });
    expectInvalid(nulText, "$.tables[0].columns[0].default.value");

    const rangeViolation = syntheticInput();
    const ordinal = rangeViolation.tables[0]?.columns.find(
      column => column.columnId === "ordinal",
    );
    Reflect.set(ordinal ?? {}, "default", { kind: "integerLiteral", value: -1 });
    expectInvalid(
      rangeViolation,
      "$.tables[child].constraints[child.ordinal-range].column",
    );
  });

  it("enforces the aggregate decode budget at its exact boundary", () => {
    expect(MAX_RELATIONAL_SCHEMA_DECODE_UNITS).toBe(16_000);
    expect(Result.isSuccess(
      normalizeRelationalSchema(aggregateBudgetInput(false)),
    )).toBe(true);
    const overflow = normalizeRelationalSchema(aggregateBudgetInput(true));
    expect(Result.isFailure(overflow)).toBe(true);
    if (Result.isFailure(overflow)) {
      expect(overflow.failure).toMatchObject({
        _tag: "RelationalSchemaError",
        operation: "normalize",
        reason: "invalidInput",
      });
    }
  });

  it("canonicalizes unordered definitions, searchable members, and provenance paths", async () => {
    const firstInput = currencyInput();
    const secondInput = currencyInput();
    secondInput.tables.reverse();
    secondInput.tables[0]?.columns.reverse();
    secondInput.tables[0]?.keys.reverse();
    secondInput.tables[0]?.indexes.reverse();
    secondInput.capabilities.reverse();
    const searchable = secondInput.capabilities.find(
      capability => capability.kind === "searchableText",
    );
    searchable?.columns?.reverse();

    const first = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: firstInput,
      provenance: currencyProvenance(),
    }));
    const secondProvenance = currencyProvenance();
    secondProvenance.paths.reverse();
    const second = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: secondInput,
      provenance: secondProvenance,
    }));

    expect(second.schema).toEqual(first.schema);
    expect(second.artifact.canonicalJson).toBe(first.artifact.canonicalJson);
    expect(second.artifact.identity.artifactSha256).toBe(
      first.artifact.identity.artifactSha256,
    );

    const firstSyntheticInput = syntheticInput();
    const secondSyntheticInput = syntheticInput();
    secondSyntheticInput.tables.reverse();
    for (const table of secondSyntheticInput.tables) {
      table.columns.reverse();
      table.keys.reverse();
      table.indexes.reverse();
      table.constraints.reverse();
      table.relationships.reverse();
    }
    const firstSynthetic = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: firstSyntheticInput,
      provenance: { kind: "synthetic", fixtureId: "definition-order" },
    }));
    const secondSynthetic = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: secondSyntheticInput,
      provenance: { kind: "synthetic", fixtureId: "definition-order" },
    }));
    expect(secondSynthetic.schema).toEqual(firstSynthetic.schema);
    expect(secondSynthetic.artifact.canonicalJson).toBe(
      firstSynthetic.artifact.canonicalJson,
    );
    expect(secondSynthetic.artifact.identity.artifactSha256).toBe(
      firstSynthetic.artifact.identity.artifactSha256,
    );
  });

  it("composes one fixed framework artifact codec and derives required capabilities", async () => {
    const captured = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: currencyInput(),
      provenance: currencyProvenance(),
    }));

    expect(captured.artifact.identity).toMatchObject({
      deploymentId: "deployment-main",
      owner: "medusa",
      lineageId: "commerce",
    });
    expect(captured.artifact.codec).toEqual({
      format: "flarex.relational-schema",
      version: 1,
    });
    expect(captured.artifact.provenance).toEqual({
      kind: "sourceSnapshot",
      repository: "https://github.com/agmmdotdev/medusa-fork.git",
      revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
      paths: [
        "packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts",
        "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts",
        "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
        "packages/modules/currency/src/models/currency.ts",
      ],
    });
    expect(captured.artifact.payload).toEqual(captured.schema);
    expect(captured.artifact.capabilities).toContain(
      "relational-schema.persistence.searchableText",
    );
    expect(captured.artifact.capabilities).toContain(
      "relational-schema.index-predicate.isNull",
    );
    expect(captured.artifact.capabilities).not.toContain(
      "relational-schema.relationship.manyToMany",
    );
  });

  it("pins the minimal outer canonical frame and SHA-256 compatibility vector", async () => {
    const captured = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      schema: minimalInput(),
      provenance: { kind: "synthetic", fixtureId: "golden" },
    }));

    expect(captured.artifact.canonicalJson).toBe(GOLDEN_CANONICAL_JSON);
    expect(captured.artifact.identity.artifactSha256).toBe(GOLDEN_SHA256);
  });

  it("detaches and recursively freezes every retained schema value", () => {
    const input = currencyInput();
    const schema = Result.getOrThrow(normalizeRelationalSchema(input));
    input.tables.reverse();
    input.tables[0]?.columns.reverse();
    input.capabilities.reverse();

    expect(schema.tables[0]?.identity.tableId).toBe("currency");
    expect(schema.tables[0]?.columns[0]?.identity.columnId).toBe("code");
    expect(schema.capabilities[0]?.identity.capabilityId)
      .toBe("currency.exact-number");
    expectDeeplyFrozen(schema);
  });

  it("rejects unsupported owners, types, relationships, and actions deterministically", () => {
    const payload = minimalInput();
    Reflect.set(payload, "owner", "payload");
    expectUnsupported(payload, "$.owner", "payload");

    const malformedOwner = minimalInput();
    Reflect.set(malformedOwner, "owner", 42);
    expectInvalid(malformedOwner, "$.owner");

    const booleanColumn = minimalInput();
    Reflect.set(booleanColumn.tables[0]?.columns[0] ?? {}, "type", "boolean");
    expectUnsupported(booleanColumn, "$.tables[0].columns[0].type", "boolean");

    const malformedColumnType = minimalInput();
    Reflect.set(malformedColumnType.tables[0]?.columns[0] ?? {}, "type", null);
    expectInvalid(malformedColumnType, "$.tables[0].columns[0].type");

    const pivot = syntheticInput();
    Reflect.set(
      pivot.tables[0]?.relationships[0] ?? {},
      "kind",
      "manyToMany",
    );
    expectUnsupported(
      pivot,
      "$.tables[0].relationships[0].kind",
      "manyToMany",
    );

    const cascade = syntheticInput();
    Reflect.set(cascade.tables[0]?.constraints[0] ?? {}, "onDelete", "cascade");
    expectUnsupported(
      cascade,
      "$.tables[0].constraints[0].onDelete",
      "cascade",
    );
  });

  it("rejects duplicate identities, dangling references, and invalid physical semantics", () => {
    const duplicateColumn = minimalInput();
    const firstColumn = duplicateColumn.tables[0]?.columns[0];
    if (firstColumn === undefined) throw new Error("Fixture lost its column.");
    duplicateColumn.tables[0]?.columns.push({ ...firstColumn });
    expectInvalid(duplicateColumn, "$.tables[only].columns");

    const danglingForeignKey = syntheticInput();
    const foreignKey = danglingForeignKey.tables[0]?.constraints[0];
    const target = foreignKey?.targetColumns?.[0];
    if (target === undefined) throw new Error("Fixture lost its foreign key.");
    Reflect.set(target, "tableId", "missing");
    expectInvalid(
      danglingForeignKey,
      "$.tables[child].constraints[child.parent].targetColumns",
    );

    const nullablePrimary = minimalInput();
    Reflect.set(nullablePrimary.tables[0]?.columns[0] ?? {}, "nullable", true);
    expectInvalid(nullablePrimary, "$.tables[only].keys[only.primary]");

    const mismatchedDefault = minimalInput();
    Reflect.set(mismatchedDefault.tables[0]?.columns[0] ?? {}, "default", {
      kind: "integerLiteral",
      value: 0,
    });
    expectInvalid(mismatchedDefault, "$.tables[only].columns[id].default");
  });

  it("rejects malformed records and provenance before artifact hashing", async () => {
    const extraRoot = minimalInput();
    Reflect.set(extraRoot, "format", "caller-controlled");
    expectInvalid(extraRoot, "$");

    const accessor = minimalInput();
    Object.defineProperty(accessor.tables[0]?.columns[0] ?? {}, "type", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectInvalid(accessor, "$.tables[0].columns[0]");

    const duplicatePaths = currencyProvenance();
    duplicatePaths.paths.push(duplicatePaths.paths[0] ?? "missing");
    const failure = await runEffectFailure(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: currencyInput(),
      provenance: duplicatePaths,
    }));
    expect(failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.paths",
    });

    const unsupportedProvenance = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: { kind: "future-source" },
      }),
    );
    expect(unsupportedProvenance).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "unsupportedCapability",
      path: "$.provenance.kind",
      capability: "future-source",
    });

    const malformedProvenance = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: { kind: 42 },
      }),
    );
    expect(malformedProvenance).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.kind",
    });

    let lengthReads = 0;
    let synthesizedIndexReads = 0;
    const changingLengthPaths = new Proxy<string[]>([], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads <= 2 ? 0 : 2;
        }
        return Reflect.get(target, property, receiver);
      },
      ownKeys() {
        return ["length"];
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === "0" || property === "1") {
          synthesizedIndexReads += 1;
          return {
            configurable: true,
            enumerable: true,
            value: `path-${property}`,
            writable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const changingLengthFailure = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: {
          kind: "sourceSnapshot",
          repository: "repo",
          revision: "revision",
          paths: changingLengthPaths,
        },
      }),
    );
    expect(changingLengthFailure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.paths",
    });
    expect(lengthReads).toBe(0);
    expect(synthesizedIndexReads).toBe(0);
  });

  it("delegates hashing failures to the existing framework artifact boundary", async () => {
    vi.stubGlobal("crypto", undefined);
    const failure = await runEffectFailure(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      schema: minimalInput(),
      provenance: { kind: "synthetic", fixtureId: "hash-failure" },
    }));

    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "capture",
      reason: "resourceFailure",
      message: "Framework schema artifact SHA-256 failed",
    });
  });
});

const GOLDEN_CANONICAL_JSON =
  '{"capabilities":["relational-schema","relational-schema.column.text",' +
  '"relational-schema.key.primary"],"dependencies":[],' +
  '"deploymentId":"deployment-a","format":"flarex.framework-schema-artifact",' +
  '"lineageId":"relational-core","owner":"system","payload":{' +
  '"capabilities":[],"coordinate":{"lineageId":"relational-core",' +
  '"owner":"system"},"format":"flarex.relational-schema","tables":[{' +
  '"columns":[{"default":{"kind":"none"},"identity":{"columnId":"id",' +
  '"lineageId":"relational-core","owner":"system","tableId":"only"},' +
  '"nullable":false,"origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table.id"},"type":"text"}],"constraints":[],' +
  '"identity":{"lineageId":"relational-core","owner":"system",' +
  '"tableId":"only"},"indexes":[],"keys":[{"columns":[{' +
  '"columnId":"id","lineageId":"relational-core","owner":"system",' +
  '"tableId":"only"}],"identity":{"keyId":"only.primary",' +
  '"lineageId":"relational-core","owner":"system","tableId":"only"},' +
  '"kind":"primary","origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table.primary"}}],"origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table"},"relationships":[]}],"version":1},' +
  '"payloadCodec":{"format":"flarex.relational-schema","version":1},' +
  '"provenance":{"fixtureId":"golden","kind":"synthetic"},"version":1}';
const GOLDEN_SHA256 =
  "4a71c9b158b5978f10858cd093a70f2bbd7b69919f504022888a10890362ce8b";

function minimalInput() {
  return {
    owner: "system",
    lineageId: "relational-core",
    tables: [{
      tableId: "only",
      origin: synthetic("golden.table"),
      columns: [{
        columnId: "id",
        type: "text",
        nullable: false,
        default: { kind: "none" },
        origin: synthetic("golden.table.id"),
      }],
      keys: [{
        keyId: "only.primary",
        kind: "primary",
        columns: ["id"],
        origin: synthetic("golden.table.primary"),
      }],
      indexes: [],
      constraints: [],
      relationships: [],
    }],
    capabilities: [],
  };
}

function minimalIntegerInput(value: number) {
  const input = minimalInput();
  Reflect.set(input.tables[0]?.columns[0] ?? {}, "type", "integer");
  Reflect.set(input.tables[0]?.columns[0] ?? {}, "default", {
    kind: "integerLiteral",
    value,
  });
  return input;
}

function compositeRelationshipInput() {
  return {
    owner: "system",
    lineageId: "composite-cardinality",
    tables: [
      {
        tableId: "child",
        origin: synthetic("composite.child"),
        columns: [
          scalarColumn("id", "text", synthetic("composite.child.id")),
          scalarColumn(
            "left_ref",
            "text",
            synthetic("composite.child.left_ref"),
          ),
          scalarColumn(
            "right_ref",
            "text",
            synthetic("composite.child.right_ref"),
          ),
        ],
        keys: [
          primaryKey("child.primary", ["id"], "fixture.child.primary"),
          {
            keyId: "child.parent-pair",
            kind: "unique",
            columns: ["right_ref", "left_ref"],
            origin: synthetic("composite.child.parent-pair"),
          },
        ],
        indexes: [],
        constraints: [{
          constraintId: "child.parent",
          kind: "foreignKey",
          sourceColumns: ["left_ref", "right_ref"],
          targetColumns: [
            { tableId: "parent", columnId: "left" },
            { tableId: "parent", columnId: "right" },
          ],
          onDelete: "restrict",
          onUpdate: "restrict",
          origin: synthetic("composite.child.parent"),
        }],
        relationships: [{
          relationshipId: "child.parent",
          kind: "oneToOne",
          foreignKeyConstraintId: "child.parent",
          origin: synthetic("composite.child.parent-relation"),
        }],
      },
      {
        tableId: "parent",
        origin: synthetic("composite.parent"),
        columns: [
          scalarColumn("id", "text", synthetic("composite.parent.id")),
          scalarColumn("left", "text", synthetic("composite.parent.left")),
          scalarColumn("right", "text", synthetic("composite.parent.right")),
        ],
        keys: [
          primaryKey("parent.primary", ["id"], "fixture.parent.primary"),
          {
            keyId: "parent.pair",
            kind: "unique",
            columns: ["right", "left"],
            origin: synthetic("composite.parent.pair"),
          },
        ],
        indexes: [],
        constraints: [],
        relationships: [],
      },
    ],
    capabilities: [],
  };
}

function aggregateBudgetInput(overflow: boolean) {
  const tables: unknown[] = [];
  for (let tableIndex = 0; tableIndex < 31; tableIndex += 1) {
    const tableId = `budget-${String(tableIndex).padStart(2, "0")}`;
    const indexCount = tableIndex === 0 && !overflow ? 255 : 256;
    const columns: unknown[] = [
      scalarColumn("id", "text", synthetic(`${tableId}.id`)),
    ];
    if (tableIndex === 0) {
      columns.push(
        timestampColumn("created_at", false, "currentTimestamp", tableId),
        timestampColumn("updated_at", false, "currentTimestamp", tableId),
      );
    }
    const indexes: unknown[] = [];
    for (let index = 0; index < indexCount; index += 1) {
      indexes.push({
        indexId: `${tableId}.index-${String(index).padStart(3, "0")}`,
        kind: "btree",
        columns: ["id"],
        predicate: null,
        origin: synthetic(`${tableId}.index-${String(index)}`),
      });
    }
    tables.push({
      tableId,
      origin: synthetic(tableId),
      columns,
      keys: [primaryKey(
        `${tableId}.primary`,
        ["id"],
        `fixture.${tableId}.primary`,
      )],
      indexes,
      constraints: [],
      relationships: [],
    });
  }
  const capabilities: unknown[] = [{
    capabilityId: "budget.timestamps",
    kind: "managedTimestamps",
    createdAtColumn: { tableId: "budget-00", columnId: "created_at" },
    updatedAtColumn: { tableId: "budget-00", columnId: "updated_at" },
    updateBehavior: "currentTimestampOnUpdate",
    origin: implicit("budget.timestamps"),
  }];
  return {
    owner: "system",
    lineageId: "aggregate-budget",
    tables,
    capabilities,
  };
}

function syntheticInput() {
  return {
    owner: "system",
    lineageId: "relational-core",
    tables: [
      {
        tableId: "child",
        origin: synthetic("fixture.child"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.child.id")),
          scalarColumn(
            "parent_id",
            "text",
            synthetic("fixture.child.parent_id"),
          ),
          scalarColumn(
            "alternate_parent_id",
            "text",
            synthetic("fixture.child.alternate_parent_id"),
          ),
          {
            columnId: "ordinal",
            type: "integer",
            nullable: false,
            default: { kind: "integerLiteral", value: 0 },
            origin: synthetic("fixture.child.ordinal"),
          },
        ],
        keys: [
          primaryKey("child.primary", ["id"], "fixture.child.primary"),
          {
            keyId: "child.parent-ordinal",
            kind: "unique",
            columns: ["parent_id", "ordinal"],
            origin: synthetic("fixture.child.parent-ordinal"),
          },
        ],
        indexes: [
          {
            indexId: "child.parent-lookup",
            kind: "btree",
            columns: ["parent_id"],
            predicate: null,
            origin: synthetic("fixture.child.parent-lookup"),
          },
          {
            indexId: "child.alternate-lookup",
            kind: "btree",
            columns: ["alternate_parent_id"],
            predicate: null,
            origin: synthetic("fixture.child.alternate-lookup"),
          },
        ],
        constraints: [
          {
            constraintId: "child.parent",
            kind: "foreignKey",
            sourceColumns: ["parent_id"],
            targetColumns: [{ tableId: "parent", columnId: "id" }],
            onDelete: "restrict",
            onUpdate: "restrict",
            origin: synthetic("fixture.child.parent"),
          },
          {
            constraintId: "child.alternate-parent",
            kind: "foreignKey",
            sourceColumns: ["alternate_parent_id"],
            targetColumns: [{ tableId: "parent", columnId: "id" }],
            onDelete: "restrict",
            onUpdate: "restrict",
            origin: synthetic("fixture.child.alternate-parent"),
          },
          {
            constraintId: "child.ordinal-range",
            kind: "integerRange",
            columnId: "ordinal",
            minimum: 0,
            maximum: null,
            origin: synthetic("fixture.child.ordinal-range"),
          },
        ],
        relationships: [
          {
            relationshipId: "child.parent",
            kind: "manyToOne",
            foreignKeyConstraintId: "child.parent",
            origin: synthetic("fixture.child.parent-relation"),
          },
          {
            relationshipId: "child.alternate-parent",
            kind: "manyToOne",
            foreignKeyConstraintId: "child.alternate-parent",
            origin: synthetic("fixture.child.alternate-parent-relation"),
          },
        ],
      },
      {
        tableId: "parent",
        origin: synthetic("fixture.parent"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.parent.id")),
          scalarColumn("slug", "text", synthetic("fixture.parent.slug")),
        ],
        keys: [
          primaryKey("parent.primary", ["id"], "fixture.parent.primary"),
          {
            keyId: "parent.slug",
            kind: "unique",
            columns: ["slug"],
            origin: synthetic("fixture.parent.slug"),
          },
        ],
        indexes: [],
        constraints: [],
        relationships: [],
      },
    ],
    capabilities: [],
  };
}

function currencyInput() {
  const modelSource =
    "packages/modules/currency/src/models/currency.ts#currency";
  const implicitSource =
    "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts";
  return {
    owner: "medusa",
    lineageId: "commerce",
    tables: [{
      tableId: "currency",
      origin: authored(modelSource),
      columns: [
        scalarColumn("code", "text", authored(`${modelSource}.code`)),
        scalarColumn("symbol", "text", authored(`${modelSource}.symbol`)),
        scalarColumn(
          "symbol_native",
          "text",
          authored(`${modelSource}.symbol_native`),
        ),
        scalarColumn("name", "text", authored(`${modelSource}.name`)),
        {
          columnId: "decimal_digits",
          type: "integer",
          nullable: false,
          default: { kind: "integerLiteral", value: 0 },
          origin: authored(`${modelSource}.decimal_digits`),
        },
        {
          columnId: "rounding",
          type: "numeric",
          nullable: false,
          default: { kind: "exactNumericLiteral", value: "0" },
          origin: authored(`${modelSource}.rounding`),
        },
        {
          columnId: "raw_rounding",
          type: "jsonb",
          nullable: false,
          default: {
            kind: "exactNumericRawLiteral",
            value: "0",
            precision: 20,
          },
          origin: derived("dml.big-number.raw_rounding"),
        },
        timestampColumn("created_at", false, "currentTimestamp", implicitSource),
        timestampColumn("updated_at", false, "currentTimestamp", implicitSource),
        timestampColumn("deleted_at", true, "none", implicitSource),
      ],
      keys: [primaryKey(
        "currency.primary",
        ["code"],
        `${modelSource}.code.primaryKey`,
      )],
      indexes: [{
        indexId: "currency.active",
        kind: "btree",
        columns: ["deleted_at"],
        predicate: { kind: "isNull", columnId: "deleted_at" },
        origin: implicit("dml.deleted_at.active-index"),
      }],
      constraints: [],
      relationships: [],
    }],
    capabilities: [
      {
        capabilityId: "currency.searchable",
        kind: "searchableText",
        columns: [
          { tableId: "currency", columnId: "code" },
          { tableId: "currency", columnId: "name" },
        ],
        origin: authored(`${modelSource}.searchable`),
      },
      {
        capabilityId: "currency.exact-number",
        kind: "exactNumericCompanion",
        numericColumn: { tableId: "currency", columnId: "rounding" },
        rawColumn: { tableId: "currency", columnId: "raw_rounding" },
        origin: derived("dml.big-number.companion"),
      },
      {
        capabilityId: "currency.timestamps",
        kind: "managedTimestamps",
        createdAtColumn: { tableId: "currency", columnId: "created_at" },
        updatedAtColumn: { tableId: "currency", columnId: "updated_at" },
        updateBehavior: "currentTimestampOnUpdate",
        origin: implicit("dml.managed-timestamps"),
      },
      {
        capabilityId: "currency.soft-delete",
        kind: "softDelete",
        deletedAtColumn: { tableId: "currency", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "currency", indexId: "currency.active" },
        origin: implicit("dml.soft-delete"),
      },
    ],
  };
}

function currencyProvenance() {
  return {
    kind: "sourceSnapshot",
    repository: "https://github.com/agmmdotdev/medusa-fork.git",
    revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
    paths: [
      "packages/modules/currency/src/models/currency.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts",
    ],
  };
}

function scalarColumn(
  columnId: string,
  type: string,
  origin: Readonly<{ kind: string; sourceId: string }>,
) {
  return {
    columnId,
    type,
    nullable: false,
    default: { kind: "none" },
    origin,
  };
}

function timestampColumn(
  columnId: string,
  nullable: boolean,
  defaultKind: string,
  sourceId: string,
) {
  return {
    columnId,
    type: "timestamptz",
    nullable,
    default: { kind: defaultKind },
    origin: implicit(`${sourceId}#${columnId}`),
  };
}

function primaryKey(keyId: string, columns: string[], sourceId: string) {
  return {
    keyId,
    kind: "primary",
    columns,
    origin: sourceId.startsWith("fixture.")
      ? synthetic(sourceId)
      : authored(sourceId),
  };
}

function authored(sourceId: string) {
  return { kind: "authored", sourceId };
}

function derived(sourceId: string) {
  return { kind: "derived", sourceId };
}

function implicit(sourceId: string) {
  return { kind: "implicit", sourceId };
}

function synthetic(sourceId: string) {
  return { kind: "synthetic", sourceId };
}

function expectInvalid(input: unknown, path: string): void {
  const result = normalizeRelationalSchema(input);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "normalize",
      reason: "invalidInput",
      path,
      retryable: false,
    });
  }
}

function expectUnsupported(
  input: unknown,
  path: string,
  capability: string,
): void {
  const result = normalizeRelationalSchema(input);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "normalize",
      reason: "unsupportedCapability",
      path,
      capability,
      retryable: false,
    });
  }
}

function expectDeeplyFrozen(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  expect(Object.isFrozen(input)).toBe(true);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeeplyFrozen(descriptor.value);
    }
  }
}
