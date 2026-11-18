# Core query cost and finite-workflow cold gate

Status: **bounded owner correction implemented for the private selected profile.**
The owner approved batching source readiness and table-frontier
work, challenging repeated validation and short-transaction boundaries, and
assessing journal, pending, publication and COMMIT costs. This approval covers a
coherent correction at the responsible core/persistence owner and its connected
tests. It does not approve a new authority model, a cross-transaction cache,
long SQL transactions over Worker or workflow callbacks, higher deadlines or
shared ceilings, schema/data migration, another framework operation, public
API or named-environment activation. A material change to those boundaries
returns to focused discussion before implementation.

The [accepted mixed execution design](../../design-notes/flarexdb-mixed-mutation-execution.md#performance-evidence-and-optimization-sequence),
[mixed roadmap](./README.md), [measurement preflight](./04-performance-baseline-preflight.md),
and [retained benchmark evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/README.md)
govern this slice. The original failed measurement remains evidence. The
corrected complete series closes the current private cold gate; it does
**not** retroactively complete the original partial run or establish the
cause of its delayed COMMIT observation.

## Outcome and measured reason to act

The correction keeps the existing one-root Application/Product/Payload/finite
workflow behavior and authenticated per-source evidence while removing
redundant SQL work within trusted, short database operations. It derives
bounded work from authenticated tables and definitions rather than Product
names, benchmark IDs or a framework/module-name switch. Future Medusa modules,
workflows and Payload sources can use these core mechanics when separately
admitted; this result does not admit them. The same selected real-Worker
correctness and ordinary-PostgreSQL workloads now provide a complete cold
workflow series under the existing deadline. Fresh physical readiness checks
and historical per-row SQL remain; native ORM parity and the cause of the
original COMMIT delay are not established.

The original ordinary-role PostgreSQL series located repeated physical
search-readiness and table-frontier queries inside checked reads. Its mixed
workflow cold deadline failure remains a failed historical sample. The
complete corrected series shows lower median request cost and finishes the
selected cold workflow without raising the deadline. The independently
settling standalone workflow has fewer root obligations and is not a native
ORM parity baseline. The [benchmark guide](../../packages/flarex-backend/benchmarks/mixed-mutation-core/README.md)
retains exact sample counts, distributions, owner attribution, exclusions and
measurement limits; neither series isolates the original COMMIT-delay cause.

## Owner audit and bounded correction

The source audit located the repeated work in persistence and the trusted
logical working set. The bounded correction is implemented and its selected
private correctness and cost gates are closed. The affected internal call
graph is:

| Cost or boundary | Current owner and selected correction |
| --- | --- |
| Physical search-index identity repeated per definition | `logicalStorageReadiness.ts` calls `LogicalSearchBuild.inspect` in `logicalSearchBuild.ts`. That owner reads scoped definition coverage in 64-definition batches and, once needed, checks the selected JSON/text physical GIN kinds in one catalog projection per refresh. Missing or changed definitions still refuse in selection order. |
| Table frontier repeated per index, unique and search definition | `appRows.ts` reads distinct selected table frontiers in 64-table batches. `logicalStorageReadiness.ts` supplies only uncovered index tables when the first coverage decision needs them; `indexBuildStates.ts` ties the batch to its coverage context and exact transaction; `appUniqueConstraintSetBuildV1.ts` selects uncovered unique tables per eligibility refresh; `logicalSearchBuild.ts` consumes one frontier per selected table and refresh only after a selected definition reaches that check. |
| Repeated short checked reads | `logicalDocuments/workingSet.ts` groups bounded pending-row hydration, index/search candidates with missing-row hydration, and index-page hydration in each checked short transaction. The source-admission owner remains responsible for the fresh check on each operation; native callbacks and Worker execution remain outside it. |
| Journal, pending evaluation and publication | The source audit did not justify a new journal or publication path. Historical row observations still issue per-row SQL inside grouped transactions; the completed cost series leaves them as a residual rather than a blocker for this bounded correction. Preserve one invocation marker, receipt correlation, OCC and atomic publication. |
| Delayed COMMIT observation | The completed corrected series has successful cold workflow requests under the existing deadline. The original trace does not establish lock hold, server execution or a causal COMMIT defect. |

The owner audit selected these **bounded implementation contracts**:
`appRows.readAppTableWriteFrontiersInTransactionEffect` reads distinct table
frontiers in chunks of 64 through indexed `LATERAL` latest-pointer lookups,
retaining a per-table stored-value verdict for definition-order consumption.
Index and unique readiness request only uncovered, non-maintenance table
frontiers within each refresh. The index coverage context is constructed first;
its `readIndexCoverageTableFrontiersInTransactionEffect` operation runs lazily
at the first definition that needs a frontier. The context and batch are tied
to the same SQL transaction through the owner-held `WeakMap`. This retains
definition-order failure priority when an earlier state can already refuse.
`logicalSearchBuild.inspect` reads selected coverage states in bounded
64-definition scoped batches. Within each refresh it validates each batch in
definition order, then lazily checks the selected generic physical GIN kinds
in one catalog projection and loads distinct table frontiers only when a
definition reaches those checks. A known earlier refusal is not masked by a
later physical or frontier query failure. The trusted working-set owner groups
bounded hydration, index candidates and missing-row reads under one checked
short transaction, with explicit transaction ownership. Working-set capability
admission completes before the
checked read transaction opens, because admission may itself open a separate
short SQL transaction. Grouped internal readers consume the supplied admitted
transaction without independently invoking admission or opening another
transaction. The checked read still rechecks each pinned source inside its own
transaction for every operation and does not hold that transaction over a
native callback. The search selection comes from authenticated logical
definitions, including future Medusa, Payload and Application sources when
those sources are separately admitted. No frontier or physical proof is cached
across refreshes, phases or transactions.

A transaction-local projection may reuse validated facts only for the same trusted scope,
source set, binding heads, schema/build selection and observed clock where the
owning code proves equivalence. Every admitted source must still be checked
before a historical read; a changed source or index must refuse in a later
transaction. READ COMMITTED refresh, schema activation, concurrent publication
and the special pending-publication proof cannot silently reuse an earlier
view. Immediate authority checks remain in each transaction that accepts a
read or write. A trusted working-set operation may group its internal steps
only within one bounded short transaction; no native service call or workflow
callback as a whole becomes that transaction. No SQL transaction spans sandbox
execution, Medusa steps, Payload hooks, workflow callbacks, remote effects or
a pause.

Challenge the alternatives explicitly: per-definition SQL solely because
existing helpers each issue a query; caching authenticated readiness across
transactions; an adapter-side direct-SQL shortcut; one long transaction around
the workflow; raising the existing selected command deadline or root
limits; weakening a dependency, head, constraint or event check; and a generic
batching engine or new ledger. The first wastes measured work. The others
change authority, lifetime or ownership and are outside this approval.

## Contracts, compatibility and cleanup

Changes are **internal** persistence/readiness and working-set read contracts.
The new plural frontier reader serves batched index, unique and search checks;
the singular reader remains a real path for contribution validation,
intrinsic-creation-time activation, and individual index/unique coverage
decisions. Those callers are not compatibility wrappers and still need their
own observed frontier. The existing `readTransaction`/explicit-`tx` working-set
contract stays in place for its core, Medusa and Payload callers. No public
authoring or durable journal-format change is proposed.
The existing short transaction, scope-clock lock order, source binding, root
lease, selected resource/deadline profiles, journal receipt, replay and
uncertain-COMMIT outcome remain authoritative. No new table, column, codec,
index, source digest or data reset is expected. If evidence requires one, or
requires a new trust/transaction boundary, stop for a material preflight
revision and explicit approval, including named-data disposition.

Remove displaced per-definition search proof and duplicate frontier reads from
the affected refresh paths, with owner and consumer regression coverage. Keep
singular frontier reads for the concrete paths above. The pending-publication
proof still uses its distinct immutable-fact check rather than a batched
current-pointer frontier.
Do not retain compatibility wrappers, parallel readers, diagnostic logging or
benchmark-only runtime branches. Preserve the failed benchmark artifacts and
exclusion record; new measurements compare against them rather than
overwriting them.
Fresh physical search readiness and historical row observations remain. Any
further physical-proof optimization needs a separate focused cost and
correctness decision; this slice does not cache physical authority or make
future framework operations admissible.

## Proof and completion gate

These gates define the bounded correction now implemented; they do not
promote another framework operation, public API or hosted activation.

- Demonstrate identical source-head, schema/build, unique/index/search,
  dependency and pending-read decisions on PGlite and ordinary-role PostgreSQL.
  Include changed-head/index refusal between short transactions, a coverage
  miss or publication refresh, pending-publication state and concurrent writer
  evidence. Neutral multi-table selected definitions exercise bounded target
  SQL and scaling on both drivers; their control-catalog selection is isolated
  rather than independently compiled. Real independently compiled Product,
  Payload and three-source workflow sources provide the connected Worker
  consumer proof. These distinct witnesses show the generic persistence
  selection is not a Product-name branch without admitting a new framework
  capability. Add negative tamper and fresh-transaction refusal cases,
  then repeat the same trace shape after the correction to verify count
  scaling. A cache-hit test alone is insufficient.
- Preserve first-failure order, rollback-only poisoning, cancellation and
  connection cleanup, one-root settlement, exact journal/receipt/seal bytes,
  retry/replay and lost-COMMIT recovery. Show no SQL transaction survives a
  native callback or Worker boundary. Retain the original cold COMMIT
  diagnostic separately; do not turn that outlier into a causal claim.
- Rerun affected owner/consumer typechecks, builds, source guards, focused
  PGlite tests and isolated ordinary-role PostgreSQL transaction/concurrency
  tests. Rerun all four benchmark workloads with the same input graph and
  planned **3 warmups, 20 measured warm and 3 cold** samples each. Record every
  failure and unavailable metric separately. The original partial run and
  independently filtered standalone run remain distinct comparison evidence.
- Compare the complete corrected distribution and original partial record in
  the benchmark guide, including remaining physical readiness and historical
  read costs. No count target substitutes for correctness.
- Run `pnpm lint:core`, `pnpm lint:diff`, affected package checks and both
  project diff reviewers after the significant final code checkpoint; rerun
  reviews after substantive fixes. Update this preflight, the benchmark guide
  and roadmap to the observed final status, remove displaced code, and make
  one scoped commit only when the connected proof and acceptance gates pass.
