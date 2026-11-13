import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { checkoutLinkReadPolicy } from "../src/links/checkout-link-read-receipt";
import { prepareLinkRepository } from "../src/links/repository";
import { linkLogicalEventPolicy } from "../src/links/events";
import type { SchemaTable } from "../src/schema/model";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const table: SchemaTable = { name: "neutral_pair", columns: [
  { name: "id", type: "text", nullable: false, primaryKey: false },
  { name: "left_id", type: "text", nullable: false, primaryKey: true },
  { name: "right_id", type: "text", nullable: false, primaryKey: true },
  { name: "created_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "updated_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "deleted_at", type: "dateTime", nullable: true, primaryKey: false },
], indexes: [], foreignKeys: [] };

it("keeps the default four-row Link receipt limit while accepting an explicit bounded cohort", async () => {
  const repository = Result.getOrThrow(prepareLinkRepository(table, "neutral"));
  const plan = Result.getOrThrow(repository.readPlan(buildQuery({}, { take: 256, skip: 0,
    select: ["id", "left_id", "right_id", "created_at", "updated_at", "deleted_at"], relations: [] }), 256));
  const base = linkLogicalEventPolicy(table.name, "neutralPair", "NeutralPair", ["left_id", "right_id"]);
  const make = (maximum?: number) => checkoutLinkReadPolicy(table, ["left_id", "right_id"], "neutralPairRead", "NeutralPair.validateRead", base,
    () => Result.succeed({ plan, includes: () => true }), maximum);
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: "row" + index, left_id: "left" + index, right_id: "right" + index,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null }));
  const call: Parameters<LogicalCallReceiptValidation>[0] = { commandName: "neutralPairRead", mode: "read", input: {}, result: [rows, 5],
    events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Parameters<LogicalCallReceiptValidation>[1] = { mutations: [], lifecycle: [], setNull: [], referenceReplacements: [],
    observedRows: rows.map(row => ({ table: table.name, row })),
    relationalReads: [0, 1].map(() => ({ table: table.name, query: plan.query, total: rows.length, returned: rows.length })) };
  expect(await Effect.runPromise(Effect.result(Result.getOrThrow(make()).validateLogicalCall(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  await Effect.runPromise(Result.getOrThrow(make(200)).validateLogicalCall(call, activity));
  for (const maximum of [0, 257, NaN, 1.5]) expect(Result.isFailure(make(maximum))).toBe(true);
});
