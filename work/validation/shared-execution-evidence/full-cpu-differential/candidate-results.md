# Candidate selection and checked physical commands

Diagnostic investigation against `323961910`, current checkout. No production
runtime, SQL, business checks, error ordering or worktree changes.

## Result

**Command execution is the dominant substage of checked physical commands.
Neither boundary reveals a dominant safely removable function.** In the control,
candidate selection excluding captures costs 11.800 ms; all 38 checked commands
cost 16.275 ms, of which launching/completing commands costs 9.700 ms. These are
observed Flarex CPU costs, not native-subtracted excess or achievable savings.

| Disjoint/explicitly nested measurement | Control CPU | Profile B CPU | Profile C CPU |
| --- | ---: | ---: | ---: |
| Candidate selection, excluding every nested capture | 11.800 ms | 16.600 ms | 12.050 ms |
| Whole checked physical commands | 16.275 ms | 22.725 ms | 19.675 ms |
| ↳ Launch/completion, included in preceding row | 9.700 ms | 12.525 ms | 12.575 ms |
| Other capture preparation/acceptance, excluding commands | 1.550 ms | 5.775 ms | 3.175 ms |
| Other relational processing, excluding candidates/captures | 11.750 ms | 8.600 ms | 12.100 ms |

Exclude the indented command subrow when summing. The four disjoint families
total 41.375 / 53.700 / 47.000 ms. They measure the same broad read/capture family
as the earlier approximately 45 ms; separate-process/probe variation remains.

The independent cycle measurements give a more stable ranking than the small
CPU increments. Launch/completion is **56.33 / 62.76 / 57.15%** of command cycles.
Acquisition including wrapper construction is 11.6–13.5%; capability admission is
14.6–17.1%; other command orchestration is 8.2–9.7%; drain plus release is only
**2.88–3.40%**. These percentages are partitions, not converted cycle milliseconds.

For candidate selection excluding capture, 35–36% of cycles remains in local
selection/continuation construction and consumption; 22–23% in row/index decoding
excluding hydration; roughly 13% in unique-key lowering and historical bounds;
about 6% in live metadata consumption. The rest is finite-read bookkeeping,
location/hydration and other selected helpers. None is a majority leaf function.
The 44 candidate calls include recursive consuming continuations: summing their
inclusive times would double count. The reducer selects each exclusive span
once, with capture descendants excluded.

The profile stacks confirm concrete execution of node-postgres connection
configuration/serialization, Drizzle placeholder binding, Effect execution,
protocol decoding and GC. They do **not** establish which leaf dominates the
whole stage: clock uncertainty is 0.439–0.448 ms, many short operations cross
that boundary, and some native frames are redacted. GC seen during a command
does not prove that command allocated its garbage. The conservative retained
sample partition is evidence of executing work, not permission to allocate all
boundary samples to a convenient owner.
Across 7,284 admitted active Flarex samples, 2,455 are focus-boundary ambiguous;
598 are securely inside a checked command and 229 inside candidate selection
outside those commands. These selected samples are not representative coverage
of all short operations and cannot establish a majority leaf cost.

### Removal decision

The measured concrete allocation candidate remains small: 38 disposable
cancellation-client constructions cost **0.375 / 0.390 / 0.422 ms** per workflow
in warm replay. Removing them safely requires the configuration/capability
ownership proof below; no end-to-end reduction is measured. Existing duplicate
query/bounds preparation remains about 0.3 ms in its separate prior replay.

There is no evidence supporting removal of acquisition, deadlines/cancellation,
fences, drain/release, metadata dependencies, row checks or membership checks.
No exact duplicate storage demands were established, so batching/dropping reads
is not a supported removal proposal either. A new direct driver path, fewer
Promise/Effect wrappers or a broad selection rewrite would still be hypotheses;
the measured launch/completion envelope includes required driver/protocol work
and does not price those replacements. **No runtime redesign selected; actual
CPU reduction from this diagnostic work is zero.**

## Scope and method

The previous read probe identified candidate selection and physical commands as
large residual boundaries. It also materially increased CPU through argument
identity/structural-key recording. This follow-up reuses the existing SDK harness,
operation counter probe, native thread-cycle reader and V8 clock landmarks, with
no argument-key ledger. Test-only AST transforms bracket original operations;
they do not replace business expressions or bypass checks.

Every accepted campaign has 40 alternating complete native/Flarex pairs after
five warmups per lane. Original SDK root counters, settled operation nesting,
exact disjoint CPU/cycle conservation, source hashes and workload gates must
pass. The runtime hash remains
`538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`.

The profiler-off control measures 146.600 ms Flarex and 27.825 ms native mean
thread CPU, an observed difference of 118.775 ms. This includes observer work and
process variation. It does not replace the untouched 106.9625 ms baseline or
measure a performance improvement. Small Windows thread-counter increments are
coarse; cycle shares rank the smaller scopes without converting cycles to time.

Candidate intervals include their consuming continuation. Physical command
intervals include driver/protocol continuations and may contain unrelated work
scheduled on the same thread. Child durations are subtracted before reporting
residuals; database/network waiting is not thread CPU.

## Constructor replay

Each complete Flarex root constructs 38 cancellation Clients solely during
transport capability admission. After all workflow work settles, five batches
repeat the final constructor closure 38,000 times each, using its actual config
without serializing that config or opening a network connection. The control
batch median is 0.375 ms per 38 constructions (range 0.375–0.406 ms).
Independent profile processes give medians 0.390 and 0.422 ms.

This is a warm allocation/loop price, including GC occurring during those
batches. It is not an observed end-to-end saving or an upper bound on cold/live
cost. Live per-constructor counters also include observation and counter aliasing.

## Existing reuse and checks

- The finite profile returns `work` directly from `withStorageFrontier`; it does
  not borrow/hold the transaction frontier used by other profiles.
- `uniqueReads`, `indexReads` and row dependencies already retain observations.
  `readFiniteBase` filters already-observed identities before issuing a capture.
  Prior evidence finds no equal input among the 26 index and eight row captures.
- An index page validates every membership and lookahead before permitting row
  hydration. Each row envelope, body and consumer settles before the next row.
  Candidate membership is then checked against its actual base revision/key.
- Metadata consumption still checks the live root/issuer. A repeated check is
  not permission to reuse an old verdict.
- Every checkout has fresh fences, tracked promises, error listener and release
  state. They cannot be shared just because the physical client is reused.
- Physical order is acquisition, capability admission, bounded command,
  close fence, drain, connection-error check, release. Failure quarantine and
  full Cause combination remain unchanged.

The disposable cancellation Client is a possible small allocation removal only
if stable driver capability/configuration can be owned once while retaining
current authenticated backend identity, TLS, startup timeout/options checks and
their refusal order. Mutable pool configuration, environment-derived defaults,
custom streams/connections and prototype mutation prevent assuming a globally
cached verdict is equivalent. No such runtime change is selected here.

## Rejected capture

`candidate-profile-a`, run `3cfd2ed3-4f8f-47ac-b0f5-3117ddf4f311`, completed
all business calls and cleanup, but the final Flarex profile was rejected with
`cpuDecode`. Its root counter was complete; its profile was absent. The campaign
is retained as incomplete and excluded from attribution. The collector did not
retain the invalid raw V8 payload, so this investigation does not establish the
decoder rejection's underlying cause. Successful later captures do not prove it
fixed. No collector limit or acceptance check was relaxed.

## Reproduction

Use the existing ordinary-role PostgreSQL fixture on port 56434 and
`attribution.integration.test.ts` through `candidate-profile.config.ts`, with
`FLAREX_MEASUREMENT_ATTRIBUTION=control|cpu`, 40 samples and a fresh output folder.
The observer uses no broad argument serialization. `candidate-probe.json`
records transformed source hashes/sites and five constructor replay batches.

The reducers use the existing strict operation partitioner. Profile correlation
adds instantaneous sample attribution: the entire calibrated timestamp
uncertainty must lie within a selected owner. The preceding sampling gap is not
assigned to that owner or converted to CPU time. Root admission retains the
earlier conservative full-gap check. Owner categories are statistical sample
allocations, not exact leaf-function timers or removable CPU.

Run `candidate-analysis.config.ts` for transform and point-correlation witnesses,
`candidate-costs.config.ts` for counter/source/conservation checks, and
`analysis.config.ts` with `FLAREX_PROFILE_CANDIDATE_CORRELATION=on` for profiles.
The same flag selects lossless packaging in `retain.mjs`.

Accepted run IDs: control `87b3f8d4-999b-4f2b-b329-8efeed746f5f`, profile B
`2e87b022-7f10-41a5-9692-1004dfaa6df0`, profile C
`6a2cc2c1-143b-482d-af54-0e00a4d742af`. Profile root CPU is respectively
160.500/27.350 and 153.150/28.850 ms (Flarex/native), including profiling effects.
