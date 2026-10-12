# Separate query handoff and capture header CPU trials

Status: both candidates tested, measured independently and rejected as CPU
optimizations. Original runtime implementations restored byte-for-byte. Work
uses the current checkout, base `14b40575a`; no worktree was created.

## What the candidates change

The logical read owner already retains an immutable query compiler between a
prepared program's find/count executions. The query candidate consolidates the
existing capture, budget charge and compiler preparation into one ordered pure
Result handoff before fresh access selection. It preserves both authority
guards, the original Envelope/Node decoders and exact captured byte charge.
Every execution still consumes current access metadata before selection or
compiled-query reuse. It introduces no adapter validator, cross-request issuer,
authority cache or row/result reuse. The target is repeated Effect dispatch,
not elimination of the first query decode. The compile diagnostic consequently
covers access selection after preparation; complete root counters retain the
whole operation.

The header candidate compiles Result decoders from the same authoritative
reason, database-time and CommitSeq Schemas. One pure acceptance step preserves
reason/retirement handling, database time, serving sequence, retained floor,
readiness, epoch comparison and layout refusal in that order. It enters Effect
once. Replacement-anchor validation and late transaction timestamp decoding
remain at their original later frontiers. Every capture executes fresh SQL
authorization; no accepted header or serving verdict survives the capture.

## Measurement method

Four variants execute the same complete native and Flarex mixed workflow:
saved original, query only, header only and combined. Two independent processes
per variant run in reversed block order, with five warmups per lane and fifteen
alternating measured native/Flarex pairs per process. Report actual per-pair
Flarex-minus-native thread CPU, not a difference of endpoint medians. Windows
thread counters are coarse; PostgreSQL server CPU is excluded.

Test-only module selection uses saved implementation bytes at the original
module paths, preserving shared issuer identity. Module-load hash assignments
outside request windows prove the selected bytes. Disk source inventories,
settings, every sample's business verification and fixture cleanup are required
to pass. No CPU profile, operation probes, SQL duration logging, server sampler,
concurrent tests or compiler runs overlap the campaign. Setup, seed, business
verification and disposal stay outside original endpoint CPU windows.

Request-resampling intervals describe observed uncertainty; they do not remove
process/block dependence, coarse counter quantization or host variation. This
one small local graph does not establish all-five-graph CPU/quiet acceptance or
Cloudflare performance. Existing complete performance gates remain unchanged.

## Correctness evidence and validation limits

New header witnesses mutate real driver-mapped results under genuine authority
and fresh SQL. Malformed reason/time/sequence, refused/retired reasons and floor
ordering must win without touching later throwing getters. An accepted header's
throwing time getter must remain the original defect. Both PGlite and ordinary
PostgreSQL execute these witnesses. Saved originals pass the same new ordering
tests, proving their expected behavior predates the candidates.

Existing read-program tests cover inert construction, foreign Proxy capture,
caller mutation after first capture, repeated budget charging, fresh metadata,
pending overlays, root closure, bounded/empty/cursor/index evidence and complete
returned-row checks. The affected working-set scenario passes in both database
lanes. PGlite native Medusa query/workflow tests and serial ordinary PostgreSQL
query/readiness tests pass. Strict persistence/adapter source/test checks,
core/diff lint and the Effect, connected-source and Medusa-source guards pass.
Both read-only project reviewers found no candidate contract or systems defect.

The bounded current-capture test initially failed before the candidate path:
obsolete scope-clock initialization omitted its current authority pair. After
switching to the existing scope fixture owner, setup exposed missing installation
admission. The fixture now acquires the actual installation admission per test
transaction and closes it in finally. Original budget/corruption/transport
assertions pass separately in PGlite and ordinary PostgreSQL.

Two broader suites remain limited. The commerce snapshot suite fails five
assertions on both original and candidate implementations: four old trace-name
expectations and one maintenance inventory comparison across a binding change.
The managed Product suite fails the same six cases through `referencePages.ts`
on both implementations, including isolated runs; five other cases pass.
Those witnesses stay unchanged and their logs are retained. These trials do not
claim full managed-reader regression acceptance or resolve those preexisting
failures.

An overlapping PostgreSQL query validation attempt hit an advisory-lock timeout
while another suite used the same fixture scope. Serial query/readiness
validation then passes seven tests. The overlap is documented, not treated as
proof of an intermittent timeout's complete root cause. No such overlap is
permitted in the CPU campaign.

## Measurements and final disposition

Eight independent processes completed 120 matched pairs: thirty per variant.
All samples, source/settings gates and cleanup checks pass. The added thread CPU
is each original measured Flarex call minus its matched native call.

| Variant | Added CPU median | Added CPU mean | Observed mean reduction | Exploratory 95% interval for mean reduction |
| --- | ---: | ---: | ---: | --- |
| Original | 125.0 ms | 121.77 ms | — | — |
| Query handoff only | 125.5 ms | 124.13 ms | **-2.37 ms** | -20.10 to +15.83 ms |
| Header acceptance only | 124.5 ms | 119.90 ms | **+1.87 ms** | -14.60 to +17.93 ms |
| Both | 117.0 ms | 110.97 ms | **+10.80 ms** | -5.67 to +27.30 ms |

Positive reduction means lower CPU. Neither isolated candidate establishes a
saving. The combined pooled median is 8 ms lower, but its interval crosses zero
and the block comparison reverses: its mean is 22.67 ms lower than the first
control and 1.07 ms higher than the last. These are exploratory request-resampling
intervals, not independent-process confidence bounds; two processes per variant
do not resolve their between-process uncertainty.

The unchanged original controls themselves move from 125/130 ms median/mean to
95/113.53 ms. Query blocks are 124/124.13 and 126/124.13; header blocks are
140/128.33 and 110/111.47; combined blocks are 94/107.33 and 125/114.60.
This is why the first lower combined result cannot honestly be credited to the
changes. The current original pooled added median remains **125 ms**. We have
not demonstrated any amount of CPU reduction from these two proposals. This
does not prove their precise cost is zero; it rejects the claim of a measured
benefit at this evidence level.

Both runtime candidates are removed. Before reversal, their hashes were checked
against the measured candidate snapshots to protect intervening shared edits.
After reversal, the original disk bytes were restored and checked against the
saved originals and both measured original-control module hashes. No runtime
Effect rewrite, query validator removal or accepted-header cache remains.
The new behavioral witnesses and current-fixture repairs remain. Two reviewers
assessed candidate correctness before measurement and the final retained scope
after disposition.

Raw reports, saved sources, source-selection ledgers and validation logs remain
local in this directory. `summary.json` retains all actual pairs, selected
hashes, settings, uncertainty and final production disposition. PostgreSQL
cleanup and the exact-index final review are recorded there after completion.
