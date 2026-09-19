# CE2 Active Request Measurement

Status: active CMS measurement and the connected bounded uniqueness correction
are implemented. Native/reference equivalence, wider concurrency and capacity
acceptance remain open.

## Outcome And Boundary

Measure the existing private CMS host with a genuinely activated Application,
ordered indexes, closed unique set and Payload write binding. Existing CE0
primitive publication measurements do not admit this authority and cannot
attribute continuous-maintenance request cost. Reuse `cmsHostFixture`, the
production CMS host/session/materializer, the pool observer and CE0 environment
provenance. No new framework capability or alternate execution engine is added.

The measured interval is `host.run`: fresh admission, document calls, publication,
settlement and recovery for replay. This includes catalog/readiness preparation
transactions as well as the one material publication transaction. Host construction, schema installation,
activation, request-key generation and assertion/read-back work stay outside.
This is the private trusted CMS core profile, not Payload Local API callbacks,
Cloudflare transport, native user-code execution or a matched independent SQL
reference. Those comparisons and broader lifecycle races remain open.

## Design, Alternatives And Acceptance

Use 1/8/32 unique-title inserts, one warm-up pair and five measured pairs at
offered concurrency one. Alternate normal/instrumented order in a shared
activated scope per size. Fixed-width unique inputs avoid conflicts; physical
tables grow during the run, so this is not a large-catalog capacity experiment.
Record normal and instrumented duration, query/transport bytes, command/family
counts and replay separately. A 5% median paired observer tolerance governs
interpretation; failure limits timing claims and must not discard samples.
Do not invent a throughput-improvement target from diagnostic local runs.

Require exact row/revision/claim/fact/outcome/wake increments, read-back of every
returned document, one dense commit increment, unchanged ordered/unique build
tuples, and durable replay without reexecuting the command or changing state.
Also retain uniqueness-conflict rollback. Normal requests must issue no ordinary
build progress UPDATE; count SELECT and WITH separately instead of treating all
mentions as writes. Family/command counters classify top-level statement verbs
mentioning known family names, not SQL syntax trees or affected-row counts.
Pair these counters with tuple/state proofs; never infer absence of writes from
the counters alone. Observer tests must preserve forwarding, cleanup and secrecy.

## Ownership, Breaks And Cleanup

The original repeated 32-row workload failed with `limitExceeded` once existing rows
plus pending inserts reached the 256-identity request budget. `CmsDocuments.validateUnique`
called `readBase(tableId)` and consumed the whole table before comparing keys.
This incorrectly made a selective write depend on total catalog size. Retain the
growing workload, the limit and failure semantics; do not reset between samples,
raise the limit or add an adapter bypass to make the benchmark pass.

`appUniqueKeys` now provides a bounded indexed slot read using its existing
projection/hash/canonical-byte verification. The CMS document owner combines that
committed owner with its bounded pending overlay. It loads only an actual conflicting
owner, authenticates its base document/key, and honors pending release/delete/reuse.
Preserve eager uniqueness refusal and rollback-only behavior. This removes the
whole-table uniqueness scan; explicit bounded scan APIs retain their semantics.
The fresh admitted closed definition set, held scope clock and final materializer
remain authoritative. No new claim writer, transaction or cache is introduced.
Large-catalog, pending release/reuse, conflict and corrupt-claim witnesses run
through existing core consumers on both drivers. No durable format/API break is
needed; this is an internal read capability used by the current CMS core.

The existing observer now includes family/command counts and unique-build/claim families;
do not instrument production code or change locks, schema, APIs or codecs.
Keep the low-level baseline for its explicit primitive comparison. Remove stale
claims that unique serving still updates progress; keep scope-clock serialization
and incomplete native/reference/capacity acceptance explicit.

Run shared semantic assertions with PGlite and ordinary-role PostgreSQL before
the isolated timing lane. Validate observer regressions, affected typecheck,
lint, both read-only reviews and exact staged checks. Save raw reports outside
tracked roadmaps with source/configuration hashes, stop owned resources and
commit one coherent measurement slice. Passing this slice does not close CE2.

## Remaining Measurement And Execution Work

`cmsExecutionMeasurement.test.ts` and its PostgreSQL counterpart share the
growing-catalog correctness scenario. The PostgreSQL `measures` case records
paired raw samples through `FLAREX_CE2_ACTIVE_CMS_REPORT_PATH`. Source/configuration
hashes and raw receipts stay in that report and Git, not this living roadmap.

Active build tuples and ordinary build-write counters stay unchanged while
rows, indexes, unique claims and publication advance. Full requests and durable
replay still perform repeated catalog/readiness preparation before their one
guarded execution/recovery transaction. Attribute and correct that work at the
existing preparation owner with fresh authorization/activation checks; do not
introduce an adapter readiness flag or bypass verification on replay. The active
CMS profile remains distinct from native persistence and the primitive SQL
reference. Scope-clock concurrency and matched before/after comparisons remain
required before claiming CE2 or broader execution acceptance.
