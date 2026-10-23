import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileOrderDefinition, captureOrderMetadata } from "../src/modules/order/schema";
import { prepareLogicalRelationalRows } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalRows";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

describe("native Order generated serial selection", () => {
  it("retains preservation by default and the original missing-value refusal", async () => {
    const metadata = await Effect.runPromise(captureOrderMetadata());
    expect(metadata.frame.tables.find(table => table.name === "order_change_action")?.columns.find(column => column.name === "ordering"))
      .toMatchObject({ type: "serial", nullable: false });
    const definition = await Effect.runPromise(compileOrderDefinition()), table = definition.schema.tables.find(table => table.identity.tableId === "order_change_action");
    if (table === undefined) throw new Error("Missing native Order Change Action");
    const rows = Result.getOrThrow(prepareLogicalRelationalRows(table, definition.schema.capabilities, (reason, cause) => commerceError("unsupportedProfile", { reason, cause })));
    const normalized = rows.normalize({ id: "ordchact_refund", order_id: "order_refund", order_change_id: "ordch_refund", action: "CREDIT_LINE_ADD",
      amount: "3.125", raw_amount: { value: "3.125", precision: 20 }, version: 2 }, null, "2026-10-23T00:00:00.000Z");
    expect(Result.isFailure(normalized)).toBe(true);
    expect(table.columns.find(column => column.identity.columnId === "ordering")?.default).toEqual({ kind: "none" });
    const generated = await Effect.runPromise(compileOrderDefinition("generate"));
    expect(generated.schema.tables.find(table => table.identity.tableId === "order_change_action")?.columns
      .find(column => column.identity.columnId === "ordering")?.default).toEqual({ kind: "serialNext" });
  });
});
