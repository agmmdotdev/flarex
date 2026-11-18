import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { useRemoteQueryStep, type EntryStepInput } from "@medusajs/core-flows/common/use-remote-query";
import { prepareWorkflowGraphQuery, type WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";
import { runEffect } from "../../persistence-postgres/test/support/effectTestRuntime";

it("admits only the named native refund graph option at its shared owner", () => {
  const query = { entity: "orders", fields: ["id", "status", "summary", "total", "payment_collections.id"],
    filters: { id: "order-finance" } };
  expect(prepareWorkflowGraphQuery(query, 4)).toMatchObject({ _tag: "Success" });
  expect(prepareWorkflowGraphQuery({ ...query, options: { throwIfKeyNotFound: true } }, 4))
    .toMatchObject({ _tag: "Success", success: { queryOptions: { throwIfKeyNotFound: true } } });
  for (const options of [{ throwIfKeyNotFound: false }, { throwIfRelationNotFound: true },
    { throwIfKeyNotFound: true, arbitrary: true }]) {
    expect(prepareWorkflowGraphQuery({ ...query, options }, 4))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
});

const execute = (query: WorkflowGraphResource, input: EntryStepInput) => {
  const flow = createWorkflow("remote-query-step", () => new WorkflowResponse(useRemoteQueryStep(input)));
  const container: WorkflowContainer = { resolve<T>(name: string): T {
    expect(name).toBe("query");
    // SAFETY: the test provides the exact named native Query resource.
    return query as T;
  } };
  const port: WorkflowExecutionPort<Error> = { checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()),
      catch: error => error instanceof Error ? error : new Error("Foreign query failure") }),
    context: { container, eventGroupId: "remote-query-test" },
  };
  return runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port));
};

describe("native Product remote query seam", () => {
  it("preserves native Order payment association lookup and optional absence", async () => {
    const fields = ["order.id"] as const, calls: unknown[][] = [];
    const input = { entry_point: "order_payment_collection" as const, fields,
      variables: { payment_collection_id: "pay_col" }, list: false as const };
    const graph = async () => { throw new Error("Association singleton must use callable Query"); };
    for (const row of [{ order: { id: "order-one" } }, { order: null }, undefined]) {
      const query = Object.assign(async (...args: unknown[]) => { calls.push(args); return row === undefined ? [] : [row]; },
        { maxPageSize: 4, graph });
      expect(await execute(query, input)).toEqual(row);
    }
    expect(calls).toEqual(Array.from({ length: 3 }, () => [{ entryPoint: "order_payment_collection", fields,
      variables: { payment_collection_id: "pay_col" } }, { throwIfKeyNotFound: false, throwIfRelationNotFound: undefined }]));
    const missing = new Error("Native association not found");
    const throwing = Object.assign(async () => { throw missing; }, { maxPageSize: 4, graph });
    await expect(execute(throwing, { ...input, throw_if_key_not_found: true as const })).rejects.toBe(missing);
  });

  it("requires a real association row for the throwing native profile even if a Query resource returns an empty array", async () => {
    const graph = async () => { throw new Error("Unexpected graph dispatch"); };
    const query = Object.assign(async () => [], { maxPageSize: 4, graph });
    const input = { entry_point: "order_payment_collection" as const, fields: ["order.id"] as const,
      variables: { payment_collection_id: "pay_col" }, list: false as const, throw_if_key_not_found: true as const };
    await expect(execute(query, input)).rejects.toMatchObject({ reason: "invalidDefinition",
      detail: "Malformed native Order payment association projection" });
  });

  it("checks association projections and refuses a broader selector before dispatch", async () => {
    let calls = 0;
    const graph = async () => { throw new Error("Unexpected graph dispatch"); };
    const query = Object.assign(async () => { calls++; return [{ order: { id: 7 } }]; }, { maxPageSize: 4, graph });
    const input = { entry_point: "order_payment_collection" as const, fields: ["order.id"] as const,
      variables: { payment_collection_id: "pay_col" }, list: false as const };
    await expect(execute(query, input)).rejects.toThrow();
    expect(calls).toBe(1);
    // SAFETY: foreign malformed selectors deliberately enter the strict step boundary.
    await expect(execute(query, { ...input, variables: { payment_collection_id: "pay_col", order_id: "other" } } as EntryStepInput)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("retains the native nonthrowing Payment singleton ABI and selected typed projection", async () => {
    const fields = ["id", "amount", "raw_amount", "currency_code", "payment_sessions.*"] as const;
    const input = { entry_point: "payment_collection" as const, fields, variables: { id: "pay_col" }, list: false as const };
    const calls: unknown[][] = [], row = { id: "pay_col", amount: 12.5, raw_amount: { value: "12.5", precision: 20 }, currency_code: "usd",
      payment_sessions: [{ id: "payses_old", provider_id: "pp_system_default", authorized_at: null }] };
    const graph = async () => { throw new Error("Payment singleton must use callable Query"); };
    const query = Object.assign(async (...args: unknown[]) => { calls.push(args); return [row]; }, { maxPageSize: 4, graph });
    expect(await execute(query, input)).toEqual(row);
    expect(calls).toEqual([[{ entryPoint: "payment_collection", fields, variables: { id: "pay_col" } },
      { throwIfKeyNotFound: false, throwIfRelationNotFound: undefined }]]);
    expect(await execute(Object.assign(async () => [], { maxPageSize: 4, graph }), input)).toBeUndefined();
    await expect(execute(Object.assign(async () => [{ ...row, amount: "12.5" }], { maxPageSize: 4, graph }), input)).rejects.toThrow();
    await expect(execute(Object.assign(async () => [{ ...row, payment_sessions: [{}] }], { maxPageSize: 4, graph }), input)).rejects.toThrow();
  });
  it("maps native filters to a complete bounded graph list without mutating arguments", async () => {
    const supplied = { entry_point: "product", fields: ["variants.id"], variables: { filters: { id: ["p"] } } };
    const calls: unknown[] = [];
    const rows = [{ variants: [{ id: "v" }] }];
    const query: WorkflowGraphResource = { maxPageSize: 4, graph: async input => {
      calls.push(input);
      return { data: rows, metadata: { count: 1, skip: 0, take: 4 } };
    } };
    expect(await execute(query, supplied)).toEqual(rows);
    expect(calls).toEqual([{ entity: "product", fields: ["variants.id"], filters: { id: ["p"] }, pagination: { take: 4 } }]);
    expect(supplied).toEqual({ entry_point: "product", fields: ["variants.id"], variables: { filters: { id: ["p"] } } });
  });

  it("retains empty lists and rejects incomplete graph results", async () => {
    const input = { entry_point: "product", fields: ["id"], list: true as const };
    expect(await execute({ maxPageSize: 4, graph: async () => ({ data: [], metadata: { count: 0, skip: 0, take: 4 } }) }, input)).toEqual([]);
    await expect(execute({ maxPageSize: 4, graph: async () => ({ data: [{ id: "p" }], metadata: { count: 2, skip: 0, take: 4 } }) }, input)).rejects.toThrow();
  });

  it("calls the exact native singleton ABI and selects its first partial record", async () => {
    const calls: unknown[][] = [], row = { id: "sloc", name: "Warehouse", address: { id: "addr", city: "Yangon" } };
    const query = Object.assign(async (...args: unknown[]) => { calls.push(args); return [row]; }, {
      maxPageSize: 4,
      graph: async () => { throw new Error("Singleton must use callable Query"); },
    });
    const supplied = { entry_point: "stock_location" as const, fields: ["id", "name", "address.id", "address.city"],
      variables: { id: "sloc" }, list: false as const, throw_if_key_not_found: true as const };
    expect(await execute(query, supplied)).toEqual(row);
    expect(calls).toStrictEqual([[{ entryPoint: "stock_location", fields: supplied.fields, variables: { id: "sloc" } },
      { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined }]]);
    expect(supplied.variables).toEqual({ id: "sloc" });
  });

  it("preserves nullable Address and the callable native not-found failure", async () => {
    const input = { entry_point: "stock_location" as const, fields: ["id", "address.id"], variables: { id: "sloc" },
      list: false as const, throw_if_key_not_found: true as const };
    const graph = async () => { throw new Error("Unexpected graph dispatch"); };
    expect(await execute(Object.assign(async () => [{ id: "sloc", address: null }], { maxPageSize: 4, graph }), input))
      .toEqual({ id: "sloc", address: null });
    const missing = Object.assign(new Error("StockLocation id not found: sloc"), { type: "not_found" });
    await expect(execute(Object.assign(async () => { throw missing; }, { maxPageSize: 4, graph }), input)).rejects.toBe(missing);
  });

  it("refuses broader remote-query capabilities before resource dispatch", async () => {
    let calls = 0;
    const query: WorkflowGraphResource = { maxPageSize: 4, graph: async () => { calls++; throw new Error("Unexpected query"); } };
    const base = { entry_point: "product", fields: ["id"] };
    for (const input of [{ ...base, service: "product" }, { ...base, list: false },
      { ...base, throw_if_key_not_found: true }, { ...base, variables: { filters: {}, take: 1 } },
      { ...base, variables: { id: "p" }, list: false, throw_if_key_not_found: true },
      { entry_point: "stock_location", fields: ["id"], variables: { id: "sloc" }, list: false },
      { entry_point: "stock_location", fields: ["id"], variables: { id: "sloc" }, list: false, throw_if_key_not_found: true,
        throw_if_relation_not_found: true }]) {
      // SAFETY: malformed native inputs intentionally exercise the runtime boundary.
      await expect(execute(query, input as EntryStepInput)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});


describe("named native refund singleton projections", () => {
  const cases = [
    { input: { entry_point: "payment", fields: ["id", "payment_collection_id", "currency_code", "amount", "raw_amount",
        "captures.raw_amount", "refunds.raw_amount"], variables: { id: "pay-refund" }, list: false, throw_if_key_not_found: true },
      row: { id: "pay-refund", payment_collection_id: "paycol-refund", currency_code: "usd", amount: 12.5,
        raw_amount: { value: "12.500000000000000000", precision: 20 },
        captures: [{ raw_amount: { value: "12.500000000000000000", precision: 20 } }], refunds: [] } },
    { input: { entry_point: "order", fields: ["id", "summary", "total", "currency_code", "region_id"],
        variables: { id: "order-refund" }, list: false, throw_if_key_not_found: true },
      row: { id: "order-refund", total: 12.5, currency_code: "usd", region_id: null,
        summary: { pending_difference: -3.125, raw_pending_difference: { value: "-3.125", precision: 20 }, paid_total: 15 } } },
    { input: { entry_point: "refund_reason", fields: ["id", "label", "code"], variables: { id: "refr-refund" },
        list: false, throw_if_key_not_found: true }, row: { id: "refr-refund", label: "Customer return", code: "return" } },
  ] as const;
  it.each(cases)("keeps the exact $input.entry_point projection and throwing Query ABI", async ({ input, row }) => {
    const calls: unknown[][] = [], graph = async () => { throw new Error("Singleton must use callable Query"); };
    const query = Object.assign(async (...args: unknown[]) => { calls.push(args); return [row]; }, { maxPageSize: 4, graph });
    expect(await execute(query, input)).toEqual(row);
    expect(calls).toEqual([[{ entryPoint: input.entry_point, fields: input.fields, variables: input.variables },
      { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined }]]);
    const missing = new Error("Native missing " + input.entry_point);
    await expect(execute(Object.assign(async () => { throw missing; }, { maxPageSize: 4, graph }), input)).rejects.toBe(missing);
    await expect(execute(Object.assign(async () => [{ ...row, id: 7 }], { maxPageSize: 4, graph }), input)).rejects.toThrow();
    // A throwing singleton resource cannot successfully return an absent row.
    await expect(execute(Object.assign(async () => [], { maxPageSize: 4, graph }), input)).rejects.toThrow();
  });
  it("checks raw financial fields while retaining native missing-summary fallbacks", async () => {
    const graph = async () => { throw new Error("Unexpected graph dispatch"); };
    const payment = cases[0], order = cases[1], reason = cases[2];
    const { summary: _summary, ...withoutSummary } = order.row;
    for (const row of [withoutSummary, { ...order.row, summary: null }])
      expect(await execute(Object.assign(async () => [row], { maxPageSize: 4, graph }), order.input)).toEqual(row);
    await expect(execute(Object.assign(async () => [{ ...payment.row,
      captures: [{ raw_amount: { value: 12.5, precision: 20 } }] }], { maxPageSize: 4, graph }), payment.input)).rejects.toThrow();
    await expect(execute(Object.assign(async () => [{ ...order.row,
      summary: { raw_pending_difference: { value: "-3.125" } } }], { maxPageSize: 4, graph }), order.input)).rejects.toThrow();
    await expect(execute(Object.assign(async () => [{ ...reason.row, code: 7 }], { maxPageSize: 4, graph }), reason.input)).rejects.toThrow();
  });
  it("rejects broader financial selectors and flags before dispatch", async () => {
    let calls = 0;
    const query = Object.assign(async () => { calls++; return []; }, {
      maxPageSize: 4, graph: async () => { throw new Error("Unexpected graph dispatch"); },
    });
    for (const { input } of cases) for (const foreign of [
      { ...input, fields: [...input.fields, "provider_id"] }, { ...input, throw_if_key_not_found: false },
      { ...input, throw_if_relation_not_found: true }, { ...input, variables: { id: input.variables.id, other: "foreign" } },
    ]) {
      // SAFETY: malformed foreign calls enter the actual strict step boundary.
      await expect(execute(query, foreign as EntryStepInput)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});
