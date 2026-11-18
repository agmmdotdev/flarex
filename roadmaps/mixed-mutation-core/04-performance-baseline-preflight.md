# Mixed Mutation Performance Baseline

Status: **original measurement partial; corrected private cost series complete.**
The original ordinary-role PostgreSQL run produced complete successful warm
Product, Product-plus-Payload and finite-workflow series, then one
finite-workflow cold request reached its existing deadline. The remaining
cold request was not attempted. The failure's cause has not been established;
no failed sample is omitted or treated as a successful distribution. A
separate filtered standalone-workflow series completed its planned samples;
it does not fill the missing original mixed cold sample. The complete
post-correction series closes the current private cold-workflow acceptance
gate while preserving the original partial record.
This measurement package precedes further Product or SalesChannel admission.
It records costs of the already proved profiles and recommends numerical
targets from evidence. Its measurement approval did not authorize
optimization;
the separate, approved [core query cost correction](./05-core-query-cost-preflight.md)
now owns that bounded work. Neither package approves another framework
operation, public APIs or named-environment activation. The
[accepted mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md#performance-evidence-and-optimization-sequence)
sets the sequence: connected correctness first, measurement second, owner-led
optimization only after the baseline.

## Decision and bounded outcome

Measure where the existing mixed attempt spends SQL dispatches, awaited database
time and wall time. The immediate question is whether repeated checked reads,
source binding and attempt authority work dominate the Product, Product plus
Payload and complete finite workflow paths, and which actual owner would need
correction. Preserve every current authority, dependency, journal, event,
rollback and recovery obligation while collecting evidence. There is no target
to reduce a count before its meaning and cost are known.

The package delivers a reproducible, machine-readable sample set, a concise
comparison of the four workloads below, ranked SQL/time contributors mapped to
source functions, explicit uncertainty, and recommended acceptance targets for
the separately approved correction. It makes no production telemetry service,
execution API or persistence contract. A passing isolated correctness fixture
or elapsed test duration is not a latency baseline.

## Workloads and comparison boundary

| Workload | Existing private seam | Measured outcome |
| --- | --- | --- |
| Application plus Product | [mixed Product Worker fixture](../../packages/flarex-backend/test/support/mixedMutationProductFixture.ts) | One admitted native Product update, pending read, dependent Application write and one publication. |
| Application plus Product and Payload | The same fixture with its selected Payload `posts` lifecycle | Native Product, nested and outer Payload reads/writes, dependent Application result and one publication. |
| Complete finite mixed workflow | The same fixture with `workflow: true` | Product scalar update/read, real ordered Variant/Pricing/Link and Tag children, Payload lifecycle, dependent `productLaunch` record and one publication. |
| Selected standalone native workflow | [native Product launch test](../../packages/medusa-adapter/test/logical-product-launch-workflow.test.ts) using `prepareAtomicWorkflowHost` | The same finite two-child Product/Pricing/Link/Tag business graph and event selection under its independently settling profile. |

Use the same ordinary-role PostgreSQL instance class and isolated schema
policy. For the two workflow workloads, seed a `Size: "0"` Product with an
attached `preview` tag and align the child input and resulting one Variant,
one PriceSet, one USD Price without rules, and one Link across mixed and
standalone runs. The Product and Product-plus-Payload workloads keep their own
matching selected data shapes; they do not create the workflow graph. Record the profiles'
different root obligations and resource selections. The standalone workflow
comparison isolates the selected business graph; its latency delta is **not**
isolated framework overhead because the mixed path also performs Application,
Payload, journal and OCC work. There is no native Medusa ORM parity claim
without a separately runnable equivalent baseline and matching obligations.

For a warm series, provision one isolated schema/scope and prepare disjoint,
equivalent input graphs outside each measured interval. The Product and Product
plus Payload graphs can be preseeded. The finite workflow fixes the tag value
`preview` and updates it to the uniquely claimed value `launched`: seed its next
graph before that sample, then rename the prior committed tag to a unique
retained value before another launch. Record this fixture work separately. Reuse the same
prepared modules, scope and pools for warm samples, while each mutation gets a
fresh attempt, business IDs and single-use Worker. The exact runtime permits one
invocation per Worker; Worker construction, readiness and disposal therefore
belong inside every mixed request interval. The graph selected by each run begins
at the same shape; other committed rows can accumulate, so record table
cardinality before each sample.
Use separate isolated scopes and module construction for cold samples.
Provisioning, migration, source compilation/registration, seeding and cleanup
stay outside invocation timing. Separate cold runtime construction from request
admission and warm invocation. The measured warm interval starts before fresh
Application selection, grant signing, session activation and journal opening,
then includes Worker construction, readiness, dispatch and disposal or the
standalone host request until authoritative publication and retained outcome
resolution. The private
test grant issuer and signed-argument parsing are included; report the mixed and
standalone profiles separately.

## Instrumentation and attribution

- Use the existing test fixture and driver seams. Its `sqlByPhase`/`observeSql`
  currently observes **PGlite only** and uses one mutable phase variable; it
  is useful for correctness checks but supplies no complete PostgreSQL timing
  baseline and is unsafe as concurrent phase attribution. For PostgreSQL, use
  fixture-owned instrumentation around the existing `PostgresPersistenceOptions`
  injected pool and acquired client. Trace control and target pools separately,
  including direct SQL, Drizzle statements and transaction commands. Count a
  dispatch once at the client boundary; do not count a delegated `pool.query`
  again. Reconcile observed counts against fixture entrypoints and fail the
  sample if a relevant query route is unobserved.
- Record driver dispatch count, SQL statement count and awaited dispatch time
  as distinct measures. One dispatch can contain several SQL statements; a
  dispatch is only a proxy for a network round trip unless the protocol proves
  one-to-one behavior. Count statements from compiled statement records or a
  SQL-aware parser, never by splitting on semicolons; report unclassifiable
  dispatches instead of presenting an inferred exact count. Time from query
  submission through Promise settlement includes driver and database wait, not
  server execution alone. Measure pool
  checkout separately so it is not silently assigned to query execution.
  Instrument transaction begin/settle intervals and scope-clock wait/hold only
  where boundaries can be observed accurately; label an unavailable metric
  rather than infer it from total latency.
- Use per-invocation correlation and named phase spans for request admission,
  Worker construction and execution, journal seal/OCC preparation, publication,
  and retained outcome. Preserve nested inclusive times and compute exclusive
  time without double counting. Exact native child, checked-read, inner OCC,
  materialization and scope-clock lock intervals have no test observation hook;
  mark them unavailable and use source/SQL fingerprint attribution without
  inventing phase durations. Report the union of observed awaited query intervals,
  not an inferred sequential path. A global mutable phase string must not label
  concurrent work.
- Group structural SQL by a normalized fingerprint without storing parameter
  values, row data, credentials or raw literal-bearing SQL. Map each important
  fingerprint and phase to its exact owning package/source function using a
  separate untimed reconnaissance trace when necessary; do not pay for stack
  capture on every measured call. Preserve an `unattributed` bucket and report
  its size. Core work-call budget usage is not SQL statement or dispatch count.

The instrumentation stays in test/benchmark support and must not wrap business
methods, alter transaction or error semantics, cache authorization, or bypass
checked reads. Existing distinct control/target PostgreSQL connections and
ordinary-role permissions remain the proof boundary. PGlite can check trace
shape and semantic assertions, but only ordinary-role real PostgreSQL supports
the latency, lock and query-cost conclusions here. Hosted transport requires a
separate gate.

## Sampling, analysis and exit gate

Run a small reconnaissance pass to verify coverage and phase boundaries, then
three warmups and 20 measured **successful warm** invocations per workload,
sequentially and without another heavy test sharing the database host. Run
three separately labeled cold construction/invocation samples per workload.
Keep input shape, source revisions, connection settings and machine conditions
fixed; record the starting cardinality and growth through each warm series.
Report every sample, median and range, plus descriptive p95 for the 20 warm
samples. Do not claim a stable p99, throughput or production capacity from this
sample size. Record failures and rerun exclusions rather than silently drop
them.

After sequential attribution, use only focused, bounded probes if the baseline
points to them: same-scope versus separate-scope two-request concurrency, and
one whole-attempt retry and one retained replay. Report their added SQL and
elapsed time separately from successful first attempts; do not blend them into
warm percentiles. Avoid a broad load-test program before bottlenecks and
numerical targets are reviewed.

Keep raw machine-readable records with repository revision, test/profile and
source revisions, PostgreSQL/Node/runtime versions, host/connection settings,
schema/data shape, cold/warm label, scope/run ID, phase spans, dispatch and
statement counts, awaited durations, fingerprint/owner mapping, journal bytes,
committed row/index/event counts and any measured lock interval. The report
must show end-to-end wall time alongside the non-additive phase and query time
totals, rank contributors by awaited time and sequential dispatches, explain
control versus target work, and state missing coverage or timing uncertainty.

Completion requires a reviewable equivalent-graph series, instrumentation
coverage checks, raw samples and an owner-by-owner cost analysis. The
implemented correction in [preflight 05](./05-core-query-cost-preflight.md)
supplies a complete comparison series against this unchanged partial record;
its retained evidence and numerical results are in the
[benchmark guide](../../packages/flarex-backend/benchmarks/mixed-mutation-core/README.md).
Raising timeouts or limits and extending Product or SalesChannel admission
require their own focused agreement.
