import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { customerModuleModels } from "@medusajs/customer/static-manifest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "flarex-protocol/internal/logical-storage-requirements";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";

describe("complete native Customer schema prerequisites", () => {
  it("retains both active Boolean unique constraints across the complete genuine four-model closure", async () => {
    const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema(customerModuleModels)))));
    expect(checked.tables.map(table => table.name).toSorted()).toEqual([
      "customer", "customer_address", "customer_group", "customer_group_customer",
    ]);
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "customer-schema-prerequisite")));
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.customer-schema-prerequisite", owner: "medusa",
      writeProfile: "customer-schema-prerequisite", evidence: { kind: "synthetic", sourceId: "native-customer-schema-prerequisite" },
      definition: { kind: "relational", schema }, bindings: checked.tables.map(table => ({ kind: "definition", localName: table.name,
        table: { namespace: "medusa", logicalName: "customer-schema-prerequisite/" + table.name } })) }));
    const ordered = Result.getOrThrow(compileLogicalSourceIndexes(source));
    const unique = Result.getOrThrow(compileLogicalSourceUniqueConstraints(source));
    const booleanUnique = unique.filter(item => item.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals");
    expect(booleanUnique).toHaveLength(2);
    expect(booleanUnique.map(item => item.physicalSpec.predicate)).toEqual([
      { kind: "fieldIsNullAndBooleanEquals", nullField: "deleted_at", booleanField: "is_default_billing", value: true },
      { kind: "fieldIsNullAndBooleanEquals", nullField: "deleted_at", booleanField: "is_default_shipping", value: true },
    ]);
    for (const item of booleanUnique) {
      expect(item.localName).toBe("customer_address");
      expect(item.physicalSpec.orderedFields).toEqual(["customer_id"]);
      expect(ordered.find(index => index.localName === item.localName && index.descriptor === item.descriptor)?.physicalSpec.predicate)
        .toEqual(item.physicalSpec.predicate);
    }
  });
});
