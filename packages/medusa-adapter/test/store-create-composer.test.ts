import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { createStoresWorkflow, createStoresWorkflowId,
  type CreateStoresWorkflowInput } from "@medusajs/core-flows/store/create-stores";
import { StoreModuleService } from "@medusajs/store/services";

const prepared = Result.getOrThrow(createStoresWorkflow.prepare());
const store = { id: "store-native", name: "Trimmed", supported_currencies: [{ id: "currency-native", currency_code: "usd", is_default: true }],
  supported_locales: [{ id: "locale-native", locale_code: "en-US" }], metadata: { retained: true } };
const preference = { id: "preference-new", attribute: "currency_code", value: "USD", is_tax_inclusive: false,
  created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z", deleted_at: null };
const oneStore: CreateStoresWorkflowInput = { stores: [{ name: " Trimmed ",
  supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: false }],
  supported_locales: [{ locale_code: "en-US" }], metadata: { retained: true } }] };

/** Genuine composer/callbacks over scripted service outcomes. Native service
 * normalization, mixed upsert grouping, persistence and event authentication
 * are proved separately by the connected Store/Pricing integration. */
function nativePort() {
  const trace: string[] = [];
  const createStores = vi.fn(async (_input: unknown) => [store]);
  const deleteStores = vi.fn(async (_ids: string[]) => undefined);
  const listPricePreferences = vi.fn(async (_input: unknown): Promise<(typeof preference)[]> => []);
  const upsertPricePreferences = vi.fn(async (_input: unknown) => [preference]);
  const deletePricePreferences = vi.fn(async (_ids: string[]) => undefined);
  const services: Readonly<Record<string, unknown>> = {
    store: {
      createStores: (input: unknown) => { trace.push("create-stores"); return createStores(input); },
      deleteStores: (ids: string[]) => { trace.push("delete-stores"); return deleteStores(ids); },
    },
    pricing: {
      listPricePreferences: (input: unknown) => { trace.push("list-preferences"); return listPricePreferences(input); },
      upsertPricePreferences: (input: unknown) => { trace.push("upsert-preferences"); return upsertPricePreferences(input); },
      deletePricePreferences: (ids: string[]) => { trace.push("delete-preferences"); return deletePricePreferences(ids); },
    },
  };
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Unexpected genuine provider " + name);
    trace.push("resolve-" + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "store-create-test",
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { trace, resolve, context, createStores, deleteStores, listPricePreferences, upsertPricePreferences, deletePricePreferences,
    run: (input: CreateStoresWorkflowInput) => executeWorkflow(prepared, input, port) };
}
function step(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node?.kind !== "step") throw new Error("Missing native Store creation step " + name);
  return node;
}
const creation = step("create-stores"), preferences = step("update-price-preferences-as-array");

async function failure(env: ReturnType<typeof nativePort>, input: CreateStoresWorkflowInput) {
  const result = await Effect.runPromise(Effect.result(env.run(input)));
  if (Result.isSuccess(result)) throw new Error("Expected genuine native refusal");
  return result.failure;
}

describe("genuine Store creation composer", () => {
  it("uses the unchanged native pure normalizer for Store case/name behavior without modifying caller values", () => {
    const input = [{ name: " Trimmed ", supported_currencies: [{ currency_code: "USD", is_default: true }],
      supported_locales: [{ locale_code: "EN-us" }], metadata: { retained: true } }], original = structuredClone(input);
    expect(StoreModuleService.normalizeInput(input)).toEqual([{ name: "Trimmed",
      supported_currencies: [{ currency_code: "usd", is_default: true }],
      supported_locales: [{ locale_code: "EN-us" }], metadata: { retained: true } }]);
    expect(input).toEqual(original);
    expect(StoreModuleService.normalizeInput([{}])).toEqual([{}]);
    expect(StoreModuleService.normalizeInput([{ name: "  ", supported_currencies: [] }]))
      .toEqual([{ name: "", supported_currencies: [] }]);
  });

  it("retains root identity, two ordered native steps and both transaction-covered inverses", () => {
    expect(createStoresWorkflowId).toBe("create-stores");
    expect(prepared.nodes.map(node => node.name)).toEqual(["create-stores", "update-price-preferences-as-array"]);
    expect(prepared.parallel).toBeUndefined();
    for (const node of [creation, preferences]) {
      expect(node.compensation).toBe("transactionCovered");
      expect(node.compensate).toBeTypeOf("function");
      expect(node.hook).toBe(false);
    }
  });

  it("isolates Store currency fields and derives raw Pricing keys from original input rather than returned normalized Stores", async () => {
    const env = nativePort(), input = structuredClone(oneStore), original = structuredClone(input);
    expect(await Effect.runPromise(env.run(input))).toEqual([store]);
    expect(env.createStores).toHaveBeenCalledExactlyOnceWith([{ name: " Trimmed ",
      supported_currencies: [{ currency_code: "USD", is_default: true }],
      supported_locales: [{ locale_code: "en-US" }], metadata: { retained: true } }]);
    expect(env.listPricePreferences).toHaveBeenCalledExactlyOnceWith({ $or: [{ attribute: "currency_code", value: "USD" }] });
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([
      { id: undefined, attribute: "currency_code", value: "USD", is_tax_inclusive: false },
    ]);
    expect(env.trace).toEqual(["resolve-store", "create-stores", "resolve-pricing", "list-preferences", "upsert-preferences"]);
    expect(input).toEqual(original);
    expect(env.deleteStores).not.toHaveBeenCalled();
    expect(env.deletePricePreferences).not.toHaveBeenCalled();
  });

  it("keeps first raw key order and the final occurrence payload across different Stores", async () => {
    const env = nativePort();
    const input: CreateStoresWorkflowInput = { stores: [
      { supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: true },
        { currency_code: "eur", is_tax_inclusive: false }] },
      { supported_currencies: [{ currency_code: "gbp", is_default: true, is_tax_inclusive: true },
        { currency_code: "USD", is_tax_inclusive: false }] },
      { supported_currencies: [{ currency_code: "usd", is_default: true, is_tax_inclusive: true },
        { currency_code: "eur" }] },
    ] };
    expect(await Effect.runPromise(env.run(input))).toEqual([store]);
    expect(env.listPricePreferences).toHaveBeenCalledExactlyOnceWith({ $or: [
      { attribute: "currency_code", value: "USD" }, { attribute: "currency_code", value: "eur" },
      { attribute: "currency_code", value: "gbp" }, { attribute: "currency_code", value: "usd" },
    ] });
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([
      { id: undefined, attribute: "currency_code", value: "USD", is_tax_inclusive: false },
      { id: undefined, attribute: "currency_code", value: "eur", is_tax_inclusive: undefined },
      { id: undefined, attribute: "currency_code", value: "gbp", is_tax_inclusive: true },
      { id: undefined, attribute: "currency_code", value: "usd", is_tax_inclusive: true },
    ]);
  });

  it("still resolves Store then Pricing for an empty Store request without calling preference methods", async () => {
    const env = nativePort(); env.createStores.mockResolvedValueOnce([]);
    expect(await Effect.runPromise(env.run({ stores: [] }))).toEqual([]);
    expect(env.createStores).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.trace).toEqual(["resolve-store", "create-stores", "resolve-pricing"]);
    expect(env.listPricePreferences).not.toHaveBeenCalled();
    expect(env.upsertPricePreferences).not.toHaveBeenCalled();
  });

  it("passes an empty supported-currency array to Store and still resolves the empty Pricing step", async () => {
    const env = nativePort();
    expect(await Effect.runPromise(env.run({ stores: [{ supported_currencies: [] }] }))).toEqual([store]);
    expect(env.createStores).toHaveBeenCalledExactlyOnceWith([{ supported_currencies: [] }]);
    expect(env.trace).toEqual(["resolve-store", "create-stores", "resolve-pricing"]);
    expect(env.listPricePreferences).not.toHaveBeenCalled();
    expect(env.upsertPricePreferences).not.toHaveBeenCalled();
  });

  it.each(["store", "list", "upsert"] as const)("propagates the exact %s failure once without invoking retained compensators", async phase => {
    const env = nativePort(), expected = new Error("native " + phase + " failed");
    if (phase === "store") env.createStores.mockRejectedValueOnce(expected);
    else if (phase === "list") env.listPricePreferences.mockRejectedValueOnce(expected);
    else env.upsertPricePreferences.mockRejectedValueOnce(expected);
    expect(await failure(env, oneStore)).toBe(expected);
    expect(env.createStores).toHaveBeenCalledTimes(1);
    expect(env.listPricePreferences).toHaveBeenCalledTimes(phase === "store" ? 0 : 1);
    expect(env.upsertPricePreferences).toHaveBeenCalledTimes(phase === "upsert" ? 1 : 0);
    expect(env.deleteStores).not.toHaveBeenCalled();
    expect(env.deletePricePreferences).not.toHaveBeenCalled();
  });
});

describe("retained genuine Store creation callbacks", () => {
  it("captures generated result IDs in returned order for the physical inverse", async () => {
    const env = nativePort(), second = { ...store, id: "returned-second" };
    env.createStores.mockResolvedValueOnce([second, store]);
    const response = await creation.invoke([], env.context);
    if (!(response instanceof StepResponse) || creation.compensate === undefined) throw new Error("Missing genuine Store response");
    expect(response.output).toEqual([second, store]);
    expect(response.compensateInput).toEqual(["returned-second", "store-native"]);
    await creation.compensate(response.compensateInput, env.context);
    expect(env.deleteStores).toHaveBeenCalledExactlyOnceWith(["returned-second", "store-native"]);
  });

  it("skips undefined and empty generated Store IDs before resolving the inverse service", async () => {
    const env = nativePort();
    if (creation.compensate === undefined) throw new Error("Missing genuine Store inverse");
    await creation.compensate(undefined, env.context);
    await creation.compensate([], env.context);
    expect(env.resolve).not.toHaveBeenCalled();
    expect(env.deleteStores).not.toHaveBeenCalled();
  });

  it("propagates the exact physical Store inverse failure once", async () => {
    const env = nativePort(), expected = new Error("native Store inverse failed");
    if (creation.compensate === undefined) throw new Error("Missing genuine Store inverse");
    env.deleteStores.mockRejectedValueOnce(expected);
    await expect(creation.compensate([store.id], env.context)).rejects.toBe(expected);
    expect(env.deleteStores).toHaveBeenCalledExactlyOnceWith([store.id]);
  });
});

describe("retained genuine Pricing preference callbacks", () => {
  it("preserves prior flags for omission, explicit false and native create-before-update result order", async () => {
    const env = nativePort();
    const oldUSD = { ...preference, id: "old-usd", value: "usd", is_tax_inclusive: true };
    const oldEUR = { ...preference, id: "old-eur", value: "eur", is_tax_inclusive: true };
    const createdGBP = { ...preference, id: "new-gbp", value: "gbp" };
    const updatedUSD = { ...oldUSD, is_tax_inclusive: false };
    const previous = [oldEUR, oldUSD], groupedResult = [createdGBP, updatedUSD, oldEUR];
    env.listPricePreferences.mockResolvedValueOnce(previous);
    // The callback receives the genuine service's group order. The connected
    // service witness proves that grouping rather than reproducing its logic here.
    env.upsertPricePreferences.mockResolvedValueOnce(groupedResult);
    const response = await preferences.invoke([
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false },
      { attribute: "currency_code", value: "eur" }, { attribute: "currency_code", value: "gbp" },
    ], env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing genuine Pricing response");
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([
      { id: "old-usd", attribute: "currency_code", value: "usd", is_tax_inclusive: false },
      { id: "old-eur", attribute: "currency_code", value: "eur", is_tax_inclusive: true },
      { id: undefined, attribute: "currency_code", value: "gbp", is_tax_inclusive: undefined },
    ]);
    expect(response.output).toEqual(groupedResult);
    expect(response.compensateInput).toEqual({ prevData: previous, newDataIds: ["new-gbp"] });
  });

  it("matches both preference attribute and value rather than only the raw value", async () => {
    const env = nativePort();
    const unrelated = { ...preference, id: "region", attribute: "region_id", value: "usd", is_tax_inclusive: false };
    const matching = { ...preference, id: "currency", value: "usd", is_tax_inclusive: true };
    env.listPricePreferences.mockResolvedValueOnce([unrelated, matching]);
    await preferences.invoke([{ attribute: "currency_code", value: "usd" }], env.context);
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([
      { id: "currency", attribute: "currency_code", value: "usd", is_tax_inclusive: true },
    ]);
  });

  it.each([
    { attribute: "", value: "usd" }, { attribute: "currency_code", value: "" },
    { value: "usd" }, { attribute: "currency_code" },
  ])("retains native attribute/value refusal before the list call: %j", async input => {
    const env = nativePort();
    await expect(preferences.invoke([input], env.context)).rejects.toMatchObject({ type: "invalid_data",
      message: "Attribute and value must be provided when updating price preferences" });
    expect(env.trace).toEqual(["resolve-pricing"]);
    expect(env.listPricePreferences).not.toHaveBeenCalled();
    expect(env.upsertPricePreferences).not.toHaveBeenCalled();
  });

  it("retains the truthy empty compensation object and executes both empty inverse calls in order", async () => {
    const env = nativePort();
    const response = await preferences.invoke([], env.context);
    if (!(response instanceof StepResponse) || preferences.compensate === undefined) throw new Error("Missing genuine Pricing response");
    expect(response.output).toEqual([]);
    expect(response.compensateInput).toEqual({ prevData: [], newDataIds: [] });
    expect(env.trace).toEqual(["resolve-pricing"]);
    await preferences.compensate(response.compensateInput, env.context);
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.deletePricePreferences).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.trace).toEqual(["resolve-pricing", "resolve-pricing", "upsert-preferences", "delete-preferences"]);
  });

  it("restores complete preimages before deleting captured new IDs and skips only absent compensation", async () => {
    const env = nativePort(), previous = [{ ...preference, id: "old", is_tax_inclusive: true }];
    if (preferences.compensate === undefined) throw new Error("Missing genuine Pricing inverse");
    await preferences.compensate({ prevData: previous, newDataIds: ["new-b", "new-a"] }, env.context);
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith(previous);
    expect(env.deletePricePreferences).toHaveBeenCalledExactlyOnceWith(["new-b", "new-a"]);
    expect(env.trace).toEqual(["resolve-pricing", "upsert-preferences", "delete-preferences"]);
    env.trace.length = 0; env.resolve.mockClear();
    await preferences.compensate(undefined, env.context);
    expect(env.trace).toEqual([]);
    expect(env.resolve).not.toHaveBeenCalled();
  });

  it.each(["upsert", "delete"] as const)("propagates the exact inverse %s failure without later calls or retry", async phase => {
    const env = nativePort(), expected = new Error("native Pricing inverse " + phase + " failed");
    if (preferences.compensate === undefined) throw new Error("Missing genuine Pricing inverse");
    if (phase === "upsert") env.upsertPricePreferences.mockRejectedValueOnce(expected);
    else env.deletePricePreferences.mockRejectedValueOnce(expected);
    await expect(preferences.compensate({ prevData: [preference], newDataIds: ["new"] }, env.context)).rejects.toBe(expected);
    expect(env.upsertPricePreferences).toHaveBeenCalledExactlyOnceWith([preference]);
    expect(env.deletePricePreferences).toHaveBeenCalledTimes(phase === "delete" ? 1 : 0);
  });
});
