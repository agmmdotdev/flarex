# Complete native Product workflow performance

This benchmark executes the pinned `createProductsWorkflow` through the current
eight-source Core fixture: Product, Pricing, Inventory, Stock Location, Sales
Channel, Fulfillment, Product Links and Variant Links. It uses the exact
[conformance input](../../../medusa-adapter/test/support/core-product-creation-input.ts),
shared with the existing complete Product creation tests. It is separate from
the mixed Application/Product service request in [TYPE-INPUTS.md](./TYPE-INPUTS.md).

## Measured result

The complete four-Product workflow remains approximately **1.07 seconds of
client CPU** in both Node and the best measured Bun build. Keeping original
Core/adapter and Medusa source reduces Bun's CPU by **14.0%** versus compiling
the frozen JavaScript graph, but does not establish a CPU advantage over Node
for this larger graph. Its median wall latency is **18.2% higher than Node**.

Windows x64, Ryzen 5 2600, Node 26.13.0, Bun 1.4.5, ordinary-role PostgreSQL
18.7 with durability enabled. Each row has two fresh workers and 60 measured
requests, with five warmups per worker. Values are milliseconds:

| Products | Runtime/input | Mean client CPU | Median wall | P95 wall |
| ---: | --- | ---: | ---: | ---: |
| 1 | Node, frozen JS | 566.65 | 566.65 | 1386.50 |
| 1 | Bun AOT, frozen JS | 598.07 | 608.83 | 1676.82 |
| 1 | Bun AOT, Core/adapter TS | 498.88 | 647.28 | 698.21 |
| 1 | Bun AOT, Core/adapter + Medusa source | 443.98 | 573.32 | 686.11 |
| 4 | Node, frozen JS | 1072.12 | 1204.80 | 1668.80 |
| 4 | Bun AOT, frozen JS | 1243.28 | 1665.74 | 1859.47 |
| 4 | Bun AOT, Core/adapter TS | 1209.42 | 1541.09 | 2155.72 |
| 4 | Bun AOT, Core/adapter + Medusa source | 1069.73 | 1423.53 | 1568.22 |

For one Product, the source-preserving Bun route used **21.6% less CPU than
Node** and **25.8% less than JavaScript AOT**, while median wall latency was
approximately level with Node. Native Medusa source helped this complete
workflow more than the small mixed-service case; that benefit is workload
dependent and also includes changes to module boundaries and decorator lowering.

All 16 workers, 480 measured requests and 80 warmups passed committed readback,
per-publication verification and disposal. No samples were removed. There is
substantial cohort variation, retained in the per-worker means. Two processes
per configuration and this machine do not establish stable production tails,
throughput, a pure annotation effect, or general framework compatibility.

The [observations](./product-workflow.observations.windows-x64.json) contain
per-worker CPU means, preparation timings, compiler summaries and hashed evidence
links. The compressed evidence preserves both complete series and raw output.
The separate cold smoke runs are excluded from this table.

Each Product has two images, one option with four values, one managed variant,
two prices with rules, four Tag and four Category memberships, two Sales Channel
links and one ShippingProfile link. The native child creates Inventory and
Pricing associations and retains the authentic empty inventory-level and Stock
Location graph calls. The one-Product case writes 29 business rows; the
four-Product case writes 116. Existing endpoints and reference data are seeded
before timing. No custom `productsCreated` hook is registered.

## Repeat

Use the [owned PostgreSQL controller](../../../../scripts/core-aot-postgres.README.md)
and fresh output directories. Build before running quiet measurements:

```powershell
$runner = 'packages/executor/benchmarks/core-aot/type-inputs.mjs'
node $runner --bun C:/Users/User/.bun/bin/bun.exe --scenario product-workflow --out work/validation/product-workflow-assets --build-only
./scripts/core-aot-postgres.ps1 -Action Start
foreach ($products in @(1, 4)) {
  node $runner --assets work/validation/product-workflow-assets --scenario product-workflow --products $products --out "work/validation/product-workflow-$products" --rounds 2 --samples 30 --warmups 5
  if ($LASTEXITCODE -ne 0) { throw "Workflow cohort failed" }
}
./scripts/core-aot-postgres.ps1 -Action Stop
```

The workflow default compares Node from frozen JS, Bun AOT from that same JS,
Bun AOT from original Core/adapter TS with existing native `dist`, and Bun AOT
with native Medusa source as well. `--variants` selects named routes. The uniform
config experiments remain available explicitly. Artifact, resolved input graph,
configuration and compiler-log hashes are retained as in the mixed experiment.

The timer includes the entire workflow host invocation, native child workflows,
all eight module paths, validation, staging, events and the trusted outer
settlement. It excludes fixture installation, endpoint/reference seeding,
reusable host construction, committed readback and cleanup. Each request's
Product/Variant/image result is checked against committed native reads. After
the series, the genuine fixture snapshot must prove 29 rows per Product, one
outcome and event family per request, a single timestamp for every request's
business revisions and events, all four Link event families, and ordered
Variant/Product events. The worker reports `publicationVerified: true` only
after these checks; failed verification or cleanup rejects the entire cohort.

Reports retain preparation timings separately. CPU means client process user
plus system CPU; PostgreSQL server CPU is excluded. These are in-process native
workflow invocations without HTTP ingress, custom hooks or remote effects.
They do not establish native-business-relative, host/deployment or scale acceptance.
No host-wide idle/frequency measurements are collected, so retain all cohorts
and report variation without attributing its cause.

## CPU diagnostics

Run request-only Node inspector profiles separately from quiet measurements:

```powershell
node packages/executor/benchmarks/core-aot/run.mjs --assets work/validation/product-workflow-assets/frozen --scenario product-workflow --products 4 --runtime node --mode generated --profile --out work/validation/product-workflow-profile --rounds 1 --samples 3 --warmups 2
```

Profiler start/stop and committed verification remain outside the request timer.
Sampling stacks identify work to investigate; inclusive frames and sampled self
counts do not establish exclusive CPU or the behavior of Bun's generated code.

Three diagnostic four-Product requests retained 11,991 samples in total. Source
mapping groups their sampled self frames as follows; these are counts, not CPU
durations or percentages:

| Observed owner/frame | Self samples |
| --- | ---: |
| Effect runtime | 2,987 |
| Idle | 2,972 |
| Persistence/Core | 2,385 |
| Protocol | 1,287 |
| Byte/utilities | 468 |
| Native Medusa | 86 |
| Medusa adapter | 76 |

Recurring project frames include private JSON capture (`visit`, 234), lowercase
hex encoding (218), canonical document-ID decoding (156), byte comparison
(106), write-log insertion (90), native validation (89) and index-key encoding.
This points the next CPU investigation toward owned-value capture/canonical
encoding, byte/index work, Core write/index management and Effect construction
and dispatch. Native workflows delegate work to these owners, so the small
Medusa self count does not measure their inclusive cost. No optimization of
those remaining paths is claimed by this build experiment.

Requested sampling was 100 microseconds; observed median deltas were
529–554 microseconds. Large first deltas of 404–518 ms include profiler startup
outside the request timer. The raw profiles, mapping hash and sample summaries
are retained. Diagnostic timings are excluded from the quiet comparison above.

## Conformance witness correction

The initial existing suite failed two assertions on both PGlite and ordinary
PostgreSQL. The fixed 256-call refusal test omitted the four graph-reading hook
calls used by the maximum-graph witness, and its no-hook workflow fit the cap.
The empty-child test spied on `StockLocationModuleService`, while the executing
fork and its accepted admission use native `Query.graph` for that read.

The corrected checks use the bounded owner's existing charged-call diagnostic
and require complete rollback one call below the observed boundary. They also
observe the actual native Stock Location graph call with `id: []`. The 64-event
rollback test and other budget, rollback, replay, cancellation and publication
assertions remain in place. The production 512-call/128-event profile is retained.
Original expectations are preserved in Git at `3d165f5f`; the structured
[failure witness](./workflow-conformance.witness.windows-x64.json) records
expected/actual behavior and the owning source paths. No runtime behavior was
changed to clear these tests.
