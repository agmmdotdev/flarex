import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { compilePromotionDefinition } from "../src/modules/promotion/schema";
import { prepareLogicalRelationalRead } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery";

it("represents the native inclusive Campaign start boundary without losing equality", async () => {
  const definition = await Effect.runPromise(compilePromotionDefinition());
  const campaign = definition.schema.tables.find(table => table.identity.tableId === "promotion_campaign");
  expect(campaign).toBeDefined();
  if (campaign === undefined) return;
  const now = "2026-10-29T10:00:00.000Z";
  const result = prepareLogicalRelationalRead(campaign, definition.schema.capabilities, {
    order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
      { kind: "isNull", column: "deleted_at" }, { kind: "or", children: [
        { kind: "lessThan", column: "starts_at", value: now },
        { kind: "in", column: "starts_at", values: [now] },
      ] },
    ] },
  }, 256, reason => ({ reason }));
  expect(Result.isSuccess(result), Result.isFailure(result) ? JSON.stringify(result.failure) : "").toBe(true);
});
