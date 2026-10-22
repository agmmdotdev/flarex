import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import SystemTaxService from "@medusajs/tax/providers/system";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareLogicalItemTaxLines, fullTaxGraph, taxCart, taxCountry, taxInput, taxItem, taxProvince,
  taxRate, taxRegion, taxRule, taxSeed, taxShipping, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalItemTaxLines>>, sharedCleanupCount = 0, scopeOrdinal = 0;
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const empty = { lineItemTaxLines: [], shippingMethodsTaxLines: [] };
const province = () => taxRegion(taxProvince, { province_code: "ca", parent_id: taxCountry, provider_id: null });
function line(rate_id = "txr163-country", rate = 10, line_item_id = taxItem.id,
  name = "Native163 country", code = "N163_COUNTRY") {
  return { rate_id, rate, name, code, line_item_id, provider_id: "system" };
}
function shippingLine(rate_id = "txr163-country", rate = 10, shipping_line_id = taxShipping.id,
  name = "Native163 country", code = "N163_COUNTRY") {
  return { rate_id, rate, name, code, shipping_line_id, provider_id: "system" };
}
function readOnly(before: Inventory, after: Inventory) {
  // Successful roots may record their own durable idempotency outcome. No Tax
  // row, history, index, fact or event may change during this read-only child.
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
async function scenario(name: string, rows: readonly TaxInitialRow[]) {
  const ordinal = ++scopeOrdinal;
  return prepareLogicalItemTaxLines(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "item-tax-lines-" + name + "-" + ordinal, projectId: "item-tax-lines-163", uuidOffset: 2_900_000 + ordinal * 10_000 } });
}

describe("genuine supplied item and shipping Tax lines", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalItemTaxLines(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it.each(["disabled", "missing-address", "missing-country", "empty"] as const)("preserves native %s no-calculation branches", async branch => {
    const input = branch === "disabled" ? taxInput({ orderOrCart: { ...taxCart, region: { automatic_taxes: false } } })
      : branch === "missing-address" ? taxInput({ orderOrCart: { ...taxCart, shipping_address: null } })
      : branch === "missing-country" ? taxInput({ orderOrCart: { ...taxCart, shipping_address: { city: "No country" } } })
      : taxInput({ items: [], shipping_methods: [] });
    const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual(empty);
    expect(method).not.toHaveBeenCalled(); readOnly(before, await connected.snapshot());
  }, 180_000);

  it("preserves omitted input arrays and native forced missing-country failure", async () => {
    const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { orderOrCart: taxCart }))).toEqual(empty);
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), taxInput({ force_tax_calculation: true,
      orderOrCart: { ...taxCart, shipping_address: { city: "No country" } } })));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("country code is required to calculate taxes");
    expect(method).not.toHaveBeenCalled(); readOnly(before, await connected.snapshot());
  }, 180_000);

  it("returns complete native item then shipping outputs and replays without another provider call", async () => {
    const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
    const input = taxInput(), owned = structuredClone(input), before = await connected.snapshot(), key = host.newRequestKey();
    const expected = { lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] };
    expect(await Effect.runPromise(host.run(key, input))).toEqual(expected);
    expect(method).toHaveBeenCalledTimes(2); expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.contexts[0]).toBeInstanceOf(SystemTaxService);
    expect(provider.mock.contexts[1]).toBe(provider.mock.contexts[0]);
    expect(method.mock.contexts[0]).not.toBe(method.mock.contexts[1]);
    expect(method.mock.calls[0]?.[0]).toEqual([{ ...taxItem, currency_code: "usd" }]);
    expect(method.mock.calls[1]?.[0]).toEqual([{ id: taxShipping.id, shipping_option_id: taxShipping.shipping_option_id, unit_price: taxShipping.amount, currency_code: "usd" }]);
    expect(method.mock.invocationCallOrder[0]).toBeLessThan(method.mock.invocationCallOrder[1] ?? 0);
    expect(provider.mock.calls[0]?.[2]).toBe(method.mock.calls[0]?.[1]);
    expect(provider.mock.calls[1]?.[2]).toBe(method.mock.calls[1]?.[1]);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(expected); expect(provider).toHaveBeenCalledTimes(2);
    expect(input).toEqual(owned); readOnly(before, await connected.snapshot());
  }, 180_000);

  it("preserves generated own-undefined context fields, supplied metadata and distinct context shipping", async () => {
    const host = await connected.prepare(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
    const contextualShipping = { ...taxShipping, id: "sm-context-only", amount: 123 };
    const input = taxInput({ is_return: true, shipping_address: { country_code: "US", province: "NY", metadata: { nested: { nullValue: null, arbitrary: "kept" } } },
      orderOrCart: { ...taxCart, shipping_methods: [contextualShipping] } });
    const before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual({ lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] });
    const context = provider.mock.calls[0]?.[2];
    expect(context).toEqual({ address: { country_code: "US", province_code: "NY", address_1: undefined, address_2: undefined, city: undefined,
      postal_code: undefined, metadata: { nested: { nullValue: null, arbitrary: "kept" } } },
      customer: { id: taxCart.customer.id, email: taxCart.customer.email, customer_groups: ["cg163-one"], metadata: { supplied: true } },
      is_return: true, locale: "en-US", shipping_methods: [contextualShipping] });
    expect(Object.hasOwn(context?.address ?? {}, "city")).toBe(true);
    expect(Object.hasOwn(context?.address ?? {}, "address_2")).toBe(true);
    expect(provider.mock.calls[1]?.[2]).toEqual(context); readOnly(before, await connected.snapshot());
  }, 180_000);

  it.each(["omitted", "null"] as const)("retains %s province and null explicit-address fallback", async presence => {
    const address = presence === "omitted" ? { country_code: "us" } : { country_code: "us", province: null };
    const host = await connected.prepare(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ shipping_address: null, orderOrCart: { ...taxCart, shipping_address: address } }))))
      .toEqual({ lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] });
    const context = provider.mock.calls[0]?.[2]; expect(context?.address.province_code).toBe(presence === "omitted" ? undefined : null);
    expect(Object.hasOwn(context?.address ?? {}, "province_code")).toBe(true); readOnly(before, await connected.snapshot());
  }, 180_000);

  it("forces calculation when automatic taxes are disabled", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ force_tax_calculation: true,
      orderOrCart: { ...taxCart, region: { automatic_taxes: false } } })))).toEqual({ lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] });
    readOnly(before, await connected.snapshot());
  }, 180_000);

  it.each(["omitted", "null"] as const)("preserves %s supplied Customer and native own-undefined context", async presence => {
    const { customer: _customer, locale: _locale, shipping_methods: _shipping, ...cart } = taxCart;
    const orderOrCart = presence === "null" ? { ...cart, customer: null } : cart;
    const host = await connected.prepare(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ orderOrCart })))).toEqual({
      lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] });
    const context = provider.mock.calls[0]?.[2];
    expect(context?.customer).toBe(presence === "null" ? null : undefined);
    expect(Object.hasOwn(context ?? {}, "customer")).toBe(true);
    expect(context?.locale).toBeUndefined(); expect(Object.hasOwn(context ?? {}, "locale")).toBe(true);
    expect(context?.shipping_methods).toBeUndefined(); expect(Object.hasOwn(context ?? {}, "shipping_methods")).toBe(true);
    readOnly(before, await connected.snapshot());
  }, 180_000);

  it.each(["item-omitted", "item-null", "shipping-omitted", "shipping-null"] as const)
    ("retains native default matching for a custom %s reference", async branch => {
      const item = { id: "li-custom", quantity: 1, unit_price: "13.25" };
      const shipping = { id: "sm-custom", amount: "7.5" };
      const input = branch === "item-omitted" ? taxInput({ items: [item], shipping_methods: [] })
        : branch === "item-null" ? taxInput({ items: [{ ...item, product_id: null, product_type_id: null }], shipping_methods: [] })
        : branch === "shipping-omitted" ? taxInput({ items: [], shipping_methods: [shipping] })
        : taxInput({ items: [], shipping_methods: [{ ...shipping, shipping_option_id: null }] });
      const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual(branch.startsWith("item")
        ? { lineItemTaxLines: [line("txr163-country", 10, item.id)], shippingMethodsTaxLines: [] }
        : { lineItemTaxLines: [], shippingMethodsTaxLines: [shippingLine("txr163-country", 10, shipping.id)] });
      expect(method).toHaveBeenCalledTimes(1);
      const normalized = method.mock.calls[0]?.[0][0], reference = branch.startsWith("item") ? "product_id" : "shipping_option_id";
      expect(Object.getOwnPropertyDescriptor(normalized, reference)?.value).toBe(branch.endsWith("null") ? null : undefined);
      expect(Object.hasOwn(normalized ?? {}, reference)).toBe(true);
      readOnly(before, await connected.snapshot());
    }, 180_000);

  it.each(["only", "mixed", "shipping"] as const)("preserves %s gift-card and empty-call behavior", async branch => {
    const input = branch === "only" ? taxInput({ items: [{ ...taxItem, is_giftcard: true }], shipping_methods: [] })
      : branch === "mixed" ? taxInput({ items: [{ ...taxItem, id: "li-giftcard", is_giftcard: true }, { ...taxItem, is_giftcard: false }] })
      : taxInput({ items: [] });
    const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual(branch === "only" ? empty
      : { lineItemTaxLines: branch === "shipping" ? [] : [line()], shippingMethodsTaxLines: [shippingLine()] });
    expect(method).toHaveBeenCalledTimes(branch === "mixed" ? 2 : 1);
    if (branch === "only") { expect(method.mock.calls[0]?.[0]).toEqual([]); expect(provider).toHaveBeenCalledWith([], [], expect.anything()); }
    if (branch === "mixed") expect(method.mock.calls[0]?.[0]).toEqual([{ ...taxItem, currency_code: "usd" }]);
    readOnly(before, await connected.snapshot());
  }, 180_000);

  it.each(["product", "product_type", "shipping_option"] as const)("retains native %s Rule matching", async reference => {
    const referenceId = reference === "product" ? taxItem.product_id : reference === "product_type" ? taxItem.product_type_id : taxShipping.shipping_option_id;
    const id = "txr163-" + reference, local = await scenario(reference, taxSeed([taxRate(), taxRate(id, { is_default: false, rate: 20, name: id, code: id })],
      [taxRegion()], [taxRule("txrule163-" + reference, id, reference, referenceId)]));
    const host = await local.prepare(), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput()))).toEqual({
      lineItemTaxLines: [reference === "shipping_option" ? line() : line(id, 20, taxItem.id, id, id)],
      shippingMethodsTaxLines: [reference === "shipping_option" ? shippingLine(id, 20, taxShipping.id, id, id) : shippingLine()] });
    readOnly(before, await local.snapshot());
  }, 240_000);

  it.each([false, true])("retains province precedence and combinable parent %s with original uppercase provider context", async combinable => {
    const local = await scenario("province-" + combinable, taxSeed([taxRate(), taxRate("txr163-province", { tax_region_id: taxProvince, rate: 5, is_combinable: combinable })],
      [taxRegion(), province()])), host = await local.prepare(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await local.snapshot();
    const input = taxInput({ orderOrCart: { ...taxCart, shipping_address: { ...taxCart.shipping_address, country_code: "US", province: "CA" } } });
    expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual({
      lineItemTaxLines: [line("txr163-province", 5), ...(combinable ? [line()] : [])],
      shippingMethodsTaxLines: [shippingLine("txr163-province", 5), ...(combinable ? [shippingLine()] : [])] });
    expect(provider.mock.calls[0]?.[2].address).toMatchObject({ country_code: "US", province_code: "CA" }); readOnly(before, await local.snapshot());
  }, 240_000);

  it("retains native equal-priority ID order despite reverse seed insertion", async () => {
    const a = "txr163-a-product", z = "txr163-z-product", local = await scenario("tie", taxSeed([taxRate(),
      taxRate(z, { is_default: false, rate: 22, name: z, code: z }), taxRate(a, { is_default: false, rate: 11, name: a, code: a })], [taxRegion()],
      [taxRule("txrule163-z", z, "product", taxItem.product_id), taxRule("txrule163-a", a, "product", taxItem.product_id)]));
    const host = await local.prepare(), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput()))).toEqual({ lineItemTaxLines: [line(a, 11, taxItem.id, a, a)], shippingMethodsTaxLines: [shippingLine()] });
    readOnly(before, await local.snapshot());
  }, 240_000);

  it.each(["no-region", "no-rates", "deleted-region", "deleted-rate", "deleted-rule", "unmatched-rule"] as const)("excludes %s without changing Tax data", async branch => {
    const specific = taxRate("txr163-specific", { is_default: false, rate: 20 });
    const rows = branch === "no-region" ? taxSeed([], []) : branch === "no-rates" ? taxSeed([])
      : branch === "deleted-region" ? taxSeed([taxRate()], [taxRegion(taxCountry, { deleted_at: "2026-10-22T00:00:00.000Z" })])
      : branch === "deleted-rate" ? taxSeed([taxRate("txr163-country", { deleted_at: "2026-10-22T00:00:00.000Z" })])
      : taxSeed([taxRate(), specific], [taxRegion()], [taxRule("txrule163-specific", "txr163-specific", "product",
        branch === "unmatched-rule" ? "prod-other" : taxItem.product_id,
        branch === "deleted-rule" ? { deleted_at: "2026-10-22T00:00:00.000Z" } : {})]);
    const local = await scenario(branch, rows), host = await local.prepare(), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput()))).toEqual(branch === "deleted-rule" || branch === "unmatched-rule"
      ? { lineItemTaxLines: [line()], shippingMethodsTaxLines: [shippingLine()] } : empty);
    readOnly(before, await local.snapshot());
  }, 240_000);

  it.each([[null, 0], [0, 0], [0.1, 0.1], [1.00000006, 1.0000001], [1.0000000596046448, 1.0000001], [16777217, 16777216]] as const)
    ("returns native cold SQL-real rate %s as %s", async (rate, expected) => {
      const local = await scenario("real-" + rate, taxSeed([taxRate("txr163-country", { rate })])), host = await local.prepare(), before = await local.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput()))).toEqual({ lineItemTaxLines: [line("txr163-country", expected)], shippingMethodsTaxLines: [shippingLine("txr163-country", expected)] });
      readOnly(before, await local.snapshot());
    }, 240_000);

  it("retains genuine missing-provider Awilix error and logger branch", async () => {
    const local = await scenario("missing-provider", taxSeed([taxRate()], [taxRegion(taxCountry, { provider_id: null })])), host = await local.prepare(), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), taxInput())); expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("Please make sure that the provider is registered in the container");
    expect(local.errors).toHaveLength(1); expect(local.errors[0]?.[0]).toMatch(/^AwilixResolutionError:/);
    expect(local.errors[0]?.[1]?.name).toBe("AwilixResolutionError"); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["mixed", "items", "shipping"] as const)("preserves complete four-plus-four, two-Region, eight-Rate, sixteen-Rule %s graph", async layout => {
    const graph = fullTaxGraph(layout), local = await scenario("full-" + layout, graph.rows), host = await local.prepare(), before = await local.snapshot(); let calls = 0;
    const output = await Effect.runPromise(host.run(host.newRequestKey(), graph.input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    // Exact saved original full-graph observations: native algorithms, rather
    // than a test-side priority calculation, select these two-Rate sequences.
    const itemKinds = layout === "mixed" ? ["product", "product", "type", "type"] : layout === "items" ? ["product", "product", "product", "product"] : ["default", "default", "default", "default"];
    const shippingKinds = layout === "mixed" ? ["shipping", "shipping", "default", "default"] : layout === "shipping" ? ["product", "product", "product", "product"] : ["default", "default", "default", "default"];
    const value = { default: 1, product: 2, type: 3, shipping: 4 }, number = { default: 0, product: 1, type: 2, shipping: 3 };
    expect(output).toEqual({ lineItemTaxLines: itemKinds.flatMap((kind, index) => {
      const key = Schema.decodeUnknownSync(Schema.Literals(["default", "product", "type", "shipping"]))(kind);
      return [line(`txr163s-1-${number[key]}-${key}`, value[key] + 10, `li163s-${index}`, `Native163s 1 ${key}`, `N163S_1_${key}`),
        line(`txr163s-0-${number[key]}-${key}`, value[key], `li163s-${index}`, `Native163s 0 ${key}`, `N163S_0_${key}`)];
    }), shippingMethodsTaxLines: shippingKinds.flatMap((kind, index) => {
      const key = Schema.decodeUnknownSync(Schema.Literals(["default", "product", "type", "shipping"]))(kind);
      return [shippingLine(`txr163s-1-${number[key]}-${key}`, value[key] + 10, `sm163s-${index}`, `Native163s 1 ${key}`, `N163S_1_${key}`),
        shippingLine(`txr163s-0-${number[key]}-${key}`, value[key], `sm163s-${index}`, `Native163s 0 ${key}`, `N163S_0_${key}`)];
    }) });
    console.info("Complete Tax item+shipping BoundedRequest.enter", layout, calls);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    readOnly(before, await local.snapshot());
  }, 240_000);

  it("rolls back late parent failure after both complete native provider calls", async () => {
    const graph = fullTaxGraph(), local = await scenario("late-parent", graph.rows), host = await local.prepareLateFailure();
    const provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), graph.input)); expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("Late genuine Tax parent failure");
    expect(provider).toHaveBeenCalledTimes(2); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["rates", "rules"] as const)("refuses an incomplete %s cohort before provider output", async boundary => {
    const rates = boundary === "rates" ? [taxRate(), ...Array.from({ length: 8 }, (_, index) => taxRate("txr-over-" + index, { is_default: false }))] : [taxRate()];
    const rules = boundary === "rates" ? Array.from({ length: 8 }, (_, index) => taxRule("txrule-over-" + index, "txr-over-" + index, "product", taxItem.product_id))
      : Array.from({ length: 17 }, (_, index) => taxRule("txrule-over-" + index, "txr163-country", "product", "prod-over-" + index));
    const local = await scenario("over-" + boundary, taxSeed(rates, [taxRegion()], rules)), host = await local.prepare(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines"), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), taxInput())); expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toEqual(["limitExceeded", "rollbackOnly"]);
    expect(provider).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("refuses oversized and malformed supplied input before the native Tax method", async () => {
    const host = await connected.prepare(), method = vi.spyOn(TaxModuleService.prototype, "getTaxLines"), before = await connected.snapshot();
    const malformed: readonly unknown[] = [taxInput({ items: Array.from({ length: 5 }, (_, index) => ({ ...taxItem, id: "li-over-" + index })) }),
      taxInput({ shipping_methods: Array.from({ length: 5 }, (_, index) => ({ ...taxShipping, id: "sm-over-" + index })) }),
      { ...taxInput(), force_tax_calculation: "true" }, { ...taxInput(), unknown_root: true },
      { ...taxInput(), items: [{ ...taxItem, quantity: Number.NaN }] }, { ...taxInput(), orderOrCart: { currency_code: true } }];
    for (const input of malformed) {
      const failed = await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), input]));
      expect(Exit.isFailure(failed)).toBe(true);
    }
    expect(method).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
  }, 180_000);
});
