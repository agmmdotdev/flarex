import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { makeLocalSalesChannelCommands } from "../src/modules/sales-channel/service";
import { decodeSalesChannelCartRead, decodeSalesChannelCartReadArguments } from "../src/modules/sales-channel/cart-read-input";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let runtime: Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>;
const row = (): JsonObject => ({ id: "sc_cart", name: "Native channel", description: null, is_disabled: false,
  metadata: { nested: { keep: true } }, created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null });
const receipt = (): Call => ({ commandName: "salesChannelRetrieve", mode: "read", input: { id: "sc_cart" }, result: row(), events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const evidence = (): Activity => ({ mutations: [], lifecycle: [], setNull: [], referenceReplacements: [],
  observedRows: [{ table: "sales_channel", row: { ...row(), _id: "private-incarnation", _creationTime: 1 } }],
  relationalReads: [{ table: "sales_channel", query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
    predicate: { kind: "and", children: [
      { kind: "and", children: [{ kind: "in", column: "id", values: ["sc_cart"] }] },
      { kind: "isNull", column: "deleted_at" },
    ] } }, total: 1, returned: 1 }] });
const validate = (call: Call, activity: Activity, command: CommerceCommand = runtime.retrieve) => {
  const policy = workflowModuleDefinition(runtime.cartReadWorkflow)?.logical;
  if (policy === undefined) throw new Error("Missing Cart Sales Channel read policy");
  return policy.validateLogicalCall(call, activity, command);
};
const refused = async (call: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => { runtime = await Effect.runPromise(makeLocalSalesChannelCommands()); });

describe("Cart native Sales Channel point-read admission", () => {
  it("admits one ID with omitted config and validates every native DML field", () => {
    expect(Result.getOrThrow(decodeSalesChannelCartReadArguments(["sc_cart"]))).toEqual(["sc_cart"]);
    for (const args of [[], [""], [["sc_cart"]], [{ id: "sc_cart" }], ["sc_cart", {}], ["sc_cart", undefined]])
      expect(Result.isFailure(decodeSalesChannelCartReadArguments(args))).toBe(true);
    for (const input of [{ id: ["sc_cart"] }, { id: "sc_cart", config: {} }, { id: "sc_cart", extra: true }])
      expect(Result.isFailure(decodeSalesChannelCartRead(input))).toBe(true);
    const method = workflowMethodDefinition(runtime.cartReadWorkflow.methods.retrieveSalesChannel);
    if (method === undefined) throw new Error("Missing native retrieve binding");
    expect(Result.getOrThrow(method.input(["sc_cart"]))).toEqual({ id: "sc_cart" });
    expect(Result.getOrThrow(method.output(row()))).toEqual(row());
    const incomplete = { ...row() }; delete incomplete.description;
    for (const output of [incomplete, { ...row(), is_disabled: "false" }, { ...row(), extra: true }, { ...row(), _id: "private" }])
      expect(Result.isFailure(method.output(output))).toBe(true);
  });

  it("binds the sole complete observed row to the actual unique-ID query", async () => {
    await Effect.runPromise(validate(receipt(), evidence()));
    const changed = { ...row(), is_disabled: true };
    await Effect.runPromise(validate({ ...receipt(), result: changed }, { ...evidence(), observedRows: [{ table: "sales_channel", row: changed }] }));
    await refused({ ...receipt(), input: { id: "other" } }, evidence());
    await refused({ ...receipt(), result: { ...row(), id: "other" } }, evidence());
    await refused({ ...receipt(), result: { ...row(), metadata: null } }, evidence());
    await refused(receipt(), { ...evidence(), observedRows: [{ table: "sales_channel", row: { ...row(), id: "other" } }] });
    await refused(receipt(), { ...evidence(), observedRows: [{ table: "other_module", row: row() }] });
    await refused(receipt(), { ...evidence(), observedRows: [] });
    await refused(receipt(), { ...evidence(), observedRows: [...evidence().observedRows, ...evidence().observedRows] });
    const incomplete = { ...row() }; delete incomplete.created_at;
    for (const value of [incomplete, { ...row(), is_disabled: "false" }, { ...row(), unknown: true }, { ...row(), deleted_at: "deleted" }])
      await refused(receipt(), { ...evidence(), observedRows: [{ table: "sales_channel", row: value }] });
  });

  it("refuses different query, predicate, table, page, total or selected count", async () => {
    const selected = evidence().relationalReads[0];
    if (selected === undefined) throw new Error("Missing read fixture");
    for (const changes of [{ table: "other_module" }, { total: 0 }, { total: 2 }, { returned: 0 }, { returned: 2 },
      { query: {} }, { query: { take: 1, predicate: { kind: "and", children: [] } } },
      { query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: ["sc_cart", "other"] } } }])
      await refused(receipt(), { ...evidence(), relationalReads: [{ ...selected, ...changes }] });
    await refused(receipt(), { ...evidence(), relationalReads: [] });
    await refused(receipt(), { ...evidence(), relationalReads: [selected, selected] });
  });

  it("confines command identity and forbids events and every mutation category", async () => {
    const lookalike = defineCommerceCommand("salesChannelRetrieve", "read", () => Effect.succeed(row()));
    for (const command of [runtime.list, runtime.create, lookalike])
      expect(await Effect.runPromise(Effect.result(validate(receipt(), evidence(), command))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    await refused({ ...receipt(), events: [{ forged: true }] }, evidence());
    await refused({ ...receipt(), input: { id: "sc_cart", config: {} } }, evidence());
    await refused(receipt(), { ...evidence(), mutations: [{ ordinal: 0, table: "sales_channel", operation: "patch", before: row(), after: row() }] });
    await refused(receipt(), { ...evidence(), lifecycle: [{ table: "sales_channel", operation: "restore", key: { id: "sc_cart" },
      beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: row() }] });
    await refused(receipt(), { ...evidence(), setNull: [{ sourceTable: "sales_channel", sourceColumn: "id", targetTable: "other", targetColumn: "id", targetKey: "other", managedUpdate: "advance" }] });
    await refused(receipt(), { ...evidence(), referenceReplacements: [{ sourceTable: "sales_channel", sourceColumn: "id", targetTable: "other", targetColumn: "id", targetKey: "other", desiredKeys: [] }] });
    const policy = workflowModuleDefinition(runtime.cartReadWorkflow)?.logical;
    if (policy === undefined) throw new Error("Missing policy");
    expect(await Effect.runPromise(Effect.result(policy.capture({ forged: true }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });
});
