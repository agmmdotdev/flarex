# Checked command launch and completion

Diagnostic investigation against `baf564131`, current checkout. No authored
production runtime, SQL, business checks, failure order or worktree changes.

## Decision

**Driver execution is the largest observed category inside command launch and
completion. The evidence does not establish a dominant removable Promise or
Effect cost. No runtime redesign is selected by this investigation.**

Two fresh processes each ran 40 complete alternating native/Flarex pairs after
five warmups per lane. Five-pair blocks toggle detailed observation in ABBA and
opposite BAAB order: 20 observed and 20 unobserved Flarex workflows per process.
Every Flarex workflow launches 38 checked commands. All workload gates passed.

The disjoint, directly bracketed **thread-cycle** partitions are:

| Owner during launch/completion | ABBA | BAAB |
| --- | ---: | ---: |
| Driver preparation, launch, receive and checked mapping | 40.49% | 51.68% |
| Effect run loop, including unobserved command code it executes | 14.99% | 19.32% |
| Explicit Promise bridge, fence, registration and completion callbacks | 8.28% | 10.03% |
| Outside the selected synchronous boundaries | 36.24% | 18.97% |

Driver send/launch alone is 19.86/25.38%; receive/parser dispatch is
11.94/15.24%; Drizzle launch excluding those nested scopes is 5.00/6.45%;
checked result mapping is 2.34/3.02%; preparation is 1.35/1.58%.
These are observed cycle shares, **not milliseconds, native-subtracted excess,
or attainable savings**. Driver APIs include their own Promise allocations;
the table partitions execution ownership rather than classifying every VM
instruction by abstraction. Counters/proxy dispatch add observer work.

The outside bucket includes VM/microtask and Node continuations, unobserved
Drizzle continuation work, GC and observer bookkeeping. Its process variation
is material. It must not be renamed "Promise overhead". Likewise, the Effect
bucket is not exclusively the interpreter: it includes command code executed
inside that interpreter. There is no timestamp-to-sample allocation in this
measurement, avoiding the earlier profile boundary ambiguity.

## Millisecond attribution limit

The fine thread-CPU partition reconciles arithmetically but **fails temporal
resolution acceptance**. Windows reports thread-time increments at edges far
larger than these individual calls. For example, all measured driver stages
receive only 0.8 ms/workflow in ABBA and zero in BAAB, despite their substantial
independent cycle counts. Some increments instead land in the short query-fence
wrapper or between boundaries. Neither those zeros nor the adjacent charges
are credible leaf CPU prices. Raw partitions are retained explicitly as
rejected leaf attribution, not silently corrected or converted from cycles.

| Whole SDK request, mean thread CPU | ABBA detail off | ABBA detail on | BAAB detail off | BAAB detail on |
| --- | ---: | ---: | ---: | ---: |
| Flarex | 144.55 ms | 152.55 ms | 146.15 ms | 141.30 ms |
| Native | 21.80 ms | 23.25 ms | 25.75 ms | 30.50 ms |

Activating detail changes Flarex root CPU by +8.00 and -4.85 ms across the two
processes; the native lane varies too. This does not establish a stable observer
overhead correction. Detail-off still contains wrapper dispatch and outer
operation counters. Do not subtract these deltas from the fine buckets.

The earlier lighter command probe measured **9.700 ms** launch/completion CPU
inside **16.275 ms** for all checked commands. This study partitions that kind
of work; it does not turn it into a new precise leaf-ms estimate. The untouched
80-pair baseline remains **106.9625 ms mean added CPU**. These instrumented
campaigns do not update that baseline and do not explain all 107 ms.

## What repeats, and what could be removed

1. **Prepared-query object construction:** 38 calls each workflow, even though
   the fixed command already retains statement text, fields and mapper.
   Replaying the actual installed `NodePgSession.prepareQuery` with the captured
   ordered receivers/arguments costs **0.00280–0.00500 ms/workflow** in ABBA and
   **0.00312–0.00374 ms** in BAAB. Each of five blocks performs 50,000 workflow
   equivalents (1.9 million constructions); a retained ring consumes outputs.
   This is a warm allocation price, not an end-to-end saving or a bound on cold
   construction, long-lived retention or GC. A reusable session-neutral command
   descriptor could avoid some object/config construction, but caching a
   client-bound prepared object across checkouts is invalid. This tiny warm
   price does not justify prioritizing that redesign.
2. **Two Promise registrations and two settlement callbacks per command:**
   76 of each per workflow. Registration plus settlement occupies **2.86/3.58%**
   of observed launch cycles. They track distinct promises: raw PostgreSQL work
   and the mapped Drizzle result. The latter can fail after the former succeeds;
   on driver failure the first retained drain cause is the original PostgreSQL
   failure while the command returns Drizzle's wrapper. Removing a mirror just
   because there are two changes this evidence. A single command state machine
   would have to preserve both observations, all pending work, and first-failure
   selection. Its performance benefit is unproved; no mirror removal recommended.
3. **Deadline/Effect bridge:** 38 bridge starts, 38 completion callbacks and 228
   run-loop entries per workflow. Entries are execution counts, not redundant
   business checks. The bridge owns timeout races, completion-once, interruption,
   synchronous start failures and cause mapping. A specialized bridge is still
   a hypothesis; this evidence does not price a behavior-equivalent replacement.
4. **Driver send/receive:** the largest measured driver components execute real
   protocol submission, decoding and dispatch. Earlier input-ledger evidence
   did not establish duplicate storage demands. Dropping queries, mapping checks
   or per-command ordering is not a supported removal.

**Actual CPU reduction: zero.** This is diagnostic work. It narrows attribution
and rejects a large wrapper-construction win; it does not prove a removable
dominant function. Removing required protocol work or calling the unresolved
continuations Promise overhead would overstate the result.

## Preservation and evidence

The test-only AST transform executes original expressions and wraps synchronous
callbacks without adding Promise chains. Installed Effect, Drizzle and pg
prototype wrappers retain receivers, ordered arguments, original returns and
throws; descriptors are restored and checked. Scopes never span awaits. An
enclosing run loop is seeded/cut at command start/end. The existing SDK
telescoping partition is reused independently for cycles and CPU microseconds.
The command observer deliberately uses `Effect.suspend` plus `Effect.onExit`:
it starts only during interpretation and preserves every Exit, without an extra
generator/function-tracing wrapper in the execution machinery being measured.

The reducer joins all 3,040 commands uniquely to their original SDK request
windows, validates 160 roots and 80 native/Flarex pairs, enforces 38 commands per
Flarex root and zero per native root, checks on/off ordering and call counts,
and requires exact conservation, stable source hashes and no observer faults.
Runtime source hash remains
`538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`.

Existing physical-session tests define the removal constraints: preparation
fails before SQL; mapper and driver failures retain command and drain causes;
cleanup defects are added without replacing earlier causes; refused/cancelled
commands do not call their mapper. The transformed suite passed 41 tests with
one TLS-specific case skipped. Five probe tests cover receiver/argument/Promise
identity, synchronous throws, typed failure, defects, interruption, combined
Cause, no later work after failure, boundary conservation, opposite observation
orders and counter faults. The strict retained-evidence reducer and diagnostic
TypeScript check pass. Core/diff lint has no changed configured runtime files.
The transformed physical-session suite has no SDK operation roots, so its
negative cases verify transformed forwarding and owner assertions; active
attribution on failure is covered separately by synthetic probe tests. Active
detailed attribution during real database failure/cancellation remains unverified.
No new schema, isolation or query-plan claims; PGlite was not rerun. Benchmarks
use the ordinary PostgreSQL fixture role. The four-pair smoke is excluded from
the accepted campaigns. Owned PostgreSQL is stopped after validation.

Reproduce using `launch-profile.config.ts`, the existing measurement environment
(`control`, 40 samples, five default warmups, small mixed PostgreSQL workflow),
fresh output directories, and `FLAREX_LAUNCH_ORDER=abba` then `baab`. Run
`launch-analysis.config.ts` for probe tests, `launch-costs.config.ts` for the
strict reducer, and `launch-contract.config.ts` for existing physical-session
tests with transforms. Retain with `FLAREX_PROFILE_LAUNCH_CORRELATION=on node
work/validation/shared-execution-evidence/full-cpu-differential/retain.mjs`.
The lossless gzip inputs and output are listed in `launch-artifacts.json`.
