# Mixed-workflow client CPU attribution

The CPU excess recurs across complete calls. It is accumulated client work,
concentrated in business execution, with additional admission and publication
work. The historical 172.1902 ms pricing await is a separate elapsed-time event;
subtracting it cannot correct a CPU counter.

This investigation ran in the current shared checkout. The unwanted worktree
was removed before these runs. No runtime implementation, source optimization,
database schema, failure ordering or durable settings were changed by this
campaign. Other sessions' existing OCC and test edits were preserved.

## Current measurement and separate diagnostic cohorts

The pre-OCC matched baseline is **125 ms median added thread CPU**. The newer
[five-graph OCC campaign](../occ-vector/results.md) records **109 ms** for mixed
workflow, with five pairs and all request/source/settings/cleanup gates passing.
Its quiet native/Flarex medians are 42.04/276.83 ms, paired added median/P95
234.15/349.75 ms. Complete performance acceptance remains failed. The OCC
implementation is uncommitted; the approximately one Windows counter tick
difference from 125 ms does not establish a causal CPU saving.

Our current-checkout diagnostic cohorts retain their own values:

| Diagnostic cohort | Pairs | Native thread CPU median ms | Flarex thread CPU median ms | Paired added median ms | Added range ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Counters only, no profiler or phase observer | 5 | 31 | 172 | 141 | 78–173 |
| Paired CPU profiles and phase counters | 10 | 31 | 156.5 | 117.5 | 93–187 |
| Phase counters, profiler disabled | 10 | 31.5 | 218.5 | 179.5 | 110–312 |
| Final counters-only repeat, no profiler or phase observer | 5 | 47 | 171 | **125** | 93–188 |

Added medians are medians of actual matched differences. Do not subtract the
independently aggregated lane medians. All four cohorts completed successfully,
with successful business samples and SDK source/settings/cleanup gates passing.
They do not replace the full five-graph CPU/quiet acceptance campaign.

The first two cohorts share source digest
`58d0dcfc4de47fe3944f171f05963660cfa239d8777ce887fd1c101f823a8741`.
The phase-only cohort and final counter-only repeat have digest
`e3cd9296110adfb122edeb84dfdf1bdf3325859580e1b5d1fec2bcbe8ec07118`.
Each inventories 6,962 authored/lock/loaded-native files and remains stable
within its process. The SDK retains aggregate digests, so the exact differing
file and responsible owner are not established. These are different source
inventories; the change between source inventories cannot be assigned to
profiler overhead, the phase observer, a runtime regression or a CPU saving.
Even on the latter shared digest, the phase-only run's 179.5 ms and final
counter-only repeat's 125 ms are separate processes. These were not randomized
observer on/off blocks, so their difference does not prove observer cost or host
contention as its cause. External contention is not controlled or measured by
the SDK. The final repeat's actual pairs are 188/125/93/141/108 ms: **125 ms recurs
without a profiler or phase observer**, while its exact historical value remains
a separate receipt.

## Where the client CPU goes

Test-only thread-counter readings surround the existing six sequential Flarex
phases. Their totals equal the original full-call thread CPU for every root in
both ten-pair cohorts. This directly locates CPU, unlike the earlier unassigned
elapsed-time/sample-spacing residual.

| Existing Flarex phase | With paired profiles, median CPU ms | Profiler disabled, median CPU ms |
| --- | ---: | ---: |
| Request admission | 16 | 31 |
| Portable business execution | **109** | **141** |
| Runtime result validation | 0 quantized | 0 quantized |
| Finite freeze and validation | 0 quantized | 0 quantized |
| Authoritative publication | 31 | 47 |
| Complete call cleanup | 0 quantized | 0 quantized |

These are Flarex phase costs, not native-subtracted excess or removable costs.
Windows counters resolve about 16 ms: zero means below the observed quantum,
not no work, and quantization can move cost into an adjacent phase. The medians
do not sum to a whole-call median. Validation/freeze/cleanup remain small elapsed
phases: sampled-cohort medians 0.42/2.37/0.28 ms, versus 0.62/3.11/0.43 ms without
the profiler. Business execution is the largest phase in every root of both
cohorts. Its large cost persists with profiling disabled.

## What that business execution is doing

Ten native and ten Flarex profiles use the original complete-call boundaries.
After clock alignment and boundary exclusion, Flarex retains 952 non-idle
terminal self samples; native retains 207. Flarex's dominant sampled locations:

| Source owner | Flarex self samples | Share of retained non-idle self samples |
| --- | ---: | ---: |
| Effect | 291 | 30.6% |
| Logical persistence (`persistence-postgres`) | 241 | 25.3% |
| Protocol/value processing (`flarex-protocol`) | 116 | 12.2% |
| Node built-ins | 69 | 7.2% |
| Drizzle | 50 | 5.3% |
| Medusa | 33 | 3.5% |
| pg | 27 | 2.8% |
| GC | 20 | 2.1% |
| Remaining/unknown/program/other owners | 105 | 11.0% |

These counts locate work; they are not percentages of the historical 125 ms
excess, exact CPU durations or savings. No generic Effect frame is charged the
inclusive application work beneath it. Native's largest sampled owner is Medusa
(150/207 samples), including its ORM/query/workflow path. Effect has no retained
native terminal self samples in these complete-call windows.

The dominant phases and synchronous stacks identify these mechanisms:

- **Effect execution and diagnostic context.** Business execution contains 227
  Effect self samples: 124 in the internal engine, 39 in SchemaAST/SchemaParser,
  17 in Result/Option, five in Context, and 42 elsewhere in Effect. This is broader
  than fiber dispatch: schema parsing, result composition, primitive construction
  and named-function context are present. Installed Effect 4.0.0-rc.112 creates
  definition/call error stacks and stack-frame context for `Effect.fn`. Its
  sampled invocation callback is visible; this does not prove all engine cost
  comes from stack construction or justify losing diagnostic context.
- **Logical reads, provisional writes and exact dependencies.** Business
  execution contains 178 persistence self samples and 77 protocol self samples.
  Sampled authored stacks include working-set reads/projection, relational query
  preparation, metadata dependency recording/consumption and value capture. These
  calls retain fresh checks and exact dependency evidence while business logic
  runs; PostgreSQL latency does not account for their active client CPU.
- **Value validation, canonical processing and detached evidence.** The
  `privateJsonData` recursive visitor has 34 full-call self samples. Its actual
  sampled callers include commerce input normalization, Medusa projections and
  logical relational rows. It checks descriptors/prototypes, bounds, cycles and
  canonical sizes, freezes containers and issues reusable owner facts. Already
  issued values have a reuse path. `structuredClone` has 20 self samples, with
  synchronous callers in logical-root snapshot detachment and finite-entry
  journal confirmation. Root detachment already shares canonical document copies
  within a snapshot while preserving exact dependency-object correlation and
  opaque index identities. Those costs are real; duplicate removable copying
  across generations has not been proved.
- **Publication is additional client work.** Its 31 ms sampled-cohort CPU median
  includes local acceptance, materialization preparation and returned evidence
  consumption, with persistence, protocol, Effect and Drizzle self samples. Its
  roughly 79 ms median elapsed duration also includes PostgreSQL awaits. The
  elapsed duration is not client CPU.

Native performs the same complete business graph through independently committed
calls. Flarex additionally provides one trusted atomic publication, OCC with exact
read dependencies, provisional state, revision/history effects and a durable
outcome. The measured difference includes implementing these guarantees plus
their orchestration. The native graph is a useful complete business baseline;
it does not make those additional guarantees free or optional.

Flarex GC overlap is 2.53–3.45 ms, median 3.08 ms, in the profiled roots; native
median overlap is zero. GC is a small component in this cohort. The repeated
active thread CPU and sampled stacks support accumulated processing, rather
than attributing this CPU excess to the historical pricing wait or a PC pause.
Same-isolate background work and external contention remain measurement limits.

## What is established, and what remains open

The dominant owner is **business execution through the guarded logical storage
and framework bridge**, followed by additional admission/publication. The major
sampled layers are Effect composition, logical persistence and protocol/value
processing. This narrows the earlier ambiguous 53 ms profile-spacing interval:
new phase counters locate the dominant CPU phases directly. It does not assign
that historical interval retrospectively.

No exclusive causal partition of the historical 125 ms, or large safe removable
CPU block, is established. Earlier construction/rendering envelopes remain small
relative to the excess: all SQL rendering 3.05 ms median, OCC rendering 0.41 ms,
and 2,550 observed Effect factory constructions 10.53 ms elapsed including
observer/required work. SchemaAST samples are parsing activity; they do not by
themselves prove repeated schema compilation.

The next useful causal experiment is a narrowly counted/timed repeated internal
value/dependency operation at its existing owner, retaining foreign-input checks,
snapshot generations, refusal order and cancellation. It must compare unchanged
sources and the same complete native graph before any runtime correction. A
broad Effect rewrite or removal of lifecycle/evidence checks is not supported
by this campaign.

## Evidence and method

- [Retained compact campaign receipt](summary.json) records cohort identities,
  actual CPU pairs/phase rows, source gates and profile location counts. Raw SDK
  reports, profiles and ignored diagnostic tools remain under this directory.
- `counter-control`: `879e4c09-2c2f-4253-8633-3999ef69186c`.
- `paired-profiles`: `b51910ee-dd16-4fe0-800e-9d770a7e900f`.
- `phase-counters`: `00e11aca-44c6-42e1-abe4-796b7407d453`.
- `counter-repeat`: `b3a1ac3c-69b7-4e2c-8c77-765a7826d684`.
- Test-only Vitest transforms bracket existing SDK native/Flarex roots with its
  CPU collector and optionally surround the six existing phase invocations.
  Inspector start/stop and two six-ms clock landmarks run outside original
  root-counter windows. Allocations are disabled. Warmups retain original paths.
- Every retained profile sample must fall inside the original call for all
  admissible clock offsets. The shared offset interval is 0.4503 ms wide;
  seven Flarex and six native call-boundary samples are excluded. Ten further
  Flarex phase-boundary samples remain unassigned. Asynchronous parents are not
  invented from synchronous stack ancestry. Profile line numbers are transformed
  locations, not verified physical TypeScript lines.
- Complete mixed-workflow calls reuse prepared module/database context with
  five warmups per lane, fresh disjoint graphs and the original SDK business
  assertions. Test-only observer state is restored at completion.
- Ordinary PostgreSQL 18.3 runs on the campaign-owned port 56434 with fsync,
  full-page writes and synchronous commit enabled. Statement-duration logging,
  auto_explain and pg_stat_statements tracking are disabled. No PostgreSQL CPU
  is counted as Node request-thread CPU. This is a diagnostic of existing
  behavior, not a schema/query-plan correctness change requiring a PGlite claim.
- No quiet latency acceptance or runtime optimization is claimed here. The
  fixed complete performance gates remain unchanged.
- The campaign-owned PostgreSQL instance was stopped with `pg_ctl -m fast -w
  stop`; its exact data-directory status confirms no server running. No unrelated
  PostgreSQL or Node process was stopped.
