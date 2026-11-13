import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type CommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import type { GraphReadContext } from "../src/local-graph/model";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import { storeOrderReadResources } from "../src/modules/order/store-read-input";
import { declaredNativeGraph } from "./support/declared-native-graph";
import { promiseFailureObserver } from "./support/promise-failure-observer";

const participant = defineAtomicCommerceParticipant("native-value-budget");
const command = defineGraphReadCommand("nativeValueBudgetRead", () => Effect.succeed([[], 0]));
const module = declaredNativeGraph({ aliases: [{ name: "budget_item", model: "BudgetItem" }], reads: [{ model: "BudgetItem", command,
  table: { name: "budget_item", columns: ["id", "payload"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
  paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] },
  [{ serviceName: "budget_item", primaryKeys: ["id"], alias: [{ name: "budget_item", entity: "BudgetItem", args: { methodSuffix: "BudgetItems" } }] }], []);
const members = [{ participant, module }];
const fields = ["id", "payload"];
const page = (width: number) => Array.from({ length: 50 }, (_, index) => ({ id: "row" + index,
  payload: Array.from({ length: width }, () => 0) }));
const bind = (rows: Json, resources?: CommerceResources) => {
  const context: GraphReadContext = { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: () => Effect.succeed([rows, 50]) };
  return Result.getOrThrow(prepareLocalGraph(members, resources)).bind(context);
};

describe("prepared native Query value budgets", () => {
  it.each(["graph", "nativeGraph", "remoteQuery"] as const)("keeps ordinary %s output bounded and captures the complete named fifty-row page", async method => {
    const input = method === "remoteQuery" ? { entryPoint: "budget_item", fields, variables: { filters: {}, take: 50, skip: 0 } }
      : { entity: "budget_item", fields, pagination: { take: 50, skip: 0 } };
    const rows = page(200);
    expect(await Effect.runPromise(Effect.result(bind(rows)[method](input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const resources = { ...storeOrderReadResources };
    const selected = bind(rows, resources);
    Reflect.set(resources, "valueNodes", defaultCommerceResources.valueNodes);
    const result = await Effect.runPromise(selected[method](input));
    expect(result).toEqual(method === "remoteQuery" ? { rows, metadata: { count: 50, skip: 0, take: 50 } }
      : { data: rows, metadata: { count: 50, skip: 0, take: 50 } });
    expect(await Effect.runPromise(Effect.result(bind(page(1_400), storeOrderReadResources)[method](input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("refuses an invalid selected profile during preparation", () => {
    for (const valueNodes of [0, 131_073, Number.NaN])
      expect(prepareLocalGraph(members, { ...storeOrderReadResources, valueNodes }))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
