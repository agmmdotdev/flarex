# Complete Request Comparison Contract

Status: real empty-operation baseline and source-grounded comparison contract
implemented under standing core approval. The first
[zero-row request reference](./48-ce0-empty-mutation-reference.md) supplies bounded
cross-host publication/replay and settlement witnesses. The
[first-insert profile](./50-ce0-first-insert-reference.md) adds independent
nonempty persistence. The [first-insert executor](./52-ce0-first-insert-execution.md)
also independently owns its fixed pending insert flow, while schema validation,
bounded readers, lifetime and authority remain common. The
[settlement matrix](./51-ce0-nonempty-settlement.md) extends the actual PostgreSQL
uncertainty, cancellation and scoped contention witnesses to eight-row requests.
The [standalone read reference](./53-ce0-standalone-read-reference.md) independently
executes empty and bounded point readback with actual snapshot overlap and no
publication. The [cumulative budget witnesses](./54-ce0-cumulative-request-budget.md)
compare refusal from accumulated valid read/insert work, including cached output
copies and unchanged durable state. The
[explicit title-list extension](./55-ce0-pending-unique-equivalence.md) exercises
pending duplicates and committed conflicts after pending work, preserving eager
first-failure order, complete rollback and input identity. The
[request authority matrix](./56-ce0-request-authority-matrix.md) checks stale
clock/catalog/build evidence and missing or damaged active bindings across
zero/eight-row fresh/replayed mutations and standalone empty/populated reads.
The [paired scalar request measurement](./57-ce0-paired-request-measurement.md)
admits diagnostic timing for these selected operations with predeclared targets
and explicit observer calibration results, including misses. Broader
complete-request and CE0 acceptance remain open; admitted scalar timing does not
imply arbitrary framework equivalence.

## Selected Boundary And Missing Evidence

Use the active private CMS core composition in
`test/cmsExecutionMeasurementFixture.ts` as the first bounded complete-request
profile. It exercises generic shared Application rows, an intrinsic creation-time
index, a developer title index, scoped title uniqueness, activated readiness,
one physical command transaction, atomic publication and durable replay.
Native Workerd execution and its earlier-read OCC/journal remain a separate
profile; this comparison cannot substitute for their acceptance.

The row reference admits first revisions without indexes or publication. The
publication reference begins with prepared row output and a locked clock.
Concatenating them would still omit active authority/readiness, command resource
accounting, index/claim transitions, request identity and uncertain settlement.
It would also move work out of the reference's timed boundary. Neither existing
reference is a complete-request comparator, including at zero rows.

The real-host baseline now includes empty operations alongside nonempty inserts,
making fixed request work visible before selecting a reference implementation.
Both an empty standalone read and a successful zero-row mutation return `[]`.
The mutation still advances the dense clock and writes one commit, outcome and
wake; the read publishes nothing. A duplicate mutation replays without rerunning
its callback. A repeated read executes its callback again. Never label both
follow-ups as replay or compare either to a bare SQL SELECT/COMMIT.

The calibrated local lane confirms substantial SQL work for empty reads, empty
mutations and mutation replay. This is complete-request work, not an attribution
of its latency to any single owner. Both core and reference must keep their
declared admission, publication and recovery costs inside the timed boundary;
the existing primitive references cannot be substituted for these requests.

## Equivalence Owners

| Required behavior | Current source owner | Reference obligation |
| --- | --- | --- |
| Target, scope/generation/epoch and live binding authorization | `scopeAuthorityResolution.ts`, `cmsTransaction/admission.ts`, `applicationRelationReadinessFold.ts` | Match preparation versus accepting checks, corruption refusal, live authority and placement. Common owner reuse must remain timed and disclosed; no fixture-issued always-valid authorization. |
| Request canonicalization, command allowlist and identity/policy digest | `cmsTransaction/host.ts` and protocol codecs | Match request identity even when two requests return the same empty result. Changed input, policy or function cannot reuse an outcome key. |
| Clock protection and physical lifetime | `scopeClock.ts`, `relationalTransaction/session.ts`, `physicalSession/postgres.ts` | Same isolation, lock order, acquisition/statement deadlines, cancellation and cleanup. Retain the shared physical runner rather than invent another settlement owner. |
| Bounded operation and pending state | `cmsTransaction/lifetime.ts`, `cmsTransaction/documents.ts` | Same input/result accounting, identity/byte limits, eager unique conflict, read-your-writes and sticky failure. First insertion is a declared reference profile, not an implicit exemption. |
| Indexes, uniqueness and semantic ownership | `applicationDocumentMaterialization/participant.ts`, `materialization.ts` | Same active definition checks, ownership, exact membership/claim bytes, old/new behavior and immutable enabled-build evidence. Reusing the production materializer would leave this component unexamined. |
| Publication and result replay | `cmsTransaction/publication.ts`, `commitPublication/publication.ts`, `committedPointOutcome.ts` | Same row facts, header counts, dense sequence, complete canonical result and digest, key non-reuse, expiry/corruption behavior and wake. Empty successful mutation is included. |
| Uncertain decision and callback replay safety | `relationalTransaction/requestRecovery.ts` and physical owner | Resolve committed outcomes after lost acknowledgement; never treat absence after ambiguity as permission to rerun business work. Confirmed rollback and uncertain decision are different cases. |

The independent candidate may share pure canonical/key codecs and the actual
physical settlement owner. Reusing authoritative admission owners is permitted
only as an explicitly common, timed component whose implementation is not being
compared. It cannot support an independent admission-overhead conclusion.
Record every further common component; sharing the entire host and substituting
only the publisher would be a complete-request *component* comparison, not the
independent request implementation required here. Do not add production runtime
selectors, test mocks that replace authority with success, or a second public API.

## Required Differential Scenarios Before Reference Timing

1. Empty read, zero-row mutation and exact replay: distinct durable effects and
   callback counts, canonical empty result, no row/index/claim/build changes.
2. One/eight/thirty-two first inserts: actual readback, exact canonical rows,
   two maintained indexes, title claims, dense publication and replay.
3. Duplicate request with different inputs; duplicate titles within a request
   and against committed state; cross-scope isolation and genuine contention.
4. Stale generation/epoch/binding/definition and damaged stored authority,
   claim or result evidence: preserve the selected core's refusal semantics.
5. Late materialization/publication failure and cancellation: complete rollback,
   no partial outcome or consumed sequence, clean connection ownership.
6. Lost COMMIT acknowledgement and post-commit cancellation: authoritative
   outcome recovery with one callback execution and no blind retry.

Updates, unique moves/swaps, relation decisions and native earlier-read OCC
require additional admitted profiles and their differential witnesses. They
remain acceptance work, not implied coverage from first-insert timing.

## Current Slice And Cleanup

Extend the existing measurement fixture and shared correctness scenario with
zero-row insertion and an observed read-callback count. Add the empty standalone
read to the same paired observation runner. Preserve existing insertion workloads
and verify every sampled durable state outside timing. Distinguish mutation replay
from repeated read in the report; retire the old ambiguous follow-up field.
The report is a private diagnostic artifact with no supported runtime consumer.

No production API, schema, storage, lock or transaction contract changes. Run
the shared correctness scenario in PGlite and ordinary-role PostgreSQL, existing
fixture consumers, isolated measurement with calibration, affected types/lint,
both reviews and one scoped commit. This slice establishes the real baseline and
the source-grounded equivalence contract; it does not implement the independent
reference or close CE0.

The preceding point-capture test also now omits its optional `rowId` for the scan
case instead of passing explicit `undefined`, preserving exact optional input
typing without widening the storage reader contract.
