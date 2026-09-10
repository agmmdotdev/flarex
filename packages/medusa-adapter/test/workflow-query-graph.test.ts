import { describe, expect, expectTypeOf, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { useQueryGraphStep, type WorkflowGraphResource, type QueryGraphInput } from "@medusajs/core-flows/common/use-query-graph";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

const input = { entity: "variant", fields: ["id", "thumbnail"], filters: { id: "v" } };
const execute = (query: WorkflowGraphResource, config: QueryGraphInput) => {
  const flow = createWorkflow("query-step", () => new WorkflowResponse(useQueryGraphStep(config)));
  const container: WorkflowContainer = { resolve<T>(name: string): T {
    expect(name).toBe("query");
    // SAFETY: the compatibility test supplies exactly the named native resource.
    return query as T;
  } };
  const port: WorkflowExecutionPort<Error> = { checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: error => error instanceof Error ? error : new Error("Foreign graph failure") }),
    context: { container, eventGroupId: "graph-test" },
  };
  return runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port));
};
describe("shared workflow graph step", () => {
  it("uses the native ceiling for omitted pages and never mutates input or native results", async () => {
    const result = { data: [{ id: "v", thumbnail: null }], metadata: { count: 1, skip: 0, take: 256 } };
    const calls: unknown[] = [];
    const query: WorkflowGraphResource = { maxPageSize: 256, graph: async args => { calls.push(args); return result; } };
    const supplied = { ...input, options: { isList: false as const } };
    expect(await execute(query, supplied)).toEqual({ data: { id: "v", thumbnail: null }, metadata: result.metadata });
    expect(calls).toEqual([{ ...input, pagination: { take: 256 } }]);
    expect(supplied).toEqual({ ...input, options: { isList: false } });
    expect(result.data).toEqual([{ id: "v", thumbnail: null }]);
    expect(await execute(query, input)).toEqual(result);
  });

  it("retains absent single results and refuses ambiguous, skipped or incomplete results", async () => {
    const query = (count: number, rows: number, skip = 0): WorkflowGraphResource => ({ maxPageSize: 2,
      graph: async () => ({ data: Array.from({ length: rows }, (_, index) => ({ id: String(index) })), metadata: { count, skip, take: 2 } }),
    });
    expect(await execute(query(0, 0), { ...input, options: { isList: false } })).toMatchObject({ data: undefined });
    await expect(execute(query(2, 2), { ...input, options: { isList: false } })).rejects.toThrow();
    await expect(execute(query(3, 2), input)).rejects.toThrow();
    await expect(execute(query(2, 1, 1), { ...input, options: { isList: false }, pagination: { take: 1, skip: 1 } })).rejects.toThrow();
    await expect(execute(query(3, 2), { ...input, options: { isList: false }, pagination: { take: 2 } })).rejects.toThrow();
    expect(await execute(query(3, 2), { ...input, pagination: { take: 2 } })).toMatchObject({ data: [{ id: "0" }, { id: "1" }], metadata: { count: 3 } });
  });

  it("refuses extra graph options before query dispatch", async () => {
    let calls = 0;
    const query: WorkflowGraphResource = { maxPageSize: 256, graph: async () => { calls++; throw new Error("Unexpected dispatch"); } };
    for (const config of [{ ...input, options: { isList: false, throwIfKeyNotFound: true } },
      { ...input, context: {} }, { ...input, options: { cache: true } }, { ...input, pagination: { take: 1, cursor: "x" } }]) {
      await expect(execute(query, config)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it("infers optional partial single records and supports repeated named list instances", () => {
    const flow = createWorkflow("typed-query", () => {
      const one = useQueryGraphStep({ ...input, options: { isList: false } }).config({ name: "one" });
      const list = useQueryGraphStep(input).config({ name: "list" });
      return new WorkflowResponse(transform({ one, list }, value => {
        expectTypeOf(value.one.data).toEqualTypeOf<typeof Schema.JsonObject.Type | undefined>();
        expectTypeOf(value.list.data).toEqualTypeOf<readonly (typeof Schema.JsonObject.Type)[]>();
        return value;
      }));
    });
    expect(Result.isSuccess(flow.prepare())).toBe(true);
  });
});
