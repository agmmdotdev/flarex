// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyPriceListPriceRemovalCallbacks, verifyPriceListPriceRemovalSelection } from "./check-medusa-price-list-prices-source.mjs";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const read = (/** @type {string} */ file) => readFileSync(file, "utf8");
const paths = ["price-list/workflows/remove-price-list-prices.ts", "price-list/steps/remove-price-list-prices.ts"];
const originals = paths.map(file => read("third_party/medusa/upstream/packages/core/core-flows/src/" + file));
const targets = paths.map(file => read("packages/medusa-core-flows/src/" + file));

describe("native PriceList Price removal callback provenance", () => {
  it("admits only portable imports and transaction-covered compensation metadata", () => {
    expect(() => verifyPriceListPriceRemovalCallbacks(originals[0], targets[0], originals[1], targets[1])).not.toThrow();
  });
  it.each([
    [0, "actual root input", "removePriceListPricesStep(input.ids)", "removePriceListPricesStep([])"],
    [0, "public output", "WorkflowResponse<string[]>", "WorkflowResponse<unknown[]>"],
    [1, "typed raw selectors", "RemovePriceListPricesStepInput = string[]", "RemovePriceListPricesStepInput = unknown[]"],
    [1, "empty dependency", "if (!ids.length)", "if (false)"],
    [1, "Pricing resource", "Modules.PRICING", "Modules.PRODUCT"],
    [1, "raw Price selector", "{ id: ids }", "{ price_list_id: ids }"],
    [1, "native List population", 'relations: ["price_list"]', "relations: []"],
    [1, "actual selected identities", "prices.map((price) => price.id)", "ids"],
    [1, "native soft deletion", "softDeletePrices(priceIds)", "removePrices(priceIds)"],
    [1, "retained actual identities", "new StepResponse(priceIds, priceIds)", "new StepResponse(priceIds, ids)"],
    [1, "empty inverse", "if (!ids?.length)", "if (false)"],
    [1, "native current-graph inverse", "restorePrices(ids)", "restorePriceListPrices(ids)"],
    [1, "atomic coverage", 'compensation: "transactionCovered"', 'compensation: "independent"'],
    [1, "input order", "{ id: ids }", "{ id: ids.sort() }"],
  ])("rejects changed %s %s", (index, _label, before, after) => {
    const selected = Number(index), changed = targets[selected].replace(String(before), String(after));
    expect(changed).not.toBe(targets[selected]);
    const mutated = targets.map((source, targetIndex) => targetIndex === selected ? changed : source);
    expect(() => verifyPriceListPriceRemovalCallbacks(originals[0], mutated[0], originals[1], mutated[1]))
      .toThrow("Changed native PriceList Price removal callback behavior");
  });
  it("rejects extra top-level execution", () => {
    expect(() => verifyPriceListPriceRemovalCallbacks(originals[0], targets[0] + "\nthrow new Error('extra');", originals[1], targets[1])).toThrow();
  });
  // The existing whole-promotion proof authenticates all native programs before
  // checking manifest pairs. Reuse its established local expensive-case cap.
  it.each([0, 1].flatMap(selected => [
    [selected, { classification: "authored" }],
    [selected, { source: "third_party/medusa/upstream/packages/core/core-flows/src/price-list/steps/delete-price-lists.ts" }],
    [selected, { target: "packages/medusa-core-flows/src/price-list/steps/unrelated-removal.ts" }],
  ]))("binds source, target and classification for pair %s against %j", (selected, mutation) => {
    /** @type {ReturnType<typeof verifyCurrencyPromotion>} */
    const promotion = JSON.parse(read("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json"));
    const target = "packages/medusa-core-flows/src/" + paths[Number(selected)];
    const changed = structuredClone(promotion), entry = changed.files.find(file => file.target === target);
    if (!entry) throw new Error("Missing removal provenance");
    Object.assign(entry, mutation);
    expect(() => verifyCurrencyPromotion(process.cwd(), changed)).toThrow("PriceList Price removal outside its exact pinned source pair");
  }, 15_000);
});

describe("private PriceList Price removal authority selection", () => {
  const sources = {
    facade: read("packages/medusa-adapter/src/workflows/pricing/remove-price-list-prices.ts"),
    policy: read("packages/medusa-adapter/src/workflow/policy.ts"),
  };
  it("admits only the original three Pricing methods and copied default resources", () => {
    expect(() => verifyPriceListPriceRemovalSelection(sources.facade, sources.policy)).not.toThrow();
  });
  it.each([
    ["facade", "trusted module", 'definition?.source.name !== "flarex-pricing-local"', 'definition?.source.name !== "other-pricing"'],
    ["facade", "removal profile", 'definition.source.profile !== "pricing-price-list-price-removals"', 'definition.source.profile !== "pricing-price-list-price-updates"'],
    ["facade", "native lifecycle", 'methods: ["listPrices", "softDeletePrices", "restorePrices"]', 'methods: ["listPrices", "removePrices", "restorePrices"]'],
    ["facade", "extra method", 'methods: ["listPrices", "softDeletePrices", "restorePrices"]', 'methods: ["listPrices", "softDeletePrices", "restorePrices", "deletePriceLists"]'],
    ["facade", "graph refusal", "graph: false", "graph: true"],
    ["facade", "selected Pricing resource", '["pricing"]))', '["pricing", "link"]))'],
    ["facade", "unsupported options", '!["execution", "pricing", "revision", "subscribers"].includes(key)', "false"],
    ["facade", "resource equality", "!jsonEqual(installed.pricing.logicalResources, priceListPriceRemovalResources)", "false"],
    ["facade", "mixed publication", 'logicalPublication: "mixed"', 'logicalPublication: "readOnly"'],
    ["facade", "call allowance", "requestCallLimit: priceListPriceRemovalResources.calls", "requestCallLimit: 128"],
    ["facade", "operation queue", 'operationScheduling: "queued"', 'operationScheduling: "parallel"'],
    ["facade", "borrowed queue", 'borrowedOperationScheduling: "queued"', 'borrowedOperationScheduling: "parallel"'],
    ["facade", "native prepared workflow", "removePriceListPricesWorkflow.prepare()", "createPriceListPricesWorkflow.prepare()"],
    ["facade", "event capture", "events: internalModuleWorkflowEvents", "events: undefined"],
    ["facade", "public result", "output: PriceListPriceRemovalWorkflowInput.fields.ids", "output: Schema.Unknown"],
    ["facade", "typed input", "readonly revision: string", "readonly revision: unknown"],
    ["facade", "policy owner", 'from "../../workflow/policy"', 'from "../../workflow/other-policy"'],
    ["policy", "default owner", 'from "@flarex/persistence-postgres/internal/commerce-values"', 'from "./commerce-values"'],
    ["policy", "inherited128calls", "priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources })", "priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources, calls: 128 })"],
    ["policy", "expanded events", "priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources })", "priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources, events: 128 })"],
    ["policy", "creation allowance", "priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources })", "priceListPriceRemovalResources = priceListPriceCreationResources"],
    ["policy", "mutable declaration", "export const priceListPriceRemovalResources", "export let priceListPriceRemovalResources"],
  ])("rejects %s changed %s", (key, _label, before, after) => {
    const field = /** @type {keyof typeof sources} */ (key);
    const changed = sources[field].replace(before, after);
    expect(changed).not.toBe(sources[field]);
    const mutation = { ...sources, [field]: changed };
    expect(() => verifyPriceListPriceRemovalSelection(mutation.facade, mutation.policy))
      .toThrow("Changed PriceList Price removal resource selection");
  });
  it("rejects extra host execution", () => {
    expect(() => verifyPriceListPriceRemovalSelection(sources.facade + "\nthrow new Error('extra');", sources.policy))
      .toThrow("Changed PriceList Price removal resource selection");
  });
});
