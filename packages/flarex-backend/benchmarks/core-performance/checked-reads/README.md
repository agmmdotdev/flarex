# Checked-read component measurements

The baseline records genuine native Product storage operations inside one
already authenticated finite Application attempt per lane. It uses the existing
Product borrow, original claim and lease, issued source admission, snapshot,
pending evaluator, renewal and liveness owner. Native update/retrieve/list then
complete and publish through the existing owner. No readiness, running attempt,
source token or loaded attempt is synthesized.

## Preserved evidence

- [PostgreSQL baseline](./postgres-baseline.json.gz): compressed captured JSON.
- [PGlite correctness baseline](./pglite-baseline.json).
- [Baseline dispatch/owner correlation](./baseline-dispatch-owner-map.json).
- [Matching PostgreSQL baseline](./postgres-matched-baseline.json.gz).
- [PostgreSQL candidate](./postgres-candidate.json.gz).
- [PGlite candidate correctness](./pglite-candidate.json).
- [Asserted paired observations](./paired-observations.json).

The PostgreSQL decoded bytes are unchanged: 994,395 bytes, SHA-256
`761e0b73c7909f196716b4c787e85f1d0515936849a26dce9d9cf62c530da1b2`.
Its gzip is 74,139 bytes, SHA-256
`b4317c2295e1db50947cd1f5238b6cfcc1dd1e88f499722bd80e0553b3500657`.
Each raw report contains its measured source hashes. The runtime baseline is
`6a5391110`; the report also hashes the actual component harness and fixture.
The initial baseline remains preserved after a review correction to use
unnamed `Effect.fn` stack boundaries and expand the direct component-owner hash
inventory. The matching baseline and candidate use that same final harness;
all 36 owner hashes match except `logicalDocuments/sourceAdmission.ts`.

The matching baseline decoded SHA-256 is
`77a77f79da1bf10b5b8c4ee04089f95a06989e1a6742fecf14110c6e2479e20d`
(996,798 bytes). The candidate decoded SHA-256 is
`3204cabac2c5de5ab95f3b135036c9dcfb7af4dd7f767a2d5078ef1b81437893`
(996,739 bytes). Their compressed files decode to the exact captured bytes.

## Operation and observation settings

The untraced lane records one first demand and five successive distinct demands
for missing Product ids and missing handles in the **same attempt**. It also
records one positive id selection, one positive handle selection after that row
has already been observed, and six pending id reads after the genuine native
update. Every query includes the native `deleted_at IS NULL` predicate.
Missing predicates are distinct; the harness does not clear caches.

First/successive describes demand order in a prepared attempt. It does not
describe cold/warm host construction. Positive selections have one sample each;
there is no positive-hit distribution. The pending control includes one first
and five repeated local demands. Its row result is checked on every call.

The small SQL trace uses the same query shapes and order, with one first and one
successive demand. It observes actual driver dispatches, pool checkout, whole
transaction intervals and named outer Effect spans. Reconnaissance captures
stacks and has observer overhead; these samples do not judge steady latency.
Untraced means no additional pool or Effect tracer; the existing fixture SQL
observer remains where present. PGlite runs both bounded sample settings for
correctness and has **no PostgreSQL pool trace**.

## Initial baseline observations

Ordinary restricted-role PostgreSQL 18.3 was observed with `fsync`,
`synchronous_commit` and `full_page_writes` enabled and `rolsuper = false`.
Values below are client observations, in milliseconds.

| Operation | Samples | Untraced median | Untraced range | Small trace dispatches / transactions per demand |
| --- | ---: | ---: | ---: | ---: |
| Successive distinct Product-id misses | 5 | 18.718 | 18.202–21.352 | 20 / 1 |
| Successive distinct handle-index misses | 5 | 19.198 | 17.704–20.525 | 20 / 1 |
| Successive pending Product-id hits | 5 | 0.567 | 0.560–0.608 | 0 / 0 |
| First positive Product-id selection | 1 | 25.305 | single observation | 21 / 1 |
| New positive handle-index demand, row already observed | 1 | 19.218 | single observation | 20 / 1 |

The Product-id selection actually demands a historical ordered index range;
the positive result also reads a historical row revision. It is not a direct
single-statement row point read. The empty selection omits that row-revision
dispatch. The new positive handle demand retains the existing row observation.

The small traced Product-id miss transactions lasted 23.251 and 22.523 ms;
their dispatch-await unions were 11.297 and 10.156 ms and their pool checkout
waits were 0.030 and 0.031 ms. Handle-index miss transactions lasted 21.545 and
23.332 ms, with dispatch-await unions of 10.448 and 12.529 ms. These are not
server execution, network round-trip or pure lock-hold measurements. Subtracting
these intervals does not establish CPU attribution.

Initial Application preparation, atomic entry, full authentication and fresh
renewal are outside the component samples and observed separately. The traced
initial interval recorded 97 dispatches: 71 target and 26 control, with three
target transactions and one control transaction. Its client duration was
172.061 ms; the corresponding untraced interval was 144.294 ms. Host construction,
native seeding and source preparation preceded that interval and took about
14.2 seconds per lane; their SQL counts are unavailable in this observer seam.

## Actual transaction ordering and source correlation

The raw `dispatches` and parsed fingerprints establish this order. The separate
owner map correlates those templates with current source functions. Runtime
stack attribution is usually `unattributed`; the source correlations are
explicitly **inferred from the SQL templates and code**, not observed stack
owners.

| Ordinal in positive id demand | Group | Source correlation |
| --- | --- | --- |
| 1 | Transaction | BEGIN |
| 2 | Attempt kernel | Scope clock `FOR NO KEY UPDATE`; placement/generation/revocation checks |
| 3 | Attempt kernel | Session `FOR UPDATE`; exact attempt fence |
| 4 | Attempt kernel | Snapshot lease `FOR UPDATE`; structure, epoch and retained snapshot |
| 5 | Attempt kernel | Journal root `FOR UPDATE`; complete root structure |
| 6 | Attempt kernel | Execution claim `FOR UPDATE` |
| 7 | Attempt kernel | Fresh database time after the locks; grant/hard/lease/claim expiry checks |
| 8–17 | Source/Application guards | Binding head, Application head/physical builds, definition lifecycle, source index builds/frontiers, unique builds, search builds/physical GIN/frontiers |
| 18 | Data | Historical index range |
| 19 | Data, positive id only | Historical row revision |
| 20 | Transaction tail | Protected metadata final guard with full attestation |
| 21 | Transaction | COMMIT |

The exact source checked-read path uses the attempt kernel's **NO KEY UPDATE**
clock mode. The separate Application read-syscall kernel uses SHARE. There is no
claim that this framework storage path uses the SHARE mode.

Refusal order remains part of the owner contract: stable scope authority before
session inspection; session fence before lease; lease structure before lifecycle
and missing-lease refusal; complete root before claim; time after claim lock;
then source/Application readiness before data and the protected guard before
COMMIT. A query grouping or cached admission must not reorder or omit these
checks. Server-side statements inside protected functions/triggers are not
counted by the dispatch observer.

## Attribution limits and candidate comparison

The caller Effect tracer records genuine outer working-set spans. The exact
attempt kernel runs its SQL callback through its own `Effect.runPromise`, which
does not inherit the caller tracer service. Consequently **source-selection and
kernel Effect span counts are unavailable**. An absent
`LogicalStorageReadiness.selectSources` span is not zero calls. The raw named
span list must not be used to assert a selection compilation count or isolated
source-guard CPU. The source-owner's genuine catalog/charge witness owns that
structural proof.

Driver wire bytes, SQL parameter bytes, isolated validation/decode CPU, server
execution time, pure lock hold time and internal database statement counts are
unavailable. Returned byte counts are the actual JSON encoding of the returned
projection. They are not wire, canonical journal or decode-allocation bytes.

Candidate measurements must use this unchanged harness and declared settings,
write separate candidate files, and retain the baseline. Compare per-read parsed
fingerprints/dispatches and outcomes independently of timing. Five successive
samples are a bounded diagnostic baseline, not a latency acceptance threshold
or production-scale proof.

The final matching pair asserts identical declared settings, demand counts,
returned row counts and JSON bytes, ordered SQL dispatch fingerprints and
outcomes, and transaction outcomes. The initial authentication/admission graph
also matches. Only the source-admission runtime owner hash changes from
`077a5436e327ccc410e307f56e808a2f3bae69ebcca3ff1182dc5f8c8fb762ef` to
`1dce90c3fd5ddaa1f466a8894d6cdb0acbf2a71605ba9f17be4d2fdd745e5fcf`.

| Successive demand, five observations | Matching baseline median / range (ms) | Candidate median / range (ms) |
| --- | ---: | ---: |
| Distinct Product-id miss | 29.270 / 20.693–34.596 | 18.772 / 17.962–32.072 |
| Distinct handle-index miss | 28.532 / 22.579–31.679 | 18.722 / 17.873–22.337 |
| Pending Product-id hit | 0.960 / 0.768–1.079 | 0.597 / 0.573–0.738 |

The pending local control also became faster despite performing no source
selection or SQL. The original initial baseline's miss medians were already
near the candidate values. This pair therefore establishes no attributable
latency improvement or acceptance threshold. The measured SQL count and fresh
transaction graph are unchanged. The connected source-owner witness supplies
the separate structural result: four sequential genuine singleton reads compile
one immutable projection while each still inspects fresh readiness. Concurrent
genuine calls retain one charged projection; database locks may serialize those
calls, so this is not a deterministic overlapping-compilation claim.

Run the PGlite and PostgreSQL test files sequentially. Set
`FLAREX_POSTGRES_DATABASE_URL` and `FLAREX_POSTGRES_PROVISIONING_DATABASE_URL` for
the ordinary PostgreSQL fixture, `FLAREX_CHECKED_READ_PERF_REPORT_DIR` for saved
reports, and `FLAREX_CHECKED_READ_PERF_STAGE=candidate` for the separate candidate
files (`matched-baseline` selects the matching baseline). Earlier harness
predicate/environment refusals produced no reports and
are not excluded measured samples.
