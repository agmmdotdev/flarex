import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { bindWorkflowQuery } from "../src/workflow/query";

async function bind(result: Json = [[{ id: "v" }], 1]) {
  const calls: Json[] = [], refusals: string[] = [];
  const participant = defineAtomicCommerceParticipant("native-direct-graph");
  const read = defineGraphReadCommand("nativeDirectGraphRead", () => Effect.succeed(result));
  const graph = Result.getOrThrow(prepareLocalGraph([{ participant, module: {
    aliases: [{ name: "variant", model: "Variant" }, { name: "variants", model: "Variant" }],
    reads: [{ model: "Variant", command: read,
      table: { name: "variant", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
      paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
  } }]));
  const context: AtomicCommerceContext = { eventGroupId: "native-direct-graph", checkpoint: Effect.void,
    refuse: error => { refusals.push(error.reason); return Effect.fail(error); },
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    call: (selected, command, input) => {
      expect(selected).toBe(participant); expect(command).toBe(read); calls.push(input); return Effect.succeed(result);
    },
  };
  const owner = await Effect.runPromise(makeCommercePromiseOwner());
  return { calls, refusals, owner, query: bindWorkflowQuery(graph, context, owner) };
}
const input = { entity: "variant", fields: ["id"], filters: { id: ["v"] } };
const cache = { cache: { enable: true } };

describe("native direct graph Query ABI", () => {
  it("executes both native aliases and cache hints through the original authenticated read", async () => {
    const connected = await bind(), before = structuredClone({ input, cache });
    try {
      const result = { data: [{ id: "v" }], metadata: { count: 1, skip: 0, take: commerceLimits.catalogRows } };
      expect(await connected.query.graph(input, cache)).toEqual(result);
      expect(await connected.query.graph({ ...input, entity: "variants" }, cache)).toEqual(result);
      expect(await connected.query.graph(input)).toEqual(result);
      expect(connected.calls).toEqual(Array.from({ length: 3 }, () => ({ filters: input.filters,
        config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: commerceLimits.catalogRows } })));
      expect({ input, cache }).toEqual(before); expect(connected.refusals).toEqual([]);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("retains explicit page semantics and the genuine empty-selector read", async () => {
    const page = await bind([[{ id: "v" }], 2]), empty = await bind([[], 0]);
    try {
      expect(await page.query.graph({ ...input, pagination: { take: 1 } }, cache)).toEqual({
        data: [{ id: "v" }], metadata: { count: 2, skip: 0, take: 1 },
      });
      expect(await empty.query.graph({ ...input, filters: { id: [] } }, cache)).toEqual({
        data: [], metadata: { count: 0, skip: 0, take: commerceLimits.catalogRows },
      });
      expect(empty.calls).toHaveLength(1); expect(empty.calls[0]).toMatchObject({ filters: { id: [] } });
    } finally { await Effect.runPromise(page.owner.close); await Effect.runPromise(empty.owner.close); }
  });

  it("latches malformed options and argument bags before dispatch even when rejection is caught", async () => {
    const connected = await bind();
    const invalidOptions: unknown[] = [{}, undefined, null, { cache: true }, { cache: {} }, { cache: { enable: false } },
      { cache: { enable: true, ttl: 10 } }, { cache: { enable: true }, throwIfKeyNotFound: true }];
    try {
      for (const options of invalidOptions) {
        const before = connected.refusals.length;
        await connected.query.graph(input, options).catch(error => {
          expect(error).toMatchObject({ reason: "unsupportedProfile" });
          expect(connected.refusals).toHaveLength(before + 1);
        });
      }
      for (const args of [[], [input, cache, {}], [{ ...input, options: cache }]]) {
        await expect(connected.query.graph(...args)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      }
      expect(connected.calls).toEqual([]); expect(connected.refusals).toHaveLength(invalidOptions.length + 3);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("does not evaluate option getters and keeps unavailable aliases refused", async () => {
    const connected = await bind();
    let getterCalls = 0;
    try {
      await expect(connected.query.graph(input, { cache: { get enable() { getterCalls++; return true; } } }))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      await expect(connected.query.graph({ ...input, entity: "other" }, cache)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(getterCalls).toBe(0); expect(connected.calls).toEqual([]); expect(connected.refusals).toHaveLength(2);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("retains complete-result corruption and revokes escaped direct graph calls", async () => {
    const connected = await bind([[{ id: "v" }], 2]);
    try {
      await expect(connected.query.graph(input, cache)).rejects.toMatchObject({ reason: "storedCorruption" });
      expect(connected.refusals).toEqual(["storedCorruption"]); expect(connected.calls).toHaveLength(1);
    } finally { await Effect.runPromise(connected.owner.close); }
    await expect(connected.query.graph(input, cache)).rejects.toMatchObject({ reason: "closed" });
    expect(connected.calls).toHaveLength(1);
  });
});
