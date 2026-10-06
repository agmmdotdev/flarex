# Executor Measurement Flow Expansion

Status: implemented private measurement harness. Smoke verifies flow assembly
and reporting. The complete native reference from [preflight 26](./26-native-business-baseline-preflight.md)
now governs final acceptance; matched paired overhead and stable tails remain open.

## Outcome And Owners

Expand only the direct executor measurement runner from its five fixed graphs
into an explicit daily and extended matrix. Preserve the five existing graphs
as iteration evidence. Add native Product creation, graph update and lifecycle,
Payload CRUD/query/relation demands, and Application-only, Application/Payload
and repeated pending-operation graphs through the existing finite executor.

This extends [the harness](./21-core-performance-harness-preflight.md), not
framework capability coverage or the other correctness suites. Executor test
support owns composition and reporting; adapters retain native semantics;
persistence retains admission, history, constraints, settlement and recovery.
The active whole-mutation owner retains its runtime edits and preflight 24.

## Selected Contract

- Keep `--scenario` and the five historical scenario names. Default remains
  `payload-create`; a daily selection keeps the historical five, while `--all`
  selects the expanded inventory. List exact graphs without starting a database.
  Select one family explicitly. `--smoke` verifies one real request without
  warmups and cannot be presented as latency acceptance. Existing `--full`
  remains twenty samples after three warmups for iteration. `--acceptance`
  selects one hundred quiet samples after five warmups; sampling alone cannot
  prove native-relative acceptance. Separate assembly verification from distributions.
- Share a single scenario inventory between command selection and the runner.
  Report scenario semantics and input cardinality so unlike graphs cannot be
  presented as interchangeable baselines. Preserve short and full sampling,
  separate SQL and CPU diagnostics, failure exit codes and original failures.
- Retain preparation only in a bounded, single-command family lifetime. Fresh
  keys, seeds, request/attempt state, native execution and real commits remain.
  Release every family at command completion, including failing preparation.
  Report acquisition/reuse and disposal cost; include all cost in command totals.
  Release after the last selected use to keep peak resource cost bounded. Durable
  history within a family remains until disposal; disclose the difference from
  fresh single-flow preparation. Reuse never crosses command boundaries.
- Use native Product commands and event receipts for graph writes and lifecycle.
  Measure creation and deletion themselves, rather than their untimed setup.
  Product delete, soft delete and restore are separate workloads.
- Use actual Payload Local API commands, scalar indexed query shapes and the
  existing fresh-install many/join conformance profiles. Fixture installation
  reuses current admission/readiness owners rather than copying their logic.
- New mixed graphs use admitted Product update/retrieve/list and Payload
  create/update/findByID, and complete entry, execution, freeze and publication.
  Application-only and Application/Payload use the existing prepared fixture
  source envelope; disclose unused installed Product sources and seeding.
  They do not establish minimal-source admission cost.
- Test representative small/typical sizes within existing bounds. No global
  schema, budget or runtime permission changes, benchmark rollback transactions,
  authority caches or reusable state across commands are authorized.

## Complete Native Reference And Reporting

Use the committed complete native business graphs, not native method timings,
as the performance reference. The selected added-cost budget is five milliseconds
median and ten milliseconds P95, charged once across the complete matched graph.
Old absolute mixed gates are intermediate history. Native calls commit
independently and Application writes are PostgreSQL surrogates; attribute real
Flarex snapshot/OCC/history/journal/atomic-outcome/publication work at its owners.

Reports identify the pinned reference and hash, observed complete request costs,
one root budget and unresolved semantic attribution. Only the original small
daily graphs map to this reference. Additional CRUD/relation/repeated graphs and
typical sizes need their own matching native business graphs; Product scalar
update does not inherit the native update/retrieve/list graph. Planning totals
use reference cost plus the selected allowance and are explicitly not measured
paired excess.

`quietSamplingEligible` requires a successful complete quiet series with at least
thirty samples after five warmups. `quietAcceptance` remains false and paired
excess remains absent: this runner does not orchestrate fresh matched native
pairs, source/settings stability checks or controlled tail reproduction. Final
acceptance requires those final-source pairs and per-pair excess before
percentiles. Historical percentile subtraction cannot fill this gap. Preserve
failures, maxima and tails; narrower method probes remain diagnostics.

This replaces the former report boolean that treated any unprofiled non-smoke
run as quiet acceptance. Report consumers must distinguish eligible sampling,
reference-only planning and actual paired acceptance. No runtime, durable data
format, authority or settlement contract changes with this reporting cutover.
Runtime optimization remains with preflight 24's owner. The committed core
baseline now permits the separately owned harness cutover and validation.
The shared test-series bound follows the maximum declared sampling plan (105
fresh attempts) instead of the historical forty-attempt cap. This changes only
the measurement fixture's bounded run length; business operation, authority and
runtime budgets are unchanged. Seeds remain lazy and attempts independently fresh.

## Shared SDK Composition

The command and measurement SDK select the same prepared family and scenario
view. Existing flow owners retain seeding, the timed native or finite invocation,
committed-result verification and cleanup. SDK composition provides diagnostic
tracing at the genuine Effect runtime entry; mixed series also carry their
existing publication observation and cleanup-failure sink. Native host commands
retain their existing contract. Observation does not introduce another business
engine or publication option.

PostgreSQL endpoint selection is explicit at the family preparation boundary and
is forwarded to the existing fixture owner. PGlite returns actual scenario views
without PostgreSQL pools, supporting timeline and CPU diagnostics through the
same flow. PostgreSQL endpoints on a PGlite selection fail before preparation.
The original finite graphs and standalone Product launch have fixed cardinality
across size selections; their views report that limit. Extended and typical
graphs remain outside the original five matched small native references.

The earlier benchmark CPU helper remains owned by its actual command and
mixed-native-read consumers. Its sampling summary differs from the SDK's bounded
CPU, allocation and GC evidence. Retirement requires migrating both consumers
without discarding their raw sampling windows or cleanup guarantees.

## Challenged Alternatives And Boundaries

A single large happy-path workflow hides per-operation costs. Measuring every
correctness case would make iteration expensive and conflate separate owners.
Use named representative execution graphs with a small daily set and an explicit
extended set instead. Share only immutable installation/native construction;
never cache request decisions or commit results to shorten runs.

Full Product creation with Inventory/Stock Location, calculated pricing,
arbitrary Payload drafts/uploads/auth/localization and new mixed delete or
relationship participants remain separately gated. Cold/reconnect, controlled
contention, error/rollback/recovery timings and exact native-method comparisons
must have declared comparable envelopes before becoming acceptance scenarios.
Existing witnesses are not imported as replacement measurement cases.

## Replacement And Data Disposition

Extend the current runner and replace duplicate scenario selection lists. Retain
the historical scenarios and reports as comparison evidence. New fixtures are
disposable; no retained application data or durable protocol is migrated or
deleted. Preserve unrelated dirty files and overlapping whole-mutation edits;
stage only this slice's hunks or new files.

## Validation And Completion

Validate selection, family release/reuse, failure propagation and committed
business results. Run the added flows on ordinary-role PostgreSQL with real
settlement, and a representative PGlite lane through the same assembly. Keep
functional smoke, short timings and full distributions distinct. Check affected
TypeScript, core/diff/staged lint, both read-only project reviews and connected
source boundaries. Update the runner documentation with exact implemented
inventory and limitations, remove displaced selection/assembly, and make one
scoped commit. Resume other chats' measurements only after the runner handoff;
do not claim a production or core latency improvement from faster fixture setup.
