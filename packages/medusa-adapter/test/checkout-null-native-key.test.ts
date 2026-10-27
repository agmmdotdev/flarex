import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../src/local-graph/query";
import { captureCartMetadata } from "../src/modules/cart/schema";
import { nestedPrefixParticipants } from "./support/logical-nested-prefix";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import type { GraphParticipant } from "../src/local-graph/model";

function queryItem(item: JsonObject, participants: readonly GraphParticipant[] = nestedPrefixParticipants(), target: JsonObject[] = []) {
  const root = participants[0]?.module.reads[0]?.command;
  let targetCalls = 0;
  const context: AtomicCommerceContext = { eventGroupId: "nullable-native-key", checkpoint: Effect.void,
    recordFailure: promiseFailureObserver(), capture: () => Effect.fail(commerceError("unsupportedProfile")),
    emit: () => Effect.fail(commerceError("unadmittedEvent")), clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: Effect.fail, call: (_participant, command) => {
      if (command === root) return Effect.succeed([[{ id: "cart", title: "Cart", items: [item] }], 1]);
      targetCalls++;
      return Effect.succeed([target, target.length]);
    } };
  const graph = Result.getOrThrow(prepareLocalGraph(participants));
  return { run: () => graph.bind(context).graph({ entity: "cart", fields: ["items.variant.title"],
    filters: { id: ["cart"] }, pagination: { take: 4 } }), calls: () => targetCalls };
}

it("keeps an authentic native manual LineItem's nullable Variant key absent without a target read", async () => {
  const native = await Effect.runPromise(captureCartMetadata());
  expect(native.frame.tables.find(table => table.name === "cart_line_item")?.columns
    .find(column => column.name === "variant_id")?.nullable).toBe(true);
  const query = queryItem({ id: "item", variant_id: null });
  expect(await Effect.runPromise(query.run())).toEqual({ data: [{ items: [{ variant_id: null }] }], metadata: { count: 1, skip: 0, take: 4 } });
  expect(query.calls()).toBe(0);
});

it("still refuses omitted, malformed, undeclared-null and null target keys", async () => {
  const strict = nestedPrefixParticipants().map(entry => ({ ...entry, module: { ...entry.module,
    reads: entry.module.reads.map(read => read.model === "LineItem" ? { ...read, table: { ...read.table, nullableColumns: [] } } : read) } }));
  for (const query of [queryItem({ id: "item" }), queryItem({ id: "item", variant_id: 3 }),
    queryItem({ id: "item", variant_id: null }, strict), queryItem({ id: "item", variant_id: "variant" }, undefined, [{ id: null, title: "Invalid" }])]) {
    expect(await Effect.runPromise(Effect.result(query.run()))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  }
});

it("rejects nullable primary or unknown columns and detaches admitted nullability arrays", async () => {
  for (const nullableColumns of [["id"], ["missing"], ["variant_id", "variant_id"]]) {
    const selected = nestedPrefixParticipants().map(entry => ({ ...entry, module: { ...entry.module,
      reads: entry.module.reads.map(read => read.model === "LineItem" ? { ...read, table: { ...read.table, nullableColumns } } : read) } }));
    expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
  }
  const nullableColumns = ["variant_id"];
  const selected = nestedPrefixParticipants().map(entry => ({ ...entry, module: { ...entry.module,
    reads: entry.module.reads.map(read => read.model === "LineItem" ? { ...read, table: { ...read.table, nullableColumns } } : read) } }));
  const query = queryItem({ id: "item", variant_id: null }, selected);
  nullableColumns.length = 0;
  expect(await Effect.runPromise(query.run())).toEqual({ data: [{ items: [{ variant_id: null }] }], metadata: { count: 1, skip: 0, take: 4 } });
});
