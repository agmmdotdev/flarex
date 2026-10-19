import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { decodeFulfillmentDeliveryList, decodeFulfillmentShipmentUpdate } from "../src/modules/fulfillment/fulfillment-shipment-input";
import { workflowModuleDefinition, defineWorkflowModule } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { bindWorkflowQuery } from "../src/workflow/query";

describe("selected native Fulfillment Delivery translation", () => {
  it("shares the complete native update contract while retaining Delivery date normalization", () => {
    const instant = new Date("2026-10-19T08:00:00.000Z");
    expect(Result.getOrThrow(decodeFulfillmentShipmentUpdate({ delivered_at: instant })))
      .toEqual({ delivered_at: instant.toISOString() });
    expect(Result.getOrThrow(decodeFulfillmentShipmentUpdate({ delivered_at: null }))).toEqual({ delivered_at: null });
    expect(Result.getOrThrow(decodeFulfillmentShipmentUpdate({ shipped_at: null, labels: [] }))).toEqual({ shipped_at: null, labels: [] });
    for (const input of [{}, { delivered_at: null, shipped_at: null }, { delivered_at: null, labels: [] }])
      expect(Result.getOrThrow(decodeFulfillmentShipmentUpdate(input))).toEqual(input);
    for (const input of [{ delivered_at: null, canceled_at: null }, { delivered_at: null, updated_at: instant.toISOString() }])
      expect(Result.isFailure(decodeFulfillmentShipmentUpdate(input))).toBe(true);
  });

  it("admits the selected native list call without pagination, relation or order fallback", () => {
    const input = { filters: { id: ["ful145"] }, config: { select: ["id", "delivered_at", "canceled_at"], relations: [], order: { id: "ASC" } } };
    expect(Result.getOrThrow(decodeFulfillmentDeliveryList(input))).toEqual(input);
    for (const value of [{ ...input, filters: { id: [] } }, { ...input, filters: { id: ["ful145", "other"] } },
      { ...input, filters: { id: "ful145" } }, { ...input, config: { ...input.config, order: { id: "DESC" } } },
      { ...input, config: { ...input.config, take: 1 } }, { ...input, config: { ...input.config, skip: 0 } },
      { ...input, config: { ...input.config, relations: ["labels"] } }, { ...input, config: { ...input.config, select: ["location_id"] } }])
      expect(decodeFulfillmentDeliveryList(value)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("captures the actual local list command and preserves the mixed constructor's existing Option graph", async () => {
    const local = await Effect.runPromise(makeLocalFulfillmentCreationCommands()), definition = workflowModuleDefinition(local.workflow);
    if (definition === undefined) throw new Error("Missing native local Fulfillment module");
    expect(definition.graph.aliases).toContainEqual({ name: "fulfillment", model: "Fulfillment" });
    expect(definition.graph.reads).toHaveLength(1);
    expect(definition.graph.reads[0]).toMatchObject({ model: "Fulfillment", result: "list", command: local.list });
    expect(definition.logical?.commands).toContain(local.list);
    const read = definition.graph.reads[0];
    if (read === undefined || read.result !== "list") throw new Error("Missing native list capability");
    for (const value of [null, [[], 0], [{ id: "ful145" }, { id: "other" }], [{ id: "ful145", delivered_at: 4 }]])
      expect(read.decode(value)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    expect(Result.getOrThrow(read.decode([{ id: "ful145", delivered_at: null, canceled_at: null }])))
      .toEqual([{ id: "ful145", delivered_at: null, canceled_at: null }]);
    const participant = defineAtomicCommerceParticipant("delivery-list-authority");
    expect(prepareLocalGraph([{ participant, module: { ...definition.graph, reads: [{ ...read, command: { ...local.list } }] } }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(defineWorkflowModule({ name: "fulfillment", source: definition.source, methods: {}, graph: definition.graph }))
      .toMatchObject({ _tag: "Success" });
    const mixed = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands()), mixedDefinition = workflowModuleDefinition(mixed.workflow);
    if (mixedDefinition === undefined) throw new Error("Missing native mixed Fulfillment/Option module");
    expect(mixedDefinition.graph).toEqual(workflowModuleDefinition(mixed.option.workflow)?.graph);
    expect(mixedDefinition.graph.reads.some(read => read.model === "Fulfillment")).toBe(false);
    expect(Object.keys(mixed.workflow.methods)).toEqual(expect.arrayContaining(["createFulfillment", "cancelFulfillment"]));
    expect(mixed.workflow.methods).not.toHaveProperty("listFulfillments");
    let calls = 0;
    const context: AtomicCommerceContext = { eventGroupId: "delivery145-mixed-refusal", checkpoint: Effect.void, refuse: Effect.fail,
      capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
      clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
      call: () => { calls++; return Effect.die(new Error("Mixed Delivery must not dispatch")); } };
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    try {
      const graph = Result.getOrThrow(prepareLocalGraph([{ participant, module: mixedDefinition.graph }])), query = bindWorkflowQuery(graph, context, owner);
      await expect(query({ entryPoint: "fulfillment", fields: ["id", "delivered_at", "canceled_at"], variables: { id: "ful145" } },
        { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined })).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toBe(0);
    } finally { await Effect.runPromise(owner.close); }
  });
});
