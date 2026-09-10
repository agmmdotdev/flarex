# Atomic Composition

## Status And Scope

Status: first source-private atomic-commerce capability implemented, validated
on PGlite and ordinary-role PostgreSQL, and reviewed. The separately approved module-lineage correction
is implemented. General native relational OCC remains unapproved. The
[folder index](./README.md) owns the overall process.

The accepted first integration foundation is a bounded trusted command over
the existing shared SQL transaction owner. Product and Currency participate
with pending reads, one outcome and bounded scope-lock contention.
Native Tasks are not a prerequisite. Relational OCC remains a separate
investment if composing admitted Application and commerce operations inside
one native mutation is a product requirement.

This preflight addresses execution ownership and its consequences for local
Graph Query and Medusa integration. It does not select a universal workflow
API, add commerce modules, or claim complete workflow compatibility.

The approved [Product-tag update capability](./12-product-tag-updates.md) extends
admission to one through eight explicitly selected participants as an authenticated
subset of the active commerce binding. Individual authority checks, whole-binding
replay evidence and the existing settlement owner remain unchanged.

The [Product-tag deletion capability](./13-product-tag-deletion.md) extends
successful outer-call observations with their already-captured native inputs.
Inputs and results are recursively frozen, charged by existing capture, and
retained only after participant validation. Nested calls do not create additional
outer observations. This is ephemeral event-validation evidence, not a journal,
persisted step checkpoint or change to settlement/replay formats.

## Product Decision

### Implementation Finding: Module Installation Lineage

Before the correction, the actual Product/Currency fixture installed Currency,
then attempted to
install Product into the same authenticated target. Reproduction:
`pnpm exec vitest run --config vitest.config.ts test/atomic-commerce.test.ts`
from `packages/medusa-adapter`. The initial PGlite run reached
`FrameworkMigrationCoordinatorError: Fresh plan conflicts with the current head`
in `prepareCoordinatorGraphInTransaction` before any business command runs.

Expected: independent module installations coexist under the same placement.
Actual: [DML lowering](../../packages/medusa-adapter/src/schema/lower.ts)
hardcoded `lineageId: "commerce"` for both modules. The
[migration coordinator](../../packages/persistence-postgres/src/migrationCoordination/freshCoordinator.ts)
correctly treats their different fresh artifacts as competing heads of the same
lineage. This is an adapter identity limitation, not evidence that the core
conflict check should be weakened. The initial source preflight missed it.

Bounded correction separately approved by the user after the shared-owner
preflight:

- Module schema capture supplies its stable lineage: `commerce.product` and
  `commerce.currency`. The generic DML lowerer does not select a module identity.
- Keep collision coordination, physical name reservation, migration-plan
  validation and commit ownership unchanged. Retain the test that competing
  fresh artifacts in one lineage conflict.
- Rebaseline these source-private module artifacts and profiles, and prove both
  installations through the real coordinator. No synthetic installation rows,
  bypasses or second transaction path in the fixture.
- This changes artifact/layout/installation identity and may change generated
  physical names. Do not relabel old immutable evidence or silently reopen old
  tables under new authority. Existing installed data is not migrated by this
  slice. A deployed old `commerce` installation would require a separately
  admitted migration before moving to the new profile; no deployment or such
  data migration is authorized here.

Current source search finds profile/schema preparation in the adapter and its
proof consumers, with no application-host caller. That is source evidence,
not an inventory of databases outside this checkout. Both installations now
succeed through the unchanged real migration coordinator, and the combined
command reaches business execution. Single-module regressions use the newly
captured artifacts. Existing deployed data remains outside this correction.

| Required promise | Consequence |
| --- | --- |
| A trusted, bounded business command operates across modules and settles once | Extend existing framework transaction participation; application callers require an explicit command invocation boundary |
| Application authors interleave native database and admitted Medusa calls inside one native mutation | Requires relational snapshots, journals, dependencies, retry and materialization, plus the corresponding runtime authority |

The first promise is the approved, implemented starting point. It does not
supply the second, even when both share a database and publisher.

Select execution semantics explicitly. An atomic command settles as one
bounded operation or fails. It must not silently become a Task, split into
committed steps, retry arbitrary callbacks, or gain another budget when it
calls a module. A durable workflow may later invoke atomic commands.

## Current Sources Of Truth

The [accepted architecture](../../design-notes/flarex-db-accepted-design.md#shared-framework-transaction-ownership)
and [shared-owner design](../../design-notes/flarexdb-commerce-occ-migration-preflight.md)
own cross-domain authority. They allow named trusted SQL composition and keep
general mixed OCC separate. Current implementation is evidence, not a reason
to reject a justified replacement.

Medusa compatibility follows [SOURCE.json](../../third_party/medusa/SOURCE.json):
fork revision 48d5cc675e4e8bc821e22c20c88a751acc66fb5f, package baseline 2.13.4.
Current public documentation explains semantics but does not replace this pin.
The source island remains reference-only until promotion gates pass.

| Inspected source | Finding and consequence |
| --- | --- |
| [Commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts) | Executes SQL in a bounded relational session, takes the scope clock lock before services run, and recovers retained outcomes. This is not native journal execution. |
| [Commerce publication](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) | Authenticated contribution consumption is already separate from finalization. Reuse it instead of adding another publisher. |
| [Composite host](../../packages/persistence-postgres/src/crossDomainCommand/host.ts) and [actual assertions](../../packages/medusa-adapter/test/currency-announcement.test.ts) | A fixed Currency/CMS/Application command has one physical owner, pending reads, combined facts, retained replay, late-failure rollback and physical-failure assertions. This does not establish a generic two-commerce-module host or application API. |
| [Binding model](../../packages/persistence-postgres/src/frameworkSchema/binding/model.ts) and [atomic admission](../../packages/persistence-postgres/src/atomicCommerce/admission.ts) | Format 2 admits an ordered set of at most eight commerce installations; the atomic host authenticates its nonempty selected subset. Existing standalone hosts select their own authenticated installation. |
| [Relational fact reader](../../packages/persistence-postgres/src/commitPublication/relationalFacts.ts) | Validates every fact against a caller-supplied directory of original captured installation layouts before returning a participant projection. Active bindings do not reinterpret old commits. |
| [Module definition](../../packages/medusa-adapter/src/module-definition.ts) | Checked definitions and fresh scoped services already exist. Preparation stays separate from request authority. |
| [Read execution](../../packages/medusa-adapter/src/query/read.ts) and [catalog](../../packages/medusa-adapter/src/query/catalog.ts) | Relation filtering, root selection, population, count and projection are reusable semantics; they do not produce native relational OCC dependencies. |
| [Native journal](../../packages/persistence-postgres/src/sessionJournalStore.ts) and [internal calls](../45-private-internal-user-code-calls.md) | Native calls share an attempt and overlay. These admitted native operations do not establish arbitrary relational query support. |
| [Application command invocation](../shared-transaction-core/06-application-command-invocation-preflight.md) | The Action-to-trusted-command boundary is proposed, not implemented. The private host is not an ordinary application API. |

The tests linked below establish the implemented private scope. There is no
measured SQL-versus-relational-OCC comparison; the second execution path does
not exist yet.

## Medusa Execution And Compatibility

The [composer](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts)
constructs a dependency graph and handler registry. The
[step handler](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/utils/composer/helpers/create-step-handler.ts)
resolves values and builds context from transaction/step state.
[LocalWorkflow](../../third_party/medusa/upstream/packages/core/orchestration/src/workflow/local-workflow.ts)
uses the orchestrator; the
[distributed transaction](../../third_party/medusa/upstream/packages/core/orchestration/src/transaction/distributed-transaction.ts)
checkpoints and schedules retries/timeouts when configured.

Replacing only the workflow-engine service does not replace that chain. Reuse
requires bounded extraction/adaptation of value resolution, step context and
definition registration. Bind definitions and hook sets to an admitted revision;
global registration by name does not establish revision or request authority.

The [Product creation step](../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/create-products.ts)
saves IDs for compensating deletes. Under an explicitly atomic profile, failure
aborts uncommitted work; those deletes must not run against changes that never
committed. This is an intentional execution difference. Preserve business
results and admitted hook semantics with source-based assertions.

The full [create-products workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-products.ts)
also depends on Sales Channel, Fulfillment, nested variants, Pricing, Inventory
and links through its call graph. It cannot be the first complete workflow
while module scope remains Product and Currency.

The smaller [create-product-tags workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-product-tags.ts)
is a useful later target, but includes a hook and workflow event.
[Workflow export](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/helper/workflow-export.ts)
releases/clears event groups, while the
[current Product module](../../packages/medusa-adapter/src/product-module.ts)
refuses those operations. Local event buffering and the commit wake outbox do
not establish durable grouped business events. Do not drop the event step to
claim original workflow compatibility.

## Alternatives And Recommendation

| Dimension | Existing bounded SQL composition | Native relational journal/OCC |
| --- | --- | --- |
| Settlement | One existing physical owner and publisher | Existing native validation/materialization and shared publication after relational participation is implemented |
| Pending reads | Scoped stores see uncommitted SQL changes | Exact snapshot plus pending relational changes for every admitted query shape |
| Conflicts | Preserve scope-lock ordering and bounded SQL isolation | Complete dependencies and safe whole-attempt retries |
| Application execution | Trusted host work; no SQL transaction across arbitrary sandbox callbacks | Admitted sandbox composition once runtime and relational contracts exist |
| Resource tradeoff | Connection and scope lock held during command | Shorter physical ownership is possible, with journal/history/validation work and whole-flow reruns |
| Immediate gaps | Multiple installations, aggregate closure/publication, caller admission, transaction-bound query composition | Those authority concerns plus relational snapshots, overlays, writer interoperability, retry and retention |
| Recommendation | First private foundation | Select for a stronger product requirement or demonstrated execution need |

PostgreSQL Serializable isolation is another possible concurrency technique
for trusted commands. It detects serialization anomalies but requires complete
transaction retries and does not retain a logical snapshot after closure.
It is not a drop-in setting change: lock ordering, relevant writers, replay
safety and publication must be proved together. Do not change isolation or
scope-lock discipline incidentally.

### Challenges To Both Choices

- SQL is a smaller change, not a measured performance winner. The current write
  command holds the scope clock FOR UPDATE during business execution; disjoint
  same-scope writers can contend.
- OCC is not automatically cheaper. Broad reads enlarge dependencies, and a
  late conflict can repeat all earlier work. Journal/history costs also matter.
- Internal modules can still belong to different scopes or physical placements.
  Atomic admission must bind one scope, generation and placement.
- Atomic database work does not solve human waits, long imports, durable event
  delivery, external hooks or business reservations spanning several commits.
- A clean authoring API must expose its atomic/durable guarantee even when
  construction and persistence details are hidden.

## Native Relational OCC Feasibility Boundary

If the stronger mixed-mutation promise is selected, prove one coherent vertical
through the existing native owners:

1. Admit a bounded relational query/write subset using checked model metadata.
   Do not promise arbitrary SQL or replace relational models with Application
   documents merely to reuse native point operations.
2. Supply exact snapshot reads, historical rows/deletions and pending query
   visibility. Row caches or lists of SQL strings are insufficient for filters,
   relation membership, counts and ordered pages after pending changes.
3. Track absence, predicate/range and relationship dependencies, including empty
   results. Conservative tracking may be correct but needs measured conflict
   cost. Recording only returned row IDs is insufficient.
4. Require compatible version/conflict evidence from every relevant writer, or
   exclude that writer. Preserve binding/schema activation, generated values,
   uniqueness and relationship constraints through existing commit ownership.
5. Define callback/hook replay, time/random, IDs and event-intent behavior.
   Retry the whole confirmed-uncommitted attempt with fresh services; reconcile
   uncertain commits before re-executing business work.
6. Include history retention, snapshot leases, cancellation and recovery.
   Compare existing native history and relational needs before selecting DDL.

PostgreSQL exported snapshots remain available for import only while their
exporter is open. Transactions importing the same snapshot do not see each
other's uncommitted writes. Exporting a token therefore does not supply
Flarex's durable snapshot or pending-state contract.

## Implemented First Coherent Capability

The source-private multi-installation atomic commerce command uses Product and
Currency with relation reads in the same transaction. It closes a shared
prerequisite while retaining the physical owner, lock order and retry policy.

The [proof command](../../packages/medusa-adapter/src/category-currency-atomic-command.ts)
uses real private internal services to create a Category parent, upsert/read a
Currency, create a Category child, then read the relation, count and Currency
before commit. Late failure after both participants write rolls back both.
This is a database conformance operation,
not a fabricated Medusa core workflow or cross-module foreign-key contract.

The event-free selection is grounded in
[internal Category assertions](../../packages/medusa-adapter/test/support/product-internal-category-checks.ts)
and [Currency's private participant](../../packages/medusa-adapter/src/currency-service.ts).
Internal Category calls deliberately omit the module event aggregator while
retaining write facts. Public Product operations still require their event
contract. Do not suppress public events or generalize the internal proof to
public workflow compatibility. Preserve profile-specific fact/event validation
at each participant's closure.

### Implemented Owner Changes

- Framework binding/admission: authenticate an explicitly selected bounded installation set,
  profiles and active frame/head. Keep deterministic installation lock order,
  scope/placement checks and table authority. The current persisted binding
  contract now has format 2: a bounded commerce array ordered strictly by
  installation digest. Format 1 remains decodable for immutable stored
  candidate and activation evidence; no bytes or digests are rewritten.
  [Migration 0090](../../packages/persistence-postgres/drizzle/0090_atomic-commerce-bindings.sql)
  adds installation identity to the physical-lane primary key, retaining rows.
- Commerce composition: issue borrowed participant contexts under one root
  lifetime. Children cannot settle, create independent outcomes, reset budgets
  or outlive closure. Pure definitions remain reusable; services stay scoped.
- Publication/readers: consume every expected closure once, assign one sequence
  and global fact order, publish one complete result/wake, and validate the
  complete fact set before participant projection. Preserve enough original
  binding evidence to interpret older commits after the active binding changes.
- Query execution: reuse catalog, relation and projection owners under the
  borrowed context. A child cannot call a standalone host that starts another
  transaction. A public Query facade is not required for this database proof.

Core contracts remain independent of Product and Currency names. Start with
existing normal budgets shared across participants, not scale-test allowances.
Refuse excessive work rather than silently splitting it into commits.

### Private Definition And Execution Boundary

[Definitions](../../packages/persistence-postgres/src/atomicCommerce/commands.ts)
hold opaque participant and command identities. The
[host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) registers
each participant with its authentic profile, installation, allowed commands and
required local event/fact validator. Definitions alone grant no installation or
transaction authority. Core registration contains no Product or Currency names.

An admitted root receives only `call(participant, command, args)` and
`refuse(error)`. Calls borrow the existing commerce context; each service bind
is fresh and every read uses the same physical transaction. No child receives a
session, publisher or commit method. This is the low-level trusted composition
contract, not a final workflow authoring API or application ingress.

The command keeps the ordinary aggregate call and byte limits, capped by the
strictest participating profile, a shared 64-statement quota across all stores,
a 256-fact ceiling, and the existing ten-second
business deadline. SQL statements retain one-second timeouts and lock waits
retain a 500-millisecond ceiling. Scale-profile allowances cannot enlarge the
atomic host's normal limits. Unsupported parallel work and emitted events are
refused. All participant admissions stay live until one existing finalizer
consumes their closures, with facts ordered by execution rather than module.

### Failure, Replay And Invocation

A participant failure makes the entire command rollback-only, even if caught.
No child savepoints or partial-step retries are introduced. Parallel graph
syntax must not create concurrent operations on this serialized owner; refuse
unsupported execution rather than silently changing its ordering.

One request identity binds command, inputs, authority and selected bindings.
Replay returns the retained result without callbacks. Changed intent conflicts;
expired results stay explicit. Lost commit acknowledgement uses authoritative
recovery rather than blind callback replay.

Application ingress and cross-process recovery after binding movement remain
with the [caller preflight](../shared-transaction-core/06-application-command-invocation-preflight.md).
The private host's in-invocation recovery does not establish either capability.
A later Action calling this command has an independently committed child;
failure after that child returns cannot undo it.

### Reuse And Removal Inventory

| Owner or path | Disposition |
| --- | --- |
| Physical session, bounded lifetime, clock, publisher and outcome recovery | Keep and compose; introduce no competing settlement or recovery ledger |
| Medusa services, metadata, module definitions and read semantics | Keep; extend scoped binding rather than bypassing services with direct table writes |
| Single-commerce admission assumptions and whole-commit fact reader | Extend for exact installation sets; switch consumers and remove displaced duplicate mechanics |
| Standalone commands and Currency/CMS/Application command | Keep intentional guarantees and regressions; avoid an unrelated CMS migration |
| Native journal/OCC | Keep unchanged in the recommended first capability |
| Medusa composer, callbacks and value machinery | Reference now; port/adapt the needed source closure during workflow integration with provenance |
| Medusa orchestration storage, Redis/BullMQ providers and scheduler | Do not introduce for atomic execution; there is no active Flarex workflow runtime here to delete |
| Any temporary bridge introduced later | Record its consumer and removal condition; no permanent dual writes, publishers or silent fallback |

Fixtures alone do not create a shipped compatibility obligation. Inspect durable
data and issued binding contracts before selecting clean replacement, one-time
migration or a justified compatibility decoder.

## Local Graph Query Consequences

The pinned [portable graph runtime](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts)
maps entity aliases and fields to
[local list-and-count calls](../../third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/direct-entrypoint-query.ts).
This is a reuse seam, not full cross-module join execution. Its graph path
ignores the separate options argument, forwards its limited pagination fields,
and requires another adapter for query.index.

A Flarex facade should validate its supported subset, bind calls to the current
command, and refuse unsupported options instead of silently ignoring them.
Reuse filters, relations and serialization. Metadata grants no table authority
and creates no Module Links; two module entry points are not a cross-module join.

Under SQL composition, Graph Query uses the command transaction. Under a future
native profile it must use the attempt snapshot, overlay and dependencies.
Neither path may cache results across attempts or independently acquire a
transaction inside a graph traversal.
[Topic 06](./06-local-graph-query.md) owns the implemented private graph contract.

## Convex Compatibility And Flarex Divergences

The checked-in [Convex mutation context](../../../../npm-packages/convex/src/server/registration.ts)
documents nested queries in the same transaction and mutations with child
rollback. Flarex's [native internal calls](../45-private-internal-user-code-calls.md)
share a journal but have no child savepoint: caught application-owned errors
retain earlier staged writes. Neither behavior silently defines Medusa recovery.

The recommended trusted command uses rollback-only participant failure and no
automatic callback retries. It retains the accepted framework execution profile
and does not extend native mutation context or sandbox guarantees.

## Conformance Evidence And Remaining Gates

| Proof | Required observation |
| --- | --- |
| Real participants | Product and Currency share a physical transaction; pending changes from both are visible before settlement |
| Queries | Parent/child changes, filters, count and bounded ordering agree with admitted existing service behavior before commit |
| Publication | Complete facts from both installations; one sequence/header, retained result and wake; no child outcome |
| Failure | Late validation/SQL/publication failure, caught participant failure, cancellation and limits leave no partial business/publication state |
| Authority | Refuse wrong/missing/duplicate installation, scope, placement, head, profile, copied context and detached work; decode old commits using original binding evidence |
| Concurrency/recovery | Real PostgreSQL connections cover duplicate keys, same-scope contention, native overlap, binding/availability changes and lost commit acknowledgement without callback replay |
| Compatibility | Retain original Product/Currency and existing composite/native assertions; keep public events distinct from the internal event-free fixture |
| Bounded contention | An ordinary-role PostgreSQL command blocked on the scope clock fails within its configured lock bound without entering business code; duplicate requests execute the callback once |

Use PGlite for fast functionality and ordinary-role PostgreSQL for isolation,
locking and recovery. Refresh the relevant baseline before changing shared
owners. Implementation needs affected typechecks, lint gates and both standing
reviewers. Worker/Hyperdrive validation belongs to the later admitted host path;
nothing here establishes deployment or production readiness.

The [atomic suite](../../packages/medusa-adapter/test/atomic-commerce.test.ts)
exercises the real participants, pending relation/count results, one global fact
order and retained outcome, late and caught refusals, aggregate budgets,
detached contexts, cancellation, rejected overlap, publication-stage failures,
corruption outside a requested projection, binding movement, disjoint native
journal coexistence, and lost acknowledgement recovery. The retained
Currency/CMS/Application composite proves the native overlap-conflict assertion.
PostgreSQL-specific cases use
independent connections and verify duplicate keys, lock contention and recovery
on a fresh backend. The
[binding value tests](../../packages/persistence-postgres/test/frameworkDataBindingValues.test.ts)
pin both persisted formats and reject malformed sets. The existing
[binding lifecycle](../../packages/persistence-postgres/test/frameworkDataBindings.test.ts)
and [ordinary-role PostgreSQL lifecycle](../../packages/persistence-postgres/test/frameworkDataBindings.postgres.test.ts)
retain activation, physical evidence and replay checks.

Compatibility remains pinned by the original internal/public Category suites,
Currency live integration tests, Product local/query tests and the existing
Currency/CMS/Application command. Internal Category projection envelopes and
public event assertions remain unchanged. The module schema tests explicitly
pin their new stable lineages and captured artifacts.

Broader performance validation remains open: statement totals, connection
occupancy, scope-lock hold time, p50/p95/p99 latency, throughput and cleanup under
cold/warm, same-scope disjoint/hot-key and multi-scope load need explicit budgets
and repeatable measurements. The conformance suite's elapsed-time diagnostics
are individual observations, not throughput or percentile evidence. This is a
private functional foundation, not completion of the shared owner's performance
or production gates.

Do not build two production engines merely to compare them. Measure the SQL
baseline first. If mixed-mutation semantics are required, or measured resource
ownership motivates replacement, select a bounded relational OCC vertical with
the same logical workload and invariants. Establish performance budgets before
interpreting results. Uncoordinated read-committed SQL is not an equivalent
baseline for serializable native execution.

The private [Local Graph Query capability](./06-local-graph-query.md) now binds
checked module reads to this context and shares its existing limits and replay.
The first original Medusa workflow also depends on the proven execution owner.
Grouped durable events remain necessary for that workflow. Their dispatcher
can reuse native delivery capabilities without making the atomic command a
durable Task. Task continuations and resource leases follow only when needed
by a selected workflow.

## External Primary References

- [Medusa workflow constraints](https://docs.medusajs.com/learn/fundamentals/workflows/constructor-constraints): composition builds a representation; runtime values and conditions use composition primitives.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): read-your-writes, snapshot distinctions and serialization retries.
- [PostgreSQL snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION): snapshot export lifetime and pending-write isolation.
- [Convex mutations](https://docs.convex.dev/functions/mutation-functions): atomic writes, deterministic execution and separate external-effect actions.
