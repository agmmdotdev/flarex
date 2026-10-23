import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/framework/utils/portable";
import { fulfillmentModuleModels } from "@medusajs/fulfillment/static-manifest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compileLogicalSourceUniqueConstraints } from "flarex-protocol/internal/logical-storage-requirements";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { compileStockLocationDefinition } from "../src/modules/stock-location/schema";

describe("native one-to-one uniqueness through logical lowering", () => {
  it("retains the neutral active unique reference and distinct NULL policy through physical requirements", async () => {
    const Owner = model.define("NeutralOwner", {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, { mappedBy: "owner" }).nullable(),
    });
    const Target = model.define("NeutralTarget", {
      id: model.id().primaryKey(),
      owner: model.hasOne(() => Owner, { mappedBy: "target" }),
    });
    const compiled = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema([Owner, Target])))));
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(compiled.tables, "neutral-one-to-one")));
    const owner = schema.tables.find(table => table.identity.tableId === "neutral_owner");
    expect(owner?.indexes).toContainEqual(expect.objectContaining({
      kind: "uniqueBtree", columns: [expect.objectContaining({ columnId: "target_id" })],
      predicate: { kind: "isNull", column: expect.objectContaining({ columnId: "deleted_at" }) },
    }));
    const source = await Effect.runPromise(captureLogicalSchemaSource({
      key: "neutral.one-to-one", owner: "medusa", writeProfile: "neutral.one-to-one",
      evidence: { kind: "synthetic", sourceId: "neutral-native-one-to-one" },
      definition: { kind: "relational", schema }, bindings: compiled.tables.map(table => ({
        kind: "definition", localName: table.name,
        table: { namespace: "medusa", logicalName: "neutral-one-to-one/" + table.name },
      })),
    }));
    expect(Result.getOrThrow(compileLogicalSourceUniqueConstraints(source)).filter(requirement =>
      requirement.localName === "neutral_owner" && requirement.physicalSpec.orderedFields.some(field => field === "target_id")))
      .toMatchObject([{ physicalSpec: {
        orderedFields: ["target_id"], nullsDistinct: true,
        predicate: { kind: "fieldIsNull", field: "deleted_at" },
      } }]);
  });

  it("compiles the genuine Stock Location address active unique index on its owner", async () => {
    const definition = await Effect.runPromise(compileStockLocationDefinition());
    const stock = definition.schema.tables.find(table => table.identity.tableId === "stock_location");
    const address = definition.schema.tables.find(table => table.identity.tableId === "stock_location_address");
    expect(stock?.indexes).toContainEqual(expect.objectContaining({
      identity: expect.objectContaining({ indexId: "stock_location_address_id_unique" }),
      kind: "uniqueBtree", columns: [expect.objectContaining({ columnId: "address_id" })],
      predicate: { kind: "isNull", column: expect.objectContaining({ columnId: "deleted_at" }) },
    }));
    expect(stock?.columns.find(column => column.identity.columnId === "address_id"))
      .toMatchObject({ nullable: true });
    expect(address?.indexes.filter(index => index.kind === "uniqueBtree")).toEqual([]);
  });

  it("leaves genuine Fulfillment provider and address owning hasOneWithFK references nonunique", () => {
    const fulfillment = compileDmlSchema(fulfillmentModuleModels).tables.find(table => table.name === "fulfillment");
    for (const column of ["provider_id", "delivery_address_id"])
      expect(fulfillment?.indexes.filter(index => index.columns.includes(column)))
        .toEqual([expect.objectContaining({ columns: [column], unique: false })]);
  });
});
