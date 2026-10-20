import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareVariantPricingLink } from "../src/links/variant-pricing-service";
import { prepareCreatePriceListPricesWorkflow } from "../src/workflows/pricing/create-price-list-prices";
import { prepareUpdatePriceListsWorkflow } from "../src/workflows/pricing/update-price-lists";
import { priceListPriceCreationResources } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";

let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let link: Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
beforeAll(async () => {
  pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-price-creations"));
  link = await Effect.runPromise(prepareVariantPricingLink());
});

function preparation() {
  const compositions: AtomicWorkflowHostComposition[] = [];
  const selectionAccess = vi.fn((): never => { throw new Error("Preparation touched logical database selection"); });
  const logicalStorage: InstalledWorkflowModule["logicalStorage"] = {
    get ports(): never { return selectionAccess(); },
    get unique(): never { return selectionAccess(); },
    get schemaVersionId(): never { return selectionAccess(); },
    get source(): never { return selectionAccess(); },
    get initialization(): never { return selectionAccess(); },
  };
  const prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
    compositions.push(composition);
    return Effect.succeed({ close: Effect.void, newRequestKey: () => "preparation-only", run: () => Effect.succeed(null) });
  });
  return { compositions, prepare, selectionAccess, input: {
    execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare },
    modules: { pricing: { module: pricing.workflow, logicalStorage }, link: { module: link.workflow, logicalStorage } },
    revision: "a".repeat(64), subscribers: [{ id: "price-list-price-create", revision: "b".repeat(64) }],
  } };
}

describe("named Price List Price creation allowance preparation", () => {
  it("changes only calls to128 and retains all shared defaults including64events", () => {
    expect(priceListPriceCreationResources.calls).toBe(128);
    expect(defaultCommerceResources.calls).toBe(64);
    expect(priceListPriceCreationResources.eventMessages).toBe(64);
    expect(Object.isFrozen(priceListPriceCreationResources)).toBe(true);
    expect({ ...priceListPriceCreationResources, calls: defaultCommerceResources.calls }).toEqual(defaultCommerceResources);
  });

  it("captures absent and equal copies into the same two-participant native identity", async () => {
    const { input, compositions, prepare, selectionAccess } = preparation();
    const pricingCopy = { ...priceListPriceCreationResources, calls: 128 };
    const linkCopy = { ...priceListPriceCreationResources, calls: 128 };
    await Effect.runPromise(prepareCreatePriceListPricesWorkflow(input));
    await Effect.runPromise(prepareCreatePriceListPricesWorkflow({ ...input, modules: {
      pricing: { ...input.modules.pricing, logicalResources: pricingCopy }, link: { ...input.modules.link, logicalResources: linkCopy },
    } }));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(compositions[0]?.identityAndAccessPolicy).toEqual(compositions[1]?.identityAndAccessPolicy);
    expect(Object.hasOwn(input.modules.pricing, "logicalResources")).toBe(false);
    expect(Object.hasOwn(input.modules.link, "logicalResources")).toBe(false);
    for (const composition of compositions) {
      expect(composition.requestCallLimit).toBe(128);
      expect(composition.operationScheduling).toBe("queued");
      expect(composition.borrowedOperationScheduling).toBe("queued");
      expect(composition.requestEventLimit).toBeUndefined();
      expect(composition.requestByteLimit).toBeUndefined();
      expect(composition.requestCommandMs).toBeUndefined();
      expect(composition.participants).toHaveLength(2);
      for (const participant of composition.participants) {
        if (!("logicalResources" in participant)) throw new Error("Missing logical participant resources");
        expect(participant.logicalResources).toEqual(priceListPriceCreationResources);
        expect(participant.logicalResources).not.toBe(pricingCopy);
        expect(participant.logicalResources).not.toBe(linkCopy);
        expect(participant.logicalStorage).toBe(input.modules.pricing.logicalStorage);
      }
    }
    pricingCopy.calls = 64; linkCopy.calls = 129;
    for (const composition of compositions) for (const participant of composition.participants)
      expect(participant).toHaveProperty("logicalResources.calls", 128);
    expect(selectionAccess).not.toHaveBeenCalled();
  });

  it("refuses caller knobs and unequal complete resources on either participant before execution", async () => {
    const { input, prepare } = preparation();
    const refused: unknown[] = [
      { ...input, requestCallLimit: 128 }, { ...input, requestEventLimit: 64 },
      { ...input, requestByteLimit: priceListPriceCreationResources.commandBytes },
      { ...input, logicalResources: priceListPriceCreationResources },
      { ...input, operationScheduling: "queued" }, { ...input, borrowedOperationScheduling: "queued" },
    ];
    for (const name of ["pricing", "link"] as const) for (const logicalResources of [
      { ...priceListPriceCreationResources, calls: 64 }, { ...priceListPriceCreationResources, calls: 129 },
      { ...priceListPriceCreationResources, eventMessages: 65 },
      { ...priceListPriceCreationResources, queryRows: priceListPriceCreationResources.queryRows + 1 },
      { ...priceListPriceCreationResources, commandBytes: priceListPriceCreationResources.commandBytes + 1 },
    ]) refused.push({ ...input, modules: { ...input.modules, [name]: { ...input.modules[name], logicalResources } } });
    for (const value of refused)
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareCreatePriceListPricesWorkflow, undefined, [value]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses resource accessors without invoking getters and rejects cross-wired module authority", async () => {
    const { input, prepare } = preparation(), getter = vi.fn(() => 128);
    for (const name of ["pricing", "link"] as const) {
      const resources = Object.defineProperty({ ...priceListPriceCreationResources }, "calls", { enumerable: true, get: getter });
      const binding = Object.defineProperty({ ...input.modules[name] }, "logicalResources", { enumerable: true, get: getter });
      for (const [member, reason] of [
        [{ ...input.modules[name], logicalResources: resources }, "invalidInput"], [binding, "unsupportedProfile"],
      ] as const)
        expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareCreatePriceListPricesWorkflow, undefined,
          [{ ...input, modules: { ...input.modules, [name]: member } }]))))
          .toMatchObject({ _tag: "Failure", failure: { reason } });
    }
    const creation = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    for (const module of [creation.workflow, { ...pricing.workflow }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareCreatePriceListPricesWorkflow, undefined,
        [{ ...input, modules: { ...input.modules, pricing: { ...input.modules.pricing, module } } }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareCreatePriceListPricesWorkflow, undefined,
      [{ ...input, modules: { ...input.modules, link: { ...input.modules.link, module: pricing.workflow } } }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps the independent Price List update profile at unselected defaults", async () => {
    const { input, compositions, selectionAccess } = preparation();
    const update = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
    await Effect.runPromise(prepareUpdatePriceListsWorkflow({ execution: input.execution,
      pricing: { module: update.workflow, logicalStorage: input.modules.pricing.logicalStorage },
      revision: input.revision, subscribers: input.subscribers }));
    const composition = compositions[0];
    if (!composition) throw new Error("Missing independent update composition");
    expect(composition.requestCallLimit).toBeUndefined();
    expect(composition.participants).toHaveLength(1);
    expect(Object.hasOwn(composition.participants[0] ?? {}, "logicalResources")).toBe(false);
    expect(selectionAccess).not.toHaveBeenCalled();
    expect(defaultCommerceResources.calls).toBe(64);
  });
});
