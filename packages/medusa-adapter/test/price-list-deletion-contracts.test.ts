import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { preparePriceListDeletionLinkResource } from "../src/links/price-list-deletion";
import { prepareDeletePriceListsWorkflow } from "../src/workflows/pricing/delete-price-lists";
import { prepareUpdatePriceListsWorkflow } from "../src/workflows/pricing/update-price-lists";
import { priceListDeletionResources } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";

let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let link: Result.Result.Success<ReturnType<typeof preparePriceListDeletionLinkResource>>;
beforeAll(async () => { pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-deletions")); link = Result.getOrThrow(preparePriceListDeletionLinkResource()); });
function preparation() {
  const compositions: AtomicWorkflowHostComposition[] = [];
  // This port observes composition only. It must never inspect or borrow the
  // database authority which a real trusted execution owner closes over.
  const selectionAccess = vi.fn((): never => { throw new Error("Preparation touched logical database selection"); });
  const logicalStorage: InstalledWorkflowModule["logicalStorage"] = {
    get ports(): never { return selectionAccess(); },
    get unique(): never { return selectionAccess(); },
    get schemaVersionId(): never { return selectionAccess(); },
    get source(): never { return selectionAccess(); },
    get initialization(): never { return selectionAccess(); },
  };
  const prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
    compositions.push(composition); return Effect.succeed({ close: Effect.void, newRequestKey: () => "preparation-only", run: () => Effect.succeed(null) });
  });
  return { compositions, prepare, selectionAccess, input: { execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare },
    pricing: { module: pricing.workflow, logicalStorage }, link, revision: "a".repeat(64), subscribers: [{ id: "price-list-delete", revision: "b".repeat(64) }] } };
}
const decodeIdentity = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Struct({
  resources: Schema.Array(Schema.Struct({ name: Schema.String, profile: Schema.String, graph: Schema.Null,
    methods: Schema.Array(Schema.Struct({ name: Schema.String })) })),
  composedResources: Schema.Array(Schema.Struct({ name: Schema.String, methods: Schema.Array(Schema.String), dependencies: Schema.Array(Schema.Json) })),
}) }));

describe("named Price List deletion allowance preparation", () => {
  it("changes only calls to128 and keeps the complete shared defaults including64events", () => {
    expect(priceListDeletionResources.calls).toBe(128); expect(defaultCommerceResources.calls).toBe(64);
    expect(priceListDeletionResources.eventMessages).toBe(64); expect(Object.isFrozen(priceListDeletionResources)).toBe(true);
    expect({ ...priceListDeletionResources, calls: defaultCommerceResources.calls }).toEqual(defaultCommerceResources);
  });

  it("binds absent and equal captured resource copies to the authentic lifecycle-only composition", async () => {
    const { input, compositions, prepare, selectionAccess } = preparation(), selectedCopy = { ...priceListDeletionResources, calls: 128 };
    await Effect.runPromise(prepareDeletePriceListsWorkflow(input));
    await Effect.runPromise(prepareDeletePriceListsWorkflow({ ...input, pricing: { ...input.pricing, logicalResources: selectedCopy } }));
    expect(prepare).toHaveBeenCalledTimes(2); expect(Object.hasOwn(input.pricing, "logicalResources")).toBe(false);
    for (const composition of compositions) {
      expect(composition.requestCallLimit).toBe(128); expect(composition.operationScheduling).toBe("queued"); expect(composition.participants).toHaveLength(1);
      expect(composition.requestEventLimit).toBeUndefined(); expect(composition.requestByteLimit).toBeUndefined(); expect(composition.requestCommandMs).toBeUndefined();
      const participant = composition.participants[0];
      if (!participant || !("logicalResources" in participant)) throw new Error("Missing named logical participant allowance");
      expect(participant.logicalResources).toEqual(priceListDeletionResources); expect(participant.logicalResources).not.toBe(selectedCopy);
      expect(participant.logicalStorage).toBe(input.pricing.logicalStorage);
      expect(participant.logicalResources?.eventMessages).toBe(defaultCommerceResources.eventMessages);
      const identity = decodeIdentity(composition.identityAndAccessPolicy);
      expect(identity.workflow.resources).toEqual([{ name: "pricing", profile: "pricing-price-list-deletions", graph: null,
        methods: [{ name: "softDeletePriceLists" }, { name: "restorePriceLists" }] }]);
      expect(identity.workflow.composedResources).toEqual([{ name: "link", methods: ["delete", "restore"], dependencies: [] }]);
    }
    expect(compositions[0]?.identityAndAccessPolicy).toEqual(compositions[1]?.identityAndAccessPolicy);
    selectedCopy.calls = 64;
    for (const composition of compositions) expect(composition.participants[0]).toHaveProperty("logicalResources.calls", 128);
    expect(selectionAccess).not.toHaveBeenCalled();
  });

  it("refuses all caller allowance knobs and differing complete participant resource profiles before execution", async () => {
    const { input, prepare } = preparation();
    for (const options of [{ ...input, requestCallLimit: 128 }, { ...input, requestEventLimit: 64 }, { ...input, logicalResources: priceListDeletionResources },
      { ...input, requestByteLimit: priceListDeletionResources.commandBytes },
      ...[{ ...priceListDeletionResources, calls: 64 }, { ...priceListDeletionResources, calls: 129 },
        { ...priceListDeletionResources, eventMessages: 65 }, { ...priceListDeletionResources, queryRows: priceListDeletionResources.queryRows + 1 }]
        .map(logicalResources => ({ ...input, pricing: { ...input.pricing, logicalResources } }))]) {
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareDeletePriceListsWorkflow, undefined, [options]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses accessors and unauthenticated or cross-wired module/Link identities without reading getters", async () => {
    const { input, prepare } = preparation(), getter = vi.fn(() => priceListDeletionResources);
    const resourceGetter = Object.defineProperty({ ...priceListDeletionResources }, "calls", { enumerable: true, get: getter });
    const bindingGetter = Object.defineProperty({ ...input.pricing }, "logicalResources", { enumerable: true, get: getter });
    const topGetter = Object.defineProperty({ ...input }, "requestCallLimit", { enumerable: true, get: getter });
    // The nested policy reaches the private JSON descriptor owner; registration
    // and facade accessors are refused by the workflow record owner instead.
    for (const { options, reason } of [
      { options: { ...input, pricing: { ...input.pricing, logicalResources: resourceGetter } }, reason: "invalidInput" },
      { options: { ...input, pricing: bindingGetter }, reason: "unsupportedProfile" },
      { options: topGetter, reason: "unsupportedProfile" },
    ])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareDeletePriceListsWorkflow, undefined, [options]))))
        .toMatchObject({ _tag: "Failure", failure: { reason } });
    const creation = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    for (const module of [creation.workflow, { ...pricing.workflow }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareDeletePriceListsWorkflow, undefined, [{ ...input, pricing: { ...input.pricing, module } }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareDeletePriceListsWorkflow, undefined, [{ ...input, link: { ...link } }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps the independent Price List update preparation unselected at its original defaults", async () => {
    const { input, compositions, prepare, selectionAccess } = preparation(), update = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
    await Effect.runPromise(prepareUpdatePriceListsWorkflow({ execution: input.execution, pricing: { module: update.workflow, logicalStorage: input.pricing.logicalStorage },
      revision: input.revision, subscribers: input.subscribers }));
    expect(prepare).toHaveBeenCalledOnce(); const composition = compositions[0];
    if (!composition) throw new Error("Missing independent update composition");
    expect(composition.requestCallLimit).toBeUndefined(); expect(composition.requestEventLimit).toBeUndefined();
    expect(composition.participants).toHaveLength(1); expect(Object.hasOwn(composition.participants[0] ?? {}, "logicalResources")).toBe(false);
    expect(selectionAccess).not.toHaveBeenCalled();
    expect(defaultCommerceResources.calls).toBe(64); expect(defaultCommerceResources.eventMessages).toBe(64);
  });
});
