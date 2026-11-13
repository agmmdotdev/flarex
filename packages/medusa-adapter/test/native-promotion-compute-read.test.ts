import { expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { BigNumber } from "@medusajs/framework/utils/portable";
import { capturePromotionMetadata } from "../src/modules/promotion/schema";
import { preparePromotionComputeRead } from "../src/modules/promotion/compute-read";
import { capturePromotionComputeQuery, preparePromotionComputeQuery, promotionComputePaths } from "../src/modules/promotion/compute-query";
import { capturePromotionComputedActions, decodePromotionComputeInput, decodePromotionGraphRead } from "../src/modules/promotion/compute-input";
import { makePromotionComputeCommands } from "../src/modules/promotion/compute-service";
import { prepareLocalGraph } from "../src/local-graph/query";
import { workflowModuleDefinition } from "../src/workflow/module";
import { captureCommerceInput } from "../src/value/input";

it.each([{ fields: ["id", "code"] }, { fields: ["id", "code", "application_method.value"] }, { fields: ["id", "code", "application_method.*"] }])("admits the actual native Promotion graph's unordered descriptor through its command and DAL owners: %j", async ({ fields }) => {
  const commands = await Effect.runPromise(makePromotionComputeCommands());
  const definition = workflowModuleDefinition(commands.workflow);
  if (definition === undefined) throw new Error("Missing genuine Promotion graph");
  const graph = Result.getOrThrow(prepareLocalGraph([{ participant: defineAtomicCommerceParticipant("nativePromotionOrder"), module: definition.graph }]));
  const calls: Json[] = [], descriptors: unknown[] = [];
  const exit = await Effect.runPromiseExit(graph.bind({ refuse: Effect.fail, recordFailure: cause => Result.succeed(cause),
    call: (_participant, _command, args) => Effect.gen(function* () {
      calls.push(args);
      const input = yield* Effect.fromResult(decodePromotionGraphRead(args));
      const descriptor = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config)));
      descriptors.push(descriptor);
      const result = yield* commands.prepared.read(() => Effect.succeed([]), "promotion", descriptor);
      expect(result.parsed.graph).toBe(true);
      return [result.rows, result.count] satisfies Json;
    }),
  }).remoteQuery({ entryPoint: "promotion", fields, variables: { id: ["promotion-native-order"] } }));
  expect(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) + JSON.stringify({ calls, descriptors }) : undefined).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ filters: { id: ["promotion-native-order"] }, config: { take: 256 } });
  expect(calls[0]).not.toHaveProperty("config.order");
  expect(descriptors[0]).not.toHaveProperty("options.orderBy");
  for (const field of ["application_method_id", "application_method.unknown", "__proto__", "application_method.constructor"])
    expect(Result.isFailure(graph.admitProjection("promotion", ["id", field])), field).toBe(true);
  for (const orderBy of [{}, { id: "DESC" }, { code: "ASC" }, { application_method: { value: "DESC" } }])
    expect(Result.isFailure(preparePromotionComputeQuery("promotion", { where: { id: ["promotion-native-order"] },
      options: { fields: ["id", "code"], populate: [], limit: 256, offset: 0, orderBy } }))).toBe(true);
  expect(Result.isFailure(preparePromotionComputeQuery("promotion", { where: { id: ["promotion-native-order"] },
    options: { fields: ["id", "code"], populate: [] } }))).toBe(true);
  expect(Result.isFailure(preparePromotionComputeQuery("promotion_campaign_budget_usage", { where: { budget_id: "budget", attribute_value: "customer" },
    options: { populate: [] } }))).toBe(true);
});

it("prepares the genuine seven-model and three-pivot calculation read graph", async () => {
  const metadata = await Effect.runPromise(capturePromotionMetadata());
  const prepared = await Effect.runPromise(Effect.fromResult(preparePromotionComputeRead(metadata.frame)));
  expect(prepared.entities).toHaveLength(10);
  expect(prepared.relations.get("promotion")?.get("application_method")?.join.type).toBe("hasOne");
  expect(prepared.relations.get("promotion_application_method")?.get("target_rules")?.join.type).toBe("manyToMany");
  expect(prepared.relations.get("promotion_campaign")?.get("budget")?.join.type).toBe("hasOne");
});

it("captures only the genuine shared active-query Date leaves", async () => {
  const now = new Date("2026-10-29T10:00:00.000Z"), candidate = { code: ["WELCOME"] };
  const input = { where: { status: "active", $or: [
    { campaign_id: null, ...candidate }, { ...candidate, campaign: { $and: [
      { $or: [{ starts_at: null }, { starts_at: { $lte: now } }] },
      { $or: [{ ends_at: null }, { ends_at: { $gt: now } }] },
    ] } },
  ] }, options: { populate: [...promotionComputePaths], orderBy: { application_method: { value: "DESC" } } } };
  const captured = await Effect.runPromise(capturePromotionComputeQuery(input));
  const query = await Effect.runPromise(Effect.fromResult(preparePromotionComputeQuery("promotion", captured)));
  expect(query.active).toBe(true);
  if (!query.active) return;
  expect(query.nativeNow).toBe(now.toISOString());
  expect(query.campaignPredicate).toMatchObject({ kind: "and", children: [
    { kind: "isNull", column: "deleted_at" },
    { kind: "or", children: [{ kind: "isNull", column: "starts_at" }, { kind: "lessThan", column: "starts_at", value: now.toISOString() }, { kind: "in", column: "starts_at", values: [now.toISOString()] }] },
    { kind: "or", children: [{ kind: "isNull", column: "ends_at" }, { kind: "greaterThan", column: "ends_at", value: now.toISOString() }] },
  ] });
  expect(now.toISOString()).toBe("2026-10-29T10:00:00.000Z");
});

it("keeps compute reads complete and rejects unrelated selectors", () => {
  expect(Result.isFailure(preparePromotionComputeQuery("promotion", { where: { metadata: {} }, options: {
    fields: ["id", "code"], populate: [], orderBy: { id: "ASC" },
  } }))).toBe(true);
  expect(Result.isFailure(preparePromotionComputeQuery("promotion_campaign_budget_usage", { where: {
    budget_id: "budget1", attribute_value: "customer1",
  }, options: { populate: [], orderBy: { id: "ASC" }, limit: 1 } }))).toBe(true);
});

it("retains exact internal native numbers and exact computed-action amounts", async () => {
  const metadata = await Effect.runPromise(capturePromotionMetadata());
  const prepared = await Effect.runPromise(Effect.fromResult(preparePromotionComputeRead(metadata.frame)));
  const entity = await Effect.runPromise(prepared.internal({ value: "9007199254740993.125", raw_value: { value: "9007199254740993.125", precision: 20 } }, "promotion_application_method"));
  expect(entity).toHaveProperty("value");
  const value: unknown = entity !== null && typeof entity === "object" ? Object.getOwnPropertyDescriptor(entity, "value")?.value : undefined;
  expect(value).toBeInstanceOf(BigNumber);
  if (!(value instanceof BigNumber)) return;
  expect(value.raw?.value).toBe("9007199254740993.125");
  const actions = await Effect.runPromise(capturePromotionComputedActions([{ action: "addItemAdjustment", item_id: "item1", code: "EXACT", amount: value }]));
  expect(actions).toEqual([{ action: "addItemAdjustment", item_id: "item1", code: "EXACT", amount: "9007199254740993.1250" }]);
});

it("preserves the genuine Cart graph's nullable context and rejects malformed required line data", () => {
  const value = decodePromotionComputeInput({ codes: [], context: { currency_code: "usd", customer: null, region: null,
    shipping_address: null, email: null, sales_channel_id: null, items: [{ id: "item1", quantity: 1,
      subtotal: "10", original_total: "10", is_discountable: true, product: null, custom_attribute: "kept" }] } });
  expect(Result.isSuccess(value)).toBe(true);
  expect(Result.isFailure(decodePromotionComputeInput({ codes: [], context: { currency_code: "usd", items: [{ id: "item1" }] } }))).toBe(true);
});
