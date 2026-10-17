import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { updateStoresWorkflow } from "@medusajs/core-flows/store/update-stores";

const prepared = Result.getOrThrow(updateStoresWorkflow.prepare());
const store = prepared.nodes.find(node => node.name === "update-stores");
const pricing = prepared.nodes.find(node => node.name === "update-price-preferences-as-array");
const condition = prepared.nodes.find(node => node.kind === "condition");
if (store?.kind !== "step" || pricing?.kind !== "step" || condition?.kind !== "condition" || store.compensate === undefined)
  throw new Error("Expected genuine native Store/Pricing callbacks and when branch");
const storeStep = store, pricingStep = pricing, branch = condition, inverse = store.compensate;
const storeResolution = prepared.resolution.inputs[prepared.nodes.indexOf(storeStep)];
const pricingResolution = prepared.resolution.inputs[prepared.nodes.indexOf(pricingStep)];
if (storeResolution?.kind !== "reference" || pricingResolution?.kind !== "reference" ||
  storeResolution.reference.kind !== "transform" || pricingResolution.reference.kind !== "transform" ||
  storeResolution.reference.transform === undefined || pricingResolution.reference.transform === undefined)
  throw new Error("Expected genuine native deferred transforms");
const normalize = storeResolution.reference.transform, preferences = pricingResolution.reference.transform;
const context = (modules: Readonly<Record<string, unknown>>, resolves: string[] = []): StepExecutionContext => ({
  eventGroupId: "native-store-update-probe", container: { resolve<T>(name: string): T {
    resolves.push(name); if (!(name in modules)) throw new Error("Unexpected native provider: " + name);
    // SAFETY: this trusted callback test owns every fake provider and its invocation contract.
    return modules[name] as T;
  } },
});

describe("genuine native Store update composer and retained callbacks", () => {
  it("retains the exact native condition, deferred transforms and Pricing guard", async () => {
    expect(prepared.name).toBe("update-stores");
    expect(prepared.nodes.map(node => node.kind)).toEqual(["step", "condition", "step", "branchResult"]);
    expect(storeStep.guards).toEqual([]); expect(pricingStep.guards).toEqual([branch.id]);
    const ctx = context({});
    for (const update of [{ name: " Name " }, { supported_currencies: [] }]) {
      const input = { selector: { id: "missing" }, update };
      expect(await normalize({ input }, ctx)).toBe(input);
      expect(await branch.invoke({ input }, ctx)).toBe(false);
    }
    const input = { selector: { id: "missing" }, update: { name: " Name ", supported_currencies: [
      { currency_code: "USD", is_default: true, is_tax_inclusive: true },
      { currency_code: "USD", is_tax_inclusive: false },
    ] } };
    const original = structuredClone(input);
    expect(await normalize({ input }, ctx)).toEqual({ selector: input.selector, update: { name: " Name ", supported_currencies: [
      { currency_code: "USD", is_default: true }, { currency_code: "USD", is_default: undefined },
    ] } });
    expect(await branch.invoke({ input }, ctx)).toBe(true);
    expect(await preferences({ input }, ctx)).toEqual([
      { attribute: "currency_code", value: "USD", is_tax_inclusive: true },
      { attribute: "currency_code", value: "USD", is_tax_inclusive: false },
    ]);
    expect(input).toEqual(original);
  });

  it("still reaches native Pricing mutation when Store selection matches no rows", async () => {
    const calls: unknown[] = [];
    const ctx = context({ store: {
      listStores: async (...args: unknown[]) => { calls.push(["listStores", ...args]); return []; },
      updateStores: async (...args: unknown[]) => { calls.push(["updateStores", ...args]); return []; },
    }, pricing: {
      listPricePreferences: async (...args: unknown[]) => { calls.push(["listPricePreferences", ...args]); return []; },
      upsertPricePreferences: async (rows: unknown) => { calls.push(["upsertPricePreferences", rows]); return []; },
    } });
    const input = { selector: { id: "missing" }, update: { supported_currencies: [
      { currency_code: "USD", is_default: true, is_tax_inclusive: true },
    ] } };
    const normalized = await normalize({ input }, ctx);
    const result = await storeStep.invoke(normalized, ctx);
    expect(result).toBeInstanceOf(StepResponse);
    expect(result).toMatchObject({ output: [], compensateInput: [] });
    expect(await branch.invoke({ input }, ctx)).toBe(true);
    await pricingStep.invoke(await preferences({ input }, ctx), ctx);
    expect(calls).toEqual([
      ["listStores", { id: "missing" }, { select: ["supported_currencies.currency_code", "supported_currencies.is_default"], relations: ["supported_currencies"] }],
      ["updateStores", { id: "missing" }, { supported_currencies: [{ currency_code: "USD", is_default: true }] }],
      ["listPricePreferences", { $or: [{ attribute: "currency_code", value: "USD" }] }],
      ["upsertPricePreferences", [{ id: undefined, attribute: "currency_code", value: "USD", is_tax_inclusive: true }]],
    ]);
  });

  it("retains actual list preimages and the native null metadata to undefined inverse", async () => {
    const calls: unknown[] = [], previous = [{ id: "one", name: "Old", metadata: null }, { id: "two", metadata: { keep: true } }];
    const output = [{ id: "one", name: "New" }];
    const ctx = context({ store: {
      listStores: async (...args: unknown[]) => { calls.push(["list", ...args]); return previous; },
      updateStores: async (...args: unknown[]) => { calls.push(["update", ...args]); return output; },
      upsertStores: async (rows: unknown) => { calls.push(["inverse", rows]); return []; },
    } });
    const response = await storeStep.invoke({ selector: { id: ["two", "one", "two"] }, update: { name: "New" } }, ctx);
    if (!(response instanceof StepResponse)) throw new Error("Missing native StepResponse");
    expect(response.output).toBe(output); expect(response.compensateInput).toBe(previous);
    await inverse(response.compensateInput, ctx);
    expect(calls).toEqual([
      ["list", { id: ["two", "one", "two"] }, { select: ["name"], relations: [] }],
      ["update", { id: ["two", "one", "two"] }, { name: "New" }],
      ["inverse", [{ id: "one", name: "Old", metadata: undefined }, { id: "two", metadata: { keep: true } }]],
    ]);
    // This pins the native caveat. It does not claim saga metadata restoration.
    const resolves: string[] = [];
    await inverse(undefined, context({}, resolves)); await inverse([], context({}, resolves));
    expect(resolves).toEqual([]); expect(previous[0]?.metadata).toBeNull();
  });
});
