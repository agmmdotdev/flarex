# Bounded batched read execution

Status: **focused proposal ready for review; runtime scope unapproved.** The
[delivered 15 contract](./15-admission-protection-preflight.md) is the baseline.
The [successor roadmap](./14-execution-redesign-roadmap.md) owns sequence and final
acceptance. Approval of the live-check timing and connected construction/read
cutover is required before implementation.

## Connected outcome and recommended direction

Replace repeated finite method/setup admission with one aggregate full root
entry, local construction under the existing issued root identity, and fresh
acceptance at actual bounded storage frontiers. Connect root, working set,
source admission, query planner and genuine Product/Payload/workflow DAL callers
in one slice. Batch trusted storage demands already captured by those owners;
close SQL before returning to native callbacks, hooks, sandbox code or workflow
steps. Postgres remains the only settlement authority.

Retain **source-wide definition/readiness closure**. Slice 13 derives complete
issued-source closure, including views and transitive strong-reference source
obligations. Exact point/range/page/unique dependencies still come from actual
queries and pending state. Preserve their ordered proof; this slice introduces
neither narrower readiness admission nor adapter-authored dependency lists.
Full entry, seal and publication remain full obligations.

The [prepared-admission baseline](../../packages/flarex-backend/benchmarks/mixed-mutation-core/prepared-admission/README.md)
has **862 / 1,068 / 1,663 / 354** SQL dispatches and **41 / 52 / 78 / 6**
explicit transactions on unchanged Product, Product + Payload, mixed workflow
and standalone graphs. Warm p50/p95 is **783.7/1,011.6, 973.8/1,006.0,
1,676.6/1,714.8 and 309.4/395.3 ms**. The next cost owner is repeated checked
construction and storage transactions. This does not prove one transaction for
an entire native method or sequential workflow.

## Material live-check timing amendment

Current finite native method entry performs full live admission; borrowed
construction uses checked source-read admission and does not always require
full readiness. The proposal replaces those repeated checks with local nominal
root/attempt/fence, method/source identity,
lifetime, deadline and resource checks after aggregate full root entry.
Callbacks may therefore execute tentatively after persisted revocation or
readiness changes until their next actual database frontier or final full
seal/publication detects the change. A call satisfied entirely from pending
root state may return tentatively without a fresh database check. This is a
material contract change requiring an accepted-design timing amendment with
approval; it is not implied by a grant or immutable preparation.

Every actual database frontier retains fresh scope/placement, Application and
binding pins, generation, revocation, session/lease/claim/fence, expiry and
post-lock database time, source-wide required readiness and physical evidence.
It registers the mandatory full protected-epoch tail guard. Live evidence is
shared only within that exact transaction and revoked on every exit. Slice 15's
full attestation, privileged quiescence and strong-lock clock observation remain.
No new certificate, permit issuer, maintenance authority or generation-only guard
is proposed. Native foreign effects remain outside the admitted finite graph.

A frontier body or tail failure must latch the existing first failure/root abort
even if native code catches the failure. No branch result or contribution from a
failed checked frontier may be released. Preserve sequential validation,
observation, charging and state transitions; do not add a rollback cache engine.

## Audited owners and actual callers

| Owner | Connected replacement or retained obligation |
| --- | --- |
| Root/kernel and `sessionJournalStore` | Aggregate finite full entry and local issued child sequencing; preserve existing local child entries, single aggregate seal, durable conflict receipt and recovery |
| `logicalDocuments/participantAdmission.ts`, `relationalAdmission.ts`, `documentAdmission.ts`, `sourceAdmission.ts` | Remove repeated finite method/setup transactions; preserve source/method/root identity and source-wide acceptance at storage frontiers |
| `commerceTransaction/borrowedLogicalAttempt.ts`, `borrowedWorkflowAttempt.ts`, `cmsTransaction/borrowedLogicalAttempt.ts` | Construct finite lifetimes and native contexts locally from authenticated owned state; defer genuine pending-seed hydration to storage |
| `logicalDocuments/query.ts`, `relationalQuery.ts`, `workingSet.ts`, `rootEvaluator.ts` | Consume captured bounded demands in order through core storage frontiers; preserve one historical snapshot plus earlier pending changes and all dependency/resource transitions |
| Medusa `query/read.ts`, `commerce-relations.ts`, `commerce-relation-filter.ts`, `write/replace.ts` | Translate actual trusted read/load plans to the core frontier; keep module relation, graph, visibility, projection and performed-action semantics with Medusa |
| Payload `adapter.ts` and borrowed CMS owner | Preserve actual native scalar create/update/find-by-ID lifecycle and hooks; use the same storage owner for real demands |

The actual borrowed Payload graph is `payload.scalar`, one `posts` table;
relations and preferences are refused by that owner. Generic adapter population
and join paths remain standalone obligations, not credited savings or new mixed
capabilities. Standalone workflow and durable-operation callers retain their
actual full admission profiles. No second engine or fallback is introduced.

The [Convex transaction](../../../../crates/database/src/transaction.rs),
[read set](../../../../crates/database/src/reads.rs) and
[write set](../../../../crates/database/src/writes.rs) anchor accumulated snapshot
dependencies and pending writes. They do not justify SQL across callbacks. Native
release contracts remain owned by pinned sources and
[01](./01-application-product-attempt-preflight.md),
[02](./02-payload-local-api-attempt-preflight.md) and
[03](./03-finite-medusa-workflow-preflight.md).

## Legal storage frontiers and dependency proof

An index range plus row hydration already shares one checked transaction. Each
page window plus hydration also shares one. Replace surrounding repeated cuts
through the actual planner/DAL owners:

| Captured demand | Current cuts and proposed grouping | Evidence that must remain |
| --- | --- | --- |
| Point/getMany | Exact uncached identities; getMany already batches requested identities | Present/missing/tombstone revision, input order, duplicates and exact pending overlay |
| Complete indexed read, IN/disjunction | Compiled selections call `selectCandidates` separately; execute ordered demands in one bounded frontier | Each complete range's membership including empty sets, hydrated point revisions, residual validation and stable deduplicated result order |
| Historical unique lookup | Retained ordered-index probe precedes a separate uncached owner point read; group probe and owner hydration | At most one owner, negative key witness, canonical key/owner correlation; final unique slot still checked at publication |
| Residual page | Each examined window opens another checked read; a bounded trusted loop may share a frontier | Examined keys, hidden successor, gaps and EOF, cursor progression, pending-only frontier and exact offset/limit semantics |
| Trusted Medusa read/load | Relation-filter leaf-to-root, root selection, count placement and population issue trusted storage demands | Module-owned traversal/visibility/projection and original error order; dependent keys come only from owned result rows |
| Captured native write probes | Ordered input rows need old identities, unique owners and references; group storage demands under the real working-set/planner owner | Original base versus overlay, applicable uniqueness and final pending reference/reverse/delete obligations; preserve mutation order |

An arbitrary native method's next call cannot be guessed. Medusa's repository
transaction callback, mutation subscribers, Payload access/validation/hooks,
native loader scheduling and workflow steps stay outside SQL. Do not wrap an
opaque native callback in a transaction or add a speculative prefetch optimizer,
query DSL, registry or caller-created frontier authority. Private core storage
execution consumes actual bounded trusted demands; framework policy and
callback lifetimes remain with their owners.

Source-wide readiness does not substitute for data dependencies. Point absence,
negative ranges, historical uniqueness, page gaps, target existence, reverse/
delete membership and pending changes that introduce requirements remain
decisive. `validateRelationalReferences` derives obligations from final pending
rows, including removed/rekeyed parents and cascades. An initial query's table
list cannot stand in for that later work. Historical text/JSON search remains
unavailable where snapshot candidates and conflict evidence are unproved.

### Construction hydration and resource order

The shared root's `appPoints` stores observed revision/absence plus a canonical
overlay separately from row/dependency maps. Construction fetches the original
snapshot row, authenticates the seed observation, then installs the overlay.
Shared state cannot delete that obligation or manufacture a base from the overlay.
Defer relevant unhydrated seeds to the first actual source storage frontier,
before any selection uses pending membership. Retain present/missing/tombstone
comparison, canonical identity, creation time, charge order and hydration marker.
A nominally state-only operation that needs an original base becomes an actual
storage frontier. A source without relevant seeds needs no construction read.
The measured Application tables are outside the native source table closures,
so those graphs have no native construction seed hydration; overlap behavior
still requires its decisive witness in the replacement.

Keep existing captured request/root limits and deadlines. Ordinary Commerce
query/catalog and CMS identity bounds are 256; CMS output pages are 32. Physical
hydration chunks remain at most **256 identities / 1 MiB**, each document at most
**64 KiB**, further reduced by remaining request/root bytes. Predicate complexity
remains **64 nodes / depth 8 / 256 operands**. Unique owner probes retain limit 2
to detect multiple ownership. No query or call limit is raised.

For `S` uncached compiled selections and `O` uncached historical owners, existing
cuts can be `S + O`; a legal frontier uses one checked transaction while retaining
all server selection/hydration statements. Hydration needs at least
`ceil(U / 256)` identity partitions for `U` identities per table; the 1 MiB and
remaining-byte bounds apply independently and can refuse overflow. This formula
does not prove sufficient byte capacity or permit fabricated absence. A residual page loop with
`P` windows still performs every window statement; grouping must obey total
examined-identity/lookahead and byte bounds.

Capture foreign data before SQL. Decode, observe, charge and install sequentially;
earlier input, corruption, conflict or budget refusal prevents later member work
from becoming visible. Preserve point observation, retained body/index/key and
output charges. Do not decode a later branch early, parallelize shared-transaction
statements or turn withheld oversized bodies into absence or fallback reads.
All internal server pages count even when one frontier contains them.

## Proposed stage budgets

The audited decomposition supplies a conservative stage gate. It credits setup
removals only; compound data frontiers must still migrate real consumers and
preserve dependency order, without claiming unproved data savings.

| Explicit transaction category | Product current → proposed | Product + Payload | Mixed workflow |
| --- | ---: | ---: | ---: |
| Request admission | 11 → 9 | 13 → 9 | 19 → 9 |
| Finite method admission / borrowed construction | 6 → 0 | 14 → 0 | 18 → 0 |
| Native storage demands, conservative allowance | 14 → 14 | 15 → 15 | 31 → 31 |
| Application point operations | 2 → 2 | 2 → 2 | 2 → 2 |
| Root bootstrap | 1 → 1 | 1 → 1 | 1 → 1 |
| Seal/OCC | 5 → 5 | 5 → 5 | 5 → 5 |
| Publication | 2 → 2 | 2 → 2 | 2 → 2 |
| Total | **41 → 33** | **52 → 34** | **78 → 50** |

The three graphs have 3 / 7 / 7 native invocations. Workflow construction adds
six setup cuts, empty of data reads in the measured graph. Parent/child demands
can depend on returned identities, so the grouped trace does not establish a
universal minimum number of sequential data rounds.

Request admission retains eight fixed setup transactions (seven target and one
control) plus one aggregate full finite entry. Product data has ten historical range
statements, three direct point reads and one timestamp transaction; workflow
adds fifteen range transactions and one timestamp. Payload adds one historical
unique-title probe. The grouped trace cannot identify the three Product point
identities or reconstruct a complete ordered call ledger; do not invent origins
or credit their elimination. Counts describe explicit BEGIN/COMMIT spans;
autocommit and server transactions, including control/standalone work, are not
fully counted by this instrumentation.
The two retained Application point transactions include a generated-ID negative
point probe; only the later pending patch is local. Neither is credited as a
native construction or data-frontier removal.

Proposed SQL ceilings are **798 / 924 / 1,439**, conservatively subtracting eight
dispatches for each of the **8 / 18 / 28** removed checked cuts from slice 15.
Each removed cut accounts for BEGIN, COMMIT and the six existing kernel queries.
The grouped entry moves existing proof reads and reuses the already locked
session principal; it must not add dispatches beyond that moved work. Standalone
remains **354 SQL / 6 explicit transactions**. Existing
six kernel statements, fixed setup, Application point, bootstrap, seal and
publication obligations remain. Ceilings count dispatches; function/trigger
server work must be accounted separately. No batching hides server statements
or moves settlement into evaluation.

The same business graphs, input effects, deadlines, recovery and exclusion policy
govern comparison. Preserve slice 15's first-fill costs and all 120 samples;
retain every new sample/outlier. CPU/decode/hash, full attestation server work and
pure server/lock attribution remain unavailable until observed. Driver await
includes transport/server/waits; overlapping trace phases are not untraced
latency acceptance. Final mixed p50 **100 / 200 / 500 ms** and p95
**200 / 400 / 1,000 ms** remain whole-successor gates; standalone median must stay
below 400 ms with regression strictly below 10%.

## Replacement, durable disposition and cleanup

Replace finite per-method/setup checks and displaced construction transaction
plumbing across root, participant/source admission and borrowed Commerce/CMS/
workflow owners. Migrate actual working-set and native DAL demands to the core
frontier and delete displaced repeated cuts in this slice. Retain standalone/
durable full checks for their named execution profiles. No dual reader,
compatibility wrapper or second lifetime/settlement authority is justified.

Finite child contributions are already local with one aggregate seal; this slice
does not create that behavior or replace durable child formats. Preserve all
journal/protocol encodings/readers, retained attempts/outcomes and early relation-
conflict durable transition. Resolve uncertain COMMIT before callback replay.
No migration, reset, data deletion or named-environment activation is proposed.
Cutover must drain live finite owners to completion or fence and abort them;
never transfer process-local evaluator or pending state to a replacement owner.
Preserve existing sealed and retained readers, and resolve uncertain outcomes
before any replay.
Settlement batching and durable changes remain with
[17](./17-batched-settlement-preflight.md).

## Validation and completion gates

- Prove local method/root/scope/fence/lifetime mismatches fail before foreign
  capture; persisted revocation/readiness changes fail at the next storage
  frontier or final full gate. Tentative callbacks acquire no commit authority.
- Use PGlite and ordinary-role Postgres for point/range/page/negative membership,
  tombstones/history, pending inserts/deletes/replacements, unique absence,
  references/reverse/delete/cascade closure and deferred seed hydration. Preserve
  required versus unrelated readiness and source-wide closure.
- Witness ordered branch errors, cumulative byte/identity/call budgets, duplicate
  and missing/extra rows, hidden lookahead, residual windows and withheld-body
  crossing before later corruption. A caught frontier body/tail failure must
  latch first failure/root abort and release no result or contribution.
- Instrument real DAL frontiers to prove no SQL spans getters, native callbacks,
  hooks or workflow suspension. On distinct connections cover head/authority/
  readiness changes, blocked reads with fresh post-wait time, fencing/claim loss,
  epoch contention and physical replacement. Keep six kernel checks and exact
  live-evidence cleanup on success, failure and interruption.
- Run genuine Product, scalar Payload Local API and finite workflow success,
  late failure, rollback-only, positive/negative conflicts, bounded whole-root
  retry, events, replay, cancellation, durable early conflict and uncertain
  COMMIT recovery; retain standalone/durable regressions and no callback replay
  after committed recovery.
- Apply Effect pattern/error guidance, affected types/builds/source/Worker guards
  and lint, both project reviewers on stable final scope, substantive-fix review,
  cleanup, staged lint and one scoped commit.

Exit requires approved timing/transaction contracts, real consumer cutover,
exact dependency/resource proof, durable preservation, deletion of displaced
topology and agreed stage ceilings. Quiet traced structure and matched untraced
distributions retain all samples and identify the next owner if latency remains
short. Developer APIs, new operations/modules/search, hosted activation, remote
effects/resource waits and advanced evolution remain outside this proposal.
