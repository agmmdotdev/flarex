# Shared Framework Transactions And Optional OCC Preflight

Status: accepted shared-core ownership direction with distinct execution
profiles. Named atomic composition and general mixed sandbox OCC are separate
capabilities requiring their own implementation contracts and proofs. This
note supersedes the earlier proposal that all-three tracked execution was the
required destination. It does not admit a new runtime, schema or public API.

Read the [integration direction](./flarexdb-framework-integration-direction.md),
[accepted execution profiles](../roadmaps/flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md)
and [transaction roadmap](../roadmaps/flarexdb-framework-integration/04-transactions-and-commit-publication.md).
The [workflow proposal](./flarexdb-medusa-workflow-execution.md) has independent
compatibility and durable-execution gates.

The [shared transaction core roadmap](../roadmaps/shared-transaction-core/README.md)
tracks implementation reconciliation against this accepted direction. The
bounded publication/recovery extraction and source ownership audit are complete.
Neutral physical resource ownership is implemented. The CMS participant /
shared Application materialization split remains proposed and awaits approval;
representative performance and overall completion gates remain open.

## Decision: Shared Core Guarantees, Distinct Execution

Both framework transaction paths must delegate shared guarantees to the core.
The `commerceTransaction` and `cmsTransaction` folders are profile adapters and
composition boundaries, not competing transaction or commit authorities.
Preserving their SQL execution semantics does not exempt them from shared core
ownership. Consolidate demonstrated duplication and remove displaced logic.

| Owner | Responsibility |
| --- | --- |
| Core transaction owner | Physical acquisition, bounded lifetime, COMMIT, rollback, cancellation and resource release |
| Core publication and recovery | Scope/generation authority, commit clock, complete typed facts, idempotent outcome, outbox and uncertain-settlement recovery |
| Native Application execution | Exact snapshots, authenticated journal, explicit dependencies, OCC validation and admitted retries |
| CMS adapter | Payload request identity, access/validation, supported hook order, nesting, pending-document semantics and error projection |
| Commerce adapter | Medusa manager propagation, checked query/repository translation, service results and domain capability admission |
| Workflow/Task owner | Committed steps, durable continuation, effect delivery, retry and compensation under its admitted contract |

Core sharing does not require one callback interpreter, identical state
representations, one new package, or a generic authority object exposing every
domain. Framework-specific preparation may remain while common guarantees
have one owner. Domain business rules stay behind their existing capabilities.

## Sandbox Security And API Atomicity

Sandbox isolation prevents raw database access. Atomicity defines which writes
settle together. OCC detects conflicts for a particular execution model.
Sandboxed callers do not imply that all trusted host commands need the native
logical journal.

```text
Sandboxed Application mutation
  -> native snapshot / tracked operations / OCC
  -> core materialization and settlement/publication

Explicit CMS or commerce command from an admitted coordinating context
  -> authenticated trusted host
  -> Payload or Medusa domain behavior through adapters
  -> core-owned bounded SQL transaction and settlement/publication
```

The proposed `ctx.cms` and `ctx.commerce` names do not admit public serving or
transaction composition. An action/task may coordinate independently committed
commands under an explicit API contract; its later failure cannot roll back a
completed command. Such an independently committing command must be rejected
inside an atomic native mutation unless actual participation is supported.

A named trusted composite command may settle admitted Application, CMS and
commerce contributions in one SQL transaction. That is a separate capability;
calling the current independent hosts sequentially does not implement it.
Arbitrary sandbox interleaving of all three APIs with one atomic outcome is a
stronger capability for which shared logical OCC may be appropriate.

Trusted framework built-ins and user-authored hooks have different trust
boundaries. No SQL transaction may span untrusted sandbox execution, arbitrary
user callbacks, remote effects or workflow suspension. A wrapper does not make
user code trusted. Admit supported hook location, lifetime and effects explicitly.

## Current Reuse And Concrete Consolidation Candidates

Both framework hosts use
[the relational session owner](../packages/persistence-postgres/src/relationalTransaction/session.ts)
and shared bounded request-lifetime mechanics. They preserve acknowledged
commit, rollback, cleanup failure and uncertain settlement as distinct outcomes.
Commerce executes SQL writes during service execution and captures authentic
row facts; CMS stages native documents while some lifecycle work, including
preference cleanup, executes inside the same bounded SQL transaction.

See the [commerce host](../packages/persistence-postgres/src/commerceTransaction/host.ts),
[CMS host](../packages/persistence-postgres/src/cmsTransaction/host.ts),
[CMS working set](../packages/persistence-postgres/src/cmsTransaction/documents.ts),
[preference cleanup](../packages/persistence-postgres/src/payloadPreferences/cleanup.ts)
and [commit owner](../packages/persistence-postgres/src/pointCommitTransaction.ts).
These paths already share substantial infrastructure. The
[completed extraction](../roadmaps/flarexdb-framework-integration/preflight/36-shared-publication-and-request-recovery.md)
gives common publication a private owner, moves commerce finalization to its
participant and shares framework uncertain-outcome routing. The native commit
module retains CMS preparation/materialization coupling. The
[completed audit](../roadmaps/shared-transaction-core/01-ownership-audit.md)
classifies that coupling and the artifact-owned physical driver dependency as
remaining replacements, with other boundaries explicitly retained or separately
gated. Neither a shared file nor this extraction alone proves reconciliation.
Do not replace the entire committer or invent work when existing ownership fits.

Keep existing scope-lock ordering and admitted isolation initially. Moving the
scope lock after business-row locks requires a separate concurrency proof
including native writers, activation, migration and cleanup.

## Settlement And Framework Compatibility

The default framework command authenticates scope, placement and capabilities;
enters its owned SQL transaction; executes admitted domain operations; closes
borrowed work; validates and publishes complete contributions; and settles once.
All participating data, required history/sidecars, facts, retained result and
outbox evidence commit atomically. Native Application retains its separate
tracked execution before commit validation/materialization.

Nested framework operations borrow the same command context and cannot settle
independently. Caught failures must not reopen a rollback-only command. Missing,
closed or foreign managers/request tokens must not fall back to standalone
access. Root Payload transaction support remains a separately proved adapter
capability; the current refusal of adapter-driven settlement must not become a
silent successful no-op.

Preserve Payload access and validation reads, supported `afterChange` timing,
pending visibility and nested Local API behavior. Preserve Medusa filters,
numeric values, links, constraints, failure timing and business locks. These
contracts remain meaningful with bounded SQL execution. Default consolidation
does not introduce automatic callback retries or discard the CMS working set.

Replay returns a retained committed result. A retry re-executes a confirmed
uncommitted operation under its explicit policy. Lost COMMIT acknowledgement
requires authoritative reconciliation, not blind callback retry. Preserve
request/contract identity across upgrades or explicitly refuse incompatibility.

Pre-commit external hooks are not made transactional by SQL or by OCC. Durable
intent adaptation requires an explicit semantic contract; moving all hooks
after commit is not compatible. Current local Product event buffers are a
compatibility proof, not durable business-event delivery. Reuse admitted
Task/effect owners rather than creating another delivery authority.

Writers affecting data already observed by native OCC must preserve native
revision, index/relation, dependency and commit-lane invariants. This applies to
CMS writes now. If tracked commerce reads are later admitted, every relevant
SQL writer must supply sufficient interoperability evidence or be fenced out.
A shared commit header alone is insufficient.

## Optional Named Atomic Composition

Choose a concrete command with one scope, physical placement, exact participant
bindings, bounded execution, one replay identity and one finalizer. Each
operation uses its domain capability; native materialization and framework
write policies remain enforced. A final-operation failure must leave no partial
rows, sidecars, facts, result or events.

Named composition can use shared SQL settlement without first implementing
general relational OCC. Extend the
[single commerce binding](../packages/persistence-postgres/src/frameworkSchema/binding/model.ts)
only when the selected command needs multiple installations. The
[relational fact reader](../packages/persistence-postgres/src/commitPublication/relationalFacts.ts)
currently validates a commit against one installation/layout; multi-installation
publication needs full-directory validation before participant projection.
Feed consumer support is another explicit capability, not an automatic result
of sharing a header.

Cross-scope or cross-database coordination uses committed steps and durable
effects. Compensation for a settled step is not rollback of an open transaction.
Whole workflows do not become atomic solely because modules are colocated.

## Optional General Mixed OCC

Select this branch only for an explicit general mixed-mutation/snapshot promise
or a demonstrated execution need. It is not required for sandbox security,
shared settlement or ordinary Payload/Medusa integration. Reuse the native OCC
owner where appropriate without fabricating Application grants or syscall
receipts for trusted framework commands.

The branch must prove exact relational snapshots and tombstones, historical
query access, absence/range/predicate dependencies, pending query visibility,
constraints, generated values, bounded retention and whole-command retries.
Filters, joins, counts and ordered pages must see snapshot plus pending writes;
a point cache or recording only returned row IDs is insufficient. Preserve
collation, null ordering and numeric/key codecs against the admitted SQL contract.

Compare typed companion histories with a shared revision store before selecting
DDL. PostgreSQL snapshots are not durable tokens after their exporter closes.
Neither physical option is selected by this note; do not add history tables
merely to make framework folders look uniform.

### Payload Lifecycle Compatibility Under Shared OCC

Only if this branch is selected, prove the real pinned Payload Local API with
access/validation reads, supported hooks, nested request reuse, conflicts and
late failure. Preserve hook arguments/order and pending visibility. An admitted
retry reruns the whole command with fresh request/attempt state, including
dependent native and Medusa work, rather than only final SQL or the CMS portion.
Email, payments and arbitrary callbacks are not inferred replay-safe.

The [pinned framework evidence](../roadmaps/flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md#source-evidence)
and current CMS profile remain the compatibility baseline. OCC feasibility must
be tested before migrating the rest of the frameworks onto that model.

## Schema And Logic Cleanup

There is no separate commerce/CMS transaction-session table family corresponding
to the two folders in the inspected static schema. Native sessions, journals
and snapshot leases remain native execution state. Framework installation,
migration and binding tables are control data; business payment/order records
named transaction are not engine metadata. Inspect actual deployed catalogs
and installations before deciding a deletion list.

| Component | Default disposition | Conditional change |
| --- | --- | --- |
| Scope clock, commit, idempotency, outbox | Retain shared authority | Consolidate proven duplicated writers/mechanics |
| Native sessions, journals and leases | Retain native guarantees | Generalize only for a selected tracked-execution consumer |
| CMS pending documents and commerce SQL store | Preserve supported semantics | Replace only when a proved capability actually supersedes them |
| Framework artifacts, installations, migrations, bindings | Retain | Extend bindings for selected composition; schema for selected capabilities |
| Relational and preference-deletion facts | Retain complete publication/lifecycle evidence | Migrate readers and retention before replacing representation |
| Temporary bridges and displaced wrappers | Remove with their replacement | Record exact consumer, reason and deletion gate while retained |

Preference-deletion evidence links the preference to an exact content revision;
ordinary relational change identities do not replace that contract. Any change
must cover the [retained-commit compactor](../packages/persistence-postgres/src/retainedCommitHistoryCompaction.ts)
and all readers. Payload drafts/business versions have a different retention
purpose from native OCC revisions.

Every approved replacement includes obsolete code, exports, codecs, schema and
temporary-path cleanup. Follow the accepted replacement policy: clean rebaseline
for unshipped disposable state; backed-up restartable transformation for durable
data without live traffic; only evidence-justified compatibility for shipped
obligations. Preserve unrelated legacy serving tables until their own retirement
gate. Default sharing alone requires neither new history tables nor a migration.

Keep runtime cleanup explicit: SQL rollback/release, uncertain-outcome recovery,
native lease/fence cleanup, and contractual commit/effect retention. Add relational
history cleanup only if that history capability is selected.

## Performance And Completion Gates

Shared ownership is not a performance result. Initially measure SQL counts,
transaction duration, scope-lock hold/wait, pool occupancy, tail latency and
throughput for unchanged framework cases, independent commands and hot keys.
Measure framework load alongside native OCC: the current native range validator
has a bounded commit window, so a shared scope clock creates cross-profile load
even when business rows differ. Preserve correctness while addressing measured
bottlenecks; neither raising limits nor moving locks is incidental cleanup.

Optional OCC may shorten the exclusive commit section but adds history,
dependency/overlay costs and repeated work. Compare identical constraints,
outputs, effects, load and database environments against agreed product budgets.
Use PGlite for fast functionality and genuine PostgreSQL for concurrency,
locking, recovery, migrations and query plans; report deployed Worker/Hyperdrive
evidence separately.

| Branch | Sequence and exit |
| --- | --- |
| Default shared ownership | Finish the agreed Product original-test handoff; refresh source/status; map actual duplication; consolidate a warranted bounded owner slice; preserve profiles and recovery; validate affected costs; remove only superseded logic/schema |
| Named composition | Select the concrete atomic operation; authenticate participants and shared settlement; extend bindings/fact consumption only as required; prove final-step rollback, recovery and performance |
| Optional mixed OCC | Select stronger API semantics; prove relational snapshots/queries and real Payload lifecycle early; prove mixed conflicts/retries and native preservation; measure costs; migrate and retire each displaced path |

Ordinary framework capability work is not blocked on optional mixed OCC or on
the separate workflow-runtime proposal. If the existing shared owner already
meets the needed guarantee, do not invent a refactor. Implementation still needs
its focused contract, unchanged framework assertions, affected failure/concurrency
proofs, required code reviews and cleanup. This documentation decision authorizes
none of the separate production, public API, reactive-query or unrestricted
framework compatibility claims.
