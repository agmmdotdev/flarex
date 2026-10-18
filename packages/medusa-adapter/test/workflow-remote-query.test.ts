import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { useRemoteQueryStep, type EntryStepInput } from "@medusajs/core-flows/common/use-remote-query";
import type { WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";
import { runEffect } from "../../persistence-postgres/test/support/effectTestRuntime";

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
