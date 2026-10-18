import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { makeShippingOptionDeletionCommands } from "../src/modules/fulfillment/shipping-option-delete-service";
import { makeLocalShippingOptionCreationCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareShippingOptionPriceSetLink } from "../src/links/shipping-option-price-set-service";
import { prepareShippingOptionDeletionLinkResource } from "../src/links/shipping-option-deletion";
import { ShippingOptionDeletionInput, prepareShippingOptionDeletionResources, prepareShippingOptionDeletionWorkflow,
  shippingOptionDeletionEvents } from "../src/workflows/fulfillment/delete-shipping-options";
import { workflowResourceSelections } from "../src/workflow/resources";
import { shippingOptionDeletionResources, shippingOptionDeletionCommandMs } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";
import { captureAtomicCommerceEvents } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";

const decode = commerceDecoder(ShippingOptionDeletionInput, "invalidInput");
const selected = Effect.gen(function* () {
  const fulfillment = yield* makeShippingOptionDeletionCommands(), pricing = yield* makeLocalPricingCommands("shipping-options"),
    priceSetLinks = yield* prepareShippingOptionPriceSetLink();
  const modules = { fulfillment: fulfillment.workflow, pricing: pricing.workflow, priceSetLinks: priceSetLinks.workflow };
  const link = yield* Effect.fromResult(prepareShippingOptionDeletionLinkResource({ fulfillment: modules.fulfillment, priceSet: priceSetLinks.nativeService, pricing: modules.pricing }));
  return { modules, link, priceSetLinks };
});
let genuine: Effect.Success<typeof selected>;
beforeAll(async () => { genuine = await Effect.runPromise(selected); });

describe("native Shipping Option deletion contract", () => {
  it("preserves the raw native ids array including missing and repeated IDs", () => {
    for (const value of [{ ids: [] }, { ids: [" raw "] }, { ids: ["z", "missing", "a", "z"] }])
      expect(Result.getOrThrow(decode(value))).toEqual(value);
    for (const value of [[], {}, { ids: "id" }, { ids: [""] }, { ids: [1] }, { ids: ["id"], extra: true },
      { ids: Array.from({ length: 5 }, () => "id") }, { ids: [], created_at: "retained" }])
      expect(Result.isFailure(decode(value))).toBe(true);
  });

  it("selects only the genuine lifecycle owners, hides cascades and excludes Query/provider execution", () => {
    const resources = Result.getOrThrow(prepareShippingOptionDeletionResources(genuine.modules, genuine.link));
    expect(workflowResourceSelections(resources)?.map(member => [member.name, member.methods, member.graph, member.expose])).toEqual([
      ["fulfillment", ["softDeleteShippingOptions", "restoreShippingOptions"], false, undefined],
      ["priceSetLinks", ["softDelete", "restore"], false, false],
      ["pricing", ["softDeletePriceSets", "restorePriceSets"], false, false],
    ]);
    expect(Result.isFailure(prepareShippingOptionDeletionResources({ ...genuine.modules, fulfillment: { ...genuine.modules.fulfillment } }, genuine.link))).toBe(true);
    expect(Result.isFailure(prepareShippingOptionDeletionResources(genuine.modules, { ...genuine.link }))).toBe(true);
  });

  it("rejects creation/profile substitutions, additional modules and private resource forgeries", async () => {
    const creation = await Effect.runPromise(makeLocalShippingOptionCreationCommands()), pricing = await Effect.runPromise(makeLocalPricingCommands());
    for (const modules of [{ ...genuine.modules, fulfillment: creation.workflow }, { ...genuine.modules, pricing: pricing.workflow },
      { ...genuine.modules, query: genuine.modules.fulfillment }, { fulfillment: genuine.modules.fulfillment, pricing: genuine.modules.pricing }])
      expect(Result.isFailure(Reflect.apply(prepareShippingOptionDeletionResources, undefined, [modules, genuine.link]))).toBe(true);
    expect(Result.isFailure(prepareShippingOptionDeletionLinkResource({ fulfillment: creation.workflow, priceSet: genuine.priceSetLinks.nativeService,
      pricing: genuine.modules.pricing }))).toBe(true);
  });

  it("admits the named allowance and grants pending cancellation only to raw workflow messages", async () => {
    const modules: Record<string, InstalledWorkflowModule> = {};
    for (const [name, module] of Object.entries(genuine.modules)) Object.defineProperty(modules, name, {
      enumerable: true, value: { module, logicalStorage: {}, logicalPublication: "mixed" },
    });
    const compositions: AtomicWorkflowHostComposition[] = [], prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
      compositions.push(composition); return Effect.succeed({ close: Effect.void, newRequestKey: () => "unit-key", run: () => Effect.succeed(null) });
    });
    const input = { execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare }, modules, link: genuine.link,
      revision: "a".repeat(64), subscribers: [{ id: "shipping-deletion", revision: "b".repeat(64) }] };
    await Effect.runPromise(Reflect.apply(prepareShippingOptionDeletionWorkflow, undefined, [input]));
    expect(prepare).toHaveBeenCalledOnce(); const composition = compositions[0];
    if (composition?.events === undefined) throw new Error("Missing genuine deletion composition");
    expect(composition.participants).toHaveLength(3);
    expect(composition).toMatchObject({ operationScheduling: "queued", requestCallLimit: shippingOptionDeletionResources.calls,
      requestEventLimit: shippingOptionDeletionResources.eventMessages, requestByteLimit: shippingOptionDeletionResources.commandBytes,
      requestCommandMs: shippingOptionDeletionCommandMs });
    for (const [index, member] of composition.participants.entries()) {
      if (!("logicalResources" in member)) throw new Error("Missing genuine logical allowance");
      expect(member.logicalResources).toEqual(shippingOptionDeletionResources);
      expect("logicalPublication" in member ? member.logicalPublication : undefined).toBe(index === 2 ? "mixed" : undefined);
    }
    const definitions = Result.getOrThrow(captureAtomicCommerceEvents(composition.events)).definitions;
    expect(definitions.filter(item => item.definition?.pendingCancellation).map(item => item.definition?.name)).toEqual(["shipping-option.deleted"]);
    expect(definitions.filter(item => item.definition?.internal).every(item => item.definition?.pendingCancellation === undefined)).toBe(true);
    const altered = { ...modules };
    Object.defineProperty(altered, "fulfillment", { enumerable: true, value: { module: genuine.modules.fulfillment,
      logicalStorage: {}, logicalResources: { ...shippingOptionDeletionResources, calls: shippingOptionDeletionResources.calls - 1 } } });
    for (const options of [{ ...input, requestCallLimit: 64 }, { ...input, query: {} }, { ...input, provider: {} }, { ...input, modules: altered }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionDeletionWorkflow, undefined, [options]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("correlates exact raw workflow IDs with the genuine call and refuses extra module invocations", async () => {
    const events = shippingOptionDeletionEvents(genuine.modules.fulfillment);
    await Effect.runPromise(events.validate([], { calls: () => [], results: () => [] }));
    const message = { contract: "shipping-option.deleted", contractRevision: "a".repeat(64), producerRevision: "a".repeat(64), internal: false,
      subscribers: [{ id: "subscriber", revision: "b".repeat(64) }],
      message: { name: "shipping-option.deleted", data: "foreign", metadata: { eventGroupId: "group" } }, group: "group" };
    await Effect.runPromise(events.validate([message], { calls: () => [{ input: ["foreign"], result: {} }], results: () => [] }));
    for (const calls of [[{ input: ["expected"], result: {} }], [{ input: [], result: {} }, { input: [], result: {} }]])
      expect(await Effect.runPromise(Effect.result(events.validate([message], { calls: () => calls, results: () => [] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
