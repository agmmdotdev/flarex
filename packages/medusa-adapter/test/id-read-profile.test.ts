import { Effect, Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareIdReadRepository } from "../src/repository/id-read";
import { ScalarIdRead } from "../src/repository/scalar-id-read";
import { commerceDecoder } from "../src/value/decoder";
import { commerceRelationReadQuery, type CommerceRelation } from "../src/query/relations";
import type { SchemaColumn, SchemaTable } from "../src/schema/model";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const column = (name: string, nullable = false): SchemaColumn => ({ name, type: name === "id" ? "id" : "text", nullable,
  primaryKey: name === "id", generated: false });
const table = (name: string, extra: readonly SchemaColumn[] = []): SchemaTable => ({ name,
  columns: [column("id"), ...extra, column("deleted_at", true)], indexes: [], foreignKeys: [] });
const records = table("record", [column("owner_id", true)]), owners = table("owner");
const decodeRead = commerceDecoder(ScalarIdRead, "invalidInput");
const decodeOwnerRead = commerceDecoder(Schema.Struct({ ...ScalarIdRead.fields,
  config: Schema.optionalKey(Schema.Struct({ ...ScalarIdRead.fields.config.schema.fields,
    relations: Schema.optionalKey(Schema.Array(Schema.Literal("owner")).check(Schema.isMaxLength(1))),
  })),
}), "invalidInput");
type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];

it("accepts the native all-fields producer's own undefined option members", () => {
  const prepared = Result.getOrThrow(prepareIdReadRepository(records, "Record", [records], new Map(), [], "recordRead"));
  const input = buildQuery({ id: "record-key" }, { take: 256, skip: 0 });
  expect(Object.hasOwn(input.options, "fields")).toBe(true);
  expect(input.options.fields).toBeUndefined();
  expect(Result.isSuccess(prepared.query(input))).toBe(true);
  expect(Result.isFailure(prepared.query({ ...input, options: { ...input.options, fields: null } }))).toBe(true);
});

it("keeps the four-row default while admitting an explicitly bounded larger cohort", async () => {
  const prepare = (maximumRows?: number) => prepareIdReadRepository(records, "Record", [records], new Map(), [], "recordRead",
    maximumRows === undefined ? undefined : { maximumRows, hasManyPaths: [], decodeRead });
  const ordinary = Result.getOrThrow(prepare()), selected = Result.getOrThrow(prepare(200));
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: "r" + index, owner_id: null, deleted_at: null }));
  const input = { filters: { id: rows.map(row => row.id) }, config: { select: ["id"] } };
  const plan = Result.getOrThrow(selected.query({ where: input.filters, options: { fields: ["id"], populate: [] } }));
  const call: Call = { commandName: "recordRead", mode: "read", input, result: [rows.map(row => ({ id: row.id })), 5], events: [],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { observedRows: rows.map(row => ({ table: records.name, row })),
    relationalReads: [{ table: records.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 5, returned: 5 }],
    mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
  await Effect.runPromise(selected.policy.validateLogicalCall(call, activity));
  expect(await Effect.runPromise(Effect.result(ordinary.policy.validateLogicalCall(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  for (const maximum of [0, 257, Number.NaN]) expect(Result.isFailure(prepare(maximum))).toBe(true);
});

it("authenticates nullable belongs-to population using the owning FK and target primary key", async () => {
  const relation: CommerceRelation = { name: "owner", targetTable: owners.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
    join: { type: "belongsTo", foreignKeys: ["owner_id"] } };
  const relations = new Map([[records.name, new Map([["owner", relation]])]]);
  const prepared = Result.getOrThrow(prepareIdReadRepository(records, "Record", [records, owners], relations, [], "recordRead",
    { maximumRows: 200, hasManyPaths: [], belongsToPaths: ["owner"], decodeRead: decodeOwnerRead }));
  expect(Result.isFailure(prepareIdReadRepository(records, "Record", [records, owners], relations, [], "recordRead"))).toBe(true);
  for (const ownerId of ["separate-owner", null]) {
    const row = { id: "record-key", owner_id: ownerId, deleted_at: null }, owner = { id: "separate-owner", deleted_at: null };
    const plan = Result.getOrThrow(prepared.query({ where: { id: row.id }, options: { fields: ["id"], populate: ["owner"] } }));
    const rootRead = { table: records.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 };
    const targetRead = { table: owners.name, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
      { kind: "in", column: "id", values: [owner.id] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 };
    const call: Call = { commandName: "recordRead", mode: "read", input: { filters: { id: row.id }, config: { select: ["id"], relations: ["owner"] } },
      result: [[{ id: row.id, owner: ownerId === null ? null : owner }], 1], events: [],
      fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    const activity: Activity = { observedRows: [{ table: records.name, row }, ...(ownerId === null ? [] : [{ table: owners.name, row: owner }])],
      relationalReads: [rootRead, ...(ownerId === null ? [] : [targetRead])], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(prepared.policy.validateLogicalCall(call, activity));
    const forged = { ...activity, relationalReads: [rootRead, { ...targetRead, query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "and", children: [{ kind: "in", column: "id", values: [row.id] }, { kind: "isNull", column: "deleted_at" }] }) }] };
    expect(await Effect.runPromise(Effect.result(prepared.policy.validateLogicalCall(call, forged))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  }
});
