# Paired Product workflow benchmark

Matched native/Core measurement of the genuine Medusa `createProductsWorkflow`
and `updateProductsWorkflow` roots. Both lanes use the same per-request input
(`shared.ts`): one Product with a variant, two prices, options, images, four
tags, four categories, two sales channels and a shipping profile, then an update
of its title, tags, categories, channel, profile and images. Both seed the same
root/replacement references before timing.

| Lane | Execution |
| --- | --- |
| `native.ts` | Pinned upstream Medusa 2.13.4 dists: Product, Pricing, Sales Channel, Fulfillment, Inventory, Stock Location and Link modules over MikroORM/PostgreSQL, mock event bus. No Flarex code. |
| `core.postgres.bench.ts` | The same workflow source through the shared Core owner on ordinary-role PostgreSQL, using the existing Core Product creation/update fixtures. Hosts are prepared once outside timing. |

`workflows-native.ts` and `workflows.postgres.bench.ts` extend the same method to
further genuine roots with matched inputs (`workflowInputs` in `shared.ts`): Sales
Channel, Shipping Profile, Inventory Item and Price List create, Product delete,
Variant update and Inventory Level update. Per-sample seeds run outside timing and
the Core lane installs one fixture per case. Roots needing modules outside the
native lane above (Order, Payment, Tax, Store, API Key, Customer) are not covered.

Each sample records wall time, main-thread CPU (`process.threadCpuUsage`), the
summed driver await and the number of driver exchanges, counted at the pg client
boundary (promise and callback forms). Summed await overlaps CPU work in other
fibers and concurrent queries; it is not exclusive database time. Native lane
writes commit independently with native defaults; Core settles one atomic root
with durable outcome, events and history, so the added cost includes those
Flarex obligations.

## Reproduce

Use disposable databases owned by an ordinary login. The Core lane installs a
fresh private namespace per run and requires a provisioning URL for that schema.
The native lane needs an empty database per run because its seeds have fixed IDs.
Build the pinned native modules once (see `../native-business/README.md` for the
isolated `tsx`/Payload dependency install):

```bash
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/product --filter @medusajs/pricing --filter @medusajs/link-modules --filter @medusajs/sales-channel --filter @medusajs/fulfillment --filter @medusajs/inventory --filter @medusajs/stock-location build
```

```bash
NATIVE_BUSINESS_MEDUSA_URL='postgresql://bench@localhost/bench_native' node --import ./work/native-business-baseline/dependencies/node_modules/tsx/dist/loader.mjs packages/medusa-adapter/benchmarks/core-performance/product-workflows/native.ts
```

```bash
cd packages/medusa-adapter && FLAREX_POSTGRES_DATABASE_URL='postgresql://bench@localhost/bench_core' FLAREX_POSTGRES_PROVISIONING_DATABASE_URL='postgresql://owner@localhost/bench_core' npx vitest run --config vitest.product-workflows.config.ts
```

For the broader set, run `workflows-native.ts` in the native command, and set
`BENCH_SUITE=workflows` on the Core command. `BENCH_CASES` selects a comma-separated
subset of case names.
`load-native.ts` and `load.postgres.bench.ts` (`BENCH_SUITE=load`) add genuine Product
service reads (retrieve, list by IDs, paged list, text search) over a seeded catalog
(`BENCH_CATALOG`, default 200) and concurrent writes, including updates to one hot
Inventory Level. `BENCH_CONCURRENCY` lists worker counts and `BENCH_LOAD_OPS` the
operations per level. Each result reports throughput, per-operation latency, CPU and
exchanges per operation, and grouped failure reasons; Core refusals are results.

Use `BENCH_WARMUPS=40` here: small roots are still JIT-cold after the default 5
warmups, which roughly doubled the first cases' Core time.

Settings: `BENCH_SAMPLES` (default 30), `BENCH_WARMUPS` (5), `BENCH_OUT` (report
path; default `work/product-workflows/<lane>-<time>.json`), `BENCH_RTT_MS`
(diagnostic delay before each exchange, applied identically to both lanes to
model network round trips), `BENCH_PROFILE` (Core lane V8 profile of the measured
loop only) and `BENCH_VERIFY_PERCENT` (Core lane shared index cache verification;
the primary baseline keeps the Source default of 100 percent, any other value is
a separately labeled diagnostic). Run lanes one at a time without other load.

## Attribution method

The pinned Convex default verifies every shared index-cache hit against
persistence (`INDEX_CACHE_VERIFY_PERCENT = 100`). Exchange counts therefore
include verified cache hits. Attribute database exchanges by their actual Core
caller (for example the Effect span chain at the persistence scan), not by which
cache API was entered: an `indexCache.scanForAdmission` call that hits its page
issues no SQL, while a verified `indexCache.scan` hit still does.
