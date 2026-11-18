# Quiet request correction and remaining mixed-workflow CPU

The quiet correction is implemented on the current checkout. It removes **824
ordinary span constructions per PostgreSQL workflow**, but establishes **no CPU
saving**. The fresh unchanged-source control measures **124 ms median / 119.6 ms
mean added thread CPU** in 15 complete native/Flarex pairs. This is a new cohort;
the older 125 ms and 140 ms medians are not measurements of a fixed current cost.
The fresh mean comprises 113.53 ms user-mode and 6.07 ms kernel CPU.

The connected row investigation finds existing reuse working. The selected row
and private-JSON functions occupy **6.54 ms mean observed self elapsed**, with
176 mutable-byte comparisons occupying only **0.243 ms**. These are instrumented
elapsed envelopes containing required work, not exclusive CPU or savings. A
large row redesign is not supported by this evidence. Row runtime code remains
unchanged; remaining complete-performance acceptance and CPU attribution are open.

## Implemented policy correction

Every unconfigured independent runner in the measured fixture now applies the
existing `withExecutionDiagnosticDefaults` policy: preparation, request-lifetime
construction, business runners, publication runners and result decoding. The
existing signed grant preparation/verification helper lends that selected
diagnostic composition through its original runner calls. The in-process test
transport accepts diagnostics as a separate trusted test argument and applies
the policy at its existing request decoder. No wire input or execution-host
contract changes.

PGlite's complete quiet witness also exposed two shared unconfigured admission
roots. The default located-transaction runner starts two admission calls; the
installation-protected scope-control reader starts 82. Those owners now use the
same defaults at their existing `Effect.runPromise` sites. The retained call-site
capture identifies both exact owners. After the first correction, the remaining
164 default spans were the scope reader's 82 `lockCurrent`/`readGate` pairs. No
installation check, lock, transaction, metadata read, failure or cleanup is removed.

Explicit request diagnostics remain selected per request. The fixture regression
runs quiet/configured/quiet workflows in one retained series on each driver,
requires zero ordinary spans for both quiet requests, and verifies the changed
grant and protocol decoder runners retain the configured parent, annotations
and timing policy. Existing finite invocation tracing and cleanup witnesses pass.
Independent admission runtimes receive local defaults; they do not inherit
business services, Clock, database, transaction or finalizer capabilities.

## CPU result: no established reduction

Two independent processes run 40 complete matched pairs each, five warmups per
lane, with original/quiet policies alternating in balanced four-pair blocks.
The second process reverses policy assignment. Native/Flarex call order also
alternates. The variant applies the same tiny forwarding decorator in both
policies, without a profiler, leaf timer or span observer.

| Policy | Pairs | Mean added CPU | Median added CPU |
| --- | ---: | ---: | ---: |
| Original defaults | 40 | 117.15 ms | 117 ms |
| Corrected quiet defaults | 40 | 122.80 ms | 125 ms |

The observed mean reduction is **-5.65 ms**, meaning the corrected policy was
slower in this sample. The 95% block-bootstrap reduction interval is
**[-18.225, +7.05] ms**. It crosses zero: neither a saving nor a definite
regression is established. The two processes' reductions are -9.0 and -2.3 ms.
The correction fixes the diagnostic policy; it is not a performance solution.

Twenty thousand bootstrap repetitions resample ten four-pair blocks within
each process with seed 137. The interval describes these observed processes,
not independent process/host variance. Counter quantization, JIT and host
variation remain limitations. These are actual per-pair thread CPU differences,
not subtraction of lane medians. Warmups split three/two across policies in
one process and two/three in the other, for five per policy pooled.

All nine fixture source sites are toggled. Both variants share the corrected
grant/decoder handoff and the two quiet admission roots, so this comparison
isolates the default policy, not exclusive old-versus-new CPU for every source
edit. The ordinary PostgreSQL quiet regression passed before the PGlite-only
admission corrections. A separate forwarding tracer-spy pass observes
**824 -> 0** ordinary spans in successful complete PostgreSQL workflows; it
does not supply the CPU comparison.

The fresh control uses corrected source without the decorator, profiler or
numeric leaf observers: 15 pairs, five warmups per lane, added CPU range
78-156 ms, mean 119.6 ms, median 124 ms. Comparing its median to a different
historical cohort cannot establish a saving. The historical 172 ms pricing
await remains a separate unresolved elapsed observation.

## Ordered row acceptance and projection

Six observed requests among 12 complete paired workflows have stable counts.
Original function bodies are forwarded. Private WeakMaps classify issuance and
table acceptance without extra reads of foreign properties. Nested selected
timers subtract child envelopes; their self times can be summed within each
request. Inclusive parent times overlap and must not be summed.

| Selected function | Calls per workflow | Reuse evidence | Mean observed self elapsed |
| --- | ---: | --- | ---: |
| Private JSON trusted handoff | 313 | 85 issued top-level inputs | 3.948 ms |
| Private JSON detached capture | 47 | 5 issued top-level inputs | 0.980 ms |
| Canonical row capture | 55 | 47 issued documents, 8 first captures | 0.336 ms |
| Working-set row output | 53 | Uses canonical capture owner | 0.315 ms |
| Mutable canonical-byte comparison | 176 | Original complete comparisons retained | 0.243 ms |
| Table-acceptance inspection | 56 | 48 same mechanics, 8 first acceptance | 0.268 ms |
| Working-set projection | 36 | New wrapper; issued children reused | 0.181 ms |
| Native row view | 2 | Both issued | 0.013 ms |
| Canonical row validation | 18 | All issued | 0.087 ms |
| Activity JSON view | 34 | All documents issued; distinct JSON policy retained | 0.173 ms |

Summed selected self elapsed is 6.543 ms mean / 6.225 ms median, range
5.947-8.461 ms. The JSON functions include calls outside row projection;
do not label their entire cost as repeated row acceptance. An unissued
top-level value can be a fresh trusted wrapper, foreign value or primitive;
that label alone does not prove a redundant full traversal.

The observer-on/off added CPU means are 109.5/127.67 ms, six pairs each. This
small noisy calibration cannot establish negative observer cost or be used to
subtract instrumentation from an owner envelope. Both groups retain forwarding
wrappers and issuance lookups. Timers include observer cost and preemption;
suspended work outside a synchronous function body is not attributed to it.

The existing canonical issuer retains captured runtime/native views and
mechanics acceptance. Private JSON retains bytes, nodes, depth, negative-zero
and Unicode facts, and reuses issued children when validating a new wrapper.
Mutable buffers still require complete comparison on reuse. Membership,
lookahead, decode/hydration, table validation and per-consumption budgets remain
in their original order. Failed table verdicts are not cached.

A narrow combined capture/inspection owner could avoid a second byte check
within one uninterrupted pure acceptance sequence, while preserving new-call
mutable-buffer checks. But even **all** observed byte comparisons occupy only
0.243 ms here. The actually removable duplicate subset is smaller and has no
measured CPU benefit. Adding an acceptance token/cache or batching across rows
is not justified: it creates ownership or failure-order risks for an unproven
gain. No such runtime change was made.

## Remaining execution after the correction

Six separate current quiet profiles use the root profiler without the Effect
measurement collector or allocation profiler. Numeric counters surround the
original six phase boundaries. Full Flarex phase CPU medians are **94 ms portable
execution**, **30.5 ms authoritative publication**, and **7.5 ms admission**.
Each request's phase increments sum exactly to its root thread counter. These
are full phase costs, including required business and durability work; phase
medians are not additive and are not native-subtracted excess. Zero observed
counter quanta in other phases do not mean no work.

Conservative shared clock alignment has **23.155 ms uncertainty**. Boundary
ambiguous samples are excluded, leaving 516 active terminal samples: 123
persistence (23.8%), 119 Effect runtime/other helpers (23.1%), 68 protocol
(13.2%), 33 Schema (6.4%) and 20 Result (3.9%), with driver, Node and other
processing also present. The largest specific terminal locations are Effect
iterator advancement (27 samples), named-function scaffolding (19) and
`Result.gen` iteration (15). Inclusive Effect frames include business callbacks;
these executing locations do not establish percentages of excess or removable
CPU. No profile sample-spacing sum is presented as exact CPU.

GC overlap is 2.712 ms median, range 2.356-3.068 ms. The measured recurring
thread processing is concentrated in guarded execution and publication rather
than one row comparison, ordinary spans or a demonstrated rare PC hang. This
does not provide an exclusive explanation for all 119.6 ms mean added CPU.

The next bounded investigation should locate high-volume generator and named
function composition by its private business/validation owner, separating
construction from interpretation. Only then consider consolidating adjacent
pure acceptance work inside the existing Effect lifetimes, or removing optional
diagnostic scaffolding through the existing observer policy. Required validation,
typed failures, interruption, ordered row refusal and durable settlement remain
gates. A broad Effect rewrite and a promised 100 ms saving remain unsupported.

## Validation and scope

The new driver regressions and existing tracing/cleanup tests pass six tests
across three files, including PGlite and ordinary-role PostgreSQL. The existing
located-runner composition and settlement regressions pass 16 tests across two
files. Executor and persistence typechecks, core/diff lint and the Effect
runtime-boundary guard pass. The separate span-count workflow also passes.

All 107 retained counter pairs have successful complete business checks, equal
before/after source digests, durable settings and completed cleanup. Database
roles are ordinary: superuser/bypass-RLS/create-role/create-database false;
fsync, full-page writes and synchronous commit on; statement tracking none and
auto-explain disabled. Performance assertions remain unchanged. These bounded
campaigns do not establish complete native-relative performance acceptance.

An initial owner-test command selected old ignored snapshot copies from the
repository root. Their import failures are a command-scope error; rerunning
from the owning package passes the actual 16 tests. The first row probe failed
before tests because TypeScript 7 has no AST API; using the repo's pinned
`@typescript/typescript6` AST dependency fixes the local probe. Neither failed
attempt contributes CPU samples. No runtime or test check was weakened.

The current quiet profile pass also completes six profiles and six quiet
calibrations with stable authored source, durable ordinary-role settings,
business checks and cleanup. It supplies execution-location evidence, not the
paired savings measurement. Final review and owned PostgreSQL shutdown are
completed with no actionable findings from both required read-only reviewers.
Final executor typecheck and exact staged lint pass. PostgreSQL is stopped:
zero other client backends before shutdown, status exit 3 and zero port 56434
listeners afterward. Unrelated backend test/worktree files are outside this
change.
