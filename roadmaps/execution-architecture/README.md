# Execution Architecture

## Status And Scope

**Active, owner-authorized design and refactor.** The owner requested clear
separation of direct Medusa operations, direct Payload operations, and Application
queries and mutations that compose admitted framework behavior. Necessary private
contract breaks, caller migration and cleanup are authorized. This roadmap owns
that organization and reuse; it does not claim every operation is implemented.

The first slice is [direct read capabilities](01-direct-read-capabilities.md).
The [architecture map](architecture.md) explains entry points, ownership, folder
direction and current coverage. Read it before the individual implementation plans.

Performance tuning is paused at the accepted standalone-read measurements.
The local standalone-read and retained installation cutover is complete. Public authoring
APIs, hosted activation, arbitrary framework admission and general schema
evolution retain their owning gates.

## Current Sources Of Truth

- [Accepted database design](../../design-notes/flarex-db-accepted-design.md)
  owns authority, replacement policy and durable-data obligations.
- [Package boundaries](../16-package-boundaries.md) owns dependency direction.
- [Mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md)
  owns shared snapshot, pending changes, retry and atomic settlement.
- [Medusa design quality](../medusa-design-quality/README.md) owns completed
  module construction and native semantic reuse; do not rebuild those owners.
- [Workflow foundations](../workflow-foundations/README.md) and
  [durable tasks](../durable-task-engine/README.md) own distinct workflow lifecycles.
- [Standalone read preflight](../core-performance/standalone-read-redesign-preflight.md)
  owns the managed installation/read contract and deferred performance targets.
- Current code and decisive tests establish exact supported operations. Older
  receipts and example syntax do not establish a public API or broader support.

## Current Architecture

Direct Commerce and CMS hosts support bounded native operations. Managed direct
readers now have independent construction and expose only read capabilities.
Ordinary hosts retain their real full-proof read/write profiles. Payload binds
both through the same native instance and operation definitions. CMS commands
and failure projection have independent shared owners instead of importing the
write-capable host from read execution. Application execution has a separate journal-backed mutation owner;
selected native participants borrow its snapshot and pending changes. Finite
Medusa atomic workflow construction already exists. Cross-framework Application
query composition is not established by the direct read draft.

## Invariants And Trust Boundaries

- Postgres is authoritative. One outer execution owns settlement.
- Native Medusa and Payload retain business, access, validation and hook meaning.
- Direct operations own their execution; participants borrow the admitted outer
  execution. A missing or invalid participant context must never start a new
  independently committed operation as fallback.
- Application mutations keep exact observations, pending visibility, conflict
  validation, full-attempt retries and uncertain-outcome recovery.
- No SQL transaction spans untrusted Application execution, unadmitted hooks,
  external effects or workflow suspension.
- Immutable preparation may be reused; principal, live authority, request state
  and mutable framework instances retain their actual lifetimes.
- Reorganizing code does not authorize new schema, journal or durable-data resets.

## Decisions And Rationale

Organize by responsibility and execution ownership. Keep direct framework entry
points and composed Application entry points distinct while reusing native
behavior and correct shared mechanisms. Do not create a universal transaction
API, framework dispatcher or a storage engine per framework. Split packages only
for an actual dependency/runtime boundary; folders are the initial tool.

Use `read`, `query`, `mutation`, `workflow`, `admission`, `commit`, `recovery` and
`installation` for the responsibilities they actually describe. A query may
perform several storage reads. A read inside a mutation remains part of that
mutation. `Mixed` describes participation, not a required developer API suffix.

## Convex Compatibility And Flarex Divergences

Preserve the Application query/mutation distinction and exact read dependencies
under the accepted design. Framework-native access, hooks, events and finite
workflow composition are Flarex integration obligations, not behavior inferred
from Convex. Before changing Application execution, inspect the checked-in Convex
query/mutation owners and document necessary divergences in the relevant slice.
The first slice changes trusted direct framework construction only.

## Implemented Capabilities And Known Gaps

See the [capability matrix](architecture.md#capability-matrix). Private direct and
mixed operations have different admitted coverage. A folder or common interface
does not extend it. The read draft still needs its installation integration,
connected correctness proofs and final review; accepted latency does not close
those gates. The paused publication experiment is archived separately from the
active read redesign; it is not part of the active runtime changes.

## Target Direction And Ordered Gates

1. **Direct read capabilities (complete for the admitted local profiles):** independently construct typed read hosts for
   both frameworks, remove fake write methods and read/write construction cycles,
   migrate native consumers and preserve refusal/lifetime behavior.
2. **[Framework runtime and participant ownership](02-runtime-and-participant-ownership.md) (complete for the admitted local profiles):** separate ordinary native
   construction from conformance fixtures, organize direct and borrowed bindings,
   reuse native operations and completed Medusa module/workflow construction.
   Prove selected create/update/read both directly and inside the existing root.
3. **Execution and persistence organization:** inventory the actual callers of
   Commerce/CMS, atomic Commerce, cross-domain commands and Application attempt
   owners. Move orchestration and database mechanics to their correct existing
   packages, consolidate genuine duplicates, remove displaced entry points.
4. **Composed Application query:** establish one explicit snapshot/dependency and
   authorization contract for Application + Medusa + Payload reads. Prove native
   visibility and concurrent changes through the actual sandbox boundary before
   claiming support. This needs its own focused preflight, not a nested direct host.
5. **Connected completion:** validate direct reads/writes, finite direct workflows,
   composed query/mutation and their recovery/failure boundaries. Finish the
   remaining profile retirement obligations; audit imports, exports, obsolete code and
   retained durable formats. Publish one accurate architecture/capability map.

Every slice includes consumer migration, cleanup, focused validation and both
required reviews. Schema/transaction changes require PGlite and ordinary-role
Postgres evidence. Do not make file moves or helper extraction separate goals.
Each later preflight records concrete owners and contract changes before edits;
the owner has authorized this refactor without repeated general permission.
