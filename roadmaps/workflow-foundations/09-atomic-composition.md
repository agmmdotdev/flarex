# Atomic Composition

## Status And Scope

Status: source-based architecture preflight complete; recommendation for
discussion. Implementation and general native relational OCC remain unapproved.
The user supports comparing the alternatives before deciding. The
[folder index](./README.md) owns the overall process.

Recommend a bounded trusted command over the existing shared SQL transaction
owner as the first integration foundation. Extend participation to Product and
Currency, preserve pending reads and one outcome, and measure contention.
Native Tasks are not a prerequisite. Relational OCC remains a separate
investment if composing admitted Application and commerce operations inside
one native mutation is a product requirement.

This preflight addresses execution ownership and its consequences for local
Graph Query and Medusa integration. It does not select a universal workflow
API, add commerce modules, or claim complete workflow compatibility.

## Product Decision

| Required promise | Consequence |
| --- | --- |
| A trusted, bounded business command operates across modules and settles once | Extend existing framework transaction participation; application callers require an explicit command invocation boundary |
| Application authors interleave native database and admitted Medusa calls inside one native mutation | Requires relational snapshots, journals, dependencies, retry and materialization, plus the corresponding runtime authority |

The first promise is the recommended starting point. It does not supply the
second, even when both share a database and publisher. The first-release
requirement remains for discussion; this recommendation does not silently
narrow an accepted mixed-mutation promise.

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
| [Binding model](../../packages/persistence-postgres/src/frameworkSchema/binding/model.ts) and [admission](../../packages/persistence-postgres/src/commerceTransaction/admission.ts) | The active frame admits one commerce installation. Constructing Product and Currency services with the same manager cannot bypass that limit. |
| [Relational fact reader](../../packages/persistence-postgres/src/commitPublication/relationalFacts.ts) | Validates the entire commit against one installation/layout. Multi-installation publication requires full validation before participant projection. |
| [Module definition](../../packages/medusa-adapter/src/module-definition.ts) | Checked definitions and fresh scoped services already exist. Preparation stays separate from request authority. |
| [Read execution](../../packages/medusa-adapter/src/query/read.ts) and [catalog](../../packages/medusa-adapter/src/query/catalog.ts) | Relation filtering, root selection, population, count and projection are reusable semantics; they do not produce native relational OCC dependencies. |
| [Native journal](../../packages/persistence-postgres/src/sessionJournalStore.ts) and [internal calls](../45-private-internal-user-code-calls.md) | Native calls share an attempt and overlay. These admitted native operations do not establish arbitrary relational query support. |
| [Application command invocation](../shared-transaction-core/06-application-command-invocation-preflight.md) | The Action-to-trusted-command boundary is proposed, not implemented. The private host is not an ordinary application API. |

Existing decisive tests were inspected, not rerun for this documentation
preflight. There is no measured SQL-versus-relational-OCC comparison; the
second execution path does not exist yet.

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

## Recommended First Coherent Capability

Deliver one source-private multi-installation atomic commerce command using
Product and Currency, with relation reads in the same transaction. This closes
an actual shared prerequisite and creates a representative SQL baseline.
Preserve the current physical owner, lock order and retry policy.

Use existing real private internal service paths: upsert/read one Currency;
create a small Product category parent/child structure; read the category
relation and count before commit; return a bounded result. Exercise a late
failure after both participants write. This is a database conformance operation,
not a fabricated Medusa core workflow or cross-module foreign-key contract.

The event-free selection is grounded in
[internal Category assertions](../../packages/medusa-adapter/test/support/product-internal-category-checks.ts)
and [Currency's private participant](../../packages/medusa-adapter/src/currency-service.ts).
Internal Category calls deliberately omit the module event aggregator while
retaining write facts. Public Product operations still require their event
contract. Do not suppress public events or generalize the internal proof to
public workflow compatibility. Preserve profile-specific fact/event validation
at each participant's closure.

### Required Owner Changes

- Framework binding/admission: authenticate an exact bounded installation set,
  profiles and active frame/head. Keep deterministic installation lock order,
  scope/placement checks and table authority. The current persisted binding
  contract changes; its decoding/migration disposition belongs to this
  capability. No physical DDL or exact format is selected by this discussion.
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
[Topic 06](./06-local-graph-query.md) retains the exact API preflight.

## Convex Compatibility And Flarex Divergences

The checked-in [Convex mutation context](../../../../npm-packages/convex/src/server/registration.ts)
documents nested queries in the same transaction and mutations with child
rollback. Flarex's [native internal calls](../45-private-internal-user-code-calls.md)
share a journal but have no child savepoint: caught application-owned errors
retain earlier staged writes. Neither behavior silently defines Medusa recovery.

The recommended trusted command uses rollback-only participant failure and no
automatic callback retries. It retains the accepted framework execution profile
and does not extend native mutation context or sandbox guarantees.

## Completion Evidence And Decision Gates

| Proof | Required observation |
| --- | --- |
| Real participants | Product and Currency share a physical transaction; pending changes from both are visible before settlement |
| Queries | Parent/child changes, filters, count and bounded ordering agree with admitted existing service behavior before commit |
| Publication | Complete facts from both installations; one sequence/header, retained result and wake; no child outcome |
| Failure | Late validation/SQL/publication failure, caught participant failure, cancellation and limits leave no partial business/publication state |
| Authority | Refuse wrong/missing/duplicate installation, scope, placement, head, profile, copied context and detached work; decode old commits using original binding evidence |
| Concurrency/recovery | Real PostgreSQL connections cover duplicate keys, same-scope contention, native overlap, binding/availability changes and lost commit acknowledgement without callback replay |
| Compatibility | Retain original Product/Currency and existing composite/native assertions; keep public events distinct from the internal event-free fixture |
| Cost | Statement count, connection occupancy, scope-lock hold/wait, p50/p95/p99 latency, throughput, failures and cleanup for cold/warm, same-scope disjoint/hot-key and multi-scope work |

Use PGlite for fast functionality and ordinary-role PostgreSQL for isolation,
locking and recovery. Refresh the relevant baseline before changing shared
owners. Implementation needs affected typechecks, lint gates and both standing
reviewers. Worker/Hyperdrive validation belongs to the later admitted host path;
nothing here establishes deployment or production readiness.

Do not build two production engines merely to compare them. Measure the SQL
baseline first. If mixed-mutation semantics are required, or measured resource
ownership motivates replacement, select a bounded relational OCC vertical with
the same logical workload and invariants. Establish performance budgets before
interpreting results. Uncoordinated read-committed SQL is not an equivalent
baseline for serializable native execution.

The next recommended implementation is the private atomic commerce foundation.
Local Graph Query and the first original Medusa workflow build on its context.
Grouped durable events remain necessary for that workflow. Their dispatcher
can reuse native delivery capabilities without making the atomic command a
durable Task. Task continuations and resource leases follow only when needed
by a selected workflow.

## External Primary References

- [Medusa workflow constraints](https://docs.medusajs.com/learn/fundamentals/workflows/constructor-constraints): composition builds a representation; runtime values and conditions use composition primitives.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): read-your-writes, snapshot distinctions and serialization retries.
- [PostgreSQL snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION): snapshot export lifetime and pending-write isolation.
- [Convex mutations](https://docs.convex.dev/functions/mutation-functions): atomic writes, deterministic execution and separate external-effect actions.
