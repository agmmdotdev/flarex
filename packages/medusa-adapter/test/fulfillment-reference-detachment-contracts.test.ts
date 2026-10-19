import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { LogicalCommerceCallObservation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalShippingOptionCreationCommands, makeLocalShippingOptionCreationWithReferenceDetachmentCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { makeServiceZoneCreationCommands, makeServiceZoneCreationWithReferenceDetachmentCommands } from "../src/modules/fulfillment/service-zone-create-service";
import { makeFulfillmentSetCreationCommands, makeFulfillmentSetCreationWithReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-set-create-service";
import { compileFulfillmentOptionSerializerSelection, makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { prepareFulfillmentCreationRepository } from "../src/modules/fulfillment/fulfillment-create-repository";
import { prepareShippingOptionCreationRepository } from "../src/modules/fulfillment/shipping-option-create-repository";
import { captureServiceZoneCreationMetadata, captureFulfillmentCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentGraphContracts } from "../src/modules/fulfillment/fulfillment-graph-contracts";
import { workflowModuleDefinition } from "../src/workflow/module";

describe("explicit native physical reference profiles", () => {
  it("derives the finite serializer discriminator from checked DML and rejects mixed or ambiguous cohorts", async () => {
    const metadata = await Effect.runPromise(captureFulfillmentCreationMetadata()),
      fulfillment = Result.getOrThrow(prepareFulfillmentCreationRepository(metadata.frame)),
      option = Result.getOrThrow(prepareShippingOptionCreationRepository(metadata.frame, "reference-detachment"));
    const compile = (table = fulfillment.contracts.fulfillment.table, entities = option.contracts.entities) =>
      compileFulfillmentOptionSerializerSelection(table, entities);
    const select = Result.getOrThrow(compile());
    expect(Result.getOrThrow(select({ id: "ful", location_id: "location" }))).toBe(true);
    expect(Result.getOrThrow(select([{ id: "option" }]))).toBe(false);
    expect(Result.getOrThrow(select([]))).toBe(false);
    const mixedCohorts: Json[] = [[{ id: "ful", location_id: "location" }, { id: "option" }],
      [{ id: "option" }, { id: "ful", location_id: "location" }], [null], ["option"]];
    for (const mixed of mixedCohorts)
      expect(select(mixed)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    expect(compile({ ...fulfillment.contracts.fulfillment.table,
      columns: fulfillment.contracts.fulfillment.table.columns.filter(column => column.name !== "location_id") })).toMatchObject({ _tag: "Failure" });
    expect(compile({ ...fulfillment.contracts.fulfillment.table,
      columns: fulfillment.contracts.fulfillment.table.columns.map(column => column.name === "location_id" ? { ...column, nullable: true } : column) })).toMatchObject({ _tag: "Failure" });
    const location = fulfillment.contracts.fulfillment.table.columns.find(column => column.name === "location_id");
    if (location === undefined) throw new Error("Missing native location scalar");
    expect(compile(fulfillment.contracts.fulfillment.table, option.contracts.entities.map(entity => ({ ...entity,
      table: { ...entity.table, columns: [...entity.table.columns, location] } })))).toMatchObject({ _tag: "Failure" });
    // Selection grants no DTO validity: each existing serializer still checks
    // its complete result, refusing a forged discriminator or hybrid shape.
    expect(Result.isFailure(await Effect.runPromise(Effect.result(fulfillment.contracts.serialize({ id: "option", location_id: "location" }))))).toBe(true);
  });

  it("keeps the real eight-table selections and requires explicit twelve-table detachment admission", async () => {
    const eight = await Effect.runPromise(captureServiceZoneCreationMetadata()), twelve = await Effect.runPromise(captureFulfillmentCreationMetadata());
    expect(Result.isSuccess(compileFulfillmentGraphContracts(eight.frame))).toBe(true);
    expect(Result.isFailure(compileFulfillmentGraphContracts(twelve.frame))).toBe(true);
    expect(Result.isFailure(compileFulfillmentGraphContracts(eight.frame, "reference-detachment"))).toBe(true);
    const selected = Result.getOrThrow(compileFulfillmentGraphContracts(twelve.frame, "reference-detachment"));
    expect(selected.referenceEntities.map(entity => entity.table.name)).toEqual(["fulfillment"]);
    expect(selected.referenceDetachments).toEqual([{ sourceTable: "fulfillment", sourceColumn: "shipping_option_id", sourceKey: "id",
      targetTable: "shipping_option", targetColumn: "id" }]);
    for (const [ordinary, selectedProfile] of [
      [await Effect.runPromise(makeLocalShippingOptionCreationCommands()), await Effect.runPromise(makeLocalShippingOptionCreationWithReferenceDetachmentCommands())],
      [await Effect.runPromise(makeServiceZoneCreationCommands()), await Effect.runPromise(makeServiceZoneCreationWithReferenceDetachmentCommands())],
      [await Effect.runPromise(makeFulfillmentSetCreationCommands()), await Effect.runPromise(makeFulfillmentSetCreationWithReferenceDetachmentCommands())],
    ]) {
      expect(workflowModuleDefinition(ordinary!.workflow)?.logical?.detachDeletedReferences).toBeUndefined();
      expect(workflowModuleDefinition(selectedProfile!.workflow)?.logical?.detachDeletedReferences).toBe(true);
      expect(Object.keys(selectedProfile!.workflow.methods)).toEqual(Object.keys(ordinary!.workflow.methods));
      expect(selectedProfile!.workflow.methods).not.toHaveProperty("createFulfillment");
      expect(selectedProfile!.workflow.methods).not.toHaveProperty("cancelFulfillment");
    }
  });

  it("reuses exact owned commands in the combined native module and retains each event decoder boundary", async () => {
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    expect(Object.keys(combined.workflow.methods)).toEqual([...Object.keys(combined.option.workflow.methods), "createFulfillment", "cancelFulfillment"]);
    expect(combined.workflow.methods.deleteShippingOptions).toBe(combined.option.workflow.methods.deleteShippingOptions);
    expect(combined.workflow.methods.createFulfillment).toBe(combined.fulfillment.workflow.methods.createFulfillment);
    const definition = workflowModuleDefinition(combined.workflow);
    if (definition?.logical === undefined) throw new Error("Missing combined native receipt owner");
    expect(definition.logical.detachDeletedReferences).toBe(true);
    const empty = { mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] };
    const call: LogicalCommerceCallObservation = { commandName: "shippingOptionPhysicalDeleteForWorkflow", mode: "write", input: [], result: null, events: [],
      fromAttempt: 0, toAttempt: empty.mutations.length, fromLifecycle: 0, toLifecycle: empty.lifecycle.length };
    await Effect.runPromise(definition.logical.validateLogicalCall(call, empty, combined.option.remove));
    expect(Result.isFailure(await Effect.runPromise(Effect.result(definition.logical.validateLogicalCall(call, empty, combined.fulfillment.create))))).toBe(true);
    const policy = combined.logicalEventPolicy();
    for (const [object, action] of [["fulfillment", "created"], ["shipping_option", "deleted"]]) {
      const event = { name: "fulfillment." + object!.replaceAll("_", "-") + "." + action,
        metadata: { source: "fulfillment", object, action }, data: { id: "id142" } };
      expect(await Effect.runPromise(policy.capture(event))).toEqual(event);
      expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.capture({ ...event, metadata: { ...event.metadata, source: "pricing" } }))))).toBe(true);
    }
  });
});
