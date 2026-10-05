# Complete native business baselines

This benchmark supplies the native business reference for the direct executor's
daily Product, Payload and mixed graphs. It uses the pinned Medusa 2.13.4 source
island's actual Product/MikroORM, Pricing, Link, query and workflow SDK, and
Payload 3.88.0 with `@payloadcms/db-postgres` 3.88.0. It changes no Flarex runtime.
The selected contract is [preflight 26](../../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md).

## What is measured

| Flow | Timed complete native business work |
| --- | --- |
| `payload-create` | `news-items` create, unique headline, default score, native commit and complete result |
| `payload-lifecycle` | Post create, nested afterChange score update/read, outer read, enable update and final read |
| `product-graph` | Seeded Product update, complete retrieval and indexed handle list |
| `medusa-workflow` | Existing Product's selected Variant/Pricing/Link child, native Tag update workflow and graph queries |
| `mixed-product` | PostgreSQL Application insert surrogate, Product update/retrieve/list, Application patch surrogate |
| `mixed-payload` | Same Product graph, Payload nested-hook lifecycle, Application insert/patch surrogates |
| `mixed-workflow` | Product update/retrieve, selected launch workflow, Payload lifecycle, Application launch insert/patch surrogates |

Product tags/categories/images/options/variants are seeded through the existing
`productAttemptSeed` inputs and real native services outside request timing.
The selected workflow composes the same native steps/child frames/query demands
as Flarex's admitted launch graph. It does not claim the full upstream
create-products workflow, Inventory or external effects.

Native framework calls commit independently. These mixed rows are **business
references, not equivalent atomic mixed-root implementations**. The two ordinary
PostgreSQL JSON document writes are explicitly a surrogate, not native Convex or
Application OCC/history/journal/outcome persistence. No transaction remains open
across the framework calls. Native framework events reach the pinned mock event
bus; Flarex's durable publication and external event delivery are not measured.
Native UUID IDs, framework timestamps and native database schemas remain native;
there is no DTO projection to conceal them or claim exact cross-lane equality.

Each timed request includes all native business calls, hook work, full returned
values and actual commit acknowledgements. Verification performs separate native
committed reads for Product, price sets, links, Payload and the Application
surrogate. Preparation, seeding, verification and cleanup are outside request
latency and retained individually. Native construction/connections live for one
command. Public Pool acquire/release events track Payload lifetime ownership;
no SQL or CPU observer runs in request intervals. Payload's native `destroy`
resets schema state but does not end its pool; the benchmark releases its retained
bootstrap checkout and ends the owned pool only after native destroy and all
business work. No driver query/transaction logic is replaced.

## Reproduce

Provision two **disposable existing databases** owned by an ordinary login. The
Medusa schema generator refreshes its native tables. Never point this benchmark
at retained or shared application databases. Keep durability enabled and quiet
`pg_stat_statements.track=none` settings. Stop overlapping tests/typechecks and
other performance runs before measuring. This benchmark neither provisions nor
drops databases and never changes global server settings.
The runner rejects `MEDUSA_MODULE_TEST_PERSISTENCE=pglite` before resource
acquisition; the business lane must remain native PostgreSQL/MikroORM.

Install the isolated, locked native Payload dependency tree without changing the
workspace dependency graph:

```powershell
New-Item -ItemType Directory -Force work/native-business-baseline/dependencies | Out-Null
Copy-Item packages/medusa-adapter/benchmarks/core-performance/native-business/dependencies.package.json work/native-business-baseline/dependencies/package.json
Copy-Item packages/medusa-adapter/benchmarks/core-performance/native-business/dependencies.package-lock.json work/native-business-baseline/dependencies/package-lock.json
npm ci --prefix work/native-business-baseline/dependencies --workspaces=false --no-audit --no-fund
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/product build
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/pricing build
corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter @medusajs/link-modules build
```

The pinned framework/test-utils/core-flows/workflow SDK dependency builds must
also exist. Use source-island commands and never resolve promoted Flarex modules
as the native reference. Set actual URLs without writing credentials into reports:

```powershell
$env:NATIVE_BUSINESS_MEDUSA_URL = '<ordinary-role disposable Medusa database URL>'
$env:NATIVE_BUSINESS_PAYLOAD_URL = '<ordinary-role disposable Payload database URL>'
$env:NATIVE_BUSINESS_SAMPLES = '100'
$env:NATIVE_BUSINESS_WARMUPS = '5'
$env:NATIVE_BUSINESS_FLOW = 'all' # or one exact name from the table
node --import tsx packages/medusa-adapter/benchmarks/core-performance/native-business/run.ts
```

One sample and zero warmups is smoke only. The runner uses the existing core
nearest-rank percentile policy; P95 is absent below twenty samples. At least
thirty retained samples and five warmups are required for its sampling label.
All warmups, successful/failed requests, complete results, verification and
cleanup costs remain in exclusive UUID-named compressed reports. Failure marks
the run incomplete and cannot produce a passing acceptance claim. Reports retain
the executing native CommonJS inventory, the Payload ESM distribution files,
exact dependency lock, authored sources and settings before/after. Source changes
across request measurements invalidate the run.
Unreadable final sources also retain an incomplete receipt. A three-minute
command deadline and SIGINT/SIGTERM handlers save collected evidence before
exiting. Forced termination labels native cleanup and pending commit outcomes
unconfirmed; process exit closes sockets, and the disposable database owner
must inspect/drop those resources. Imports precede this runner deadline.

## Acceptance direction

The owner selects these complete graphs as the reference for ongoing optimization
and a native-relative target: at most **5 ms
added median / 10 ms added P95 for the complete mixed root**, with the cost of
Flarex-only snapshot/OCC/history/durable outcomes explicitly attributed. Aim for
10-15 ms total median for small warm graphs whose native business cost permits it.
A larger native graph may require a larger total budget. The old 100/200/500 ms
median targets are historical intermediate milestones and no longer final
acceptance. This allowance applies once per complete root. Method-specific
retrieval/unique probes retain their diagnostic role. Additional graphs need
matching native references before they can claim native-relative acceptance.

This baseline alone does not pass that target. Final acceptance needs comparable
final-source quiet runs with at least thirty samples after five warmups (prefer
one hundred), and paired complete-request excess before percentiles; do not
subtract independent native and historical Flarex percentile summaries. Local
Node/PostgreSQL timings establish no hosted Cloudflare or Hyperdrive latency.

## Retained reference

[The final-source 100-sample reference](./reports/e5a156a5-c6d2-488e-880b-999391a32d63.json.gz)
retains five warmups plus one hundred measured requests for each graph: 735
requests, all successful with committed native readback. PostgreSQL 18.3 and Node
24.16.0 ran with ordinary roles, `synchronous_commit`, `fsync` and
`full_page_writes` on and `pg_stat_statements.track=none`. Source/settings checks
passed and all benchmark connections were released. Setup took 3.25 seconds;
the recorded command interval was 23.00 seconds, excluding import/startup and
final evidence compression/write.

| Flow | Median ms | P95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Payload create | 1.05 | 1.38 | 1.99 |
| Payload nested-hook lifecycle | 4.09 | 5.02 | 6.20 |
| Product update/retrieve/list | 9.41 | 11.74 | 12.77 |
| Standalone launch workflow | 17.87 | 20.79 | 34.08 |
| Application surrogate + Product | 9.28 | 11.38 | 15.63 |
| Application surrogate + Product + Payload | 13.58 | 16.41 | 19.55 |
| Application surrogate + Product + launch + Payload | 28.07 | 31.44 | 33.22 |

Every maximum is retained. These are local development-machine observations,
not a certified isolated capacity run.
No matching compiler/test process was visible at the start. Other-session work
continues asynchronously, so absence throughout every request is not proven.
The [earlier 100-sample run](./reports/d930ab9b-32e1-4095-b4ba-7d3662fe9289.json.gz)
had a mixed workflow maximum of 198.12 ms; it preceded decoder hoisting and the
runner's interruption/source-failure corrections. The
[preceding 30-sample run](./reports/787af88c-f91f-47ca-9df3-490820c45f87.json.gz)
has substantially wider later-graph tails (mixed Payload P95 107.42 ms; mixed
workflow P95 301.07 ms). Their cause remains unresolved; these runs do not establish
tail stability. Reproduce controlled paired measurements before accepting P95.

For median planning, native business cost plus the selected 5 ms root allowance
suggests approximately **14 ms Product, 19 ms Product/Payload and 33 ms full
workflow**. These budgets are planning references, not subtraction-based paired
overhead measurements, guaranteed deadlines or permission to weaken Flarex's
atomic settlement and recovery. Small graphs support the original 10-15 ms
direction; the complete launch graph's native cost already exceeds 15 ms.

Earlier failed bootstrap/access/seed smoke receipts remain compressed alongside
the successful smoke. They preceded harness corrections and provide no latency
acceptance. The first full-run attempt was interrupted during preparation after
detecting another compiler; it produced no retained request evidence. The native
resources used for these receipts were disposable and are removed after checks.
Failure probes additionally retain PGlite startup rejection, a shortened deadline,
an injected Node SIGTERM event and an injected final source-read failure. These
are incomplete correctness receipts, not timing observations. Windows process
termination may bypass Node signal handlers; the injected event proves the
handler, not OS delivery or recovery from SIGKILL.
The isolated locked dependency installation remains reusable under ignored
`work/native-business-baseline/dependencies`; the databases and login are removed.
