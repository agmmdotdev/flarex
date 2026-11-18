// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyShippingOptionCreateCallbacks, verifyShippingOptionUpdateCallbacks, verifyShippingOptionDeleteCallbacks, verifyFulfillmentCreationCallbacks, verifyReturnFulfillmentCreationCallbacks, verifyFulfillmentCancellationCallbacks, verifyFulfillmentShipmentCallbacks, verifyRegionManifestFork } from "./check-medusa-shipping-option-source.mjs";
import { deliverySourcePairs, verifyFulfillmentDeliveryCallbacks, verifyNativeSkipStepResponseType } from "./check-medusa-delivery-source.mjs";

const root = process.cwd();
describe("native Delivery and selected Locking closure", () => {
  const delivery = "packages/medusa-core-flows/src/durable/fulfillment/workflows/mark-fulfillment-as-delivered.ts";
  const update = "packages/medusa-core-flows/src/durable/fulfillment/workflows/update-fulfillment.ts";
  const step = "packages/medusa-core-flows/src/durable/fulfillment/steps/update-fulfillment.ts";
  const acquire = "packages/medusa-core-flows/src/durable/locking/steps/acquire-lock.ts";
  const release = "packages/medusa-core-flows/src/durable/locking/steps/release-lock.ts";
  const provider = "packages/medusa-locking/src/providers/in-memory.ts";
  const module = "packages/medusa-locking/src/services/locking-module.ts";
  const query = "packages/medusa-core-flows/src/durable/common/steps/use-remote-query.ts";
  /** @param {string} file */
  const text = file => readFileSync(path.join(root, file), "utf8");
  it("admits the exact owner correction, original callbacks and selected retention options", () => {
    expect(deliverySourcePairs).toHaveLength(13);
    expect(() => verifyFulfillmentDeliveryCallbacks(root)).not.toThrow();
    expect(() => verifyFulfillmentDeliveryCallbacks(root, { [step]: { target: text(step)
      .replace("const updated =", "const updated: unknown =") + "\n// erased declaration only\n" } })).not.toThrow();
  });
  it.each([
    ["native transaction context", delivery, "context.context?.transactionId", "context.transactionId"],
    ["nonempty native owner", delivery, 'transactionId.length === 0', 'transactionId.length < 0'],
    ["actual owner identity", delivery, '`fulfillment-delivery:${transactionId}`', '`fulfillment-delivery:constant`'],
    ["acquire owner", delivery, "      ownerId,\n      timeout: 2,", "      timeout: 2,"],
    ["release owner", delivery, "      ownerId,\n    })\n    return", "    })\n    return"],
    ["native timeout", delivery, "timeout: 2,", "timeout: 0,"],
    ["native TTL", delivery, "ttl: 10,", "ttl: 20,"],
    ["canceled guard", delivery, "if (fulfillment.canceled_at)", "if (false)"],
    ["delivered guard", delivery, "if (fulfillment.delivered_at)", "if (false)"],
    ["singleton Query", delivery, "list: false", "list: true"],
    ["native generated stamp", delivery, "delivered_at: new Date()", "delivered_at: null"],
    ["parent retention", delivery, "storeExecution: true", "storeExecution: false"],
    ["child retention", update, "store: true", "store: false"],
    ["actual preimage", step, "new StepResponse(updated, fulfillment)", "new StepResponse(updated, input)"],
    ["retained inverse", step, "await service.updateFulfillment(id, data)", "await service.updateFulfillment(id, {})"],
    ["native query flags", query, "throwIfKeyNotFound: !!data.throw_if_key_not_found", "throwIfKeyNotFound: false"],
    ["retry interval", acquire, "data.retryInterval ?? 0.3", "data.retryInterval ?? 0.1"],
    ["retry timer", acquire, "globalThis.setTimeout(resolve, retryInterval * 1000)", "resolve()"],
    ["real acquisition", acquire, "await locking.acquire(data.key,", "void locking.acquire(data.key,"],
    ["actual child skip", acquire, "const isSubWorkflow = !!parentStepIdempotencyKey", "const isSubWorkflow = true"],
    ["retained compensation owner", acquire, "ownerId: data.ownerId,", 'ownerId: "other",'],
    ["actual release", release, "await locking.release(keys,", "await locking.release([],"],
    ["newer-owner protection", provider, "isDefined(ownerId) && lock.ownerId !== ownerId", "false"],
    ["native expiry", provider, "lock.expiration <= now", "false"],
    ["native module delegation", module, "await provider.acquire(keys, args, sharedContext)", "void provider.acquire(keys, args, sharedContext)"],
    ["unused ORM class field", module, "  protected defaultProviderId: string", "  protected manager: unknown\n  protected defaultProviderId: string"],
  ])("rejects changed %s", (_label, file, before, after) => {
    const original = text(file); expect(original).toContain(before);
    expect(() => verifyFulfillmentDeliveryCallbacks(root, { [file]: { target: original.replace(before, after) } }))
      .toThrow("Changed native Fulfillment delivery closure behavior");
  });
  it("rejects extra runtime, missing native adaptation anchors and unknown files", () => {
    for (const [file, source] of deliverySourcePairs) {
      expect(() => verifyFulfillmentDeliveryCallbacks(root, { [file]: { target: text(file) + "\nthrow new Error('extra');\n" } })).toThrow();
      if (file === delivery) {
        const original = readFileSync(path.join(root, "third_party/medusa/upstream", source), "utf8");
        expect(() => verifyFulfillmentDeliveryCallbacks(root, { [file]: { source: original.replace('from "../../locking"', 'from "other-locking"') } }))
          .toThrow("native adaptation anchor");
      }
    }
    expect(() => verifyFulfillmentDeliveryCallbacks(root, { unknown: { target: "" } })).toThrow("unknown packet file");
  });
  it("pins the native skip return union without widening it to arbitrary values", () => {
    const source = readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-step.ts"), "utf8");
    const target = text("packages/medusa-workflows-sdk/src/durable/utils/composer/create-step.ts");
    expect(() => verifyNativeSkipStepResponseType(source, target)).not.toThrow();
    expect(() => verifyNativeSkipStepResponseType(source, target.replace("  | SkipStepResponse\n", ""))).toThrow();
    expect(() => verifyNativeSkipStepResponseType(source, target.replace("Promise<void | SkipStepResponse", "Promise<unknown | SkipStepResponse"))).toThrow();
  });
});
/** @param {string} file */
const target = file => readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment", file), "utf8").replaceAll("\r\n", "\n");
const workflow = "workflows/create-shipping-options.ts";
const prices = "steps/add-shipping-options-prices.ts";
const links = "steps/set-shipping-options-price-sets.ts";
const upsert = "steps/upsert-shipping-options.ts";
const providers = "steps/validate-fulfillment-providers.ts";
const validation = "steps/validate-shipping-option-prices.ts";
const emit = "../common/steps/emit-event.ts";

describe.each(["finite", "durable"])("approved Fulfillment update preimages in %s callbacks", profile => {
  const finite = profile === "finite", key = finite ? "steps/update-fulfillment.ts"
    : "packages/medusa-core-flows/src/durable/fulfillment/steps/update-fulfillment.ts";
  const file = finite ? "packages/medusa-core-flows/src/fulfillment/" + key : key;
  const verify = finite ? verifyFulfillmentShipmentCallbacks : verifyFulfillmentDeliveryCallbacks;
  const read = () => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
  const native = () => readFileSync(path.join(root,
    "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/update-fulfillment.ts"), "utf8");
  it("admits the exact approved preimage correction and erased declarations", () => {
    expect(() => verify(root)).not.toThrow();
    expect(() => verify(root, { [key]: { target: read()
      .replace("const scalarSelects =", "const scalarSelects: string[] =") + "\n// erased only\n" } })).not.toThrow();
  });
  it.each([
    ["whole data preimage", 'objectFields: ["data", "metadata"]', 'objectFields: ["metadata"]'],
    ["whole metadata preimage", 'objectFields: ["data", "metadata"]', 'objectFields: ["data"]'],
    ["only declared JSON fields", 'objectFields: ["data", "metadata"]', 'objectFields: ["data", "metadata", "labels"]'],
    ["supplied Label detection", 'Object.prototype.hasOwnProperty.call(data, "labels")', "false"],
    ["complete Label preimage", '...scalarSelects, "labels.*"', '...scalarSelects, "labels.id"'],
    ["partial Label select removal", '!field.startsWith("labels.")', 'field.startsWith("labels.")'],
    ["other supplied scalar selects", '...scalarSelects, "labels.*"', '"labels.*"'],
    ["Label relation retention", 'relations.push("labels")', 'relations.push("items")'],
    ["native forward fields", "const updated = await service.updateFulfillment(id, data)", "const updated = await service.updateFulfillment(id, {})"],
    ["actual retained DTO", "new StepResponse(updated, fulfillment)", "new StepResponse(updated, input)"],
    ["original inverse method", "    await service.updateFulfillment(id, data)", "    await service.cancelFulfillment(id)"],
    ["original inverse fields", "    await service.updateFulfillment(id, data)", "    await service.updateFulfillment(id, {})"],
  ])("rejects changed %s", (_label, before, after) => {
    const original = read(); expect(original).toContain(before);
    expect(() => verify(root, { [key]: { target: original.replace(before, after) } })).toThrow();
  });
  it("rejects an added JSON reset write or native normalization replacement", () => {
    const original = read(), anchor = "    await service.updateFulfillment(id, data)";
    expect(original).toContain(anchor);
    expect(() => verify(root, { [key]: { target: original.replace(anchor,
      "    await service.updateFulfillment(id, { data: null, metadata: null })\n" + anchor) } })).toThrow();
    expect(() => verify(root, { [key]: { target: original.replace("    const updated =",
      "    data.metadata = {}\n    const updated =") } })).toThrow();
  });
  it("requires exactly one original native preimage adaptation anchor", () => {
    const original = native(), anchor = "getSelectsAndRelationsFromObjectArray([data])";
    expect(original).toContain(anchor);
    expect(() => verify(root, { [key]: { source: original.replace(anchor, "getSelectsAndRelationsFromObjectArray([])") } })).toThrow("native adaptation anchor");
    expect(() => verify(root, { [key]: { source: original + "\n    const { selects, relations } = " + anchor } })).toThrow("native adaptation anchor");
  });
});

describe("native shipment and nested Fulfillment update packet", () => {
  const shipment = "workflows/create-shipment.ts", update = "workflows/update-fulfillment.ts",
    guard = "steps/validate-shipment.ts", step = "steps/update-fulfillment.ts";
  it("admits exact imports, erased declarations and the existing compensation annotation", () => {
    expect(() => verifyFulfillmentShipmentCallbacks(root)).not.toThrow();
    expect(() => verifyFulfillmentShipmentCallbacks(root, { [step]: { target: target(step)
      .replace("const updated =", "const updated: unknown =") + "\n// erased formatting\n" } })).not.toThrow();
  });
  it.each([
    ["requested guard selector", shipment, "validateShipmentStep(input.id)", "validateShipmentStep('other')"],
    ["input spread", shipment, "...data.input,", "id: data.input.id,"],
    ["native generated date", shipment, "shipped_at: new Date()", "shipped_at: null"],
    ["nested update", shipment, "input: update,", "input: input,"],
    ["finite guard import", shipment, 'from "../steps/validate-shipment"', 'from "../steps"'],
    ["finite update import", update, 'from "../steps/update-fulfillment"', 'from "../steps"'],
    ["genuine update result", update, "new WorkflowResponse(updateFulfillmentStep(input))", "new WorkflowResponse(input)"],
    ["guard projection", guard, '["shipped_at", "canceled_at", "shipping_option_id"]', '["shipped_at", "shipping_option_id"]'],
    ["shipped eligibility", guard, "if (fulfillment.shipped_at)", "if (false)"],
    ["canceled eligibility", guard, "if (fulfillment.canceled_at)", "if (false)"],
    ["Option eligibility", guard, "if (!fulfillment.shipping_option_id)", "if (false)"],
    ["native refusal type", guard, "MedusaError.Types.NOT_ALLOWED", "MedusaError.Types.INVALID_DATA"],
    ["input-derived preimage", step, "getSelectsAndRelationsFromObjectArray([data],", "getSelectsAndRelationsFromObjectArray([],"],
    ["preimage scalar selection", step, "select: selects,", "select: [],"],
    ["preimage relations", step, "      relations,", "      relations: [],"],
    ["native update completion", step, "await service.updateFulfillment(id, data)", "void service.updateFulfillment(id, data)"],
    ["actual retained preimage", step, "new StepResponse(updated, fulfillment)", "new StepResponse(updated, input)"],
    ["native inverse", step, "    await service.updateFulfillment(id, data)", "    await service.updateFulfillment(id, {})"],
    ["finite inverse metadata", step, 'compensation: "transactionCovered"', 'compensation: "none"'],
  ])("rejects changed %s", (_name, file, before, after) => {
    const original = target(file); expect(original).toContain(before);
    expect(() => verifyFulfillmentShipmentCallbacks(root, { [file]: { target: original.replace(before, after) } }))
      .toThrow("Changed native Fulfillment shipment callback behavior");
  });
  it("rejects reordered guards, missing native import anchors and extra module runtime", () => {
    const original = target(guard), shipped = "if (fulfillment.shipped_at)", canceled = "if (fulfillment.canceled_at)";
    expect(() => verifyFulfillmentShipmentCallbacks(root, { [guard]: { target: original
      .replace(shipped, "if (__swap)").replace(canceled, shipped).replace("if (__swap)", canceled) } })).toThrow();
    for (const file of [shipment, update, guard, step]) {
      expect(() => verifyFulfillmentShipmentCallbacks(root, { [file]: { target: target(file) + "\nthrow new Error('extra');\n" } })).toThrow();
      const source = readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", file), "utf8");
      expect(() => verifyFulfillmentShipmentCallbacks(root, { [file]: { source: source.replace('@medusajs/framework/workflows-sdk', 'other-sdk') } }))
        .toThrow("native adaptation anchor");
    }
    expect(() => verifyFulfillmentShipmentCallbacks(root, { unknown: { target: "" } })).toThrow("unknown packet file");
  });
});

describe("standalone native Fulfillment cancellation packet", () => {
  const cancelling = "workflows/cancel-fulfillment.ts", step = "steps/cancel-fulfillment.ts";
  it("admits only direct native imports and the explicit void composer response", () => {
    expect(() => verifyFulfillmentCancellationCallbacks(root)).not.toThrow();
    expect(() => verifyFulfillmentCancellationCallbacks(root, { [step]: { target: target(step) + "\n// no runtime change\n" } })).not.toThrow();
  });
  it.each([
    ["service invocation", step, "await service.cancelFulfillment(id)", "await service.deleteFulfillment(id)"],
    ["awaited provider/module completion", step, "await service.cancelFulfillment(id)", "void service.cancelFulfillment(id)"],
    ["retained native ID", step, "new StepResponse(void 0, id)", "new StepResponse(void 0, 'other')"],
    ["void native step result", step, "new StepResponse(void 0, id)", "new StepResponse(id, id)"],
    ["original requested selector", cancelling, "cancelFulfillmentStep(input.id)", "cancelFulfillmentStep('other')"],
    ["void root result", cancelling, "new WorkflowResponse(void 0)", "new WorkflowResponse(input.id)"],
    ["finite direct step import", cancelling, 'from "../steps/cancel-fulfillment"', 'from "../steps"'],
  ])("rejects changed %s", (_name, file, before, after) => {
    const original = target(file), changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    expect(() => verifyFulfillmentCancellationCallbacks(root, { [file]: { target: changed } }))
      .toThrow("Changed native Fulfillment cancellation callback behavior");
  });
  it("rejects an invented business inverse and runtime outside the selected callbacks", () => {
    expect(() => verifyFulfillmentCancellationCallbacks(root, { [step]: { target: target(step)
      .replace("  }\n)", "  }, async () => { return null }\n)") } })).toThrow("Changed native Fulfillment cancellation callback behavior");
    for (const file of [cancelling, step])
      expect(() => verifyFulfillmentCancellationCallbacks(root, { [file]: { target: target(file) + "\nthrow new Error('extra');\n" } })).toThrow();
    expect(() => verifyFulfillmentCancellationCallbacks(root, { unknown: { target: "" } })).toThrow("unknown packet file");
  });
});

describe("complete native return Fulfillment creation and retained cancellation", () => {
  const creating = "workflows/create-return-fulfillment.ts", step = "steps/create-return-fulfillment.ts";
  it("admits only finite imports, erased selected Location types and compensation metadata", () => {
    expect(() => verifyReturnFulfillmentCreationCallbacks(root)).not.toThrow();
    expect(() => verifyReturnFulfillmentCreationCallbacks(root, { [step]: { target: target(step)
      .replace("const fulfillment =", "const fulfillment: FulfillmentDTO =") + "\n// erased declaration\n" } })).not.toThrow();
  });
  it.each([
    ["Location query root", creating, 'entry_point: "stock_location"', 'entry_point: "shipping_option"'],
    ["Location selector", creating, "id: input.location_id", "id: input.provider_id"],
    ["Location projection", creating, '"address.country_code",', '"address.first_name",'],
    ["singleton Location", creating, "list: false", "list: true"],
    ["missing Location refusal", creating, "throw_if_key_not_found: true", "throw_if_key_not_found: false"],
    ["native query identity", creating, 'name: "get-location"', 'name: "get-option"'],
    ["queried Location precedence", creating, "        ...input,\n        location,", "        location,\n        ...input,"],
    ["actual step input", creating, "createReturnFulfillmentStep(stepInput)", "createReturnFulfillmentStep(input)"],
    ["original workflow result", creating, "new WorkflowResponse(result)", "new WorkflowResponse(input)"],
    ["direct selected step import", creating, 'from "../steps/create-return-fulfillment"', 'from "../steps"'],
    ["native return method", step, "service.createReturnFulfillment(data)", "service.createFulfillment(data)"],
    ["awaited return creation", step, "await service.createReturnFulfillment(data)", "void service.createReturnFulfillment(data)"],
    ["retained created identity", step, "new StepResponse(fulfillment, fulfillment.id)", "new StepResponse(fulfillment, data.provider_id)"],
    ["empty inverse branch", step, "if (!id)", "if (false)"],
    ["original cancellation inverse", step, "await service.cancelFulfillment(id)", "await service.deleteFulfillments(id)"],
    ["retained inverse identity", step, "await service.cancelFulfillment(id)", 'await service.cancelFulfillment("other")'],
    ["transaction-covered inverse", step, 'compensation: "transactionCovered"', 'compensation: "none"'],
  ])("rejects changed %s", (_name, file, before, after) => {
    const current = target(file); expect(current).toContain(before);
    expect(() => verifyReturnFulfillmentCreationCallbacks(root, { [file]: { target: current.replace(before, after) } }))
      .toThrow("Changed native return Fulfillment creation callback behavior");
  });
  it.each([creating, step])("rejects additional executable behavior in %s", file => {
    expect(() => verifyReturnFulfillmentCreationCallbacks(root, { [file]: { target: target(file) + '\nthrow new Error("extra");' } })).toThrow();
  });
  it("requires the exact native adaptation anchors and selected source packet", () => {
    const source = readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", creating), "utf8");
    expect(source).toContain('from "../steps"');
    expect(() => verifyReturnFulfillmentCreationCallbacks(root, { [creating]: { source: source.replace('from "../steps"', 'from "../other"') } })).toThrow("native adaptation anchor");
    expect(() => verifyReturnFulfillmentCreationCallbacks(root, { "steps/unrelated.ts": { target: "" } })).toThrow("unknown packet file");
  });
});

describe("complete native Fulfillment creation and retained cancellation", () => {
  const creating = "workflows/create-fulfillment.ts", step = "steps/create-fulfillment.ts";
  it("authenticates the complete native callback packet with erased partial-query types", () => {
    expect(() => verifyFulfillmentCreationCallbacks(root)).not.toThrow();
    expect(() => verifyFulfillmentCreationCallbacks(root, { [creating]: { target: target(creating)
      .replace("const location =", "const location: unknown =") + "\n// erased formatting\n" } })).not.toThrow();
  });
  it.each([
    ["actual Location selector", creating, "variables: { id: input.location_id }", "variables: { id: input.provider_id }"],
    ["selected native Address country", creating, '"address.country_code"', '"address.city"'],
    ["singleton result", creating, "list: false", "list: true"],
    ["missing Location failure", creating, "throw_if_key_not_found: true", "throw_if_key_not_found: false"],
    ["queried Location overrides input", creating, "        location,", "        location: input.location,"],
    ["genuine service input", step, "service.createFulfillment(data)", "service.createFulfillment({})"],
    ["retained fulfillment identity", step, "new StepResponse(fulfillment, fulfillment.id)", "new StepResponse(fulfillment, data.location_id)"],
    ["native cancellation inverse", step, "service.cancelFulfillment(id)", "service.deleteFulfillment(id)"],
    ["finite compensation selection", step, 'compensation: "transactionCovered"', 'compensation: "none"'],
  ])("rejects changed %s", (_name, file, before, after) => {
    const original = target(file), changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    expect(() => verifyFulfillmentCreationCallbacks(root, { [file]: { target: changed } }))
      .toThrow("Changed native Fulfillment creation callback behavior");
  });
  it.each([creating, step])("rejects arbitrary extra runtime outside the native callbacks in %s", file => {
    for (const extra of ['\nthrow new Error("extra");', '\nexport async function additionalHandler() { return null; }']) {
      expect(() => verifyFulfillmentCreationCallbacks(root, { [file]: { target: target(file) + extra } })).toThrow();
    }
  });
  it("rejects changed import adaptation anchors and unrelated packet files", () => {
    const native = readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", creating), "utf8");
    expect(() => verifyFulfillmentCreationCallbacks(root, { [creating]: { source: native.replace('from "../steps"', 'from "../other-step"') } }))
      .toThrow("native adaptation anchor");
    expect(() => verifyFulfillmentCreationCallbacks(root, { unknown: { target: "" } })).toThrow("unknown packet file");
  });
});

describe("native Shipping Option deletion composer and retained IDs", () => {
  const deleting = "workflows/delete-shipping-options.ts", step = "steps/delete-shipping-options.ts";
  it("authenticates exact native execution with only finite SDK and import adaptations", () => {
    expect(() => verifyShippingOptionDeleteCallbacks(root)).not.toThrow();
  });
  it.each([
    ["raw requested identities", deleting, "deleteShippingOptionsStep(input.ids)", "deleteShippingOptionsStep([])"],
    ["actual affected Link map", deleting, "removeRemoteLinkStep(softDeletedEntities as WorkflowData<DeleteEntityInput>)", "removeRemoteLinkStep({})"],
    ["workflow event", deleting, "ShippingOptionWorkflowEvents.DELETED", "ShippingOptionWorkflowEvents.UPDATED"],
    ["raw event data", deleting, "data: input.ids", "data: []"],
    ["parallel native declaration", deleting, "    parallelize(", "    changedParallelize("],
    ["void root result", deleting, "new WorkflowResponse(void 0)", "new WorkflowResponse([])"],
    ["empty branch", step, "if (!ids?.length)", "if (false)"],
    ["native soft deletion", step, "service.softDeleteShippingOptions(ids)", "service.deleteShippingOptions(ids)"],
    ["affected map", step, "[Modules.FULFILLMENT]: softDeletedEntities", "[Modules.FULFILLMENT]: {}"],
    ["inverse early return", step, "if (!prevIds?.length)", "if (false)"],
    ["raw inverse identities", step, "service.restoreShippingOptions(prevIds)", "service.restoreShippingOptions([])"],
    ["transaction-covered inverse", step, 'compensation: "transactionCovered"', 'compensation: "none"'],
  ])("rejects changed %s", (_name, file, before, after) => {
    const current = target(file), changed = current.replace(before, after);
    expect(changed).not.toBe(current);
    expect(() => verifyShippingOptionDeleteCallbacks(root, { [file]: { target: changed } })).toThrow();
  });
  it("rejects extra runtime helpers outside the exact selected native bodies", () => {
    expect(() => verifyShippingOptionDeleteCallbacks(root, { [step]: { target: target(step) + '\nthrow new Error("extra");' } })).toThrow();
  });
});

describe("complete native Shipping Option root, helpers and retained callbacks", () => {
  it("admits the pinned packet, erased strict types and formatting", () => {
    expect(() => verifyShippingOptionCreateCallbacks(root)).not.toThrow();
    expect(() => verifyShippingOptionCreateCallbacks(root, { [prices]: { target: target(prices)
      .replace("const priceSetsData =", "const priceSetsData: CreatePriceSetDTO[] =") + "\n// erased formatting\n" } })).not.toThrow();
  });

  it.each([
    ["root provider parallel validation", workflow, "validateFulfillmentProvidersStep(input)", "validateFulfillmentProvidersStep([])"],
    ["root price parallel validation", workflow, "validateShippingOptionPricesStep(input)", "validateShippingOptionPricesStep([])"],
    ["root parallel scheduling", workflow, "parallelize(", "transform("],
    ["root empty prices default", workflow, "prices ?? []", "prices ?? [{}]"],
    ["root upsert input", workflow, "data.shippingOptions\n", "[]\n"],
    ["root ordinal correlation", workflow, "data.shippingOptions[shipping_option_index]!.id", "data.shippingOptions[0]!.id"],
    ["root price creation", workflow, "normalizedShippingOptionsPrices.shippingOptionsPrices", "[]"],
    ["root Link mapping", workflow, "price_sets: [item.priceSetId]", "price_sets: []"],
    ["root event name", workflow, "ShippingOptionWorkflowEvents.CREATED", '"other.created"'],
    ["root result", workflow, "new WorkflowResponse(createdShippingOptions)", "new WorkflowResponse([])"],
    ["price helper grouping", prices, "additionalRules[rule.attribute]", 'additionalRules["other"]'],
    ["price helper string override", prices, "if (isString(existingPriceRules))", "if (!isString(existingPriceRules))"],
    ["price helper operator", prices, "operator: rule.operator", 'operator: "eq"'],
    ["price helper numeric value", prices, "value: rule.value", "value: 0"],
    ["price currency branch", prices, 'if ("currency_code" in price)', 'if ("region_id" in price)'],
    ["price Region currency", prices, "regionToCurrencyMap.get(price.region_id)!", '"usd"'],
    ["price Region override order", prices, "region_id: price.region_id,\n        ...additionalRules,", "...additionalRules,\n        region_id: price.region_id,"],
    ["price empty create", prices, "if (!data?.length)", "if (false)"],
    ["price Region query deduplication", prices, "id: [...new Set(regionIds)]", "id: regionIds"],
    ["price Region query fields", prices, 'select: ["id", "currency_code"]', 'select: ["id"]'],
    ["price native create", prices, "pricingService.createPriceSets(priceSetsData)", "pricingService.createPriceSets([])"],
    ["price retained IDs", prices, "priceSets.map((priceSet) => priceSet.id)", "[]"],
    ["price inverse empty branch", prices, "if (!priceSetIds?.length)", "if (false)"],
    ["price physical inverse", prices, "pricingService.deletePriceSets(priceSetIds)", "pricingService.softDeletePriceSets(priceSetIds)"],
    ["Link query service", links, "service: LINKS.ShippingOptionPriceSet", "service: LINKS.LocationFulfillmentSet"],
    ["Link query filter", links, "shipping_option_id: shippingOptionIds", "shipping_option_id: []"],
    ["Link query fields", links, 'fields: ["shipping_option_id", "price_set_id"]', 'fields: ["shipping_option_id"]'],
    ["Link empty forward", links, "if (!data.length)", "if (false)"],
    ["Link empty selected prices", links, "if (!dataInputToProcess.length)", "if (false)"],
    ["Link unchanged membership", links, "if (alreadyExists)", "if (!alreadyExists)"],
    ["Link dismissal", links, "remoteLink.dismiss(linksToRemove)", "remoteLink.create(linksToRemove)"],
    ["Link create", links, "remoteLink.create(linksToCreate)", "remoteLink.dismiss(linksToCreate)"],
    ["Link parallel owner", links, "await promiseAll(promises)", "await Promise.race(promises)"],
    ["Link retained inverse mapping", links, "linksToCreate: linksToRemove", "linksToCreate: linksToCreate"],
    ["Link inverse empty branch", links, "if (!rollbackData)", "if (false)"],
    ["Link inverse dismissal", links, "remoteLink.dismiss(rollbackData.linksToRemove)", "remoteLink.create(rollbackData.linksToRemove)"],
    ["Link inverse recreation", links, "remoteLink.create(rollbackData.linksToCreate)", "remoteLink.dismiss(rollbackData.linksToCreate)"],
    ["upsert empty forward", upsert, "if (!input?.length)", "if (false)"],
    ["upsert update selection", upsert, "if (!!inputItem.id)", "if (!inputItem.id)"],
    ["upsert original preimages", upsert, "id: toUpdate.map((s) => s.id)", "id: []"],
    ["upsert native type precedence", upsert, "upsertShippingOption.type = inputItem.type_id", "upsertShippingOption.type = null"],
    ["upsert retained created IDs", upsert, "upsertedShippingOptionIds,\n        updatedIds", "updatedIds,\n        upsertedShippingOptionIds"],
    ["upsert inverse preimages", upsert, "shippingOptionIds.updatedPreviousData\n", "[]\n"],
    ["upsert inverse delete", upsert, "fulfillmentService.deleteShippingOptions(", "fulfillmentService.softDeleteShippingOptions("],
    ["provider prior Option query", providers, "id: input.map((d) => d.id).filter(Boolean)", "id: []"],
    ["provider required fields", providers, "data.service_zone_id && data.provider_id", "data.service_zone_id || data.provider_id"],
    ["provider graph root", providers, 'entryPoint: "service_zone"', 'entryPoint: "shipping_option"'],
    ["provider full graph projection", providers, 'fields: ["id", "fulfillment_set.locations.fulfillment_providers.id"]', 'fields: ["id"]'],
    ["provider admission", providers, "!fulfillmentProviders.includes(data.provider_id)", "fulfillmentProviders.includes(data.provider_id)"],
    ["provider refusal branch", providers, "if (invalidProviders.length)", "if (false)"],
    ["price validation previous Option query", validation, 'select: ["id", "price_type", "provider_id"]', 'select: ["id"]'],
    ["flat pricing branch", validation, "option.price_type === ShippingOptionPriceType.FLAT", "option.price_type !== ShippingOptionPriceType.FLAT"],
    ["calculated pricing branch", validation, "option.price_type === ShippingOptionPriceType.CALCULATED", "option.price_type !== ShippingOptionPriceType.CALCULATED"],
    ["provider calculation", validation, "calculatedOptions as CreateShippingOptionDTO[]", "[] as CreateShippingOptionDTO[]"],
    ["provider calculation refusal", validation, "validation.some((v) => !v)", "validation.some((v) => v)"],
    ["Region empty branch", validation, "if (regionIdSet.size === 0)", "if (false)"],
    ["Region validation selection", validation, "id: Array.from(regionIdSet)", "id: []"],
    ["Region validation completeness", validation, "regionList.length !== regionIdSet.size", "regionList.length === regionIdSet.size"],
    ["event empty forward", emit, "if (!input?.data)", "if (false)"],
    ["event group metadata", emit, "metadata.eventGroupId = context.eventGroupId", 'metadata.eventGroupId = "other"'],
    ["event name", emit, "name: input.eventName", 'name: "other.created"'],
    ["event options omission", emit, "input.options === undefined", "input.options !== undefined"],
    ["event publication", emit, "await eventBus.emit(message)", "await eventBus.emit([])"],
    ["event retained group", emit, "eventGroupId: context.eventGroupId", 'eventGroupId: "other"'],
    ["event inverse empty branch", emit, "if (!data || !data?.eventGroupId)", "if (false)"],
    ["event inverse clear", emit, "eventBus.clearGroupedEvents(data!.eventGroupId", 'eventBus.clearGroupedEvents("other"'],
    ["event inverse event names", emit, "eventNames: [data!.eventName]", "eventNames: []"],
  ])("rejects changed %s", (_label, file, before, after) => {
    const original = target(file); expect(original).toContain(before);
    expect(() => verifyShippingOptionCreateCallbacks(root, { [file]: { target: original.replace(before, after) } }))
      .toThrow("Changed native Shipping Option creation callback behavior");
  });

  it.each([prices, links, upsert, emit])("requires the admitted compensation metadata for %s", file => {
    const original = target(file); expect(original).toContain('compensation: "transactionCovered"');
    expect(() => verifyShippingOptionCreateCallbacks(root, { [file]: { target: original.replace('compensation: "transactionCovered"', 'compensation: "none"') } })).toThrow();
  });

  it("checks exact source adaptation anchors and refuses unrelated packet entries", () => {
    const native = readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", workflow), "utf8");
    const anchor = 'from "@medusajs/framework/workflows-sdk"';
    expect(native).toContain(anchor);
    for (const source of [native.replace(anchor, 'from "other-sdk"'), native + '\nimport {} from "@medusajs/framework/workflows-sdk"'])
      expect(() => verifyShippingOptionCreateCallbacks(root, { [workflow]: { source } })).toThrow("native adaptation anchor");
    expect(() => verifyShippingOptionCreateCallbacks(root, { unknown: { target: "" } })).toThrow("unknown packet file");
  });
});

describe("Region complete native manifest without Country default loading", () => {
  const source = readFileSync("third_party/medusa/upstream/packages/modules/region/src/static-manifest.ts", "utf8");
  const adapted = readFileSync("packages/medusa-region/src/static-manifest.ts", "utf8");
  it("admits only loader removal and erased declarations", () => {
    expect(() => verifyRegionManifestFork(source, adapted)).not.toThrow();
    expect(() => verifyRegionManifestFork(source, adapted.replace("regionModuleModels =", "regionModuleModels: unknown[] ="))).not.toThrow();
    expect(() => verifyRegionManifestFork(source, source)).toThrow();
  });
  it.each([
    ["Country model", "[Region, Country]", "[Region]"],
    ["Region model", "[Region, Country]", "[Country]"],
    ["model order", "[Region, Country]", "[Country, Region]"],
    ["native service", "service: RegionModuleService", "service: undefined"],
    ["native module service", "moduleService: RegionModuleService", "moduleService: undefined"],
    ["native joiner models", "models: regionModuleModels,", "models: [],"],
    ["module identity", "ModulesDefinition[Modules.REGION]", "ModulesDefinition[Modules.PRICING]"],
    ["loader reintroduction", "loaders: []", "loaders: [loadDefaults]"],
    ["extra executable runtime", "export const regionModuleDefinition", 'console.info("extra");\nexport const regionModuleDefinition'],
  ])("rejects changed %s", (_label, before, after) => {
    expect(adapted).toContain(before);
    expect(() => verifyRegionManifestFork(source, adapted.replace(before, after))).toThrow("Changed native Region manifest fork behavior");
  });
  it("requires exactly the native loader import and both loader arrays", () => {
    expect(() => verifyRegionManifestFork(source.replace('import loadDefaults from "./loaders/defaults"', 'import different from "./loaders/defaults"'), adapted)).toThrow("native adaptation anchor");
    expect(() => verifyRegionManifestFork(source.replace("loaders: [loadDefaults]", "loaders: []"), adapted)).toThrow("native adaptation anchor");
  });
});

describe("native Shipping Option updates and approved complete Rule inverses", () => {
  it("admits complete native forward behavior and approved inverse corrections", () => {
    expect(() => verifyShippingOptionUpdateCallbacks(root)).not.toThrow();
  });
  it.each([
    ["workflow validators", "workflows/update-shipping-options.ts", "validateFulfillmentProvidersStep(input)", "validateFulfillmentProvidersStep([])"],
    ["calculated price clearing", "workflows/update-shipping-options.ts", "prices: isCalculatedOption ? [] : prices", "prices"],
    ["update event", "workflows/update-shipping-options.ts", "ShippingOptionWorkflowEvents.UPDATED", "ShippingOptionWorkflowEvents.CREATED"],
    ["full Option Rule preimages", "steps/upsert-shipping-options.ts", '"rules.*"', '"rules.id"'],
    ["restore removed Option Rules", "steps/upsert-shipping-options.ts", "await service.createShippingOptionRules(missing)", "await service.createShippingOptionRules([])"],
    ["delete introduced Option Rules", "steps/upsert-shipping-options.ts", "await service.deleteShippingOptionRules(introduced)", "await service.deleteShippingOptionRules([])"],
    ["Option Rule ownership", "steps/upsert-shipping-options.ts", "shipping_option_id: option.id", 'shipping_option_id: "other"'],
    ["flat native Pricing Rule capture", "steps/set-shipping-options-prices.ts", "price_id: priorPrices.map(price => price.id)", "price_id: []"],
    ["Price Rule ownership", "steps/set-shipping-options-prices.ts", "rule.price_id === price.id", "true"],
    ["restore only surviving Price parents", "steps/set-shipping-options-prices.ts", "existingIds.has(price.id)", "true"],
    ["restore only missing Price Rules", "steps/set-shipping-options-prices.ts", "!existingRuleIds.has(rule.id)", "true"],
    ["Price Rule original identities", "steps/set-shipping-options-prices.ts", "await service.createPriceRules(missing)", "await service.createPriceRules([])"],
    ["scalar native update", "steps/set-shipping-options-prices.ts", "pricingService.updatePriceSets(shippingOptionData.price_set_id", 'pricingService.updatePriceSets("other"'],
    ["omitted price skip", "steps/set-shipping-options-prices.ts", "!isDefined(shippingOptionData.prices)", "false"],
  ])("rejects changed %s", (_label, file, before, after) => {
    const original = target(file); expect(original).toContain(before);
    expect(() => verifyShippingOptionUpdateCallbacks(root, { [file]: { target: original.replace(before, after) } }))
      .toThrow("Changed native Shipping Option update callback behavior");
  });
});
