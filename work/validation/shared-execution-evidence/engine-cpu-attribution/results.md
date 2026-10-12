# Remaining mixed-workflow CPU: runner and primitive attribution

The remaining cost is concentrated in the logical-storage, validation and
authority work executed through Effect. We now have a thread-cycle partition,
an independent current-source profile, and counts of actual Effect primitive
allocations. This establishes an expensive execution region and its machinery;
it does **not** establish that the entire CPU difference can be removed.

Runtime remains at `c613211e3`. No runtime implementation, new worktree, change
to validation, or change to failure order occurred in this investigation.

## Updated measurement

The final control uses the original authored SDK and business sources, without
the runner patches, primitive loader, leaf timers, inspector or phase observer.
It contains five warmups and **40 matched complete native/Flarex pairs**.
Request seeding and post-call verification remain outside the original CPU
windows; request work and the fixture's complete-call cleanup remain inside.

| Root counter | Native mean | Flarex mean | Paired added mean | Paired added median |
| --- | ---: | ---: | ---: | ---: |
| Current Node thread | 24.175 ms | 140.625 ms | **116.45 ms** | **125 ms** |

Added thread CPU ranges from 62 to 172 ms. The paired whole-process mean is
131.6 ms and median is 140 ms. These are distinct counters. The upper 172 ms
value in this control is a CPU delta; it is unrelated to the historical
172.1902 ms pricing-query **elapsed await**.

Control run: `6cffac07-6b7a-4d65-b4aa-ca0dab175228`. All 40 pairs and all
request/business/durable-proof checks passed. Source, ordinary-role database
settings and cleanup gates passed. The source inventory contains 6,962 files;
before and after hashes are both
`23fb438c16ca6c07d144aa409405df283e84b07237284c789192ef0e9d679d32`.
Diagnostic mode deliberately does not evaluate quiet latency acceptance.

## Where the work runs

The first diagnostic partition used forwarding wrappers around the installed
`FiberImpl.runLoop`. Original SDK absolute thread-counter readings anchored
the partition, so its parts reconciled exactly with every root CPU delta.
Nevertheless, the approximately 16 ms counter updates aliased hundreds of
short runner boundaries and suggested too much outside-runner work.
**That fine-grained time attribution is discarded.** Reconciliation proves
accounting, not reliable placement of coarse updates.

A fresh 24-pair profile of the original implementation contradicted it:
1,759 of 2,208 retained active self samples have the original `runLoop` on
their stack, **79.7%**. Each retained sample lies inside the original SDK root
window for every admitted profiler-clock offset; alignment uncertainty is
0.4512 ms. Idle, GC, unknown and boundary samples remain explicit. Sample
counts locate work; they are not exclusive CPU durations or savings.

We then compiled a disposable Node-API reader of Windows
`QueryThreadCycleTime(GetCurrentThread())`, using the installed Visual Studio
build tools and official Node `v24.16.0` headers. Its original SDK root CPU
readings remain separate. The cycle partition reconciles exactly at its own
begin/end readings, native thread identity remains constant within each
process, and recursive runner calls do not double-count regions. The wrapper
forwards the original runner with its receiver, arguments, return, thrown
outcome and `finally` behavior intact.

The primary cycle campaign contains 24 pairs, with the partition enabled in
12 pairs and disabled in 12, in balanced four-pair blocks. Enabled roots show:

| Aggregate over 12 pairs | Thread cycles |
| --- | ---: |
| Flarex complete roots | 6,374,426,298 |
| Inside the Effect runner | 5,087,981,074 |
| Outside the runner | 1,286,445,224 |
| Native complete roots | 1,166,388,074 |
| Flarex minus native | 5,208,038,224 |

Thus **79.8% of Flarex cycles run inside Effect**. That region's cycles are
numerically 97.7% of the net native/Flarex difference; outside-runner work is
close to the whole native reference. This is a location account, not proof
that those cycles are all extra orchestration: business work and required
checks also execute inside the runner, and native uses a different persistence
implementation. The counted repeat agrees on the broad location (81.0%).

Cycles include user and kernel work. They are **not converted to milliseconds**:
[Microsoft documents hardware-dependent cycle-counter frequency behavior](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-querythreadcycletime).
The primary observer's on-minus-off mean added thread CPU is 2.33 ms. The
repeat adds allocation counters and is more intrusive: 24.42 ms on-minus-off.
Across both processes the stratified block estimate is 13.375 ms, with a
20,000-draw 95% bootstrap interval of -1.33 to 27 ms. The cycle differences
also expose observer overhead. These are diagnostic campaigns, never the
reported quiet CPU control or an optimization result.

The fixture executes the portable mutation kernel in-process. Native and
Flarex roots use the same measured Node thread; this is not an uncounted Worker
or a server elapsed-time measurement.

## Concrete machinery in that region

The counted repeat forwards the original two installed Effect factories
(`makePrimitive` and `makeExit`) and records their constructed objects without
changing them. A process-local Node loader annotates only those factories in
memory; the installed library and authored source files are unmodified.
The exact transformed-module hashes are in [summary.json](summary.json).

All 12 observed Flarex workflows construct **35,276 primitives/exits** each,
including 15,039 Success, 5,155 Suspend, 5,137 WithFiber, 3,775 Iterator and
3,079 OnExit objects. Native constructs 18 Success objects and runs no
`FiberImpl.runLoop` in these roots. Allocation counts are not CPU costs;
successful execution can also create internal Failure values.

| Flarex phase | Constructed primitives/exits |
| --- | ---: |
| Request admission | 2,023 |
| Portable business execution | **26,233** |
| Runtime result validation | 23 |
| Finite freeze/validation | 166 |
| Authoritative publication | 6,729 |
| Complete-call cleanup | 102 |

The largest named construction regions are:

| Current named frame | Objects constructed while that frame is current |
| --- | ---: |
| ProductAdapter.replaceRows | 4,853 |
| MedusaAdapter.readRelationRows | 4,045 |
| MedusaWorkflow.captureValue | 1,764 |
| MedusaRead.window | 1,693 |
| LogicalCommerce.workflowCall | 1,118 |

These counts include descendants. They are **not the cost of the named
adapter helper itself**. For example, `readCommerceRelationRows` gets a table,
calls the shared store's `find`, and checks the complete-set bound. Most
construction underneath that frame belongs to shared logical execution.
`replaceProductRows` delegates to the graph planner and shared stores. Removing
these adapter entry points would not remove their required core work.

The independent profile contains 730 Effect self samples: 495 in the engine
implementation, 121 in Schema, 58 in Result/Option, 21 in Context and 35 in
other Effect modules. It also contains substantial persistence and protocol
self work beneath the runner: canonical values, byte encodings, row/index
validation, metadata consumption and snapshot copying. No one sampled leaf
explains the whole CPU difference.

There are 826 runner calls, 3,447 context assignments, 3,289 cache refreshes
and 1,680 current-frame changes per observed workflow. Context assignment
itself averages about **2.4 ms synchronous elapsed** under instrumentation.
It cannot honestly be presented as the 125 ms explanation or saving.

An important design limit is now source-confirmed: in installed
`effect@4.0.0-rc.112`, `SchemaParser.decodeUnknownResult` delegates to
`asResult(decodeUnknownEffect(...))`. Merely switching the public Schema API
from Effect to Result leaves the underlying parser machinery in place.
Likewise, a small helper's generator count does not establish material CPU
savings. This explains why the previous metadata-only changes could remove
local construction without proving a reduction in complete-root CPU.

## Proposed next bounded designs, before implementation

1. **Reduce private composition around synchronous core validation.** Start
   with the shared logical read/write paths beneath relation reads and graph
   replacement. Within an existing owner, combine adjacent pure preparation
   and validation into one lazily sequenced Result block and one outer Effect
   handoff. Keep Schema parsing, typed errors and full causes. Keep each IO,
   hash, resource charge, authority/liveness check and row-write barrier where
   its current semantics require it. Remove displaced private generator,
   suspend and reboxing layers only where the block has no independent
   lifetime, cancellation or diagnostic obligation. This targets measured
   graph construction; its removable CPU budget is **not yet measured**.

2. **Consume the current-index batch envelope once.**
   `consumeCurrentAppIndexPagesInTransactionEffect` currently decodes each
   ordinal/presence envelope during grouping, then decodes it again while
   consuming the group. Retain the privately owned immutable scalar envelope
   from the first pass. Keep all initial envelope validation before body
   consumption, and keep body decoding, presence rules, empty-page witnesses
   and consumer refusal in their existing demand order. This is a concrete
   duplicated validation pass, but a small candidate, not an explanation of
   the complete 125 ms gap. Mutation/aliasing ownership must be proved before
   retaining anything beyond those scalar facts.

Do not remove Schema checks, scope closure/issuance, budgets, fresh authority,
exact OCC dependencies, stored digests, immutable-output ownership, public
diagnostic frames, or immediate RETURNING validation. Do not batch writes
past the earlier-corruption/later-trigger barrier. The workflow value clone
also preserves mutable-output ownership and own-undefined omissions; its
construction count alone does not justify removing it. Current append code
already reuses physical-spec digests within its batch and issued membership
evidence; a new spec cache is not an established missing optimization.

For either proposed change, preserve the failing-witness order first, run
owner and consumer regressions in PGlite and ordinary-role PostgreSQL where
the transaction/index contract is affected, then run separate balanced
complete native/Flarex CPU comparisons. Report actual paired reductions and
uncertainty. No projected millisecond saving is claimed here.

## Evidence and disposition

- Final untransformed 40-pair control passed.
- Independent original-implementation 24-pair profile passed.
- Primary 24-pair cycle campaign and reversed 24-pair counted repeat passed.
- All 96 cycle root accounts and original SDK CPU readings reconcile; source,
  durable settings, business results, stored proofs and cleanup checks passed.
- The obsolete short-counter campaign's final assertion initially used the
  wrong report ID field. The diagnostic assertion was corrected; every
  retained account was independently rechecked against the original SDK
  readings, and the corrected repeat passed. Its fine attribution remains
  discarded because of counter resolution, not because of that assertion.
- No new PGlite semantic validation is claimed for this read-only investigation.
- Owned PostgreSQL was stopped with fast shutdown; `pg_ctl status` reports no
  server, and port 56434 has zero listeners. No runtime helpers remain running.
- Unrelated worktree changes were left alone. No worktree was created or removed.

The raw ledgers, profiles, forwarding probes, official headers, cycle-reader
source/build script and analysis scripts remain local ignored diagnostic
artifacts in this directory. The committed compact summary carries run IDs,
source hashes, paired CPU measurements, cycle totals, counts and limits.
