import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import {
  captureProductSchema,
  productSchemaInput,
  productModels,
} from "../src/product-schema";
import { normalizeRelationalSchema } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { authenticateStoredRelationalSchemaArtifactEffect } from "../../persistence-postgres/src/relationalSchema/artifact";

const compiled = () =>
  JSON.parse(JSON.stringify(compileDmlSchema([...productModels]))) as unknown;

describe("actual Product schema", () => {
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
