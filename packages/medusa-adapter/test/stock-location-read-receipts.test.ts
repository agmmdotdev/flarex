import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { workflowModuleDefinition } from "../src/workflow/module";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Runtime = Effect.Success<ReturnType<typeof makeStockLocationCommands>>;
const instant = "2026-10-17T00:00:00.000Z";
const location = (id: string) => ({ id, name: "Warehouse " + id, metadata: null, address_id: null,
  created_at: instant, updated_at: instant, deleted_at: null });
const evidence = (rows: Activity["observedRows"]): Activity =>
  ({ observedRows: rows, mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (input: Call["input"], result: Call["result"]): Call => ({ commandName: "stockLocationCount", mode: "read",
  input, result, events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const args = (ids: string[]): Call["input"] => ({ filters: { id: ids }, config: { select: ["id"], relations: [],
  order: { id: "ASC" }, skip: 0, take: 8 } });
const validate = (runtime: Runtime, receipt: Call, activity: Activity) => {
  const policy = workflowModuleDefinition(runtime.workflow)?.logical;
  if (policy === undefined) throw new Error("Missing genuine Stock Location logical policy");
  return policy.validateLogicalCall(receipt, activity, runtime.count);
};

for (const admission of ["read", "create"] as const) describe("Stock Location " + admission + " ID-read receipt", () => {
  let runtime: Runtime;
  beforeAll(async () => { runtime = await Effect.runPromise(makeStockLocationCommands(admission)); });

  it("refuses a forged existing ID that was not selected by the actual ID query", async () => {
    const receipt = call(args(["selected"]), [[{ id: "other-existing" }], 1]);
    const activity = evidence([{ table: "stock_location", row: location("selected") }]);
    expect(await Effect.runPromise(Effect.result(validate(runtime, receipt, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

it("refuses fabricated matching IDs and count when the actual requested ID was absent", async () => {
    const receipt = call(args(["absent"]), [[{ id: "absent" }], 1]);
    // This forged tuple would satisfy the unchanged native existence guard.
    expect(await Effect.runPromise(Effect.result(validate(runtime, receipt, evidence([])))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("refuses a forged count around an authentic selected ID", async () => {
    const receipt = call(args(["selected"]), [[{ id: "selected" }], 2]);
    const activity = evidence([{ table: "stock_location", row: location("selected") }]);
    expect(await Effect.runPromise(Effect.result(validate(runtime, receipt, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("authenticates complete observed bodies, scalar projections, ID order and pagination count", async () => {
    const a = location("a"), b = location("b"), c = location("c");
    const activity = evidence([c, a, b].map(row => ({ table: "stock_location", row })));
    const receipt = call({ filters: { id: ["c", "b", "a", "b"] },
      config: { select: ["id", "name"], order: { id: "DESC" }, skip: 1, take: 1 } },
      [[{ id: "b", name: b.name }], 3]);
    await Effect.runPromise(validate(runtime, receipt, activity));
    const forgedResults: Call["result"][] = [
      [[{ id: "a", name: a.name }], 3],
      [[{ id: "b", name: "Forged" }], 3],
      [[{ id: "b" }], 3],
      [[{ id: "b", name: b.name, metadata: null }], 3],
      [[{ id: "b", name: b.name }], 1],
      [[], 3],
    ];
    for (const result of forgedResults) expect(await Effect.runPromise(Effect.result(validate(runtime, { ...receipt, result }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("uses the genuine scalar UTF-8 ID order rather than input order or UTF-16 sorting", async () => {
    const ids = ["a", "z", "\uE000", "😀"];
    const activity = evidence([...ids].reverse().map(id => ({ table: "stock_location", row: location(id) })));
    await Effect.runPromise(validate(runtime, call(args([...ids].reverse()), [ids.map(id => ({ id })), 4]), activity));
    expect(await Effect.runPromise(Effect.result(validate(runtime,
      call(args(ids), [[{ id: "a" }, { id: "z" }, { id: "😀" }, { id: "\uE000" }], 4]), activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("binds empty, omitted and zero-size reads to their actual selection and native scalar projection", async () => {
    const row = location("pending"), activity = evidence([{ table: "stock_location", row: {
      ...row, _id: "private-document-id", _creationTime: 1,
    } }]);
    // An earlier command can create this Location in the same outer root.
    await Effect.runPromise(validate(runtime, call({}, [[row], 1]), activity));
    await Effect.runPromise(validate(runtime, call(args([]), [[], 0]), activity));
    await Effect.runPromise(validate(runtime, call(args(["missing"]), [[], 0]), activity));
    await Effect.runPromise(validate(runtime, call(args(Array.from({ length: 9 }, () => "pending")), [[{ id: "pending" }], 1]), activity));
    await Effect.runPromise(validate(runtime, call({ filters: { id: ["pending"] },
      config: { select: ["id"], take: 0 } }, [[], 1]), activity));
    await Effect.runPromise(validate(runtime, call({ filters: { id: ["pending"] },
      config: { select: ["id"], skip: 1 } }, [[], 1]), activity));
    const empty = evidence([]);
    await Effect.runPromise(validate(runtime, call(args([]), [[], 0]), empty));
    expect(await Effect.runPromise(Effect.result(validate(runtime, call(args(["missing"]), [[{ id: "missing" }], 1]), empty))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("excludes deleted and unselected candidates and refuses forged selected bodies or counts", async () => {
    const deleted = { ...location("deleted"), deleted_at: instant }, other = location("other");
    const activity = evidence([deleted, other].map(row => ({ table: "stock_location", row })));
    await Effect.runPromise(validate(runtime, call(args(["deleted", "missing"]), [[], 0]), activity));
    for (const receipt of [call(args(["deleted"]), [[{ id: "deleted" }], 1]),
      call(args(["missing"]), [[{ id: "other" }], 1]), call(args([]), [[], 1])])
      expect(await Effect.runPromise(Effect.result(validate(runtime, receipt, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("retains the bounded ID-only grammar and refuses unrelated call activity", async () => {
    const row = location("selected"), activity = evidence([{ table: "stock_location", row }]);
    const receipt = call(args(["selected"]), [[{ id: "selected" }], 1]);
    const unsupportedInputs: Call["input"][] = [
      { filters: { name: "Warehouse" } },
      { filters: { id: Array.from({ length: 9 }, (_, index) => String(index)) } },
      { filters: { id: ["selected"] }, config: { select: ["invented"] } },
      { filters: { id: ["selected"] }, config: { select: [] } },
      { filters: { id: ["selected"] }, config: { relations: ["address"] } },
      { filters: { id: ["selected"] }, config: { withDeleted: true } },
    ];
    for (const input of unsupportedInputs) expect(await Effect.runPromise(Effect.result(validate(runtime, { ...receipt, input }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    const corruptActivity: Activity[] = [
      { ...activity, observedRows: [{ table: "stock_location_address", row }] },
      { ...activity, observedRows: [{ table: "stock_location", row: { ...row, name: 42 } }] },
      { ...activity, observedRows: [{ table: "stock_location", row: { ...row, invented: true } }] },
      { ...activity, observedRows: [...activity.observedRows, ...activity.observedRows] },
      { ...activity, mutations: [{ ordinal: 0, table: "stock_location", operation: "insert" as const, before: null, after: row }] },
      { ...activity, lifecycle: [{ table: "stock_location", key: { id: "selected" }, operation: "softDelete" as const,
        beforeDeletedAt: null, afterDeletedAt: instant, attemptOrdinal: null, rowAtOperation: row }] },
      { ...activity, setNull: [{ sourceTable: "stock_location", sourceColumn: "address_id", targetTable: "stock_location_address",
        targetColumn: "id", targetKey: "address", managedUpdate: "advance" as const }] },
      { ...activity, referenceReplacements: [{ sourceTable: "stock_location", sourceColumn: "address_id",
        targetTable: "stock_location_address", targetColumn: "id", targetKey: "address", desiredKeys: [] }] },
    ];
    for (const corrupt of corruptActivity) expect(await Effect.runPromise(Effect.result(validate(runtime, receipt, corrupt))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(validate(runtime, { ...receipt, events: [{ unexpected: true }] }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

});
