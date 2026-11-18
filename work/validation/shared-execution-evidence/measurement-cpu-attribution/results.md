# Matched CPU attribution on the current checkout

Base: `2d7c693bbe39d9eff7b49311e71c1382860ccaa5`, branch
`wip/candidate-admission`, 2026-10-13. No worktree or production runtime changes.
This change extends the existing measurement SDK and reuses its original native
and Flarex mixed-workflow graphs, probes, verification and cleanup.

## Current measurement and conclusion

The untransformed, profiler/observer-free control still measures **124 ms median
and 125.35 ms mean added thread CPU**, over 40 matched complete workflows.
Native mean: **28.075 ms**; Flarex mean: **153.425 ms**. The four-pair block
bootstrap 95% interval for the mean difference is **115.375–135.450 ms**.
The 40 differences range from 78 to 189 ms; none are discarded.

This is current CPU evidence, not the historical 172 ms pricing-query elapsed
wait. It is also not a before/after optimization comparison. The earlier
109 ms control and historical 125 ms cohort remain their own observations;
differences across those campaigns do not establish a saving or regression.

The new evidence locates a distributed cost: executing persistence and protocol
work, interpreting/composing Effect and Result programs, Schema processing,
copies/encodings, and driver/framework work. It does **not** identify one
100 ms generator, one stall, or 125 ms of removable interpreter overhead.
Cycles and admitted stack samples establish execution locations; they do not
produce an exact per-owner millisecond decomposition of the native-relative gap.

## What the API now measures

- `compare({ mode: "cpu", ... })` profiles both genuine lanes with the existing
  CPU/GC collector and independent complete-call thread/process CPU counters.
  Both elapsed timers exclude profiler acquisition/release.
- Self samples are partitioned by executing source category and original runner
  ancestry. Nearest authored callers are separate provenance, not fabricated
  source-map coordinates or exclusive ownership claims.
- Optional root-counter cycle attribution observes the installed Effect runner.
  The generator detail additionally wraps existing authored generator expressions
  with the earlier probe's AST mechanism. Nested synchronous advances form a
  disjoint cycle ledger; no scope crosses a yield or await.
- Original receivers, arguments, return/throw, business failure, interruption,
  finalization and first failure remain intact. Counter failures or missing
  required engine/body observations invalidate diagnostics without replacing
  business outcomes. Exact runner descriptors are restored after capture.
- Windows reader/engine hashes, native thread identity, calibration, transform
  manifests and balanced four-pair observer assignment are retained. No cycles
  are converted to milliseconds. Generator transforms cannot enter CPU/control
  campaigns through a stale detail setting.

The Windows thread CPU counter advanced in approximately 15–16 ms increments
in calibration; the cycle reader resolved smaller empirical increments.
This is observed calibration, not a hardware-resolution guarantee.

## Complete campaigns

All six processes ran sequentially, with five warmups per lane, ordinary-role
PostgreSQL, durable settings, the same small mixed workflow and unchanged
source hash `418159f07685a2324628f68ad6458958bdae200c838931634f487f7028960bf1`
(6,965 inventoried files). All 200 matched pairs passed complete business
verification, source/settings stability and resource cleanup gates.

| Campaign | Pairs | Added thread CPU mean | Median | Run ID |
| --- | ---: | ---: | ---: | --- |
| Engine cycles, ABBA | 32 | 115.625 ms | 109.5 ms | `95c6e067-c87f-42cd-9a2d-153e88210627` |
| Generator cycles, ABBA | 32 | 123.90625 ms | 125 ms | `a5daedae-fef0-4c24-bb7f-864ec0ea9cb8` |
| Generator cycles, BAAB | 32 | 126.3125 ms | 125 ms | `b7f5fc15-b171-417a-afef-8ba22567ed54` |
| Untransformed profiles A | 32 | 130.96875 ms | 125 ms | `d1d05608-02a7-4233-afea-78c7f6c01ca5` |
| Untransformed profiles B | 32 | 112.59375 ms | 109 ms | `10145e65-a748-49ba-bee4-f0c1ab533cf1` |
| Untransformed control | 40 | 125.350 ms | 124 ms | `af72c8ff-0a57-4935-ba88-b54757ceedb0` |

Cycle/native binary SHA256:
`87aab6b32662ee1cdb18277564f9c406f252a413bb0728cecb21d2a88f973beb`.
Installed Effect 4.0.0-rc.112 engine SHA256:
`269e711472b84dcd04862f11e842acc1095cc5d22948af36cda76e9a9185828e`.
The reader source is promoted unchanged to the measurement SDK's `native/`.
The four-pair smoke run predates review corrections and is excluded from every
table and aggregate here.

## Where observed cycles execute

The engine-only campaign puts **79.15%** of observed cycles inside `runLoop`.
That is inclusive application work, not pure interpreter overhead.

The two generator campaigns agree closely. Pooled over 32 observer-enabled
roots, all **20,190,495,036 cycles** reconcile exactly to disjoint buckets:

| Executing scope | Share of observed root cycles |
| --- | ---: |
| Persistence generator bodies and their unobserved synchronous callees | 40.91% |
| Engine scope excluding observed bodies | 30.31% |
| Outside observed engine/body scopes | 19.17% |
| Medusa adapter generator bodies | 6.30% |
| Protocol generator bodies | 1.71% |
| Other authored generator bodies | 1.59% |

Each root has **16,242 observed generator advances** and **826 runner entries**.
These are synchronous advances, including nested Result generators, not distinct
Effect factories, fibers, database calls, or new business operations.
The engine residual includes unobserved callbacks, helpers, parsers, and observer
work; the outside bucket includes asynchronous continuations and driver work.

The largest individual body is `consumeAccessMetadataResult` at **1.716%**,
followed by canonical unique-key lowering at **1.275%**, relational selection at
**1.172%**, borrowed workflow context at **0.928%**, and relational predicate
visiting at **0.897%**. No one body is a large removable CPU budget. These scopes
are not additive with the following separate profiler campaign.

## What untransformed stack samples identify

The two Flarex profiles retain 9,143 conservatively admitted samples: 3,293 idle
and **5,850 non-idle self samples**. Another 1,791 boundary-ambiguous samples and
67 outside samples remain separately reported. The denominator below is the
admitted non-idle subset, not complete root CPU time.

| Executing source category | Share of admitted non-idle self samples |
| --- | ---: |
| Persistence code | 22.38% |
| Effect engine implementation | 19.85% |
| Protocol encoding, keys, identities and other protocol work | 11.20% |
| Other Effect utilities, including Result | 8.05% |
| Schema implementation | 6.26% |
| Node internals | 6.97% |
| Drizzle | 4.56% |
| Medusa | 3.90% |
| Garbage collector | 3.71% |
| PostgreSQL driver | 3.62% |
| Other authored code, Payload and measurement | 2.50% |
| Unknown/redacted/program frames | 7.01% |

The leading repeated functions are stable in both processes:

- The installed `Iterator` continuation is **5.03%**. Its profiler function label
  is `makePrimitive` at executing line 925, but source inspection shows this is
  `fromIteratorUnsafe[contA]` advancing the iterator, not factory construction.
- The function returned by Effect's `makeFn` is **4.44%**. Current code constructs
  suspension/context/span machinery and captures a call-site Error; this sample
  location alone does not isolate Error-stack cost or authorize removing traces.
- Private JSON `visit` is **3.06%**; `Result.gen` **2.44%**; `structuredClone`
  **2.03%**; Drizzle's entity classifier **2.02%**. Bare `runLoop` self samples are
  only **1.18%**, which is very different from its inclusive 79% cycle share.

Clone stacks include `detachLogicalDocumentRootChanges`, workflow value capture,
participant contribution, and finite-entry handoff. Private JSON stacks include
commerce input capture and logical working-set operations. Encoding/key work is
spread across canonical JSON, byte/hex processing, ordered-index codecs and
metadata identities. These locations explain why tiny individual folds did not
move the complete-root result reliably.

Native profiling retained only **167 admitted samples**, versus 1,596 ambiguous
and 69 outside. The conservative clock brackets consume much of these short
calls. Therefore native/Flarex category subtraction would be misleading. The
independent full-call native CPU counter remains valid. GC event durations are
elapsed intersections, not GC CPU; they are not added to these percentages.

## Observer cost and limits

Engine on-minus-off added CPU is **+6.625 ms**, 95% interval **-9.875 to +22.563**.
Pooled generator on-minus-off is **+6.406 ms**, interval **-5.875 to +17.594**.
These intervals do not prove the observer free or precisely price its overhead.
Disabled generator roots still contain factory forwarding; the separate control
contains neither transforms nor profiler. No estimated observer cost is subtracted
from cycles or CPU. Profile CPU means differ across processes; neither run is
discarded. The bootstrap uses 20,000 stratified four-pair block draws, seed 137;
the control interval is conditional on this local cohort, not host-wide certainty.

Native and Flarex execute matched business graphs, but native does not provide
Flarex's full OCC, history, authority, settlement and outcome guarantees. Necessary
extra work is part of the measured difference. This remains a local Windows/Node
and PostgreSQL result, not a production Worker or scale acceptance result.

## Proposed redesign targets; no runtime implementation

1. **A complete owner-local validation/composition path**, rather than another
   tiny generator replacement. Iterator/Result/context processing is a measured
   contributor. Preserve the exact validator sequence and first refusal in a
   bounded synchronous owner, retaining Effect at actual async, cancellation,
   resource, admission and failure boundaries. Review trace/stack obligations
   separately; the data does not justify globally replacing Effect or suppressing
   traced functions. Even the entire engine category is only one part of the cost.
2. **An immutable private handoff across snapshot/contribution boundaries.** Trace
   the observed `detachLogicalDocumentRootChanges` and participant/finite-entry
   copies and retain one owner-issued snapshot where mutable aliases and policy
   permit. Current `privateJsonData` already tracks captured trees and
   `detachChanges` already deduplicates documents within one call. Thus the target
   is repeated cross-boundary representation work, not adding another generic cache
   or deleting a safety clone without proving ownership. JSON visit plus clone self
   samples are about 5.09%; this is a candidate, not a large promised saving.
3. **Canonical representation lifetime across the selected complete path.** Carry
   accepted values/bytes/derived keys between trusted owners when freshness,
   mutable-byte integrity and retention charges permit. `relationalRows.ts` already
   retains derived keys by root/local owner; a new cache alone is not a redesign.
   Profile each remaining re-encoding/re-lowering handoff before changing it. Preserve
   exact index membership, cursor, tombstone, digest and final stored-proof checks.

Required gates for any later implementation: original getter/descriptor and
corruption failure order, exact charges, immutable/opaque evidence, fresh authority
and OCC, complete RETURNING validation before the next write, cancellation and
rollback behavior, and complete paired native/Flarex business verification. No
measurement in this report proves a removable duplicate durable write or permits
weakening those checks. The evidence supports these bounded redesign investigations,
not an exact claim that the remaining 125 ms can be removed.

## Validation and reproduction

Both required readonly reviews cleared the corrected measurement implementation.
The SDK suite includes native-reader execution, original failure/interruption and
descriptor restoration witnesses, disjoint accounting, forwarding, invalid counters,
observer selection/coverage, complete-block admission and symmetric profiler timing.
Final SDK run: **393 passed, 16 explicitly gated tests skipped**. Typecheck and
core/diff lint pass. Real PostgreSQL proof is the six campaigns above;
no production schema, transaction or query-plan behavior changed. This turn makes
no new PGlite, hosted-runtime, scale or broad framework-suite acceptance claim.
The owned PostgreSQL instance had zero other client backends before shutdown;
fast shutdown completed, `pg_ctl status` reports no server, and port 56434 has
no listener. No benchmark worker remains owned by this campaign.

`run-campaign.ps1` reproduces each named campaign using the existing fixture and
explicit already-built native reader. It requires the owned local PostgreSQL
instance and the original native benchmark dependencies. `analyze.mjs` validates
raw ledgers and writes `summary.json`; `details.mjs` derives `details.json`, including
all retained CPU pair values, partitions, source categories and bootstrap intervals.
Raw SDK JSON/profile artifacts remain in the local ignored campaign subdirectories;
their run IDs above identify the source records. Summary and analysis scripts are
retained together. Use fresh campaign labels for another run: the runner refuses an existing output
directory, and analysis refuses ambiguous directories containing multiple reports.
The block-bootstrap analysis requires complete four-pair blocks in every selected
control/observer cohort and refuses a remainder rather than discarding samples.
The commands below re-analyze the retained original cohort.

```powershell
node work/validation/shared-execution-evidence/measurement-cpu-attribution/analyze.mjs engine generators-a generators-b profile-a profile-b control
node work/validation/shared-execution-evidence/measurement-cpu-attribution/details.mjs
```
