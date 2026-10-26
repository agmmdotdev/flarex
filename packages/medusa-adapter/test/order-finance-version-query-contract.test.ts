import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { logicalCommerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { compileLogicalRelationalRead } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery";
import { captureOrderMetadata, compileOrderDefinition } from "../src/modules/order/schema";
import { prepareOrderFinanceRepository } from "../src/modules/order/finance-repository";

/** Actual native selector through the corrected shared owner. The original
 * refusal is preserved separately; no replacement evaluator lives here. */
describe("native Order summary version selector prerequisite", () => {
  it("admits the indexed native parent cohort and its typed numeric version conjunct", async () => {
    const metadata = await Effect.runPromise(captureOrderMetadata());
    const definition = await Effect.runPromise(compileOrderDefinition("generate"));
    const prepared = Result.getOrThrow(prepareOrderFinanceRepository(metadata.frame));
    const entity = Result.getOrThrow(prepared.contracts.entity("order_summary"));
    const table = definition.schema.tables.find(table => table.identity.tableId === "order_summary");
    if (table === undefined) throw new Error("Missing actual native Order Summary schema");
    expect(table.columns.find(column => column.identity.columnId === "version")?.type).toBe("doublePrecision");
    const compile = (filters: object) => {
      const plan = Result.getOrThrow(prepared.query(entity.table, buildQuery(filters, {})));
      return compileLogicalRelationalRead(table, definition.schema.capabilities, plan.query, 4, logicalCommerceError);
    };
    expect(compile({ order_id: ["order-finance"] })).toMatchObject({ _tag: "Success" });
    expect(compile({ order_id: ["order-finance"], version: 1 }))
      .toMatchObject({ _tag: "Success" });
  });
});
