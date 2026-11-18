import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { paymentModels, capturePaymentMetadata, compilePaymentDefinition } from "../src/modules/payment/schema";

describe("native Payment schema admission", () => {
  it("preserves native Session and AccountHolder object defaults through shared schema admission", async () => {
    const source = compileDmlSchema([...paymentModels]);
    const session = source.tables.find(table => table.name === "payment_session");
    expect(session?.columns.find(column => column.name === "data")).toMatchObject({ type: "json", nullable: false, defaultValue: {} });
    expect(source.tables.map(table => table.name)).toEqual(expect.arrayContaining(["payment_collection", "payment_session", "payment_provider"]));
    const metadata = await Effect.runPromise(capturePaymentMetadata());
    expect(metadata.frame.tables).toHaveLength(9);
    const definition = await Effect.runPromise(compilePaymentDefinition());
    for (const name of ["payment_session", "account_holder"]) expect(definition.schema.tables.find(table => table.identity.tableId === name)
      ?.columns.find(column => column.identity.columnId === "data")).toMatchObject({ type: "jsonb", nullable: false, default: { kind: "emptyJsonObject" } });
  });
});
