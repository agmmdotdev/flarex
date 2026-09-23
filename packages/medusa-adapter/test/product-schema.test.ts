import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { captureProductSchema } from "../src/product-schema";
import { compileProductDefinition, productSchemaInput, productModels } from "../src/product-definition";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from
  "flarex-protocol/internal/logical-storage-requirements";
import {
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { authenticateStoredRelationalSchemaArtifactEffect } from "../../persistence-postgres/src/relationalSchema/artifact";
import { prepareLogicalRelationalRows, relationalTextIdentity } from "../../persistence-postgres/src/logicalDocuments/relationalRows";

const compiled = () =>
  JSON.parse(JSON.stringify(compileDmlSchema([...productModels]))) as unknown;

describe("actual Product schema", () => {
  it("lowers every pinned Product key and index into shared logical definitions", async () => {
    const { indexes, unique } = await Effect.runPromise(Effect.gen(function* () {
      const product = yield* compileProductDefinition();
      const source = yield* captureLogicalSchemaSource({
        key: "medusa.product", owner: "medusa", writeProfile: "medusa.product",
        evidence: product.provenance, definition: { kind: "relational", schema: product.schema },
        bindings: product.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${product.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      });
      return { indexes: yield* Effect.fromResult(compileLogicalSourceIndexes(source)),
        unique: yield* Effect.fromResult(compileLogicalSourceUniqueConstraints(source)) };
    }));
    expect(indexes).toHaveLength(56);
    expect(unique).toHaveLength(24);
    const rank = indexes.find(index => index.localName === "image" &&
      index.descriptor === "index/IDX_product_image_rank");
    expect(rank?.physicalSpec.orderedFields[0]).toMatchObject({ kind: "documentPath", path: "rank" });
    expect(indexes.some(index => index.localName === "product" && index.descriptor === "index/product.active"))
      .toBe(true);
    expect(unique.find(constraint => constraint.localName === "product" &&
      constraint.descriptor === "index/IDX_product_handle_unique"))
      .toMatchObject({ physicalSpec: { predicate: { kind: "fieldIsNull", field: "deleted_at" } } });
  });

  it("captures all ten entities and three physical pivots without inventing pivot identities", async () => {
    const captured = await Effect.runPromise(
      captureProductSchema("product-schema-test"),
    );
    // Approved module-lineage rebaseline: commerce.product. The complete
    // canonical artifact remains pinned, including all models and pivots.
    expect(captured.artifact.identity.lineageId).toBe("commerce.product");
    expect(createHash("sha256").update(captured.artifact.canonicalJson).digest("hex"))
      .toBe("cfbe80cbf3c487dcb18b6af7019c7ffb8b9adc23d1b2984bd1fd7e6eaabf8d86");
    expect(captured.schema.tables).toHaveLength(13);
    const restored = await Effect.runPromise(
      authenticateStoredRelationalSchemaArtifactEffect(captured.artifact),
    );
    expect(restored.schema).toEqual(captured.schema);
    expect(restored.artifact.canonicalJson).toBe(
      captured.artifact.canonicalJson,
    );
    expect(productModels).toHaveLength(10);
    const pivots = captured.schema.tables.filter(
      (table) => !table.keys.some((key) => key.kind === "primary"),
    );
    expect(pivots.map((table) => table.identity.tableId)).toEqual([
      "product_category_product",
      "product_tags",
      "product_variant_option",
    ]);
    for (const pivot of pivots) {
      expect(pivot.columns).toHaveLength(2);
      expect(pivot.keys).toHaveLength(1);
      expect(pivot.keys[0]).toMatchObject({ kind: "unique" });
      expect(Result.getOrThrow(relationalTextIdentity(pivot, reason => new Error(reason))))
        .toEqual(pivot.keys[0]?.columns.map(column => column.columnId));
      for (const column of pivot.keys[0]?.columns ?? []) expect(pivot.keys.some(key => key.columns[0]?.columnId === column.columnId) ||
        pivot.indexes.some(index => index.predicate === null && index.columns[0]?.columnId === column.columnId)).toBe(true);
      // Identity selection is ready, but its declared FKs still keep Product
      // serving closed until shared relation enforcement is admitted.
      expect(Result.isFailure(prepareLogicalRelationalRows(pivot, captured.schema.capabilities,
        reason => new Error(reason)))).toBe(true);
      expect(pivot.constraints).toHaveLength(2);
      expect(
        pivot.constraints.every(
          (constraint) =>
            constraint.kind === "foreignKey" &&
            constraint.onDelete === "cascade",
        ),
      ).toBe(true);
    }
    const explicit = captured.schema.tables.find(
      (table) => table.identity.tableId === "product_variant_product_image",
    );
    expect(explicit?.columns.map((column) => column.identity.columnId)).toEqual(
      [
        "created_at",
        "deleted_at",
        "id",
        "image_id",
        "updated_at",
        "variant_id",
      ],
    );
    expect(explicit?.keys).toHaveLength(1);
    expect(explicit?.keys[0]?.kind).toBe("primary");
    const product = captured.schema.tables.find(
      (table) => table.identity.tableId === "product",
    );
    expect(
      product?.columns.find((column) => column.identity.columnId === "status"),
    ).toMatchObject({
      type: "text",
      default: { kind: "textLiteral", value: "draft" },
    });
    expect(
      product?.constraints.find((constraint) => constraint.kind === "textSet"),
    ).toMatchObject({ values: ["draft", "proposed", "published", "rejected"] });
    expect(
      product?.indexes.find(
        (index) => index.identity.indexId === "IDX_product_handle_unique",
      ),
    ).toMatchObject({
      kind: "uniqueBtree",
      columns: [{ columnId: "handle" }],
      predicate: { kind: "isNull", column: { columnId: "deleted_at" } },
    });
    expect(Object.isFrozen(captured.metadata.frame.tables)).toBe(true);
    expect(
      captured.metadata.frame.tables
        .find((table) => table.name === "product")
        ?.columns.find((column) => column.name === "title")?.options,
    ).toMatchObject({ translatable: true });
  });

  it("is deterministic across model, column, relationship and index enumeration order", async () => {
    const ordinary = compileDmlSchema([...productModels]);
    const reversed = compileDmlSchema([...productModels].reverse());
    for (const table of reversed.tables) {
      table.columns.reverse();
      table.indexes.reverse();
      table.relationships.reverse();
      table.foreignKeys.reverse();
    }
    const normalize = (value: unknown) =>
      Effect.flatMap(productSchemaInput(value), (input) =>
        Effect.fromResult(normalizeRelationalSchema(input)),
      );
    expect(
      await Effect.runPromise(normalize(JSON.parse(JSON.stringify(reversed)))),
    ).toEqual(
      await Effect.runPromise(normalize(JSON.parse(JSON.stringify(ordinary)))),
    );
  });

  it("rejects incomplete, unsupported and malformed foreign compiler output", async () => {
    const candidates = [
      null,
      { tables: [] },
      { tables: [{ name: "product" }] },
    ];
    for (const candidate of candidates)
      expect(
        Result.isFailure(
          await Effect.runPromise(Effect.result(productSchemaInput(candidate))),
        ),
      ).toBe(true);
    const actual = compileDmlSchema([...productModels]);
    const product = actual.tables.find((table) => table.name === "product");
    if (product === undefined || product.indexes[0] === undefined)
      throw new Error("Missing Product fixture");
    product.indexes[0].where = "true; drop table product";
    expect(
      Result.isFailure(
        await Effect.runPromise(
          Effect.result(productSchemaInput(JSON.parse(JSON.stringify(actual)))),
        ),
      ),
    ).toBe(true);
    expect(
      Result.isSuccess(
        await Effect.runPromise(Effect.result(productSchemaInput(compiled()))),
      ),
    ).toBe(true);
  });

  it("rejects missing endpoints, nullable pivot keys and invalid enum defaults in the shared contract", async () => {
    const normalize = (value: unknown) =>
      Effect.flatMap(productSchemaInput(value), (input) =>
        Effect.fromResult(normalizeRelationalSchema(input)),
      );
    const missingEndpoint = compileDmlSchema([...productModels]);
    const endpoint = missingEndpoint.tables.find(
      (table) => table.name === "product_variant",
    )?.foreignKeys[0];
    if (endpoint === undefined) throw new Error("Missing Product foreign key");
    endpoint.referencedTable = "missing_product";
    const nullablePivot = compileDmlSchema([...productModels]);
    const pivotColumn = nullablePivot.tables.find(
      (table) => table.name === "product_tags",
    )?.columns[0];
    if (pivotColumn === undefined) throw new Error("Missing pivot column");
    pivotColumn.nullable = true;
    const invalidDefault = compileDmlSchema([...productModels]);
    const status = invalidDefault.tables
      .find((table) => table.name === "product")
      ?.columns.find((column) => column.name === "status");
    if (status === undefined) throw new Error("Missing status column");
    status.defaultValue = "unsupported";
    for (const candidate of [missingEndpoint, nullablePivot, invalidDefault]) {
      expect(
        Result.isFailure(
          await Effect.runPromise(
            Effect.result(normalize(JSON.parse(JSON.stringify(candidate)))),
          ),
        ),
      ).toBe(true);
    }
  });

  it("does not admit Currency numeric features through the Product decoder", async () => {
    const numeric = compileDmlSchema([...productModels]);
    const raw = compileDmlSchema([...productModels]);
    const numericColumn = numeric.tables[0]?.columns[0];
    const rawColumn = raw.tables[0]?.columns[0];
    if (numericColumn === undefined || rawColumn === undefined) throw new Error("Missing Product column");
    numericColumn.type = "bigNumber";
    rawColumn.type = "json";
    rawColumn.defaultValue = { value: "0", precision: 20 };
    for (const candidate of [numeric, raw]) {
      const result = await Effect.runPromise(Effect.result(productSchemaInput(JSON.parse(JSON.stringify(candidate)))));
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "ProductSchemaError" } });
    }
  });
});
