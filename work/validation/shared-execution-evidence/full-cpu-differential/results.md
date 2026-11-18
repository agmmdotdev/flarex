# Complete Flarex versus native CPU profile

Later evidence: the proposed document replacement below was implemented and
rejected by its CPU gate. [Operation-correlated counters and profiles](operation-results.md)
now bound the executing operation families. Treat this report's redesign section
as a historical hypothesis, not a current recommendation or removable-cost proof.

The remaining CPU is substantially located. The largest concentration is the
Flarex document execution path: persistence and protocol code, and the
Effect/Result/Schema machinery executing it. There is no single 110 ms function.
The unprofiled complete-workflow control reproduces **110.200 ms mean added
client-thread CPU**. This is recurring execution cost, not evidence of a rare
computer hang. The historical 172 ms pricing-query wait remains a different,
unresolved elapsed-time observation; this experiment does not explain it.

Current checkout: `wip/candidate-admission`, base `43a537d35`. Business runtime,
checks, failure order, workflow fixtures, and native comparison are unchanged.
No new worktree. This work changes only diagnostic files in this directory.

## Complete matched measurements

The existing measurement SDK runs the complete small mixed workflow, with five
warmups, 40 alternating matched pairs per process, its ordinary-role PostgreSQL
fixture, business/result gates and teardown. Campaign order was profile A,
unprofiled control, profile B. CPU profiles cover both native and Flarex roots;
allocation sampling and authored body instrumentation are disabled.

| Campaign | Native mean thread CPU | Flarex mean thread CPU | Mean paired excess | Median paired excess |
| --- | ---: | ---: | ---: | ---: |
| Profile A | 27.600 ms | 142.125 ms | 114.525 ms | 125 ms |
| Unprofiled control | 25.250 ms | 135.450 ms | **110.200 ms** | **110 ms** |
| Profile B | 29.725 ms | 142.625 ms | 112.900 ms | 110 ms |

The combined 80-pair profile excess is **113.7125 ms**. It is 3.5125 ms above
the control excess, a cross-campaign observation rather than a calibrated
profiler-overhead subtraction. Windows thread counters are coarse: individual
native roots can report zero despite active samples. Interpret cohort means,
not single-request millisecond precision. The previous 110.2 ms mean is
reproduced; there is no measured optimization or runtime CPU reduction here.

## Where the CPU goes

These are **statistical allocations of measured CPU**, using disjoint terminal
non-idle V8 samples in each root, then paired native subtraction. They are not
stopwatch measurements of each category, nor proved removable savings.

| Self-sample owner | Estimated added CPU | Profile A | Profile B |
| --- | ---: | ---: | ---: |
| Persistence implementation | 32.28 ms | 32.32 | 32.23 |
| Effect runtime (`internal/effect.js`, `internal/core.js`) | 29.78 ms | 29.38 | 30.19 |
| Flarex protocol/value/index code | 15.96 ms | 16.57 | 15.34 |
| Node built-ins | 9.74 ms | 9.66 | 9.82 |
| Effect Schema | 8.54 ms | 8.41 | 8.68 |
| Other Effect data/composition, including Result | 8.27 ms | 8.58 | 7.95 |
| Drizzle SQL building | 5.89 ms | 6.03 | 5.75 |
| Unknown/redacted frames | 5.02 ms | 5.36 | 4.69 |
| Garbage collection | 4.86 ms | 4.07 | 5.65 |
| Other workspace code | 3.14 ms | 3.44 | 2.84 |
| PostgreSQL client driver | 2.79 ms | 2.82 | 2.75 |
| V8 `(program)`, no useful frame | 2.24 ms | 2.55 | 1.93 |
| Measurement code | 0.02 ms | 0.00 | 0.04 |
| Payload code | -0.41 ms | -0.09 | -0.73 |
| Medusa/upstream dependencies, including MikroORM/Knex | -14.40 ms | -14.58 | -14.22 |
| **Total** | **113.71 ms** | **114.53** | **112.90** |

The five persistence/protocol/Effect categories total **94.83 ms**, about **83%**
of the net profiled gap. They include required work. The negative native-owner
entries matter: native spends CPU in MikroORM/Knex that Flarex replaces, so
adding only positive rows would overstate the measured difference.

Unknown/redacted plus `(program)` accounts for about **7.26 ms**, not 110 ms.
This does not mean every remaining named sample has an established removable
cause; it means the executing source owner is identified for most samples.
The combined profile admits 6,793 active Flarex and 1,352 active native samples.

### Largest concrete source owners

* `effect/dist/internal/effect.js`: **26.38 ms estimated excess**, the largest
  individual module. The iterator continuation has 316 Flarex self samples
  (about 6.64 ms); the `makeFn` returned wrapper has 284 (about 5.98 ms).
  `runLoop` itself has 104 (about 2.19 ms). The other runtime module adds 3.40 ms.
  Inspect the installed rc.112 source: the frame labelled `makePrimitive` at
  generated line 925 is the iterator continuation calling `iter.next`, **not
  proof of primitive-factory construction cost**. `makeFn` builds lazy work,
  captures an Error for call stacks and installs stack-frame context. Profiles
  do not isolate those individual mechanisms' cost.
* `storage/documents/logicalDocuments/workingSet.ts`: **5.89 ms** self estimate.
  The executing path manages table/identity/row state, reads, ordered write
  validation, unique dependencies and activity. These are domain obligations,
  not all overhead.
* `values/privateJsonData.ts`: **5.08 ms** self estimate. Its `visit` checks own
  descriptors, bounds and canonical JSON facts while capturing owned data.
  Current code already reuses issued immutable values through a WeakMap;
  calling for that optimization again would duplicate existing work.
* `SchemaAST.js` plus `SchemaParser.js`: **7.75 ms** self estimate, within the
  Schema row above. `Result.js` contributes **4.62 ms**, within other Effect.
* `flarex-protocol/ordered-index.ts`: **4.38 ms**; `json.ts`: **3.94 ms**;
  `value.ts`: **2.30 ms**. These include encoding/decoding and validation.
* `node:internal/worker/js_transferable` / `structuredClone`: **3.10 ms**.
  Visible callers include logical-root detachment, workflow values and decoded
  protocol snapshots. This is another distributed supporting cost, not the
  explanation for the whole gap.

Module and frame tables in `summary.json` retain every entry. Paths/coordinates
are V8's generated locations, not source-mapped TypeScript lines. Detail rows
are path-specific; native and Flarex copies of the same dependency can have
different paths. Category rows combine those paths before comparison. V8
inlining and unavailable native frames limit how literally a file's terminal
sample can be interpreted as pure interpreter overhead. Inclusive `runLoop`
time would include domain work and must not be added to these self categories.

## Substantial redesign target

The supported next target is **the internal logical-document operation pipeline
across working-set execution, value ownership and ordered validation**. It is
larger than SQL rendering, one JSON helper, or one wrapper. The profile supports
prioritizing this path; it does not establish a savings figure for a redesign.

Design one cohesive path that carries an owner-issued row/value representation
through internal operations, and executes each synchronous validation segment
as an ordered operation between real asynchronous/authority boundaries. Reduce
intermediate generator/Result/Schema composition and representation handoffs
only where the existing owner can prove the value and check are the same.
Existing prepared mechanics, private JSON ownership, canonical-value issuance
and derived-key caches must be reused, not rebuilt behind another abstraction.

The intended removals are redundant internal transitions, wrappers and repeated
representation work, not external input validation or transaction semantics.
Before implementation, map a complete read/write operation's existing checks
and refusal order into the proposed path, including metadata observations,
OCC ranges/cursors/empty witnesses, unique membership, detachment/mutation
isolation, write-result corruption checks, cancellation and publication proofs.
Effect continues to own asynchronous effects, services, typed failures and
resource lifetime. Application OCC and framework-compatible profiles remain
distinct. This is a redesign candidate, not an accepted architecture change.

The native lane is the actual complete business graph, not a SQL-only stub.
However native does not execute every Flarex authority/history/proof mechanism.
Therefore native subtraction locates added work; it does not certify all that
work as redundant. No blanket removal of Effect or validation is justified.
A future implementation must pass existing failure-order/behavior gates and
show a material reduction in the unprofiled complete-workflow comparison.

## Why earlier full profiles failed to resolve this

The SDK's original conservative admission brackets align V8 and host clocks
using inspector command start/stop intervals. Those intervals leave roughly
40 ms uncertainty, comparable to a complete native root. In these captures,
the original rule admits just **142 native samples including idle** across 80
roots. An apparent lack of native CPU stacks was largely an admission problem.

This diagnostic reuses the existing six-ms `clockMarkerA/B` probe technique
from `../cpu-excess-investigation`, outside the original root CPU-counter and
business windows. Only the CPU collector is transformed to call those markers;
the measured runtime is unchanged. Marker setup/teardown hashes ensure the
collector transform, marker code and launcher stayed fixed across a campaign.
Raw SDK source hashes agree before/after and across all three campaigns.

The intersection of available marker constraints narrows process clock offset
uncertainty to **0.4332 ms** and **0.4459 ms**. The corrected admission includes
1,830 native samples, 1,352 active. It requires each sample interval to fit fully
inside the original counter window; boundary samples are excluded. Marker
samples are explicitly rejected if they enter a business window.

The fit assumes a constant offset between monotonic clocks within each process,
never across processes. V8 does not retain marker frames in every profile:
12/160 and 16/160 landmarks supply sampled constraints, spanning early and late
requests; all 160 host marker records exist in each campaign. Missing frames
are recorded rather than invented. All available constraints intersect. This
does not independently prove zero clock drift in unsampled intervals.
Widening marker timestamp tolerance from 0.4 ms to 2 ms changes each of the five
dominant category estimates by less than **0.08 ms**; the largest change in any
category is 0.805 ms (Medusa). The dominant ranking remains stable.

The analyzer allocates each original thread counter by that root's admitted
non-idle sample counts. Category estimates sum to measured CPU **by construction**;
that is an accounting invariant, not independent causal verification. Sampling
counts are not elapsed sample spacing converted to CPU. Confidence intervals in
the summary use 10,000 stratified four-pair block-bootstrap draws and omit
systematic profiler, clock-fit, native-stack and classification bias. Two
independent profile processes, the control and tolerance sensitivity bound the
main interpretation; they do not measure production Worker performance.

## Evidence and reproduction

Campaign IDs:

* Profile A: `5016fd2f-30b6-4687-9b83-e659e39b3346`.
* Control: `2d1bdf55-7a76-4fd3-92b1-60988efb3964`.
* Profile B: `dc1779de-e7a5-42d8-8848-887588fc7644`.

Run fresh campaigns with `run-campaign.ps1 -Kind cpu|control -Label <new-dir>
-Samples 40` while the existing isolated PostgreSQL fixture is running. The
launcher refuses an existing label. Analysis uses the retained `profile-a`,
`control`, `profile-b` artifacts:

```powershell
pnpm exec vitest run --config work/validation/shared-execution-evidence/full-cpu-differential/analysis.config.ts
$env:FLAREX_PROFILE_TIMESTAMP_TOLERANCE_MS='2'
pnpm exec vitest run --config work/validation/shared-execution-evidence/full-cpu-differential/analysis.config.ts
Remove-Item Env:FLAREX_PROFILE_TIMESTAMP_TOLERANCE_MS
pnpm exec tsc --project work/validation/shared-execution-evidence/full-cpu-differential/tsconfig.json --noEmit
```

The raw reports contain the complete CPU profiles and counters. Lossless gzip
copies and SHA-256 records retain those inputs without duplicating the 160
separate `.cpuprofile` exports. Analysis needs no running database. All three
campaign tests and existing business gates passed; analysis and typecheck
passed. The reader also rejects changed workload settings, swapped pair IDs,
reused/unpaired roots and paired counters that disagree with the original
roots; negative tests preserve the workload/pair/counter witnesses. Typechecking
covers TypeScript producers, schemas and tests; `checkJs` is not enabled for
the executable JavaScript analyzer/retention scripts. Those are exercised by
artifact replay and accounting assertions. No schema/query-plan/runtime behavior was changed, so this is not a new
PGlite or production compatibility claim. Owned PostgreSQL was stopped.
