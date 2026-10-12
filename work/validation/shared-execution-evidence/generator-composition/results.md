# Generator and validation composition investigation

The fresh unchanged-source control still measures **125 ms median / 120.8 ms
mean added root-thread CPU** in 15 complete native/Flarex mixed-workflow pairs.
Runtime code is unchanged. This investigation establishes recurring work in
working-set, index, metadata and validation composition; it does **not** establish
an exclusive explanation or a removable budget for all 120.8 ms.

The strongest bounded redesign candidate is the existing finite-metadata owner:
reuse its issued selector tuples and identity strings, then simplify adjacent
pure consumption sequencing. Table/access consumption occupies **11.57 ms mean
observed synchronous elapsed** in the probe with fewer timers. That includes
required validation and instrumentation. Only a subset could be removed, and
no CPU saving has been measured. A broad Effect/generator rewrite is unsupported.

## Current control and observation limits

The control has five warmups per lane, 15 complete pairs, no profiler, Effect
measurement collector, forwarding facade or leaf observer. Actual paired thread
deltas range 31–188 ms. Mean added user/kernel CPU is 115.47/5.33 ms; independent
quantized component deltas can be negative. All requests succeed, source hashes
remain identical, ordinary-role durable settings remain identical and owned
sample resources drain. Installation, fixture preparation and seeding are
outside the measured request window. PostgreSQL server CPU is excluded.

All four campaigns retain the same authored/native-source digest over 6,962
files: `9093619ed1550ef5ad8d538df0cb5292844d0c69107a926f8d80cbc45795561f`.
Windows counter quantization, JIT and host variation remain limitations. The
historical 172 ms pricing await is elapsed time and remains a separate unresolved
observation. It is not added CPU or a demonstrated cause of this recurring cost.

The full observer forwards original authored generator factories and iterator
`next`, `throw` and `return` calls. Original Effect, Result, Schema and Error
implementations remain executing. Numeric timers measure only synchronous calls;
database waits and suspended interpretation are outside a generator-body timer.
Nested selected timers subtract their selected children, preventing double
counting in summed self envelopes. Self time still includes uninstrumented
business work and nested observer setup/teardown. Reflection and wrappers can
alter diagnostic stack shape, allocation and JIT behavior.

| Campaign | Complete pairs | Timers on/off | Mean added CPU on/off |
| --- | ---: | ---: | ---: |
| Untouched source control | 15 | No observers | 120.80 ms |
| Full generator/parser/construction probe | 24 | 12 / 12 | 154.58 / 132.75 ms |
| Selected complete pure-owner probe | 12 | 6 / 6 | 122.00 / 104.17 ms |
| Eight outer pure-owner timers, deeper counts only | 12 | 6 / 6 | 130.33 / 122.67 ms |

Observed/off assignments alternate in balanced four-pair blocks; the SDK also
alternates native/Flarex call order. Both groups keep forwarding wrappers. The
on/off differences expose material observer cost and noise. They are neither
optimization results nor a valid correction to subtract from an owner's
elapsed envelope. No native leaf measurements are subtracted from these owners.

## What the generators actually execute

Twelve observed full-probe requests have identical counts: **17,157 generator
advances**, comprising 5,507 through Result.gen, 4,453 through Effect.gen, 5,348
through Effect.fnUntraced and 1,849 through named Effect.fn. These are iterator
advances, not distinct operations, effects, queries or validations. There are
1,768 authored Result.gen calls.

| Selected executing envelope | Calls/advances per workflow | Mean observed self elapsed |
| --- | ---: | ---: |
| Generator bodies | 17,157 advances | 73.91 ms |
| Immediate Schema parser invocation | 4,800 calls | 18.18 ms |
| Result.gen outside timed generator bodies | 1,768 calls | 8.05 ms |
| Named-function Error construction | 893 constructions | 6.54 ms |
| Named-function invocation excluding measured Errors | 758 calls | 2.92 ms |
| Dynamic named-function definition excluding measured Errors | 135 calls | 0.37 ms |
| Selected Schema decoder factories | 26 calls | 0.026 ms |

These are instrumented elapsed envelopes containing required work, not exact
CPU attribution or savings. In particular, Result.gen self time includes the
iterator proxy and timer scaffolding outside each body timer; **8.05 ms must not
be called pure Result library overhead**. Immediate Schema Effect parser timing
does not cover a subsequently suspended parser. Generator-body time excludes
the Effect interpreter's sequencing outside `.next` and includes ordinary
validation, encoding, business and driver code inside the body.

WorkingSet.ts is the largest generator-body cluster: **4,540 advances / 19.16 ms
observed self elapsed** across 50 locations. AppIndexEntries.ts follows with
2,062 / 7.94 ms. There is no one 100 ms generator body. Lifetime and transaction
guards also execute repeatedly, but their checks cannot be removed based on
advance counts. They protect live closure, authority, pending-ID settlement,
deadline, overlap, failure latching and finalizers.

Named functions still construct call/definition Errors and install
CurrentStackFrame while ordinary spans are disabled. The installed
Effect 4.0.0-rc.112 implementation confirms this. The measured 6.54 ms is a
construction envelope; it excludes deferred stack handling and service-context
interpretation. Largest individual call-Error envelopes are only 0.46 ms for
FlarexValue.canonicalizeV1 (42 calls) and 0.28 ms for MedusaWorkflow.captureValue
(42 calls). Existing private fnUntraced use is already extensive. Removing
named public boundaries would change configured diagnostics and failure stacks,
and is not the selected redesign.

## Existing metadata reuse and remaining repeated preparation

Six requests in both focused probes have identical branch/call counts:

| Existing owner activity | Count per workflow |
| --- | ---: |
| Table consumption helper | 287 |
| Access consumption helper | 158 |
| Root metadata consumption | 899 |
| First root consumptions | 205 |
| Repeat root consumptions | 694 |
| Repeat matches using issued key/dependency facts | 655 |
| Repeat matches using the complete foreign-input decoder | 39 |
| Metadata-key template hits / misses | 850 / 83 |
| Metadata identity serialization | 6,475 |
| Canonical contract-key construction | 935 |

The root already records first consumption and compares repeats against their
original issuer and captured watermark. The projection already retains accepted
keys, observations and dependency issuance. This is **not missing semantic
reuse**. Nevertheless, selection rebuilds a key tuple and canonical contract
string before finding the retained template. Consumption, issuer comparison,
dependency recording and final proof processing reconstruct identity strings.

The selected deeper probe times identity serialization at 4.13 ms and contract
key construction at 1.55 ms mean observed self elapsed. Identity calls include
other metadata/protocol consumers; these complete envelopes are not all redundant
selection work. RetainMetadataKey has 933 calls, including 850 hits. Root
consumption and dependency recording keep their live state, consistency and
budget checks even on the successful reuse path.

The probe with fewer clocks times complete outer helpers and counts inner
functions without inner timers:

| Complete pure helper | Calls per workflow | Mean observed self elapsed |
| --- | ---: | ---: |
| Table metadata consumption | 287 | 6.770 ms |
| Access metadata consumption | 158 | 4.798 ms |
| Relational-read preparation | 39 | 2.243 ms |
| Canonical unique-key lowering | 73 | 2.066 ms |
| Range-row acceptance | 20 | 1.329 ms |
| Index append-input acceptance | 35 | 1.175 ms |
| Index read-definition capture | 102 | 0.842 ms |
| Range-input acceptance excluding measured definition capture | 52 | 0.707 ms |

The two metadata helpers sum to 11.567 ms mean / 11.312 ms median, range
10.773–13.436 ms. They retain counters and all original checks. Other helper
counts identify these APIs, not the complete count of durable writes or reads.
Index/row/unique acceptance validates different facts and preserves corruption
precedence; this evidence does not justify bypassing it.

## Proposed bounded changes, before runtime implementation

1. **Reuse issued metadata selection facts at their existing owner.** Extend
   the existing projection/key-template preparation so an admitted table,
   definition or access selector returns its original immutable tuple and
   retained identity directly. Retain identity facts only for exact issued
   immutable keys/dependencies. Generic protocol identity encoding and foreign
   or negative selector validation keep their existing behavior. No structural
   equality, caller assertion or generic cache grants provenance. Remove the
   displaced tuple/string reconstruction in migrated private consumers.

2. **Simplify the two adjacent pure consumption helpers.** Keep one ordered
   Result computation per existing call, with immediate return on the first
   failed verdict. Remove unnecessary generator/yield and conversion scaffolding
   within that uninterrupted pure sequence. These two helpers account for
   445 Result.gen calls / 1,274 Result generator advances. Their entire 11.57 ms
   envelope includes required work and cannot be promised as a saving. Compare
   this change independently from selector reuse in complete native/Flarex pairs.

Neither change caches serving authority, moves a check across suspension, or
merges database/resource lifetimes. Preserve closed-root refusal, captured
watermark equality, issuer/observation matching, requirePresent, duplicate
consistency, dependency limits and first-consumption byte charging. Table
consumption must finish before source-policy lookup/consumption; an earlier
closed/refused table must win over a later missing policy. Access families and
deduplicated fields keep their original iteration and first-failure order.
Foreign inputs and unsupported negative selectors remain fully checked and
cannot grow prepared caches without bound. Final database metadata comparison,
OCC, row corruption checks and returned-tuple checks remain live.

Required implementation witnesses include changed/missing metadata and watermark,
wrong issuer, closure/revocation between operations, negative selectors, original
budget boundaries, exact first-failure precedence, and earlier returned-tuple
corruption versus a later write/trigger failure. PGlite and ordinary-role
PostgreSQL regressions and separate complete CPU comparisons are required before
retaining runtime changes. Public diagnostics, full Causes and finalizers remain
intact. Remove superseded private helpers only after their callers migrate.

These are modest candidates with a measured owner, not the solution to the
whole CPU gap. No broad generator, Schema, lifetime or Effect rewrite is selected.
An exclusive account of all added CPU, especially interpreter work outside the
timed synchronous bodies and its native-relative share, remains open.

## Retained evidence and cleanup

The compact summary retains campaign IDs, CPU arithmetic, owner distributions,
source digests, focused loaded-source hashes and probe-source hashes. Raw reports,
ledgers, scripts and logs are local ignored diagnostic artifacts in this directory.
Control, full, focused and reduced-timer campaigns each pass source/settings and
cleanup gates; all 166 warmup/measured requests across the four campaigns succeed.
Two forwarding-observer tests cover receiver/iterator methods, early failure,
original thrown defects, interruption, repeated lazy execution and balanced
timers with observation enabled. No production source, schema or query plan
changed; no new PGlite or Workerd performance claim is made.

The ordinary fixture role is non-superuser with fsync, synchronous_commit and
full_page_writes on. Statement tracking and auto_explain are disabled for timing.
After campaigns there are zero other clients. The owned PostgreSQL instance is
stopped, pg_ctl reports no server and port 56434 has zero listeners. No new
worktree or owned Wrangler/Workerd resource was created. The preexisting Workerd
test edit and .codex-worktrees directory are untouched.
