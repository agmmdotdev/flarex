# Node callback and dispatch-gap investigation

Diagnostic-only on the current checkout. No runtime implementation or new
worktree. The previous ~12% was a share of raw checked-command
launch/completion **thread cycles**, not 12% of the full ~107 ms CPU excess.
The quiet matched baseline remains the earlier 133.5250 ms Flarex versus
26.5625 ms native mean thread CPU. This campaign does not replace it.

**The dominant remaining interval is the query-to-response handoff, not the
gaps between successive Promise reactions. No production removal or CPU saving
is proved.** The control runs locate 73.3% of their remaining gap cycles between
the final initial Drizzle reaction and entry to the response parser. Observing
Node callbacks places most of that interval before the TCP callback itself.
These boundaries still enclose native/VM/OS dispatch and unpriced hook edges;
the experiment does not separate their native instructions.

## Accepted results

Four fresh processes, 40 alternating native/Flarex pairs and five warmups per
lane each: 160 pairs, 320 measured SDK roots, 6,080 checked commands. Detailed
blocks provide 20 observed Flarex workflows per process. All workload,
cleanup, source-stability, join and accounting gates pass. Runtime source hash
is unchanged: `538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`.

All percentages below use **raw command-stage thread cycles**. The first four
rows partition the gap total; Node callback bodies and measured probe bodies
are separate from it. New instrumentation changes the denominator, so the
Node and control columns cannot be subtracted as a cost decomposition.

| Measured category | Control A | Control B | Node A | Node B |
| --- | ---: | ---: | ---: | ---: |
| Before response callback/parser | 7.903% | 8.031% | 11.036% | 11.476% |
| Seven gaps between Promise reactions/command | 0.842% | 0.886% | 1.442% | 1.273% |
| After Node callback | not observed | not observed | 1.048% | 0.960% |
| Other boundary gaps | 2.038% | 2.042% | 0% | 0.535% |
| **All boundary gaps** | **10.783%** | **10.958%** | **13.527%** | **14.244%** |
| Node callback bodies excluding named children | not observed | not observed | 2.245% | 2.069% |
| Direct measured probe bookkeeping | 26.827% | 25.924% | 28.485% | 25.327% |
| GC callback intervals | 2.960% | 1.056% | 2.579% | 9.698% |

Each observed workflow has 38 TCP callbacks and 76 TickObject callbacks.
TCP callback exclusive shares are 1.464% / 1.341%; TickObject shares are
0.780% / 0.704%. Node B also has five Timeout callbacks across 20 workflows
(0.025% callback body); their incoming gap contributes the 0.535% other row.
Every observed command still has exactly nine categorized Promise reactions.
The seven between-reaction intervals exclude time before/after that sequence;
their small share is **not** an upper bound on all V8 dispatch.

Node B's observed blocks contain 12 GC collections versus three in Node A
(controls three/one). The elevated GC result is retained, not discarded.
GC intervals exclude background collector threads and do not identify the
allocation origin. It is unsafe to treat the previous 0.9–1.7% GC result as
a fixed workload constant.

| Whole SDK request, mean thread CPU | Flarex off / on | Native off / on |
| --- | ---: | ---: |
| Control A | 153.850 / 171.150 ms | 36.600 / 38.300 ms |
| Node A | 176.550 / 186.800 ms | 60.950 / 57.750 ms |
| Node B | 183.500 / 186.750 ms | 61.750 / 64.050 ms |
| Control B | 150.900 / 163.350 ms | 36.700 / 38.100 ms |

Across full processes the Node-hook means exceed controls by 23.5875 ms
Flarex and 23.7000 ms native. The nearly common increase is evidence of
substantial observer perturbation, not a framework-specific saving. Four
processes and quantized thread CPU do not establish a precise causal price.
The observed Flarex-minus-native excess differs by only -0.1125 ms between
those process groups; this is not evidence of an optimization.

### Empty-boundary falsification

Ten alternating warm blocks execute 10,000 empty `observer.run` boundaries
each, paired with a bare-loop control. No SQL, Promise chain or application
body executes inside those boundaries. Two warmup block pairs are excluded.

| Median cycles per empty boundary | Cycles |
| --- | ---: |
| Inside nominal empty execution body | 1,482.0 |
| Outside gap to next empty body | 1,471.3 |
| Measured probe bookkeeping | 5,124.5 |

Therefore an empty execution body and its surrounding gap still register
roughly 2,953 cycles of boundary/loop/counter overhead outside the bookkeeping
bucket. This directly falsifies interpreting all residual cycles as useful
execution or pure VM work. The exact workflow correction is **not** 2,953
times a guessed edge count: callback shapes, JIT state, GC and hook dispatch
differ. No such subtraction or conversion to milliseconds is performed.

## Measurement contract

`dispatch-profile.config.ts` composes the existing launch and continuation
probes. The same SDK cycle partition remains authoritative. Its original
outside bucket is subdivided by the preceding and following synchronous
boundary, using **the same counter reads**, with exact conservation. Boundary
names locate an interval; they are not native instruction attribution.

`node:async_hooks` observes non-Promise resources. The TCP callback includes
Node stream/event dispatch around the existing PostgreSQL parser. Nested
driver, Effect and explicit Promise bodies are subtracted. Promise reactions
remain observed by the existing V8 hooks; no Promise, callback, query or
business result is replaced and no continuation is scheduled by the probe.

The control processes retain V8 hooks and gap correlation but never enable
the new async hook. The Node processes enable it globally; five-pair ABBA/BAAB
blocks still toggle detailed partitioning. Thus the in-process off blocks are
**not** hook-free controls. No forced GC or competing heavy tests/reviews run
during accepted campaigns.

Enabling async hooks also activates Node's Promise context tracking even
though the probe ignores Promise resource records. That path is present in
the executing Node 24.16.0 / V8 13.6.233.17-node.49 source, as are the callback
context push/pop outside user hook bodies and `runMicrotasks` inside the task
queue. The source is evidence of what can execute, not a cycle attribution.

| Installed Node built-in | SHA-256 of `process.binding('natives')` source |
| --- | --- |
| `internal/process/task_queues` | `19646fadc601f38a10d7cf5bb914f4c96909a8b98f675af705520f4456e80997` |
| `internal/async_hooks` | `c8fbe90d373087ef2ff41dd464a3f02019d01472f8c94dfb08ca7c202ee9ac00` |
| `internal/stream_base_commons` | `1717240a06d8b16675c6ee1af4c4814ff2aeda211b47ac69b61ad04acd438700` |
| `net` | `be1e78bb324d4954f3ec552870a3bcd255eb3845703cf82db910ef221afb4c8a` |

Windows `QueryThreadCycleTime` includes user and kernel thread cycles.
Its documentation explicitly forbids conversion to elapsed time:
[Microsoft counter contract](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-querythreadcycletime).
The socket-handoff interval must not be reported as PostgreSQL execution,
network wait, pure V8 dispatch, or a removable CPU amount.

## Removal decision

The probe's stack/maps/counter work is diagnostic overhead and can be omitted
from ordinary execution; the quiet baseline already omits these probes.
Removing it cannot be claimed as a reduction of the quiet baseline excess.
One concrete diagnostic-only cleanup is visible in `dispatch-runtime.ts`:
ignored Promise resource events still enter `observer.bookkeeping` before
returning, causing two native snapshots despite adding no Node callback frame.
The existing V8 hooks already own Promise attribution. Moving those ignore
guards ahead of bookkeeping would remove redundant diagnostic reads, but its
CPU saving has not been measured and it would require fresh capture provenance.
Native counter-call edges, callback-hook dispatch, wrapper allocations and
JIT/allocation perturbation remain partly outside the measured bookkeeping
bucket. Empty-boundary calibration tests this limitation directly. Its replay
price is not subtracted from real workflow samples.

TCP response delivery and the checks consuming it have a required consumer.
The results do not authorize dropping a callback, a read, the raw-driver
failure observation, the mapped-result observation, or deadline/drain work.
Combining physical commands could change the number of socket handoffs, but
these measurements neither prove duplicate commands nor establish the safety
or CPU saving of such a redesign. Checks and first-failure order stay intact.

## Reproduction

Use the ordinary PostgreSQL fixture role and the existing measurement harness
with attribution `control`, 40 samples, `FLAREX_CONTINUATION_MODE=detailed`,
and `dispatch-profile.config.ts`. Capture fresh folders in this order:

| Folder | `FLAREX_DISPATCH_MODE` | `FLAREX_LAUNCH_ORDER` |
| --- | --- | --- |
| `dispatch-control-a` | `control` | `abba` |
| `dispatch-nodes-a` | `nodes` | `abba` |
| `dispatch-nodes-b` | `nodes` | `baab` |
| `dispatch-control-b` | `control` | `baab` |

Run `dispatch-costs.config.ts` to decode and validate the retained campaigns;
the shared reducer also continues to validate the original continuation
campaigns via `continuation-costs.config.ts`. Run empty-boundary calibration
separately with `dispatch-calibration.config.ts` and the default Node mode.
Package with `FLAREX_PROFILE_DISPATCH_CORRELATION=on` and `retain.mjs`.
The four-pair `dispatch-smoke` preflight is excluded from accepted results.

## Validation and limits

The strict reducer validates all 6,080 commands, unique SDK-root/window joins,
source hashes, raw/virtual cycle conservation, opposite observation orders,
Node callback presence only in Node runs, and nine reactions per observed
command. The refactored original continuation reducer regenerates its previous
output byte-for-byte. The calibration decoder reuses the authoritative record
and cycle schemas and checks block identity, positive iteration counts and
conservation before `dispatch-summary.ts` presents the validated inputs. A
negative test rejects zero iterations, duplicate blocks and corrupt accounting.
The retained artifact manifest covers 19 lossless gzip files.

Three dispatch observer tests pass, including deterministic gap conservation,
an active real Node callback rejecting with the original failure, full Causes,
interruption and no later work. The four existing continuation tests and the
separate empty-boundary calibration pass. The unchanged physical-session suite
with dispatch hooks/transforms passes 41 tests; one TLS case is skipped. That
suite has no SDK roots, so it does not exercise active cycle attribution during
real database failures; the active synthetic failure tests cover that boundary.
Diagnostic TypeScript passes. No new schema, transaction or query-plan claim;
PGlite is not rerun. Owned PostgreSQL is stopped.

Pure native/VM/OS dispatch within the pre-response gap is still not separated
from all observer dispatch edges. A native stack/OS trace correlated to those
specific boundaries would be needed for instruction-level attribution;
another JS wrapper cannot establish it. This is the remaining measurement
limit, not evidence for deleting runtime work or rewriting Effect/Promise
composition. Demonstrated production CPU reduction from this investigation:
**none; runtime unchanged**.

The installed Windows Performance Recorder was checked after the accepted
campaigns and database shutdown. `wpr -status` reported no recording; this
session is not elevated. Attempting `wpr -start CPU -filemode` failed with
`0xc5585011`, “Failed to enable the policy to profile system performance.”
Thus a native CPU trace could not be acquired under the current Windows
profiling permissions. Completing that split requires a permitted native
capture; this report does not claim the requested pure Node-versus-VM split
is complete.
