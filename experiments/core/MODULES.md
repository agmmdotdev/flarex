# Replaceable modules

Status: initial candidate ownership map and continuing modularity/reuse rules,
carried forward under the accepted [existing-core refactor](./engine/REFACTOR.md).
The [open-question queue](./engine/OPEN-QUESTIONS.md) governs successor decisions
for shared snapshots, caches, coordination and recovery. This map does not
freeze the initial APIs, lifetime, schema or hosting. These are responsibilities, not
instructions to create one package, interface, service or directory per row.
Implement a boundary when an approved connected operation uses it.

The [DO execution proposal](./engine/01-do-execution-and-replicas.md) co-locates
several of these responsibilities while keeping their portable contracts distinct.
It proposes additional committed-cache lifetimes alongside private attempt state;
it does not prescribe a package per owner or preserve old bridge APIs.

## Ownership map

| Module | Owns | Must not own |
| --- | --- | --- |
| Definitions | Immutable schema/source compilation, codecs and required query capabilities | Database access, live readiness, request identity |
| Installation | Physical structure, protected writers, generations, maintenance/reopen | Per-operation business execution |
| Access policy | Typed authorization and readiness requirements; pure verdicts from complete observations | SQL construction, connection checkout, framework hooks |
| Query | Bounded point/page/count/existence/relation/aggregate contracts, lowering and dependency requirements | Session admission, physical catalog probing, commit |
| Attempt | Profile-specific logical lifetime, indexed original/pending state, dependencies, budgets and sticky failures | Driver/SQL implementation, native business rules |
| Storage | PostgreSQL/PGlite operation execution, fresh gates, snapshots and bounded result decoding | Framework callbacks, workflow orchestration, independent child commit |
| Settlement | Commit candidate validation/planning, atomic materialization/outcomes and uncertain-result resolution | Native services, runtime hosting, per-read construction |
| Physical session | Checkout, deadlines, cancellation/draining/quarantine and release | Schema/readiness policy, business transactions |
| Framework bridges | Payload/Medusa contract translation and native lifecycle integration | New integrity rules, direct SQL, alternate recovery |
| Host | Runtime, Worker/Node transport, configuration and resource construction | Domain policy and committed-data authority |

Storage and settlement share SQL/physical primitives through their real lower
owner. Installation is the exclusive structural writer; settlement is the
exclusive business commit owner for its execution. Do not duplicate policy
between modules or give each module its own admission transaction.

A module boundary does not prescribe a database round trip, resource scope or
fresh validation pass. Query, policy and storage can compose into one accepting
operation. Keep narrow semantic contracts stable while algorithms, physical
representations and batching remain replaceable. A guarantee change still needs
an explicit contract change; generic callbacks/options are not an escape hatch.

## Dependency direction

```text
host composition
  -> native framework bridges / Application execution adapter
  -> explicit direct-read, direct-command or mixed-attempt owner
       -> definitions + query + access-policy contracts
       -> storage operation contract
       -> settlement contract (write profiles only)

PostgreSQL implementations
  -> those narrow domain contracts
  -> physical session + driver + installed SQL

installation
  -> immutable definitions + physical session + controlled DDL
```

The host supplies implementations. Pure query/policy modules do not import a
driver, SQL builder, runtime host, framework package or global service locator.
Avoid importing a public barrel that eagerly constructs the active runtime.
Keep types with their owning contract; a catch-all `contracts.ts` is not an owner.

## Framework reuse and integration replacement

The target is the existing core refactored with selectively adapted integrations.
Use the old integration twice: to discover semantic requirements and to reuse
implementations whose responsibilities remain valid. Reading existing behavior
and then rewriting all of it is not the default. Starting from scratch applies
to freedom over core mechanisms, not to discarding native business logic, sound
framework translation or the integration knowledge already captured in tests.

Choose reuse, adapt or replace for each connected path. Reuse a dependency-safe
implementation directly when its contract fits. Adapt a narrow binding, or
separate portable behavior from core coupling when necessary. Replace a mechanism
when a traced dependency would preserve unwanted ownership, repeated work or the
old execution sequence. A file's age or adapter location is not sufficient reason
to replace it; a smaller diff is not sufficient reason to preserve its coupling.

Inject the candidate through native service/repository/database-adapter contracts
where they permit the new execution model. Revise Flarex's core-facing bindings
where they do not. Keep framework lifecycle obligations explicit, and audit the
actual dependency graph before reuse so a convenient import does not pull the
active admission, working-set, transaction or recovery machinery into the candidate.

The current integrations are a requirements reference, not an internal API to
preserve. Read them to discover the actual supported Payload/Medusa behavior,
native lifecycle ordering, result/error contracts, durable identities/data and
failure scenarios. Check those findings against executing native sources and
named consumers. Existing plumbing or tests alone do not establish an obligation.

For each integration requirement record its semantic owner and witness separately
from the current mechanism. Replace old working-set, manager/context, repository,
workflow-host and settlement interfaces when needed. Do not carry repeated
admission/readiness checks, framework-to-core handoffs, row rescans, per-call
construction or SQL visits into the candidate merely to keep old glue compatible.
Fresh authority and actual native behavior still need proof in the new design.
The current stage records the redesign and does not edit active integration
code. Later selected scopes migrate existing bridges at their actual owners;
they need not preserve old contracts or recreate all native coverage here.

Separate Medusa business behavior from Flarex's adapter execution machinery:

| Layer | Intended treatment |
| --- | --- |
| Native models, services, workflow definitions and steps | Reuse their executing implementations and behavioral witnesses; do not rewrite business algorithms for the candidate |
| Module-specific normalization, projection and genuine domain extensions | Reuse where their contract remains correct; distinguish these semantics from embedded core plumbing |
| Repository bindings, manager/context translation and query handoff | Rebind, simplify or replace against experimental core contracts |
| Workflow host/resources/execution bridge | Replace the old-core coupling where necessary while retaining native workflow semantics |
| Working set, pending state, contribution capture and atomic lifetime | Redesign under the Attempt and Settlement owners, shared across consumers as their profiles permit |
| Physical schema and SQL operations | Choose structures and operations that support the new lifecycle |

This is not assumed to be a drop-in database-provider swap. Current repositories
bind `CommerceCommandContext`, and workflow integration binds
`AtomicCommerceContext` and installed participant resources. The restricted native
Workflow SDK's `WorkflowExecutionPort` is an existing seam to inspect, not proof
that every workflow adapter already has a storage-neutral boundary.

Optimize for reuse of business behavior, not minimum adapter file changes.
Explicitly migrate each experimental bridge rather than emulate old admission,
working-set or settlement APIs around the new core. The eventual target is that
a storage/readiness implementation change leaves native module and workflow
business logic untouched. Achieving that target may first require material
repository and workflow bridge changes; measure and prove the connected result.

Evaluate Medusa repository/service binding reuse for one root instead of rebuilding
the same graph for every module call. Retain per-call cancellation, failure and
mutable service ownership; prove that reused instances do not leak request state.
Preserve native count/population ordering: `find-and-count` cannot move a count
across a callback when that changes observable behavior. Payload request nesting
and mutable population results remain framework-owned, with copies where needed.

## Four important handoffs

1. **Prepared definitions:** installation compatibility plus exact selected
   definition identities and immutable compiled mechanics. They contain no live
   transaction or cached permission verdict.
   Replacing a schema compiler should not change connection handling.
2. **Read demand/result:** a bounded trusted plan and root binding in; accepted
   rows/projections/scalars, exact dependencies and resource consumption out.
   Physical SQL layout and diagnostic observation packets stay inside storage.
   Unknown driver data is decoded there. The result cannot be replayed under
   another root/snapshot.
3. **Commit candidate:** detached effects, original dependencies, provenance,
   native result/event intent and request identity. It conveys intent, not a
   right to commit. Settlement freshly authenticates it and owns the decision.
4. **Physical execution:** storage/settlement invoke a narrow scoped DB operation.
   The resource owner guarantees deadline and completion handling; raw clients
   never escape to native code or application callbacks.

Define distinct direct and mixed contracts when their guarantees differ. Do not
hide nullable snapshots, optional finalizers and unrelated authority fields in
one universal request object. Borrowed participants cannot substitute a direct
execution implementation if the outer root fails.

## Root-owned indexed state

The Attempt owner maintains the following relationships incrementally. These are
logical structures; choose concrete maps/trees only when the required operation
and measurements justify them. Do not create a second mutable document store in
each bridge or keep derived maps with independent update authority.

| Structure | Key and contents | Update/invalidation rule |
| --- | --- | --- |
| Original observations | Scoped table/row identity -> exact original value/version or absence | Capture once under the root's snapshot; later edits never overwrite the original. |
| Current values | Same identity -> current value or deletion, plus mutation revision | Coalesce repeated edits while retaining native-visible intermediate behavior and required event intent. Canonical values have one owner; framework mutation uses isolated copies. |
| Table membership | Table -> observed/current and changed identities | Maintain on observation, insert, replacement and deletion; selective operations do not scan other tables' retained rows. |
| Unique ownership | Definition/version plus canonical locale/key -> current owner or explicit collision | Maintain claims/releases for every relevant observed or changed row; detect conflicts at the required operation boundary. Include compound/null/soft-delete rules from the admitted definition. Database acceptance still enforces concurrent claims. |
| Ordered membership | Required index/version -> pending additions/removals and ordered keys | Merge relevant deltas with the original snapshot page, including tie-breakers and lookahead. Compute only required indexes; charge lazy construction if used. |
| Dependencies | Point/absence, predicate/range/page and consumed metadata observations | Preserve enough evidence for the actual result. Deduplicate equivalent evidence without widening away correctness or dropping negative/phantom observations. |
| Change selection | Changed fields/definitions and affected index/unique/reference plans | Recompute affected derived state on each edit. Unchanged-key skipping needs a defined integrity/repair contract, not only a field-name comparison. |

One mutation operation updates canonical state and all affected derived structures
coherently. A failed transformation cannot leave maps partially updated. Retain
sticky failure where required; nested rollback, if the admitted native profile
requires it, must restore all derived structures together rather than simulate an
independent commit. No mutation is permitted after freeze.

Any cached computation over pending state records its relevant mutation revision
or is invalidated by the owner. A second edit, delete/recreate, key release/reclaim
or nested change must not reuse an obsolete count, projection or unique claim.
Do not create a broad cache of mutable authorization/readiness verdicts.

For supported predicates, exact count can use:

```text
visible count = original-snapshot count
              + sum over relevant changed identities
                  (matches(current) - matches(original))
```

Absence/deletion contributes zero, and each identity contributes once regardless
of edit count. The base result needs complete predicate/phantom evidence; deltas
use the identical predicate, visibility and value semantics. This permits a scalar
path without full document-result construction, not without bounded database work.
Joins/aggregates need their own proven delta semantics; do not apply the formula
to unsupported shapes.

For SQL predicate evaluation, transport only the needed pending delta when the
chosen plan permits it. Do not persist every local edit just to query it, echo
the entire retained root, or assume session-local temporary state survives across
pooled short transactions. Include encoding and transfer in the cost model.

Target expected constant-time local unique ownership lookup per claim, subject to
key construction and declared hashing assumptions. Ordered membership has its own
complexity. Charge retained originals, maps, keys, dependencies and maintenance
against root memory/work limits; prove behavior across growing batches.

## Failure ordering and replacement contracts

| Boundary | Replacement rule |
| --- | --- |
| Authorization/disclosure, native callbacks and external effects | Preserve the admitted ordering and fail before a forbidden action. |
| Native business errors, constraint timing and compensation | Preserve supported observable behavior, including caught failures and root poisoning. |
| Internal encoding/corruption checks and physical row order | Identify the invariant and any durable/public obligation separately from the old algorithm. A documented replacement may change precedence when equivalent integrity and refusal are proved. |
| Settlement/result/event/outcome publication | Preserve atomicity and uncertain-outcome recovery; batching cannot turn partial acceptance into success. |

Do not reproduce a whole-root scan merely because it currently determines which
internal malformed-row error appears first. Equally, do not remove per-item
acceptance checks without replacing their invariant. Record original/required/new
ordering, the named obligation, and a witness before changing it; unresolved
barriers stay preserved. Existing tests alone neither authorize deletion nor make
an incidental sequence a permanent compatibility contract.

## Separate policy from observation without weakening enforcement

For each check, record three pieces: what must be true, which state establishes
it, and where freshness is enforced. A pure readiness function can be tested
with observations; only the storage owner may produce an accepted read result.

For gates that must prevent row transfer inside PostgreSQL, enforcement stays
inside the accepting SQL operation. Select one authoritative policy definition:
either execute it in installed SQL, or compile it from the domain definition.
Do not maintain independent handwritten SQL and TypeScript policy algorithms.
The TypeScript result decoder validates the protocol and maps outcomes; it must
not replay a second implementation of the entire gate. Differential witnesses
check any compiled policy against its source contract.

An initial implementation may retain two dependent database visits when a native
callback makes that necessary. Describe that obligation instead of hiding it
behind an interface. Every visit must have a purpose in the operation trace.

## Replacement examples and expected change surface

| Experiment | Expected edits | Regressions that must stay unchanged |
| --- | --- | --- |
| Replace readiness storage with generation/eligibility records | Installation, storage gate, shared observation contract if necessary | Unrelated-index independence, revocation, maintenance races, query-required readiness |
| Replace row-by-row capture with bounded query execution | Query lowering and storage implementation | Native results, visibility, exact negative/range dependencies, limits and error ordering |
| Replace repeated pending-row scans with maintained indexes | Attempt-owned structures and their query/settlement consumption | Original/current consistency, claim release/reclaim, pending visibility, rollback and resource bounds |
| Change SQL layout/index organization | Installation and storage/settlement lowerings | Logical query/commit contract suite and all connected consumers |
| Change commit batching | Settlement and its SQL owner | Atomic outcomes, concurrent conflicts/uniques/references, failure barriers and unknown COMMIT |
| Change driver/resource strategy | Physical session and host construction | Cancellation, pending work, quarantine, cleanup and settlement uncertainty |

If every change requires editing all modules, stop and fix the boundary. Do not
make the contracts generic enough to accept arbitrary policy or raw SQL merely
to avoid explicit edits. A real guarantee change should require consumer work.

## Proving replaceability before expanding coverage

Treat replaceability as an executable requirement, not an inference from module
names. For observation batching or commit-execution changes, record the existing
trace, required guarantees, responsible owners and expected consumer changes.
Keep implementation changes concentrated in those owners and necessary explicit
handoffs; preserve native business behavior and unrelated lifecycle ownership.
Run the same owner and connected consumer witnesses against the replacement.
If a mechanism change spreads through unrelated modules, correct that boundary
before broadening coverage. A real guarantee change still needs its own contract;
modularity does not promise that every bottleneck is implementation-only.

The initial candidate serializes acceptance under a per-scope clock lock. That
is baseline evidence and a capacity risk, not a required successor algorithm or
measured throughput ceiling. The active ownership/acceptance concept may redesign
it with explicit visibility, concurrency and recovery evidence. Existing enforcement
continues until its replacement is selected and proved. Use the
[representative-flow gate](./VALIDATION.md#representative-flow-and-replacement-gate)
to decide whether local execution changes suffice before expanding integrations.

## Testing and iteration mechanics

- Keep reusable behavioral witnesses beside the owning contract. Run the same
  suite against each admitted implementation; real database proofs use both
  PGlite and ordinary-role PostgreSQL.
- Keep failure injection at named lifecycle boundaries in test composition.
  Do not embed a shadow admission/settlement engine in a fake storage adapter.
- Select candidate implementations explicitly in the experimental runner. No
  production feature flag, automatic fallback or dual write is introduced.
- Retain one accepted experimental default. Preserve rejected variants as small
  reproducible patches/evidence when useful, not permanent strategy registries.
- Separate immutable setup from sample execution, and reuse setup for fast local
  iteration. Each sample retains independent logical state where isolation matters.
- Track module imports and SQL/physical-command counts. These explain cost; only
  complete correctness and performance evidence can justify replacing the core.
