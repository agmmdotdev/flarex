import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { workflowQueryBoundary } from "./support/workflow-query-boundary-fixture";

const input = { entity: "variant", fields: ["id"], filters: { id: ["v"] } };
describe("bounded native workflow graph boundary", () => {
  it("uses the native graph method, preserves native options and makes counted pagination explicit", async () => {
    const result = { data: [{ id: "v" }], metadata: { count: 1, skip: 0, take: commerceLimits.catalogRows } };
    const tested = await workflowQueryBoundary({ graph: Effect.succeed(result) });
    try {
      expect(await tested.query.graph(input, { cache: { enable: true } })).toEqual(result);
      expect(tested.calls).toEqual([{ method: "nativeGraph", args: [{ ...input, pagination: { skip: 0, take: commerceLimits.catalogRows } },
        { cache: { enable: true } }] }]);
      expect(await tested.query.graph({ ...input, pagination: { take: 1 } })).toEqual(result);
      expect(tested.calls[1]?.args).toEqual([{ ...input, pagination: { take: 1, skip: 0 } }, undefined]);
    } finally { await Effect.runPromise(tested.owner.close); }
  });
  it("refuses malformed native counted pages and incomplete omitted pages", async () => {
    for (const value of [{ data: [], metadata: undefined }, { data: [undefined], metadata: { count: 1, skip: 0, take: 256 } },
      { data: [], metadata: { count: -1, skip: 0, take: 256 } }, { data: [{ id: "v" }], metadata: { count: 2, skip: 0, take: 256 } }]) {
      const tested = await workflowQueryBoundary({ graph: Effect.succeed(value) });
      try { await expect(tested.query.graph(input)).rejects.toHaveProperty("_tag", "CommerceTransactionError"); expect(tested.calls).toHaveLength(1); }
      finally { await Effect.runPromise(tested.owner.close); }
    }
  });
  it("refuses broader argument bags and getter options before dispatch and retains owner revocation", async () => {
    const tested = await workflowQueryBoundary(); let getters = 0;
    try {
      for (const args of [[], [input, undefined], [input, {}, {}], [input, {}], [input, { cache: { enable: false } }],
        [input, { cache: { get enable() { getters++; return true; } } }]])
        await expect(tested.query.graph(...args)).rejects.toHaveProperty("_tag", "CommerceTransactionError");
      expect(getters).toBe(0); expect(tested.calls).toEqual([]);
    } finally { await Effect.runPromise(tested.owner.close); }
    await expect(tested.query.graph(input)).rejects.toMatchObject({ reason: "closed" });
  });
  it("retains the existing counted catalog ceiling for explicit pages", async () => {
    const tested = await workflowQueryBoundary({ graph: Effect.succeed({ data: [{ id: "v" }], metadata: { count: 257, skip: 0, take: 1 } }) });
    try { await expect(tested.query.graph({ ...input, pagination: { take: 1 } })).rejects.toMatchObject({ reason: "storedCorruption" }); }
    finally { await Effect.runPromise(tested.owner.close); }
  });
  it("uses the existing JSON page boundary for ordinary native object absence", async () => {
    const tested = await workflowQueryBoundary({ graph: Effect.succeed({ data: [{ id: "v", payment_collection: undefined }],
      metadata: { count: 1, skip: 0, take: 256 } }) });
    try { expect(await tested.query.graph(input)).toEqual({ data: [{ id: "v" }], metadata: { count: 1, skip: 0, take: 256 } }); }
    finally { await Effect.runPromise(tested.owner.close); }
  });
});
