// Matched Product create/update inputs, seeds and pg-boundary metering shared by
// the Core and pinned native lanes. Only measurement lives here: no business
// logic, query or transaction behavior is reproduced or replaced.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** References both lanes seed before timing, matching the Core fixture's root/replacement seeds. */
export const seedPrefixes = ["root", "replacement"] as const;
export const seedLabel = (prefix: string) => prefix === "root" ? "Root" : prefix;

/** One complete Product: variant, two prices, images, options, tags, categories,
 * two sales channels and a shipping profile. Inventory follows the workflow default. */
export const productCreateInput = (prefix: string) => ({ products: [{ id: prefix + "-product", title: prefix, handle: prefix + "-handle",
  options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
  images: [{ url: "https://example.test/" + prefix + "/0" }, { url: "https://example.test/" + prefix + "/1" }],
  tag_ids: ["root-tag-0", "root-tag-1", "root-tag-2", "root-tag-3"],
  category_ids: ["root-category-0", "root-category-1", "root-category-2", "root-category-3"],
  sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
  variants: [{ id: prefix + "-variant", title: "Old", sku: prefix + "-sku", options: { Size: "0" },
    prices: [{ currency_code: "USD", amount: 123, rules: { region_id: "old" } }, { currency_code: "EUR", amount: 200 }] }] }] });

/** Reconciles the just-created Product's scalar, tag, category, channel, profile and image graph. */
export const productUpdateInput = (productId: string, ordinal: number) => ({ products: [{ id: productId, title: "Changed " + ordinal,
  tag_ids: ["replacement-tag-0", "replacement-tag-1"], category_ids: ["replacement-category-0"],
  sales_channels: [{ id: "replacement-channel-0" }], shipping_profile_id: "root-profile-1",
  images: [{ url: "https://example.test/new/" + ordinal }] }], additional_data: {} });

/** Per-request inputs of the broader matched workflow set; `prefix` keeps each run unique. */
export const workflowInputs = {
  salesChannelCreate: (prefix: string) => ({ salesChannelsData: [{ id: prefix + "-channel", name: prefix, description: "Benchmark channel" }] }),
  shippingProfileCreate: (prefix: string) => ({ data: [{ id: prefix + "-profile", name: prefix, type: "default" }] }),
  inventoryItemCreate: (prefix: string) => ({ items: [{ id: prefix + "-item", sku: prefix + "-sku", title: prefix, origin_country: "US", requires_shipping: true }] }),
  productDelete: (prefix: string) => ({ ids: [prefix + "-product"] }),
  variantUpdate: (prefix: string) => ({ product_variants: [{ id: prefix + "-variant", title: "Changed " + prefix }] }),
  priceListCreate: (prefix: string, variantId: string) => ({ price_lists_data: [{ title: prefix, description: "Benchmark list",
    prices: [{ variant_id: variantId, currency_code: "usd", amount: 10 }] }] }),
  inventoryLevelUpdate: (itemId: string, locationId: string, ordinal: number) => ({ updates: [{ inventory_item_id: itemId, location_id: locationId,
    stocked_quantity: 20 + ordinal, incoming_quantity: 1 }] }),
} as const;

export interface Sample { readonly wallMs: number; readonly cpuMs: number; readonly awaitMs: number; readonly exchanges: number;
  readonly ok: boolean; readonly error?: string }

type QueryFunction = (this: unknown, ...args: unknown[]) => unknown;
interface PgClientPrototype { query: QueryFunction }

/** Counts every driver exchange (promise or callback form) and its awaited time.
 * `rttMs` optionally delays each exchange before dispatch to model network latency;
 * it is a diagnostic applied identically to both lanes, never a server change. */
export function meterPgClient(prototype: PgClientPrototype, rttMs = 0) {
  const state = { on: false, exchanges: 0, awaitMs: 0, statements: new Map<string, number>() };
  const original = prototype.query;
  prototype.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    // Submittables (cursors, streams) keep pg's own return value; neither lane uses them.
    if (!state.on || typeof first === "object" && first !== null && "submit" in first && typeof first.submit === "function")
      return original.apply(this, args);
    const started = performance.now();
    state.exchanges += 1;
    const text = typeof first === "string" ? first : typeof first === "object" && first !== null && "text" in first ? String(first.text) : "";
    const shape = text.replace(/\s+/g, " ").replace(/"flarex_core_test_[0-9a-f]+"/g, "<ns>").slice(0, 96);
    state.statements.set(shape, (state.statements.get(shape) ?? 0) + 1);
    const done = () => { state.awaitMs += performance.now() - started; };
    const last = args.at(-1);
    if (typeof last === "function") {
      args[args.length - 1] = (...result: unknown[]) => { done(); return last(...result); };
      return rttMs > 0 ? void setTimeout(() => original.apply(this, args), rttMs) : original.apply(this, args);
    }
    if (typeof first === "object" && first !== null && "callback" in first && typeof first.callback === "function") {
      const callback = first.callback as (...result: unknown[]) => unknown;
      Object.assign(first, { callback: (...result: unknown[]) => { done(); return callback(...result); } });
      return rttMs > 0 ? void setTimeout(() => original.apply(this, args), rttMs) : original.apply(this, args);
    }
    const dispatched = rttMs > 0 ? new Promise(resolve => setTimeout(resolve, rttMs)).then(() => original.apply(this, args))
      : original.apply(this, args);
    return Promise.resolve(dispatched).finally(done);
  };
  return {
    statements: () => [...state.statements.entries()].sort((left, right) => right[1] - left[1]),
    clearStatements: () => state.statements.clear(),
    restore: () => { prototype.query = original; },
    /** Wall, main-thread CPU, summed driver await and exchange count of one complete root. */
    measure: async (work: () => Promise<unknown>): Promise<Sample> => {
      state.exchanges = 0; state.awaitMs = 0; state.on = true;
      const cpu = process.threadCpuUsage(), started = performance.now();
      let error: string | undefined;
      try { await work(); } catch (cause) { error = String(cause).slice(0, 600); }
      const wallMs = performance.now() - started, used = process.threadCpuUsage(cpu);
      state.on = false;
      return { wallMs, cpuMs: (used.user + used.system) / 1000, awaitMs: state.awaitMs, exchanges: state.exchanges,
        ok: error === undefined, ...(error === undefined ? {} : { error }) };
    },
  };
}

/** Nearest-rank percentile, matching the existing core benchmark policy (P95 absent below 20). */
const nearestRank = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
};
export function summarize(name: string, samples: readonly Sample[]) {
  const succeeded = samples.filter(sample => sample.ok);
  const field = (key: "wallMs" | "cpuMs" | "awaitMs" | "exchanges") => {
    const values = succeeded.map(sample => sample[key]);
    return values.length === 0 ? null : { median: nearestRank(values, 0.5), p95: values.length >= 20 ? nearestRank(values, 0.95) : null,
      max: Math.max(...values) };
  };
  return { name, retained: samples.length, failures: samples.length - succeeded.length, wallMs: field("wallMs"),
    cpuMs: field("cpuMs"), awaitMs: field("awaitMs"), exchanges: field("exchanges"), firstError: samples.find(sample => !sample.ok)?.error };
}

const integerSetting = (name: string, fallback: number, minimum: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}`);
  return value;
};
/** Fails fast: a malformed setting must not produce an empty passing report. */
export const benchmarkSettings = () => ({ samples: integerSetting("BENCH_SAMPLES", 30, 1),
  warmups: integerSetting("BENCH_WARMUPS", 5, 0), rttMs: integerSetting("BENCH_RTT_MS", 0, 0) });

export function writeReport(lane: "core" | "native", report: object) {
  const path = process.env.BENCH_OUT ?? new URL(`../../../../../work/product-workflows/${lane}-${Date.now()}.json`, import.meta.url).pathname;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ lane, node: process.version, ...report }, null, 1));
  return path;
}
