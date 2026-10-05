# Complete Native Business Baselines

Status: native business reference implemented. Complete graph timings are
retained in the [benchmark ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-business/README.md).
Final paired Flarex overhead and stable tail acceptance remain open.

## Outcome and ownership

Measure the native business work behind the direct executor's five daily graphs
before setting tighter mixed latency expectations. This is authorized baseline
work, separate from preflight 24's active runtime changes and preflight 25's
expanded Flarex measurement runner. Benchmark-only files own the native setup,
composition and reports; no core, framework business implementation, schema,
durable format or host contract changes are selected.

The existing paired Product retrieval/unique evidence measures methods, not
complete mutations. Existing mixed median gates of 100/200/500 ms are interim
milestones, not evidence of native parity. Do not infer a sub-5-ms native workflow
from a sub-5-ms native lookup.

## Measurement contract

Use the pinned native Medusa Product/MikroORM, Pricing, Link and workflow SDK
implementations and Payload 3.88.0 Local API with its matching PostgreSQL
adapter. Measure complete Product update/retrieve/indexed-list, Payload scalar
create and the mixed post create/nested afterChange update/read/outer read/update/
read lifecycle, and the selected Variant/Pricing/Link/Tag launch composition.
Native steps own their semantics; benchmark composition mirrors the admitted
graph, not the full upstream create-products workflow or additional modules.

Run over isolated ordinary-role PostgreSQL resources with synchronous commits,
fsync and full-page writes enabled. Retain native construction/connections for
one bounded run. Report installation, preparation, seeding, verification and
cleanup separately; request intervals include business execution, native hooks,
results and actual commit acknowledgement. Verify committed state through fresh
native reads outside the interval. Retain every sample, warmup and failure.
Fingerprint executing native implementations and benchmark inputs before and
after each run. Quiet distribution evidence uses at least 30 samples after five
warmups; traced SQL belongs to a separate diagnostic run.
Reject the native helper's ambient PGlite selector before acquiring resources.
Bound the command with a deadline and retain incomplete evidence on interruption,
deadline or unreadable final sources. Forced exit cannot claim confirmed native
cleanup or settlement; disposable-resource inspection remains required.

Medusa/Payload's independently committed calls are not an atomic mixed-root
equivalent. Report their sequential complete framework graph as a native business
reference, explicitly identifying the extra Application insert/patch demand and
Flarex's snapshot/OCC/history/journal/atomic-outcome obligations. A simple
PostgreSQL Application-document surrogate may measure those two writes only;
it is not native Convex or a replacement Application engine. Never subtract
unmatched historical percentile summaries and call the result paired overhead.

## Direction and limits

Prefer existing native construction and real service/Local API methods over raw
SQL stand-ins for frameworks or invented adapter implementations. Retain the
existing read baselines with their method-specific scope. Add complete business
baselines; do not loosen existing gates or modify another session's runtime.

After the measured complete native graph is available, propose a per-root budget
of native business cost plus at most 5 ms median / 10 ms P95, and 10-15 ms total
median for small warm graphs where the native baseline supports it. These are
proposed targets, not a claim of equivalent guarantees or achieved latency.
Paired final-source comparisons and explicit attribution of Flarex-only semantic
cost are required before declaring native-relative acceptance.

## Completion

Verify real framework outputs, hooks, graph cardinality and committed readback;
verify positive sampling, enabled durability, non-privileged roles and bounded
resource cleanup. Typecheck authored TypeScript, run applicable lint/source
boundaries, obtain both read-only project reviews, and commit only this slice's
files/hunks. Keep measured receipts in the benchmark ledger, not this roadmap.
Disposable owned databases/roles and dependency setup are removed or left with
an explicit reusable-resource disposition; named retained data is untouched.
